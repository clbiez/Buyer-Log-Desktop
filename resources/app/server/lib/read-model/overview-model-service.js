'use strict';
/* Genel Bakış okuma modeli servisi (#1074). HTTP'den bağımsız orkestrasyon.
 *
 * Yetki sınırı (WS1 read-model-service ile aynı):
 *  - guard.capture(req,'overview') oturum + alan yetkisini doğrular ve
 *    kullanıcı/bağlam/yetki/kaynak damgasını yakalar.
 *  - Satırlar YALNIZ loadProjection(req,module) üzerinden gelir (kullanıcıya özel,
 *    compute-access ile kapsama süzülmüş sayfa projeksiyonu). CP kısmı yalnız
 *    kullanıcının 'cp' alanı varsa yüklenir (istemcideki BLCanAccessArea('cp')).
 *  - Yanıt öncesi captured.assertResponse() + lease.assertResponse(): okuma
 *    sırasında yetki/veri nesli değişirse 409 COMPUTE_STALE_GENERATION.
 * Kullanıcıya özel karar bağlamı (CP kuralları, checklist ayarları ve cevapları,
 * Moderatör kuralları, PLM numune verisi, transit kuralları) loadContext(req)
 * ile sunucu kaynaklarından okunur; bağlam revizyonu önbellek anahtarına girer.
 * Önbellek: (yetki damgası, nesiller, bağlam revizyonu, filtre imzası, dil)
 * anahtarlı sınırlı LRU.
 */
const crypto=require('node:crypto');
const Model=require('../../../public/overview-model');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const MAX_VALUES=500,MAX_TEXT=200;

function failure(code,statusCode,tr,en,extra={}){return Object.assign(new Error(`${tr} / ${en}`),{code,statusCode,error:tr,errorEn:en,...extra});}
const invalid=detail=>failure('READ_MODEL_QUERY_INVALID',400,'Geçersiz Genel Bakış modeli isteği.','Invalid Overview model request.',{detail});

/* Gövde: { version:1, lang:'tr'|'en', filters:{ main:{dim:[değer]}, bg:{dim:[değer]} } } */
function validateRequest(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('body');
  if(raw.version!==1)throw invalid('version');
  const lang=raw.lang==='en'?'en':raw.lang==null||raw.lang==='tr'?'tr':null;
  if(!lang)throw invalid('lang');
  const filters={};
  for(const scope of ['main','bg']){
    const source=raw.filters&&raw.filters[scope];
    if(source==null){filters[scope]={};continue;}
    if(typeof source!=='object'||Array.isArray(source))throw invalid(`filters.${scope}`);
    const clean={};
    for(const [dim,values] of Object.entries(source)){
      if(!Object.hasOwn(Model.DIM_COLUMNS,dim))throw invalid(`filters.${scope}.${dim}`);
      if(!Array.isArray(values)||values.length>MAX_VALUES||values.some(value=>typeof value!=='string'||value.length>MAX_TEXT))throw invalid(`filters.${scope}.${dim}`);
      if(values.length)clean[dim]=[...new Set(values)].sort();
    }
    filters[scope]=Object.fromEntries(Object.keys(clean).sort().map(dim=>[dim,clean[dim]]));
  }
  return {lang,filters};
}

/* Sunucu kaynaklarından kişisel karar bağlamı. İstemcideki BLStorage ile aynı
   öncelik: kişisel kayıt, yoksa rol varsayılanı. Checklist cevapları istemcideki
   supplier-sync gibi paylaşılan cevap deposuyla birleştirilir. */
