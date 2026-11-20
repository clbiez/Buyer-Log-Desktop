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
const {performance}=require('node:perf_hooks');
const cpQuery=require('./cp-query');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const DECISION_FACTOR=3;
const WARM_BASE_BYTES=96*1024*1024;
const TOKEN=/^[A-Za-z0-9_-]{1,64}$/;

function failure(code,statusCode,tr,en,extra={}){return Object.assign(new Error(`${tr} / ${en}`),{code,statusCode,error:tr,errorEn:en,...extra});}
const invalid=detail=>failure('READ_MODEL_QUERY_INVALID',400,'Geçersiz CP hesaplanmış sütun isteği.','Invalid CP computed columns request.',{detail});

const MAX_OVERLAY=5000,MAX_KEY=512,MAX_ANSWER_BYTES=16*1024;
/* Gövde: { version:1, lang:'tr'|'en', since?:<önceki yanıtın token'ı>,
     answers?:{ "<sipariş|opsiyon>::<kalem>": cevap | null } }
   answers: istemcinin henüz sunucuya ulaşmamış (checklist senkron kuyruğundaki)
   KENDİ cevapları. Yalnız bu kullanıcının bu hesabında sunucu cevaplarının üstüne
   konur; diske yazılmaz, başka kullanıcıya ya da önbellekteki başka anahtara geçmez.
   Senkron tamamlanınca istemci göndermeyi bırakır (kuyruk boşalır). */
