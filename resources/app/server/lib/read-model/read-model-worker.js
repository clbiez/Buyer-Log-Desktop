'use strict';
/* compute-pool işçisi: okuma modeli sorgularını arka uç ana olay döngüsü
   dışında çalıştırır. Çözülmüş veri kümesi (kullanıcı+bağlam+modül+nesil)
   anahtarıyla işçide sınırlı LRU'da tutulur; ana iş parçacığı yalnız ilk
   sorguda sıkıştırılmış projeksiyonu gönderir. */
const {parentPort,threadId}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
globalThis.BLCanonicalFields=require('../canonical-fields');
const dates=require('../../../public/date-dimension');
const engine=require('./query-engine');
// Görev → aynı veri kümesi üzerinde çalışan saf işleyici. Siparişler yüzeyleri (#1076)
// ilk kullanımda yüklenir.
const HANDLERS={
  'read-model-query':(dataset,query)=>engine.executeQuery(dataset,query),
  'read-model-orders-facets':(dataset,query)=>require('./orders-facets').runOrdersFacets(dataset,query),
};
const MiB=1024*1024;

function createDatasetCache({maxEntries=4,maxBytes=768*MiB}={}){
  const entries=new Map();let bytes=0;
  function remove(key){const entry=entries.get(key);if(!entry)return;entries.delete(key);bytes-=entry.bytes;}
  return {
    get(key){const entry=entries.get(key);if(entry){entries.delete(key);entries.set(key,entry);}return entry||null;},
    set(key,scope,entry){
      // Aynı kullanıcı/modül kapsamının eski nesilleri anında düşer.
      for(const [other,value] of entries)if(value.scope===scope&&other!==key)remove(other);
      remove(key);entry.scope=scope;entries.set(key,entry);bytes+=entry.bytes;
      while(entries.size>maxEntries||bytes>maxBytes){const oldest=entries.keys().next().value;if(oldest===key)break;remove(oldest);}
    },
    clear(){entries.clear();bytes=0;},
    stats(){return {entries:entries.size,bytes};},
  };
}
const cache=createDatasetCache();

function execute(task,payload){
  if(task==='health')return {ok:true};
  // Akış Haritası kayıt modeli (#1075): tembel yüklenir, sorgu yolunu etkilemez.
  if(task==='global-flow-records')return require('./global-flow-model').execute(payload);
  if(task==='read-model-backlog-v3')return require('./backlog-v3-model').execute(payload);
  const handler=Object.hasOwn(HANDLERS,task)?HANDLERS[task]:null;
  if(!handler)throw Object.assign(Error('Invalid compute request'),{code:'COMPUTE_JOB_INVALID'});
  const started=performance.now();
  let dataset=cache.get(payload.datasetKey),loadMs=0;
  if(!dataset){
    if(!payload.buffer)return {missing:true};
    const load=performance.now();
    dataset=engine.decodeDataset(payload.buffer);payload.buffer=null;
    loadMs=performance.now()-load;
    cache.set(payload.datasetKey,payload.scopeKey,dataset);
  }
  // Tarih kovaları iş takvimine bağlıdır; her iş kendi takvimini kurar.
  if(payload.calendar&&payload.calendar.configured)dates.setMerchCalendar(payload.calendar.calendar);else dates.clearMerchCalendar();
  const queryStarted=performance.now();
  let body;
  try{body=engine.serializeResult(handler(dataset,payload.query));}
  catch(error){
    // Doğrulama hatası işçiyi emekli etmemeli (önbellek korunur): değer olarak döner.
    if(error&&error.statusCode===400)return {error:{code:error.code,detail:error.detail||null}};
    throw error;
  }
  const queryMs=performance.now()-queryStarted;
  return {body,timing:{loadMs,queryMs,totalMs:performance.now()-started,rows:dataset.rows.length}};
}

/* 503 pilotu (BUYER_LOG_COMPUTE_GC_RECHECK=1): heapUsed çöp toplanmadan ölçülür ve önceki
   işlerden kalan erişilemez nesneleri de içerir. Ölçüm havuzun kabul sınırını aşıyorsa tek
   bir tam GC sonrası yeniden ölçülür; sınır ve havuz denetimi değişmez. Bayrak kapalıyken
   davranış aynıdır. */
let gcFn;
function forceGc(){
  if(gcFn===undefined){try{require('node:v8').setFlagsFromString('--expose-gc');gcFn=require('node:vm').runInNewContext('gc');}catch(_){gcFn=null;}}
  if(typeof gcFn!=='function')return false;gcFn();return true;
}
function retainedMetrics(limitBytes,outputBytes,{enabled=process.env.BUYER_LOG_COMPUTE_GC_RECHECK==='1',memoryUsage=()=>process.memoryUsage(),gc=forceGc}={}){
  let memory=memoryUsage(),retainedBytes=memory.heapUsed+memory.arrayBuffers;
  if(!enabled||!Number.isSafeInteger(limitBytes)||retainedBytes+outputBytes<=limitBytes)return {retainedBytes};
  const before=retainedBytes,started=performance.now();
  if(!gc())return {retainedBytes};
  memory=memoryUsage();retainedBytes=memory.heapUsed+memory.arrayBuffers;
  return {retainedBytes,gcRecheck:{beforeBytes:before,gcMs:performance.now()-started}};
}

if(parentPort)parentPort.on('message',message=>{
  if(message?.type!=='run'||Object.hasOwn(ASYNC_TASKS,message.task))return;
  const start=performance.now();
  try{
    const value=execute(message.task,message.payload||{});
    const outputBytes=(value.body?Buffer.byteLength(value.body):value.buffer?value.buffer.byteLength:0)+4096;
    parentPort.postMessage({type:'result',id:message.id,ok:true,value,metrics:{threadId,executionMs:performance.now()-start,...retainedMetrics(message.retainedLimitBytes,outputBytes),outputBytes}});
  }catch(error){parentPort.postMessage({type:'result',id:message.id,ok:false,error:{code:error?.code||'COMPUTE_WORKER_FAILED'}});}
});
// Asenkron görevler (karar barındırıcısı kurar); aynı veri kümesi önbelleğini paylaşır.
// Genel Bakış modeli (#1074), CP hesaplanmış sütunlar (#1078).
const ASYNC_TASKS={'read-model-overview':'./overview-model-task','read-model-cp-computed':'./cp-computed-task','read-model-cp-query':'./cp-query-task'};
if(parentPort)parentPort.on('message',message=>{
  if(message?.type!=='run'||!Object.hasOwn(ASYNC_TASKS,message.task))return;
  const start=performance.now();
  Promise.resolve().then(()=>require(ASYNC_TASKS[message.task]).execute(message.payload||{},{cache,engine})).then(value=>{
    const outputBytes=(value.body?Buffer.byteLength(value.body):0)+4096;
    parentPort.postMessage({type:'result',id:message.id,ok:true,value,metrics:{threadId,executionMs:performance.now()-start,...retainedMetrics(message.retainedLimitBytes,outputBytes),outputBytes}});
  }).catch(error=>{parentPort.postMessage({type:'result',id:message.id,ok:false,error:{code:error?.code||'COMPUTE_WORKER_FAILED'}});});
});
module.exports={execute,createDatasetCache,cache,retainedMetrics};
