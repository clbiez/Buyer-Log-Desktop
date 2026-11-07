'use strict';
const path=require('node:path'),os=require('node:os');
const {Worker}=require('node:worker_threads');
const {performance}=require('node:perf_hooks');
const {registerLeaseWorker}=require('./lease-worker-registry');
const MiB=1024*1024;
const messages={
  COMPUTE_POOL_CLOSED:['Hesaplama havuzu kapalı.','Compute pool is closed.',503],
  COMPUTE_JOB_INVALID:['Geçersiz hesaplama isteği.','Invalid compute request.',400],
  COMPUTE_JOB_TOO_LARGE:['İşlem bellek bütçesine sığmıyor.','Operation exceeds the memory budget.',413],
  COMPUTE_QUEUE_BUSY:['Hesaplama kuyruğu dolu; tekrar deneyin.','Compute queue is full; retry later.',503],
  COMPUTE_ABORTED:['Hesaplama iptal edildi.','Compute operation cancelled.',499],
  COMPUTE_STALE_GENERATION:['Kaynak sürümü değişti.','Source generation changed.',409],
  COMPUTE_TIMEOUT:['Hesaplama zaman aşımına uğradı.','Compute operation timed out.',504],
  COMPUTE_WORKER_FAILED:['Hesaplama işçisi tamamlanamadı.','Compute worker failed.',500],
  COMPUTE_ESTIMATE_EXCEEDED:['Hesaplama bellek tahminini aştı.','Compute operation exceeded its memory estimate.',503],
  COMPUTE_SOURCE_OWNER_MISMATCH:['Kaynak sahibi uyuşmuyor.','Source owner mismatch.',403],
  COMPUTE_SOURCE_CORRUPT:['Kaynak kopyası doğrulanamadı.','Source replica could not be verified.',409],
  COMPUTE_SOURCE_TOO_LARGE:['Kaynak bellek bütçesine sığmıyor.','Source exceeds the memory budget.',413],
  COMPUTE_SOURCE_BUSY:['Kaynak önbelleği kullanımda.','Source cache is busy.',503],
  BACKLOG_FILTER_FIELD_INVALID:['Bilinmeyen Backlog filtre alanı.','Unknown Backlog filter field.',400],
};
function failure(code){const [tr,en,statusCode]=messages[code];return Object.assign(Error(`${tr} / ${en}`),{code,statusCode,errorEn:en});}
const bytes=value=>Number.isSafeInteger(value)&&value>=0;
function createComputePool(options={}){
  const constrained=typeof process.constrainedMemory==='function'?process.constrainedMemory():0;
  const machineMemory=Math.min(os.totalmem(),constrained||Infinity);
  const budget=options.memoryBudgetBytes??Math.min(4096*MiB,Math.max(64*MiB,Math.floor(machineMemory/4)));
  const workerBase=options.workerBaseBytes??32*MiB,maxWorkers=options.maxWorkers??Math.max(1,Math.min(2,os.availableParallelism()));
  const maxPending=options.maxPending??64,maxPendingBytes=options.maxPendingBytes??Math.min(128*MiB,budget);
  if(!bytes(budget)||!budget||!bytes(workerBase)||workerBase>budget||!Number.isSafeInteger(maxWorkers)||maxWorkers<1||!bytes(maxPending)||!maxPending||!bytes(maxPendingBytes))throw Error('Invalid compute pool limits');
  const WorkerClass=options.WorkerClass||Worker,workerFile=options.workerFile||path.join(__dirname,'../workers/compute-worker.js');
  const slots=new Set(),pending=[],generations=new Map();
  let nextId=1,queuedInputBytes=0,leasedOutputBytes=0,closed=false,pumping=false,closePromise;
  const counters={queued:0,completed:0,failed:0,rejected:0,peakActiveWorkers:0,peakReservedBytes:0,totalQueueWaitMs:0,totalDurationMs:0,totalPostMessageMs:0,lastQueueWaitMs:0,lastDurationMs:0,maxQueueWaitMs:0};
  const residentBytes=()=>[...slots].reduce((sum,s)=>sum+s.residentBytes,0);
  const activeBytes=()=>[...slots].reduce((sum,s)=>sum+s.estimatedBytes,0);
  const reserved=()=>slots.size*workerBase+residentBytes()+activeBytes()+queuedInputBytes+leasedOutputBytes;
  function stats(){return {...counters,maxWorkers,workerCount:slots.size,activeWorkers:[...slots].filter(s=>s.state!=='idle').length,pending:pending.length,
    memoryBudgetBytes:budget,estimatedActiveBytes:activeBytes(),retainedWorkerBytes:residentBytes(),queuedInputBytes,leasedOutputBytes,reservedBytes:reserved(),maxPendingBytes};}
  function peak(){counters.peakActiveWorkers=Math.max(counters.peakActiveWorkers,stats().activeWorkers);counters.peakReservedBytes=Math.max(counters.peakReservedBytes,reserved());}
  function timing(job){
    const ended=performance.now(),queueWaitMs=(job.startedAt??ended)-job.queuedAt,durationMs=job.startedAt==null?0:ended-job.startedAt;
    const postMessageMs=job.postMessageMs??(job.postStartedAt==null?0:ended-job.postStartedAt);
    counters.totalQueueWaitMs+=queueWaitMs;counters.totalDurationMs+=durationMs;counters.totalPostMessageMs+=postMessageMs;
    counters.lastQueueWaitMs=queueWaitMs;counters.lastDurationMs=durationMs;counters.maxQueueWaitMs=Math.max(counters.maxQueueWaitMs,queueWaitMs);
    return {queueWaitMs,durationMs,postMessageMs};
  }
  function rejectJob(job,error){
    if(job.settled)return;job.settled=true;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.onAbort);job.payload=null;job.transferList=null;
    counters.failed++;error.computeMetrics=timing(job);job.reject(error);
  }
  function removeQueued(job){const index=pending.indexOf(job);if(index<0)return false;pending.splice(index,1);queuedInputBytes-=job.inputBytes;return true;}
  function exited(slot){
    if(slot.exited)return;slot.exited=true;
    if(slot.job&&!slot.job.settled)rejectJob(slot.job,failure('COMPUTE_WORKER_FAILED'));
    slot.job=null;slot.estimatedBytes=0;slot.residentBytes=0;slots.delete(slot);slot.resolveRetired?.();pump();
  }
  function retire(slot,error){
    if(error&&slot.job)rejectJob(slot.job,error);
    if(!slot.retirement){slot.state='retiring';slot.retirement=new Promise(resolve=>{slot.resolveRetired=resolve;});}
    if(slot.terminationStarted)return slot.retirement;
    if(!slot.worker){slot.retireOnStart=true;return slot.retirement;}
    slot.terminationStarted=true;slot.retireOnStart=false;
    // İptal/timeout anında kapasite serbest bırakılmaz. Native exit veya native
    // terminate Promise'i tamamlanmadan yeni işçi aynı bütçeyi kullanamaz.
    slot.worker.ref?.();
    try{Promise.resolve(slot.worker.terminate()).then(()=>exited(slot),()=>{if(slot.worker.threadId===-1)exited(slot);});}
    catch(_){if(slot.worker.threadId===-1)exited(slot);}
    return slot.retirement;
  }
  function received(slot,message){
    const job=slot.job;
    if(slot.state!=='active'||!job||job.settled||message?.type!=='result'||message.id!==job.id)return;
    if(message.ok!==true){void retire(slot,failure(Object.hasOwn(messages,message.error?.code)?message.error.code:'COMPUTE_WORKER_FAILED'));return;}
    const metrics=message.metrics||{},retained=metrics.retainedBytes,output=metrics.outputBytes;
    if(!bytes(retained)||!bytes(output)||retained+output>slot.residentBytes+job.estimatedBytes
      ||reserved()-slot.residentBytes-slot.estimatedBytes+retained+output>budget){void retire(slot,failure('COMPUTE_ESTIMATE_EXCEEDED'));return;}
    job.settled=true;clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.onAbort);
    slot.state='idle';slot.residentBytes=retained;slot.estimatedBytes=0;slot.job=null;
    leasedOutputBytes+=output;counters.completed++;let released=false;
    // Havuz value'yu saklamaz. Tüketici, yanıt/disk kaydı bitince lease'i
    // bırakır; aynı release'in iki kez gelmesi sayacı negatife düşürmez.
    const release=()=>{if(released)return;released=true;leasedOutputBytes-=output;pump();};
    slot.worker.unref?.();peak();job.resolve({value:message.value,metrics:{...metrics,...timing(job)},release});pump();
  }
  function start(job,slot){
    job.startedAt=performance.now();
    removeQueued(job);job.slot=slot;slot.state='active';slot.job=job;slot.ownerKey=job.ownerKey;slot.generation=job.generation;slot.estimatedBytes=job.estimatedBytes;
    if(!slot.worker){
      let setupError;
      try{
        slot.worker=new WorkerClass(workerFile,{workerData:{buyerLogComputePool:true},resourceLimits:{maxOldGenerationSizeMb:options.maxOldGenerationSizeMb??Math.min(3072,Math.max(16,Math.floor(budget/MiB)))}});
        // Lease kaydı exit dinleyicilerinden önce kurulur; paylaşılan dosya
        // kilidi okuyucusu emekli thread'i istemci callback'inden önce görür.
        try{registerLeaseWorker(slot.worker);}catch(error){setupError=error;}
        slot.worker.on('message',message=>received(slot,message));
        slot.worker.on('error',()=>{void retire(slot,failure('COMPUTE_WORKER_FAILED'));});
        slot.worker.once('exit',()=>exited(slot));
      }catch(_){rejectJob(job,failure('COMPUTE_WORKER_FAILED'));exited(slot);return;}
      if(setupError){void retire(slot,failure('COMPUTE_WORKER_FAILED'));return;}
    }
    if(job.settled||slot.retireOnStart){
      // Worker constructor'ı sırasında gelen iptal için de gerçek exit beklenir.
      void retire(slot);return;
    }
    slot.worker.ref?.();peak();
    job.timer.unref?.();
    job.postStartedAt=performance.now();
    try{slot.worker.postMessage({type:'run',id:job.id,task:job.task,payload:job.payload},job.transferList);job.postMessageMs=performance.now()-job.postStartedAt;job.payload=null;job.transferList=null;}
    catch(_){void retire(slot,failure('COMPUTE_WORKER_FAILED'));}
  }
  function pump(){
    if(closed||pumping)return;pumping=true;
    try{
      for(;;){
        const ordered=pending.slice().sort((a,b)=>a.priority-b.priority||a.id-b.id);let launched=false,retired=false;
        for(const job of ordered){
          if(generations.get(job.ownerKey)!==job.generation){removeQueued(job);rejectJob(job,failure('COMPUTE_STALE_GENERATION'));launched=true;break;}
          if(job.serializationKey&&[...slots].some(slot=>slot.state!=='idle'&&slot.job?.serializationKey===job.serializationKey))continue;
          const fit=extra=>reserved()-job.inputBytes+job.estimatedBytes+extra<=budget;
          let slot=[...slots].find(s=>s.state==='idle'&&fit(0));
          if(!slot&&slots.size<maxWorkers&&fit(workerBase)){slot={state:'idle',worker:null,residentBytes:0,estimatedBytes:0,job:null};slots.add(slot);}
          if(slot){start(job,slot);launched=true;break;}
          // Yalnız gerçekten yer açacak idle cache emekli edilir. Sonuç lease'i
          // yüzünden sığmayan işi beklerken gereksiz worker yeniden kurulmaz.
          const idle=[...slots].filter(s=>s.state==='idle');
          const reclaimable=idle.reduce((sum,s)=>sum+s.residentBytes+workerBase,0);
          const victim=reserved()-reclaimable-job.inputBytes+job.estimatedBytes+workerBase<=budget
            ?idle.find(s=>s.residentBytes+workerBase>0):null;
          if(victim){void retire(victim);retired=true;break;}
        }
        if(!launched||retired)break;
      }
    }finally{pumping=false;}
  }
  function setGeneration(ownerKey,generation){
    ownerKey=String(ownerKey);generation=String(generation);generations.set(ownerKey,generation);
    for(const job of pending.slice())if(job.ownerKey===ownerKey&&job.generation!==generation){removeQueued(job);rejectJob(job,failure('COMPUTE_STALE_GENERATION'));}
    for(const slot of slots)if(slot.ownerKey===ownerKey&&slot.generation!==generation)void retire(slot,slot.job?failure('COMPUTE_STALE_GENERATION'):null);
    pump();
  }
  function queueCanProgress(estimatedBytes,inputBytes){
    const waiting=pending.map(job=>({estimatedBytes:job.estimatedBytes,inputBytes:job.inputBytes}));
    waiting.push({estimatedBytes,inputBytes});let queued=queuedInputBytes+inputBytes;
    // Each completed job can release its input before the next grows. Refuse
    // an admission that leaves any subset mutually blocking even after all
    // active work/leases and evictable worker caches have drained.
    while(waiting.length){
      const index=waiting.findIndex(job=>workerBase+queued-job.inputBytes+job.estimatedBytes<=budget);
      if(index<0)return false;queued-=waiting[index].inputBytes;waiting.splice(index,1);
    }
    return true;
  }
  function run(task,payload={},jobOptions={}){
    if(closed)return Promise.reject(failure('COMPUTE_POOL_CLOSED'));
    if(!jobOptions||typeof jobOptions!=='object'||Array.isArray(jobOptions)){counters.rejected++;return Promise.reject(failure('COMPUTE_JOB_INVALID'));}
    const estimated=jobOptions.estimatedBytes,input=jobOptions.inputBytes??0,ownerKey=String(jobOptions.ownerKey??''),generation=String(jobOptions.generation??'');
    const priority=jobOptions.priority??'interactive',timeoutMs=jobOptions.timeoutMs??options.timeoutMs??600000;
    let code;
    if(typeof task!=='string'||!task||!ownerKey||!generation||!bytes(estimated)||!estimated||!bytes(input)||input>estimated
      ||!['interactive','background'].includes(priority)||!Number.isFinite(timeoutMs)||timeoutMs<=0
      ||(jobOptions.signal!=null&&(typeof jobOptions.signal.aborted!=='boolean'||typeof jobOptions.signal.addEventListener!=='function'||typeof jobOptions.signal.removeEventListener!=='function'))
      ||(jobOptions.transferList!==undefined&&!Array.isArray(jobOptions.transferList)))code='COMPUTE_JOB_INVALID';
    else if(jobOptions.serializationKey!=null&&(typeof jobOptions.serializationKey!=='string'||jobOptions.serializationKey.length>200))code='COMPUTE_JOB_INVALID';
    else if(estimated+workerBase>budget)code='COMPUTE_JOB_TOO_LARGE';
    else if(jobOptions.signal?.aborted)code='COMPUTE_ABORTED';
    else if(generations.has(ownerKey)&&generations.get(ownerKey)!==generation)code='COMPUTE_STALE_GENERATION';
    else if(pending.length>=maxPending||queuedInputBytes+input>maxPendingBytes||reserved()+input>budget||!queueCanProgress(estimated,input))code='COMPUTE_QUEUE_BUSY';
    if(code){counters.rejected++;return Promise.reject(failure(code));}
    if(!generations.has(ownerKey))generations.set(ownerKey,generation);
    return new Promise((resolve,reject)=>{
      const job={id:nextId++,queuedAt:performance.now(),task,payload,resolve,reject,ownerKey,generation,estimatedBytes:estimated,inputBytes:input,priority:priority==='interactive'?0:1,
        signal:jobOptions.signal,transferList:jobOptions.transferList||[],serializationKey:jobOptions.serializationKey||'',timeoutMs,settled:false};
      job.onAbort=()=>{if(job.settled)return;if(job.slot){rejectJob(job,failure('COMPUTE_ABORTED'));void retire(job.slot);}else{removeQueued(job);rejectJob(job,failure('COMPUTE_ABORTED'));pump();}};
      // Admission wait and execution share one finite deadline. Waiting for a
      // held output lease cannot leave queued input alive indefinitely.
      job.timer=setTimeout(()=>{
        if(job.settled)return;
        if(job.slot)void retire(job.slot,failure('COMPUTE_TIMEOUT'));
        else{removeQueued(job);rejectJob(job,failure('COMPUTE_TIMEOUT'));pump();}
      },timeoutMs);
      pending.push(job);queuedInputBytes+=input;counters.queued++;job.signal?.addEventListener('abort',job.onAbort,{once:true});
      if(job.signal?.aborted)job.onAbort();else pump();peak();
    });
  }
  function close(){
    if(closePromise)return closePromise;closed=true;
    for(const job of pending.slice()){removeQueued(job);rejectJob(job,failure('COMPUTE_POOL_CLOSED'));}
    closePromise=Promise.all([...slots].map(slot=>retire(slot,slot.job?failure('COMPUTE_POOL_CLOSED'):null))).then(()=>{});
    return closePromise;
  }
  return {run,setGeneration,stats,close};
}
module.exports={createComputePool};
