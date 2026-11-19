'use strict';
/* Okuma modeli servisi (#1073): HTTP'den bağımsız orkestrasyon.
 *
 * Yetki sınırı:
 *  - guard.capture(req, area) oturum + alan yetkisini doğrular (401/403) ve
 *    kullanıcı/bağlam/yetki/kaynak damgasını yakalar.
 *  - Satırlar YALNIZ loadProjection(req, module) üzerinden gelir: bu, istemcinin
 *    bugün kullandığı kullanıcıya özel sayfa projeksiyonudur (compute-tasks
 *    scopedOrders → compute-access.filterRows ile görünüm kapsamına süzülmüş,
 *    _canEdit/_canEditShared işlenmiş). Kapsam dışı satır projeksiyona hiç
 *    girmediği için ne pencereye ne toplama girer.
 *  - Yanıt öncesi captured.assertResponse() + lease.assertResponse(): okuma
 *    sırasında yetki/veri nesli değişirse 409 COMPUTE_STALE_GENERATION.
 * Önbellek: (yetki damgası[kullanıcı, bağlam, yetki, kaynak], modül, nesil,
 * sorgu imzası) anahtarlı sınırlı LRU. Nesil = manifest activeGeneration +
 * modül checksum'ı; değişince eski anahtarlar kullanılmaz ve aynı kapsamın eski
 * nesilleri silinir.
 */
const crypto=require('node:crypto');
const engine=require('./query-engine');
// server/routes/read-model-routes.js AREAS ile aynı tutulur (test: read-model-service).
const AREAS=Object.freeze({cp:'cp',orders:'orders',overview:'overview'});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function failure(code,statusCode,tr,en,extra={}){return Object.assign(new Error(`${tr} / ${en}`),{code,statusCode,error:tr,errorEn:en,...extra});}
const unknownModule=()=>failure('READ_MODEL_MODULE_UNKNOWN',404,'Bilinmeyen okuma modeli modülü.','Unknown read model module.');

function createReadModelService({guard,loadProjection,runCompute,calendar=()=>({configured:false}),maxEntries=64,maxBytes=32*1024*1024}){
  if(!guard||typeof loadProjection!=='function'||typeof runCompute!=='function')throw TypeError('Invalid read model service dependencies');
  const cache=new Map();let cachedBytes=0;
  const counters={queries:0,hits:0,misses:0,datasetLoads:0};
  function remove(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cachedBytes-=entry.bytes;}
  function put(key,scope,entry){
    for(const [other,value] of cache)if(value.scope===scope&&value.generation!==entry.generation)remove(other);
    if(entry.bytes>maxBytes)return;
    remove(key);cache.set(key,{...entry,scope});cachedBytes+=entry.bytes;
    while(cache.size>maxEntries||cachedBytes>maxBytes)remove(cache.keys().next().value);
  }
  function get(key){const entry=cache.get(key);if(entry){cache.delete(key);cache.set(key,entry);}return entry||null;}
  function generationOf(lease,module){
    const manifest=lease.manifest||{},meta=manifest.modules&&manifest.modules[module];
    return `${manifest.activeGeneration||''}:${String(meta&&meta.checksum||'').slice(0,16)}`;
  }
  async function compute(payload,options){
    const result=await runCompute('read-model-query',payload,options);
    try{return result.value;}finally{result.release?.();}
  }
  async function query(req,module,rawQuery,{signal}={}){
    const area=AREAS[module];
    if(!area)throw unknownModule();
    // Yetki önce: yetkisiz kullanıcı sorgunun geçerliliğini de öğrenmez (403 > 400).
    const captured=guard.capture(req,area);
    const query=engine.validateQuery(rawQuery);
    counters.queries++;
    const lease=await loadProjection(req,module);
    try{
      captured.assertResponse();lease.assertResponse?.();
      const generation=generationOf(lease,module),scope=JSON.stringify([captured.key,module]);
      const key=JSON.stringify([captured.key,module,generation,engine.signature(rawQuery)]);
      const cached=get(key);
      if(cached){counters.hits++;captured.assertResponse();return {module,generation,cached:true,body:cached.body,timing:{...cached.timing,cached:true}};}
      counters.misses++;
      const datasetKey=hash(JSON.stringify([captured.key,module,generation])),scopeKey=hash(scope);
      const base={datasetKey,scopeKey,query:rawQuery,calendar:calendar()};
      const options={signal,estimatedBytes:64*1024*1024,ownerKey:'read-model',generation:'1'};
      let value=await compute(base,options);
      if(value&&value.missing){
        counters.datasetLoads++;
        // Sayfa önbelleğinin LRU Buffer'ı paylaşılır: aktarım için kopyalanır.
        const source=lease.value&&lease.value.buffer,bytes=Uint8Array.from(Buffer.isBuffer(source)?source:Buffer.from(source||[]));
        const uncompressed=Number(lease.value&&lease.value.uncompressedBytes)||bytes.byteLength*8;
        value=await compute({...base,buffer:bytes.buffer},{...options,estimatedBytes:64*1024*1024+uncompressed*6+bytes.byteLength,inputBytes:bytes.byteLength,transferList:[bytes.buffer]});
      }
      if(value&&value.error)throw failure(value.error.code||'READ_MODEL_QUERY_INVALID',400,'Geçersiz okuma modeli sorgusu.','Invalid read model query.',{detail:value.error.detail||null});
      if(!value||typeof value.body!=='string')throw failure('COMPUTE_WORKER_FAILED',500,'Hesaplama işçisi tamamlanamadı.','Compute worker failed.');
      captured.assertResponse();lease.assertResponse?.();
      put(key,scope,{generation,body:value.body,timing:value.timing,bytes:Buffer.byteLength(value.body)});
      return {module,generation,cached:false,body:value.body,timing:value.timing};
    }finally{lease.release?.();}
  }
  function clear(){cache.clear();cachedBytes=0;}
  function stats(){return {...counters,entries:cache.size,bytes:cachedBytes,maxEntries,maxBytes};}
  return {query,clear,stats};
}
module.exports={createReadModelService,AREAS};
