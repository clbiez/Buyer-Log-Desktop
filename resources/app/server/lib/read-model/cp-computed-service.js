'use strict';
/* CP hesaplanmış sütunlar servisi (#1078, WS5 alt PR 1). HTTP'den bağımsız.
 *
 * Yetki sınırı (WS1 read-model-service / WS2a overview-model-service ile aynı):
 *  - guard.capture(req,'cp') oturum + CP alan yetkisini doğrular, kullanıcı/
 *    bağlam/yetki/kaynak damgasını yakalar.
 *  - Satırlar YALNIZ loadProjection(req,'cp') üzerinden gelir: istemcinin bugün
 *    indirdiği, compute-access ile kullanıcının görünüm kapsamına süzülmüş CP
 *    sayfa projeksiyonu. Kapsam dışı satır hesaplanmaz, yanıta girmez.
 *  - Kişisel karar bağlamı WS2a createContextLoader ile sunucu kayıtlarından,
 *    test raporu görevleri kullanıcının yetkili siparişlerine süzülmüş halde gelir.
 *  - Yanıt öncesi captured.assertResponse() + lease.assertResponse(): okuma
 *    sırasında yetki/veri nesli değişirse 409 COMPUTE_STALE_GENERATION.
 * Önbellek: tam yanıtlar (yetki damgası, nesil, bağlam, dil) anahtarlı sınırlı
 * LRU. `since` ile gelen istek aynı kapsamın son sonucuna göre yalnız değişen
 * satırları alır; nesil ve bağlam aynıysa işçiye gidilmeden boş delta döner.
 */
const crypto=require('node:crypto');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const DECISION_FACTOR=3;
const TOKEN=/^[A-Za-z0-9_-]{1,64}$/;

function failure(code,statusCode,tr,en,extra={}){return Object.assign(new Error(`${tr} / ${en}`),{code,statusCode,error:tr,errorEn:en,...extra});}
const invalid=detail=>failure('READ_MODEL_QUERY_INVALID',400,'Geçersiz CP hesaplanmış sütun isteği.','Invalid CP computed columns request.',{detail});

/* Gövde: { version:1, lang:'tr'|'en', since?:<önceki yanıtın token'ı> } */
function validateRequest(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('body');
  if(raw.version!==1)throw invalid('version');
  const lang=raw.lang==='en'?'en':raw.lang==null||raw.lang==='tr'?'tr':null;
  if(!lang)throw invalid('lang');
  if(raw.since!=null&&(typeof raw.since!=='string'||!TOKEN.test(raw.since)))throw invalid('since');
  for(const key of Object.keys(raw))if(!['version','lang','since'].includes(key))throw invalid(key);
  return {lang,since:raw.since||null};
}

const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;};
/* Test raporu görevleri: GET /api/test-reports/tasks ile aynı süzme (kullanıcının
   yetkili siparişleri). Görev yoksa yetki modeli kurulmaz. */