function createContextLoader({preferences,roleEntries,managedRules,transitRules,plmPayload,checklistPayload,revision,merge}){
  return function loadContext(profile){
    const key=revision(profile);
    const entries={},roles=roleEntries(profile)||{},personal=(preferences.load(profile.id)||{}).entries||{};
    for(const source of [roles,personal]){
      for(const [name,entry] of Object.entries(source)){
        if(!name.startsWith('lcw.cp.')||!entry||entry.value==null)continue;
        entries[name]=String(entry.value);
      }
    }
    let own={};
    try{const parsed=JSON.parse(entries['lcw.cp.checklist.v1']||'{}');own=parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch(_){own={};}
    return {key,value:{userId:String(profile.id),entries,answers:merge(own,checklistPayload()||{}),managedRules:managedRules()||null,
      plm:plmPayload()||null,transitRules:transitRules(profile)||[]}};
  };
}

function createOverviewModelService({guard,loadProjection,runCompute,loadContext,canAccessCp,maxEntries=32,maxBytes=24*1024*1024}){
  if(!guard||typeof loadProjection!=='function'||typeof runCompute!=='function'||typeof loadContext!=='function'||typeof canAccessCp!=='function')
    throw TypeError('Invalid overview model service dependencies');
  const cache=new Map();let cachedBytes=0;
  const counters={requests:0,hits:0,misses:0,datasetLoads:0,contextLoads:0};
  function remove(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cachedBytes-=entry.bytes;}
  function put(key,scope,entry){
    for(const [other,value] of cache)if(value.scope===scope&&value.generation!==entry.generation)remove(other);
    if(entry.bytes>maxBytes)return;
    remove(key);cache.set(key,{...entry,scope});cachedBytes+=entry.bytes;
    while(cache.size>maxEntries||cachedBytes>maxBytes)remove(cache.keys().next().value);
  }
  function get(key){const entry=cache.get(key);if(entry){cache.delete(key);cache.set(key,entry);}return entry||null;}
  const generationOf=(lease,module)=>{
    const manifest=lease.manifest||{},meta=manifest.modules&&manifest.modules[module];
    return `${manifest.activeGeneration||''}:${String(meta&&meta.checksum||'').slice(0,16)}`;
  };
  function dataset(captured,lease,module){
    if(!lease)return null;
    const generation=generationOf(lease,module);
    // Özet satırları WS1 read-model-service ile aynı anahtarda paylaşılır. CP satırları
    // işçide tarayıcı biçimine getirildiği için ayrı anahtardadır (WS1 sorgusu etkilenmez).
    const name=module==='cp'?'cp-overview':module;
    return {generation,datasetKey:hash(JSON.stringify([captured.key,name,generation])),scopeKey:hash(JSON.stringify([captured.key,name]))};
  }
  function attach(spec,lease){
    const source=lease.value&&lease.value.buffer,bytes=Uint8Array.from(Buffer.isBuffer(source)?source:Buffer.from(source||[]));
    return {spec:{...spec,buffer:bytes.buffer},bytes,uncompressed:Number(lease.value&&lease.value.uncompressedBytes)||bytes.byteLength*8};
  }
  async function model(req,rawBody,{signal}={}){
    const captured=guard.capture(req,'overview');
    const request=validateRequest(rawBody);
    counters.requests++;
    const leases={overview:null,cp:null};
    try{
      leases.overview=await loadProjection(req,'overview');
      const cpAllowed=canAccessCp(req)===true;
      if(cpAllowed)leases.cp=await loadProjection(req,'cp');
      const context=cpAllowed?loadContext(captured.profile||req.currentUser):null;
      captured.assertResponse();leases.overview.assertResponse?.();leases.cp?.assertResponse?.();
      const ov=dataset(captured,leases.overview,'overview'),cp=dataset(captured,leases.cp,'cp');
      const generation=`${ov.generation}|${cp?cp.generation:'-'}`;
      const scope=JSON.stringify([captured.key,'overview-model']);
      const key=JSON.stringify([captured.key,'overview-model',generation,context?context.key:'-',request.lang,request.filters]);
      const cached=get(key);
      if(cached){counters.hits++;captured.assertResponse();return {generation,cached:true,body:cached.body,timing:{...cached.timing,cached:true}};}
      counters.misses++;
      const base={overview:{datasetKey:ov.datasetKey,scopeKey:ov.scopeKey},cp:cp?{datasetKey:cp.datasetKey,scopeKey:cp.scopeKey}:null,
        contextKey:context?hash(String(context.key)):'',filters:request.filters,lang:request.lang};
      const options={signal,estimatedBytes:96*1024*1024,ownerKey:'read-model',generation:'1'};
      let value=await run(base,options);
      if(value&&Array.isArray(value.missing)&&value.missing.length){
        const retry={...base},transferList=[];let extra=0;
        for(const name of value.missing){
          if(name==='context'){counters.contextLoads++;retry.context=context.value;continue;}
          const lease=leases[name];if(!lease)continue;
          counters.datasetLoads++;
          const attached=attach(base[name],lease);retry[name]=attached.spec;transferList.push(attached.bytes.buffer);extra+=attached.uncompressed*6+attached.bytes.byteLength;
        }
        value=await run(retry,{...options,estimatedBytes:options.estimatedBytes+extra,inputBytes:extra,transferList});
      }
      if(!value||typeof value.body!=='string')throw failure('COMPUTE_WORKER_FAILED',500,'Hesaplama işçisi tamamlanamadı.','Compute worker failed.');
      captured.assertResponse();leases.overview.assertResponse?.();leases.cp?.assertResponse?.();
      put(key,scope,{generation,body:value.body,timing:value.timing,bytes:Buffer.byteLength(value.body)});
      return {generation,cached:false,body:value.body,timing:value.timing};
    }finally{leases.overview?.release?.();leases.cp?.release?.();}
  }
  async function run(payload,options){
    const result=await runCompute('read-model-overview',payload,options);
    try{return result.value;}finally{result.release?.();}
  }
  function clear(){cache.clear();cachedBytes=0;}
  function stats(){return {...counters,entries:cache.size,bytes:cachedBytes,maxEntries,maxBytes};}
  return {model,clear,stats};
}
module.exports={createOverviewModelService,createContextLoader,validateRequest};
