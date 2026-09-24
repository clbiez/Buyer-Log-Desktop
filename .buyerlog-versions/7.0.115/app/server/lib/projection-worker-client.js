'use strict';

const path=require('node:path');
const {Worker}=require('node:worker_threads');

let workerTail=Promise.resolve();
function runOne(payload,timeoutMs){
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'..','projection-worker.js'),{workerData:payload});let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate().catch(()=>{});error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{const error=new Error('Projection worker zaman aşımına uğradı.');error.code='PROJECTION_WORKER_TIMEOUT';finish(error);},timeoutMs);
    worker.once('message',message=>{if(!message||message.ok!==true){const error=new Error(message&&message.error||'Projection worker başarısız oldu.');error.code='PROJECTION_WORKER_FAILED';finish(error);return;}finish(null,message);});
    worker.once('error',finish);worker.once('exit',code=>{if(!settled&&code!==0){const error=new Error(`Projection worker ${code} koduyla kapandı.`);error.code='PROJECTION_WORKER_EXIT';finish(error);}});
  });
}
function runProjectionWorker(payload,{timeoutMs=600000}={}){
  const task=workerTail.catch(()=>{}).then(()=>runOne(payload,timeoutMs));workerTail=task.catch(()=>{});return task;
}
module.exports={runProjectionWorker};