function validateRequest(raw,{extra=null}={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw invalid('body');
  if(raw.version!==1)throw invalid('version');
  const lang=raw.lang==='en'?'en':raw.lang==null||raw.lang==='tr'?'tr':null;
  if(!lang)throw invalid('lang');
  if(raw.since!=null&&(extra||typeof raw.since!=='string'||!TOKEN.test(raw.since)))throw invalid('since');
  for(const key of Object.keys(raw))if(!['version','lang','since','answers'].includes(key)&&key!==extra)throw invalid(key);
  let answers=null;
  if(raw.answers!=null){
    if(typeof raw.answers!=='object'||Array.isArray(raw.answers))throw invalid('answers');
    const keys=Object.keys(raw.answers);
    if(keys.length>MAX_OVERLAY)throw invalid('answers');
    answers={};
    for(const key of keys.sort()){
      const value=raw.answers[key];
      if(!key||key.length>MAX_KEY||key.lastIndexOf('::')<=0)throw invalid('answers.key');
      if(value!==null&&(typeof value!=='object'||Array.isArray(value)||typeof value.state!=='string'||value.state.length>64||JSON.stringify(value).length>MAX_ANSWER_BYTES))throw invalid('answers.value');
      answers[key]=value;
    }
    if(!keys.length)answers=null;
  }
  return {lang,since:raw.since||null,answers};
}
function overlayAnswers(base,overlay){
  if(!overlay)return base;
  const out={...(base||{})};
  for(const [key,value] of Object.entries(overlay)){if(value===null)delete out[key];else out[key]=value;}
  return out;
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
/* İşçideki karar barındırıcısının kapsamı (#1078 alt PR 3): kullanıcı + yetki kapsamı + karar girdisinde
   olmayan bağımlılıklar (iş takvimi; createContextLoader revision). Veri sürümü (override/kaynak, guard
   contextHash/sourceToken) BURAYA GİRMEZ: veri değişimini işçi satır kaynak özetiyle bulur ve yalnız etkilenen
   satırları yeniden hesaplar; diğer karar girdileri (tercihler, kurallar, PLM, transit, dil) barındırıcı
   anahtarında, cevaplar/görevler/gün barındırıcı içinde izlenir. Kimlik bilinmiyorsa eski (dar) kapsam. */
function hostScopeOf(captured,context){
  if(captured.userId==null||captured.accessHash==null||!context||!Object.hasOwn(context,'revision'))return hash(JSON.stringify([captured.key,'cp-computed']));
  return hash(JSON.stringify([String(captured.userId),String(captured.accessHash),context.revision,'cp-computed']));
}
/* Veri kümesi önbelleği kapsamı: aynı kapsamın eski nesilleri işçide anında düşer. Veri sürümüne bağlı olursa
   her düzenleme yeni kapsam açar, eski 30k veri kümeleri birikir ve işçi bellek bütçesini aşıp yeniden başlar. */
function datasetScopeOf(captured){
  if(captured.userId==null||captured.accessHash==null)return hash(JSON.stringify([captured.key,'cp-overview']));
  return hash(JSON.stringify([String(captured.userId),String(captured.accessHash),'cp-overview']));
}
/* İstemci iptali (pencereli CP yeni çizimde eski sorguyu iptal eder) işçiye İLETİLMEZ: havuz çalışan işi
   iptal edince işçiyi kapatır; barındırıcı ve veri kümesi kaybolur, sonraki sorgu soğuk tam hesap yapar
   (30k: ~15 sn; düzenleme sonrası art arda sorgularda kısır döngü). Başlamış hesap biter ve önbelleğe girer;
   iş zaman aşımı (havuz timeoutMs) geçerlidir. Kapanmış istek işçiye hiç verilmez. */
/* Veri kümesi yükleyen denemenin bellek tahmini. Barındırıcı sıcaksa (işçi `warm` bildirdi) yeni nesil artımlı
   hesaplanır: soğuk karar payı (DECISION_FACTOR) istenmez. İstenirse yerleşik barındırıcı + veri kümesiyle
   bütçe aşılır ve havuz boştaki işçiyi "yer açmak için" kapatır; her düzenleme soğuk tam hesaba döner
   (30k: ~15 sn). Tahmin yanlış çıkarsa havuz işi COMPUTE_ESTIMATE_EXCEEDED ile reddeder (sessiz aşım yok). */
function datasetLoadEstimate(out,options,uncompressed,inputBytes){
  return (out&&out.warm===true?WARM_BASE_BYTES:options.estimatedBytes)+uncompressed*6+inputBytes;
}
function workerOptions(options){
  const {signal,...rest}=options;
  if(signal&&signal.aborted)throw failure('COMPUTE_ABORTED',499,'Hesaplama iptal edildi.','Compute operation cancelled.');
  return rest;
}
/* Bekleyen satır yaması zinciri (#1078 WS5 satır yaması). İşçideki son veri kümesinin bağlamından (temel)
   güncel bağlama satır kaydı günlüğünde zincir varsa projeksiyon kirası ALINMAZ (yeni nesil yazılırken
   okumalar 30k'da 6–10 sn beklerdi): işçi temel veri kümesine yalnız kaydedilen yamaları uygular ve
   artımlı hesaplar. Kimlik kapısı aynıdır (guard.capture + assertResponse; kullanıcı, yetki ve kaynak
   damgası temelinkiyle aynı olmalı); temel veri kümesi kullanıcının yetki kapsamına süzülmüş projeksiyondur
   ve yama yalnız oradaki satırlara uygulanır (kapsam dışı satır eklenmez).
   Doğrulama: zincirdeki her geçişin projeksiyon yeniden yazımı bitince gerçek neslin yamalı CP satırları
   işçideki satırlarla karşılaştırılır. Uyuşmazlıkta ya da yeniden yazım başarısızsa temel düşer ve istek
   gerçek nesille (kira + artımlı plan; değişen satırlar yeniden hesaplanır) yeniden yürütülür. */
const MAX_LINEAGE=64;
function createCpComputedService({guard,loadProjection,runCompute,loadContext,loadTasks=async()=>[],today=localDay,maxEntries=8,maxBytes=96*1024*1024,
  rowPatchLog=null,onRowPatchMismatch=()=>{}}){
  if(!guard||typeof loadProjection!=='function'||typeof runCompute!=='function'||typeof loadContext!=='function'||typeof loadTasks!=='function')
    throw TypeError('Invalid CP computed service dependencies');
  const cache=new Map(),latest=new Map(),bases=new Map();let cachedBytes=0;
  const counters={requests:0,hits:0,misses:0,emptyDeltas:0,datasetLoads:0,rowPatchReads:0,rowPatchBuilds:0,rowPatchVerified:0,rowPatchMismatches:0,rowPatchFallbacks:0};
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
  const stampOf=captured=>JSON.stringify([String(captured.userId),String(captured.accessHash),String(captured.sourceToken)]);
  function rowPatchPlan(captured,scope){
    if(!rowPatchLog||captured.userId==null||captured.contextHash==null)return null;
    const base=bases.get(scope);
    if(!base||base.stamp!==stampOf(captured))return null;
    const to=String(captured.contextHash);
    if(base.contextHash===to)return base.virtual?{base,datasetKey:base.datasetKey,steps:null,lineage:base.lineage,contextHash:to}:null;
    const chain=rowPatchLog.chain(captured.userId,base.contextHash,to);
    if(!chain||!chain.entries.length)return null;
    const lineage=base.lineage.concat(chain.entries);
    if(lineage.length>MAX_LINEAGE)return null;
    return {base,datasetKey:hash(JSON.stringify([base.datasetKey,to,'cp-rowpatch'])),steps:chain.entries.map(entry=>({items:entry.items,context:entry.context})),lineage,contextHash:to};
  }
  /* Zincirin tüm yeniden yazımları bittiyse doğrulama satırları (aynı _id için en son yazım); başarısız yazım → fail. */
  function verificationOf(lineage){
    if(!lineage.length||lineage.some(entry=>!entry.settled))return null;
    if(lineage.some(entry=>!entry.settled.ok))return {fail:true};
    const rows=new Map();
    for(const entry of lineage){
      let list=[];try{list=JSON.parse(entry.settled.rowsJson);}catch(_){return {fail:true};}
      for(const row of Array.isArray(list)?list:[])if(row&&row._id!=null)rows.set(String(row._id),row);
    }
    return {rowsJson:JSON.stringify([...rows.values()])};
  }
  /* Satırları yükleyen ortak yol: önce bekleyen yama zinciri, olmazsa projeksiyon kirası.
     exec({dataset, extra, options, generation, verifying}) işçi çıktısını ya da {short:<sonuç>} döner
     (önbellek isabeti; işçiye gidilmedi). Dönen: {out|short, generation, leaseMs, rowPatch?}. */
  async function withDataset(req,captured,signal,exec){
    const scope=datasetScopeOf(captured);
    const plan=rowPatchPlan(captured,scope);
    if(plan){
      const verification=verificationOf(plan.lineage);
      if(verification&&verification.fail){bases.delete(scope);counters.rowPatchMismatches++;onRowPatchMismatch({reason:'rewrite-failed',userId:captured.userId});}
      else{
        const generation='rp:'+plan.datasetKey.slice(0,24);
        const dataset={datasetKey:plan.datasetKey,scopeKey:scope,...(plan.steps?{virtual:{baseKey:plan.base.datasetKey,steps:plan.steps}}:{})};
        const out=await exec({dataset,extra:verification?{verify:{rowsJson:verification.rowsJson}}:{},generation,verifying:Boolean(verification),
          options:workerOptions({signal,estimatedBytes:96*1024*1024+Math.ceil(plan.base.uncompressed*DECISION_FACTOR),ownerKey:'read-model',generation:'1'})});
        if(out&&out.short)return {short:out.short,generation,leaseMs:0};
        const missing=!out||Array.isArray(out.missing);
        const mismatch=!missing&&out.verify&&out.verify.mismatched>0;
        if(!missing&&!mismatch){
          counters.rowPatchReads++;if(plan.steps)counters.rowPatchBuilds++;
          const verified=Boolean(verification&&out.verify);
          if(verified)counters.rowPatchVerified++;
          bases.set(scope,{...plan.base,contextHash:plan.contextHash,datasetKey:plan.datasetKey,virtual:true,lineage:verified?[]:plan.lineage});
          return {out,generation,leaseMs:0,rowPatch:{steps:plan.steps?plan.steps.length:0,pending:verified?0:plan.lineage.length,verified}};
        }
        bases.delete(scope);
        if(mismatch){counters.rowPatchMismatches++;onRowPatchMismatch({reason:'row-mismatch',userId:captured.userId,ids:out.verify.ids,checked:out.verify.checked,mismatched:out.verify.mismatched});}
        else counters.rowPatchFallbacks++;
      }
    }
    const t0=performance.now();
    const lease=await loadProjection(req,'cp');
    try{
      const leaseMs=Math.round(performance.now()-t0);
      captured.assertResponse();lease.assertResponse?.();
      const generation=generationOf(lease);
      // Veri kümesi WS2a Genel Bakış ile aynı anahtardadır (tarayıcı biçiminde CP satırları).
      const datasetKey=hash(JSON.stringify([captured.key,'cp-overview',generation]));
      const value=lease.value||{},compressed=Buffer.isBuffer(value.buffer)?value.buffer.length:Number(value.buffer&&value.buffer.byteLength)||0;
      const uncompressed=Number(value.uncompressedBytes)||compressed*8;
      const options={signal,estimatedBytes:96*1024*1024+Math.ceil(uncompressed*DECISION_FACTOR),ownerKey:'read-model',generation:'1'};
      let out=await exec({dataset:{datasetKey,scopeKey:scope},extra:{},generation,verifying:false,options:workerOptions(options)});
      if(out&&out.short)return {short:out.short,generation,leaseMs};
      if(out&&Array.isArray(out.missing)&&out.missing.includes('cp')){
        counters.datasetLoads++;
        const source=value.buffer,bytes=Uint8Array.from(Buffer.isBuffer(source)?source:Buffer.from(source||[]));
        out=await exec({dataset:{datasetKey,scopeKey:scope,buffer:bytes.buffer},extra:{},generation,verifying:false,
          options:workerOptions({...options,estimatedBytes:datasetLoadEstimate(out,options,uncompressed,bytes.byteLength),inputBytes:bytes.byteLength,transferList:[bytes.buffer]})});
      }
      captured.assertResponse();lease.assertResponse?.();
      if(out&&!out.missing&&!out.short)bases.set(scope,{stamp:stampOf(captured),contextHash:String(captured.contextHash),datasetKey,virtual:false,lineage:[],uncompressed});
      return {out,generation,leaseMs};
    }finally{lease.release?.();}
  }
  async function run(task,payload,options){
    const result=await runCompute(task,payload,options);
    try{return result.value;}finally{result.release?.();}
  }
  async function computed(req,rawBody,{signal}={}){
    const captured=guard.capture(req,'cp');
    const request=validateRequest(rawBody);
    counters.requests++;
    const t1=performance.now();
    const profile=captured.profile||req.currentUser;
    const context=loadContext(profile);
    const t2=performance.now();
    const tasks=await loadTasks(profile);
    const service={contextMs:Math.round(t2-t1),tasksMs:Math.round(performance.now()-t2)};
    captured.assertResponse();
    const contextKey=hash(JSON.stringify([String(context.key),tasks,request.answers]));
    const scope=JSON.stringify([captured.key,'cp-computed']);
    const contextValue=request.answers?{...context.value,answers:overlayAnswers(context.value&&context.value.answers,request.answers)}:context.value;
    // Kararlar yerel güne bağlıdır (istemcide de önbellek gün değişince düşer).
    const keyOf=generation=>JSON.stringify([captured.key,'cp-computed',generation,contextKey,request.lang,today()]);
    const t3=performance.now();
    const loaded=await withDataset(req,captured,signal,async({dataset,extra,options,generation,verifying})=>{
      const key=keyOf(generation),last=latest.get(scope);
      if(!verifying&&!dataset.buffer&&request.since&&last&&last.token===request.since&&last.key===key){
        counters.emptyDeltas++;captured.assertResponse();
        return {short:{generation,cached:true,body:`{"version":1,"lang":${JSON.stringify(request.lang)},"token":${JSON.stringify(last.token)},"delta":true,"total":${last.total},"fields":null,"rows":[],"removed":[]}`,timing:{cached:true,delta:true,changed:0,service}}};
      }
      if(!verifying&&!dataset.buffer&&!request.since){
        const cached=get(key);
        if(cached){counters.hits++;captured.assertResponse();latest.set(scope,{key,token:cached.token,total:cached.total});return {short:{generation,cached:true,body:cached.body,timing:{...cached.timing,cached:true}}};}
      }
      return run('read-model-cp-computed',{dataset,scopeKey:hostScopeOf(captured,context),lang:request.lang,since:request.since,context:contextValue,tasks,...extra},options);
    });
    if(loaded.short)return loaded.short;
    counters.misses++;
    const {out,generation}=loaded;
    if(!out||typeof out.body!=='string')throw failure('COMPUTE_WORKER_FAILED',500,'Hesaplama işçisi tamamlanamadı.','Compute worker failed.');
    captured.assertResponse();
    const key=keyOf(generation),head=JSON.parse(out.body.slice(0,out.body.indexOf(',"fields"'))+'}');
    latest.set(scope,{key,token:head.token,total:head.total});
    if(!head.delta)put(key,scope,{body:out.body,timing:out.timing,token:head.token,total:head.total,bytes:Buffer.byteLength(out.body)});
    return {generation,cached:false,body:out.body,timing:{...out.timing,service:{...service,leaseMs:loaded.leaseMs,...(loaded.rowPatch?{rowPatch:loaded.rowPatch}:{}),computeMs:Math.round(performance.now()-t3)}}};
  }
  /* Alt PR 2 (pencereli okuma): POST /api/read-model/cp/query ve /facets.
     Gövde: { version:1, lang?, answers?, query|facets:<cp-query.js sürüm 1> }.
     Aynı yetki kapısı, satır kaynağı (bekleyen yama zinciri ya da projeksiyon kirası), kişisel bağlam ve
     görev süzmesi; hesaplanmış değerler işçide ensureComputed önbelleğinden (bağlam/cevap/gün aynıysa yeniden hesap yok). */
  async function read(kind,req,rawBody,{signal}={}){
    const captured=guard.capture(req,'cp');
    const field=kind==='facets'?'facets':'query';
    const request=validateRequest(rawBody,{extra:field});
    const spec=rawBody[field];
    // Erken 400: işçi kuyruğuna girmeden (işçi de aynı doğrulamayı yapar).
    if(kind==='facets')cpQuery.validateCpFacets(spec);else cpQuery.validateCpQuery(spec);
    counters.requests++;
    const t1=performance.now();
    const profile=captured.profile||req.currentUser;
    const context=loadContext(profile);
    const tasks=await loadTasks(profile);
    const service={contextMs:Math.round(performance.now()-t1)};
    captured.assertResponse();
    const contextValue=request.answers?{...context.value,answers:overlayAnswers(context.value&&context.value.answers,request.answers)}:context.value;
    const t2=performance.now();
    const loaded=await withDataset(req,captured,signal,({dataset,extra,options})=>
      run('read-model-cp-query',{dataset,scopeKey:hostScopeOf(captured,context),lang:request.lang,context:contextValue,tasks,kind,request:spec,...extra},options));
    const {out,generation}=loaded;
    if(!out||!out.result)throw failure('COMPUTE_WORKER_FAILED',500,'Hesaplama işçisi tamamlanamadı.','Compute worker failed.');
    captured.assertResponse();
    return {generation,result:out.result,timing:{...out.timing,service:{...service,leaseMs:loaded.leaseMs,...(loaded.rowPatch?{rowPatch:loaded.rowPatch}:{}),computeMs:Math.round(performance.now()-t2)}}};
  }
  function clear(){cache.clear();latest.clear();bases.clear();cachedBytes=0;}
  function stats(){return {...counters,entries:cache.size,bytes:cachedBytes,maxEntries,maxBytes,rowPatchBases:bases.size};}
  return {computed,query:(req,body,opts)=>read('query',req,body,opts),facets:(req,body,opts)=>read('facets',req,body,opts),clear,stats};
}
module.exports={createCpComputedService,createTaskLoader,validateRequest};
