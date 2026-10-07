'use strict';

const path=require('node:path');
const os=require('node:os');
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
/* Yenilemede sayfa önbelleği tek işçide ~11 sn sürüyordu (33 bin satır).
   Genel Bakış / Sipariş özeti, CP / Siparişler / katalogdan bağımsızdır; yeterli
   çekirdek varsa ikinci bir işçide paralel hazırlanır. Her işçi aynı saf
   projeksiyon kodunu çalıştırır; çıktı tek işçiyle birebir aynıdır. */
const ALL_MODULES=Object.freeze(['cp','overview','orders','order-summary','collection-catalog']);
const SUMMARY_MODULES=new Set(['overview','order-summary']);
const SPLIT_MIN_ROWS=5000;
function splitPlan(payload){
  const modules=Array.isArray(payload&&payload.modules)?payload.modules:ALL_MODULES;
  const summary=modules.filter(module=>SUMMARY_MODULES.has(module)),primary=modules.filter(module=>!SUMMARY_MODULES.has(module));
  const rows=Math.max(Array.isArray(payload&&payload.cpSource)?payload.cpSource.length:0,Array.isArray(payload&&payload.ordersSource)?payload.ordersSource.length:0);
  if(!summary.length||!primary.length||rows<SPLIT_MIN_ROWS||(os.availableParallelism?os.availableParallelism():os.cpus().length)<3)return null;
  return {primary,summary};
}
async function runSplit(payload,plan,timeoutMs){
  const [main,summary]=await Promise.all([
    runOne({...payload,modules:plan.primary},timeoutMs),
    runOne({...payload,modules:plan.summary,ordersSource:[],ordersAntrepo:{},catalogOrdersBuffer:null,shared:false},timeoutMs),
  ]);
  const a=main.metrics||{},b=summary.metrics||{};
  return {ok:true,compressed:{...main.compressed,...summary.compressed},
    metrics:{workerMs:Math.max(Number(a.workerMs)||0,Number(b.workerMs)||0),cpRows:a.cpRows,ordersRows:a.ordersRows,orderSummaryRows:b.orderSummaryRows,parallelWorkers:2}};
}
function runProjectionWorker(payload,{timeoutMs=600000}={}){
  const task=workerTail.catch(()=>{}).then(()=>{const plan=splitPlan(payload);return plan?runSplit(payload,plan,timeoutMs):runOne(payload,timeoutMs);});
  workerTail=task.catch(()=>{});return task;
}
module.exports={runProjectionWorker,splitPlan};