function createTaskLoader({list,authorizedOrders}){
  return async function loadTasks(profile){
    const all=typeof list==='function'?list():[];
    if(!Array.isArray(all)||!all.length)return [];
    const allowed=await authorizedOrders(profile);
    return all.filter(task=>task&&allowed&&typeof allowed.has==='function'&&allowed.has(task.orderKey));
  };
}
function createCpComputedService({guard,loadProjection,runCompute,loadContext,loadTasks=async()=>[],today=localDay,maxEntries=8,maxBytes=96*1024*1024}){
  if(!guard||typeof loadProjection!=='function'||typeof runCompute!=='function'||typeof loadContext!=='function'||typeof loadTasks!=='function')
    throw TypeError('Invalid CP computed service dependencies');
  const cache=new Map(),latest=new Map();let cachedBytes=0;
  const counters={requests:0,hits:0,misses:0,emptyDeltas:0,datasetLoads:0};
  function remove(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cachedBytes-=entry.bytes;}
  function put(key,scope,entry){
    for(const [other,value] of cache)if(value.scope===scope)remove(other);
    if(entry.bytes>maxBytes)return;
    cache.set(key,{...entry,scope});cachedBytes+=entry.bytes;
    while(cache.size>maxEntries||cachedBytes>maxBytes)remove(cache.keys().next().value);
  }
  function get(key){const entry=cache.get(key);if(entry){cache.delete(key);cache.set(key,entry);}return entry||null;}
  const generationOf=lease=>{
    const manifest=lease.manifest||{},meta=manifest.modules&&manifest.modules.cp;
    return `${manifest.activeGeneration||''}:${String(meta&&meta.checksum||'').slice(0,16)}`;
  };
  async function run(payload,options){
    const result=await runCompute('read-model-cp-computed',payload,options);
    try{return result.value;}finally{result.release?.();}
  }
  async function computed(req,rawBody,{signal}={}){
    const captured=guard.capture(req,'cp');
    const request=validateRequest(rawBody);
    counters.requests++;
    const lease=await loadProjection(req,'cp');
    try{
      const profile=captured.profile||req.currentUser;
      const context=loadContext(profile);
      const tasks=await loadTasks(profile);
      captured.assertResponse();lease.assertResponse?.();
      const generation=generationOf(lease);
      // Veri kümesi WS2a Genel Bakış ile aynı anahtardadır (tarayıcı biçiminde CP satırları).
      const datasetKey=hash(JSON.stringify([captured.key,'cp-overview',generation])),datasetScope=hash(JSON.stringify([captured.key,'cp-overview']));
      const contextKey=hash(JSON.stringify([String(context.key),tasks]));
      const scope=JSON.stringify([captured.key,'cp-computed']);
      // Kararlar yerel güne bağlıdır (istemcide de önbellek gün değişince düşer).
      const key=JSON.stringify([captured.key,'cp-computed',generation,contextKey,request.lang,today()]);
      const last=latest.get(scope);
      if(request.since&&last&&last.token===request.since&&last.key===key){
        counters.emptyDeltas++;captured.assertResponse();
        return {generation,cached:true,body:`{"version":1,"lang":${JSON.stringify(request.lang)},"token":${JSON.stringify(last.token)},"delta":true,"total":${last.total},"fields":null,"rows":[],"removed":[]}`,timing:{cached:true,delta:true,changed:0}};
      }
      if(!request.since){
        const cached=get(key);
        if(cached){counters.hits++;captured.assertResponse();latest.set(scope,{key,token:cached.token,total:cached.total});return {generation,cached:true,body:cached.body,timing:{...cached.timing,cached:true}};}
      }
      counters.misses++;
      const base={dataset:{datasetKey,scopeKey:datasetScope},scopeKey:hash(scope),lang:request.lang,since:request.since,context:context.value,tasks};
      const value=lease.value||{},compressed=Buffer.isBuffer(value.buffer)?value.buffer.length:Number(value.buffer&&value.buffer.byteLength)||0;
      const uncompressed=Number(value.uncompressedBytes)||compressed*8;
      const options={signal,estimatedBytes:96*1024*1024+Math.ceil(uncompressed*DECISION_FACTOR),ownerKey:'read-model',generation:'1'};
      let out=await run(base,options);
      if(out&&Array.isArray(out.missing)&&out.missing.includes('cp')){
        counters.datasetLoads++;
        const source=value.buffer,bytes=Uint8Array.from(Buffer.isBuffer(source)?source:Buffer.from(source||[]));
        out=await run({...base,dataset:{...base.dataset,buffer:bytes.buffer}},
          {...options,estimatedBytes:options.estimatedBytes+uncompressed*6+bytes.byteLength,inputBytes:bytes.byteLength,transferList:[bytes.buffer]});
      }
      if(!out||typeof out.body!=='string')throw failure('COMPUTE_WORKER_FAILED',500,'Hesaplama işçisi tamamlanamadı.','Compute worker failed.');
      captured.assertResponse();lease.assertResponse?.();
      const head=JSON.parse(out.body.slice(0,out.body.indexOf(',"fields"'))+'}');
      latest.set(scope,{key,token:head.token,total:head.total});
      if(!head.delta)put(key,scope,{body:out.body,timing:out.timing,token:head.token,total:head.total,bytes:Buffer.byteLength(out.body)});
      return {generation,cached:false,body:out.body,timing:out.timing};
    }finally{lease.release?.();}
  }
  function clear(){cache.clear();latest.clear();cachedBytes=0;}
  function stats(){return {...counters,entries:cache.size,bytes:cachedBytes,maxEntries,maxBytes};}
  return {computed,clear,stats};
}
module.exports={createCpComputedService,createTaskLoader,validateRequest};
