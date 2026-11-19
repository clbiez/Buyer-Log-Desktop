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
  if(task!=='read-model-query')throw Object.assign(Error('Invalid compute request'),{code:'COMPUTE_JOB_INVALID'});
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
  try{body=engine.serializeResult(engine.executeQuery(dataset,payload.query));}
  catch(error){
    // Doğrulama hatası işçiyi emekli etmemeli (önbellek korunur): değer olarak döner.
    if(error&&error.statusCode===400)return {error:{code:error.code,detail:error.detail||null}};
    throw error;
  }
  const queryMs=performance.now()-queryStarted;
  return {body,timing:{loadMs,queryMs,totalMs:performance.now()-started,rows:dataset.rows.length}};
}

if(parentPort)parentPort.on('message',message=>{
  if(message?.type!=='run'||message.task==='read-model-overview')return;
  const start=performance.now();
  try{
    const value=execute(message.task,message.payload||{});
    const memory=process.memoryUsage(),outputBytes=(value.body?Buffer.byteLength(value.body):0)+4096;
    parentPort.postMessage({type:'result',id:message.id,ok:true,value,metrics:{threadId,executionMs:performance.now()-start,retainedBytes:memory.heapUsed+memory.arrayBuffers,outputBytes}});
  }catch(error){parentPort.postMessage({type:'result',id:message.id,ok:false,error:{code:error?.code||'COMPUTE_WORKER_FAILED'}});}
});
// Genel Bakış modeli (#1074): asenkron görev; aynı veri kümesi önbelleğini paylaşır.
if(parentPort)parentPort.on('message',message=>{
  if(message?.type!=='run'||message.task!=='read-model-overview')return;
  const start=performance.now();
  Promise.resolve().then(()=>require('./overview-model-task').execute(message.payload||{},{cache,engine})).then(value=>{
    const memory=process.memoryUsage(),outputBytes=(value.body?Buffer.byteLength(value.body):0)+4096;
    parentPort.postMessage({type:'result',id:message.id,ok:true,value,metrics:{threadId,executionMs:performance.now()-start,retainedBytes:memory.heapUsed+memory.arrayBuffers,outputBytes}});
  }).catch(error=>{parentPort.postMessage({type:'result',id:message.id,ok:false,error:{code:error?.code||'COMPUTE_WORKER_FAILED'}});});
});
module.exports={execute,createDatasetCache,cache};
