'use strict';
// Büyük kişisel model snapshot'ı (saha: 655 MiB) hesap işçisinde koşabilmeli; sunucu iş
// parçacığına (20–40 sn kilit) yalnız işçi gerçekten sığmadığında düşmeli. Ölçüm (658 MiB
// sentetik kaynak, Electron 44.3.0): işçi JS heap tepesi ≈2,0 GB (≈3,1×kaynak), heap dışı
// ≈1,9 GB; Electron'da ana iş parçacığı ve işçiler TEK ~3,45 GB pointer-compression kafesini
// paylaşır ve aşım tüm sunucuyu abort eder. Bu yüzden kabul: bayt bütçesi + kafes koruması.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-large-source-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])process.env[key]=path.join(root,key);
const {createComputePool,defaultComputeBudgetBytes}=require('../server/lib/compute-pool');
const {createComputeService}=require('../server/lib/compute-service');
const MiB=1024*1024,GiB=1024*MiB,turn=()=>new Promise(setImmediate);
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

function fakePool(options={}){
  const workers=[];
  class FakeWorker extends EventEmitter{
    constructor(){super();this.threadId=workers.length+1;this.sent=[];this.keepAlive=setInterval(()=>{},60000);workers.push(this);}
    ref(){this.keepAlive.ref();}unref(){this.keepAlive.unref();}
    postMessage(message){this.sent.push(message);}
    complete(metrics={}){this.emit('message',{type:'result',id:this.sent.at(-1).id,ok:true,value:{},metrics:{retainedBytes:0,outputBytes:0,...metrics}});}
    terminate(){if(!this.exited){this.exited=true;clearInterval(this.keepAlive);queueMicrotask(()=>this.emit('exit',1));}return Promise.resolve(1);}
  }
  const pool=createComputePool({workerFile:__filename,WorkerClass:FakeWorker,maxWorkers:1,memoryBudgetBytes:1000,maxPendingBytes:1000,workerBaseBytes:0,...options});
  return {pool,workers};
}
// Sahte havuz: kabul edilen işlerin seçeneklerini kaydeder; işçi olmadan sonuç döner.
function recordingPool(extra={}){
  const runs=[];
  return {runs,pool:{setGeneration(){},stats:()=>({maxWorkers:1}),close:async()=>{},...extra,
    run:async(task,payload,options)=>{runs.push({task,options});return {value:{loadedAt:'SRC'},metrics:{threadId:1},release(){}};}}};
}

test('16 GB machines get a worker budget that admits a ~650 MiB source; smaller machines keep RAM/4',()=>{
  assert.equal(defaultComputeBudgetBytes(16*GiB),6*GiB);
  // Windows "16 GB" makinesi ≈15,8 GiB bildirir; yine 650 MiB 'projections' tahminini (96+8×kaynak) taşır.
  const windows16=Math.floor(15.8*GiB),budget=defaultComputeBudgetBytes(windows16);
  assert.ok(budget>=96*MiB+8*658*MiB+32*MiB,'a 658 MiB projections job fits the 16 GB budget');
  assert.ok(budget<=6*GiB);
  assert.equal(defaultComputeBudgetBytes(32*GiB),6*GiB);
  assert.equal(defaultComputeBudgetBytes(8*GiB),2*GiB);
  assert.equal(defaultComputeBudgetBytes(12*GiB),3*GiB);
});

test('a worker that already caches the source is not charged for it twice',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const job=()=>pool.run('projections',{},{ownerKey:'source:a',generation:'g1',estimatedBytes:700,inputBytes:0,residentKey:'["a","g1"]',residentBytes:400});
  const first=job();await turn();
  workers[0].complete({retainedBytes:400,cachedSources:['["a","g1"]']});(await first).release();
  // Kredi olmadan: 400 (önbellek) + 700 > 1000 → ısınmış işçi emekli edilir, kaynak yeniden çözülür.
  const second=job();await turn();
  assert.equal(workers.length,1,'the warm worker is kept');
  assert.equal(workers[0].sent.length,2,'the next job of the same source runs on the worker that caches it');
  assert.equal(pool.stats().reservedBytes,400+300,'the cached copy is charged once');
  workers[0].complete({retainedBytes:400,cachedSources:['["a","g1"]']});(await second).release();
});

test('the warm credit needs the exact cached source, not only the same owner key',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const options={ownerKey:'source:a',generation:'g1',estimatedBytes:700,inputBytes:0,residentKey:'["a","g1"]',residentBytes:400};
  const first=pool.run('projection-envelope',{},options);await turn();
  // Worker reports memory held for another owner's source; it does not hold ["a","g1"].
  workers[0].complete({retainedBytes:400,cachedSources:['["b","g7"]']});(await first).release();
  const second=pool.run('projections',{},options);await turn();
  assert.equal(workers.length,2,'without the cached source the job is charged in full and the idle worker is retired');
  workers[1].complete({retainedBytes:400,cachedSources:['["a","g1"]']});(await second).release();
});

test('a large source within the worker budget is computed in the worker, charged once per cached copy',async t=>{
  const {runs,pool}=recordingPool();
  const service=createComputeService({pool,root,heapCage:null});t.after(()=>service.close());
  const descriptor=await service.coldSource({ownerId:'big',generation:'disk-1',loadedAt:'SRC',uncompressedBytes:658*MiB});
  const lease=await service.run('source-info',descriptor,{});
  try{assert.equal(lease.metrics.fallbackReason,undefined,'658 MiB no longer exceeds the worker source cache');}finally{lease.release();}
  assert.equal(runs.length,1);
  assert.equal(runs[0].options.residentKey,JSON.stringify(['big','disk-1']));
  assert.equal(runs[0].options.residentBytes,descriptor.bytes);
  assert.equal(runs[0].options.serializationKey,'source:big');
});

test('a source beyond the worker source cache still uses the capacity path',async t=>{
  const {runs,pool}=recordingPool();
  const service=createComputeService({pool,root,heapCage:null});t.after(()=>service.close());
  await require('../server/lib/model-snapshot').saveModelSnapshotAsync('huge',{loadedAt:'HUGE',asasOrders:[],antrepoMap:{},lflRows:[]});
  const descriptor=await service.coldSource({ownerId:'huge',generation:'disk-1',loadedAt:'HUGE',uncompressedBytes:800*MiB});
  const lease=await service.run('source-info',descriptor,{});
  try{assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');assert.equal(lease.value.loadedAt,'HUGE');}finally{lease.release();}
  assert.equal(runs.length,0);
});

test('on a shared V8 heap cage the worker is used only while the server heap leaves room for it',async t=>{
  let mainHeap=100*MiB,released=0;
  const {runs,pool}=recordingPool({heapBytesExcluding:()=>0,releaseIdle:async()=>{released++;}});
  const heapCage={limitBytes:3*GiB,usedBytes:()=>mainHeap};
  const service=createComputeService({pool,root,heapCage});t.after(()=>service.close());
  await require('../server/lib/model-snapshot').saveModelSnapshotAsync('cage',{loadedAt:'CAGE',asasOrders:[],antrepoMap:{},lflRows:[]});
  const descriptor=await service.coldSource({ownerId:'cage',generation:'disk-1',loadedAt:'CAGE',uncompressedBytes:658*MiB});
  let lease=await service.run('source-info',descriptor,{});lease.release();
  assert.equal(runs.length,1,'a lean server heap leaves room for the worker copy');
  // Large source jobs share one cage lane: two workers never hold large transient copies at once.
  assert.equal(runs[0].options.serializationKey,'source-heap-cage');
  mainHeap=1536*MiB;
  lease=await service.run('source-info',descriptor,{});
  try{assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE','a second copy would overflow the shared cage');}finally{lease.release();}
  assert.equal(runs.length,1,'the worker is not given a job that could abort the whole server');
  assert.equal(released,1,'idle workers holding large copies are released before the server computes locally');
});

test('small sources keep their per-owner lane on a shared cage',async t=>{
  const {runs,pool}=recordingPool({heapBytesExcluding:()=>0,releaseIdle:async()=>{}});
  const service=createComputeService({pool,root,heapCage:{limitBytes:3*GiB,usedBytes:()=>100*MiB}});t.after(()=>service.close());
  const descriptor=await service.coldSource({ownerId:'small',generation:'disk-1',uncompressedBytes:20*MiB});
  const lease=await service.run('source-info',descriptor,{});lease.release();
  assert.equal(runs[0].options.serializationKey,'source:small');
});

test('other workers heaps count against the shared cage',async t=>{
  const {runs,pool}=recordingPool({heapBytesExcluding:key=>key===JSON.stringify(['cage2','disk-1'])?1200*MiB:0,releaseIdle:async()=>{}});
  const service=createComputeService({pool,root,heapCage:{limitBytes:3*GiB,usedBytes:()=>100*MiB}});t.after(()=>service.close());
  await require('../server/lib/model-snapshot').saveModelSnapshotAsync('cage2',{loadedAt:'C2',asasOrders:[],antrepoMap:{},lflRows:[]});
  const descriptor=await service.coldSource({ownerId:'cage2',generation:'disk-1',loadedAt:'C2',uncompressedBytes:658*MiB});
  const lease=await service.run('source-info',descriptor,{});
  try{assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');}finally{lease.release();}
  assert.equal(runs.length,0);
});

test('an idle worker holding a large copy releases it after the idle period',async t=>{
  const {pool,workers}=fakePool({idleReleaseBytes:300,idleReleaseMs:20});t.after(()=>pool.close());
  const first=pool.run('projections',{},{ownerKey:'source:a',generation:'g1',estimatedBytes:500,inputBytes:0});await turn();
  workers[0].complete({retainedBytes:400,heapUsedBytes:350,cachedSources:['["a","g1"]']});(await first).release();
  assert.equal(pool.stats().workerCount,1);
  assert.equal(pool.heapBytesExcluding('["b","g1"]'),350,'the idle copy counts against other sources');
  assert.equal(pool.heapBytesExcluding('["a","g1"]'),0,'it is the same copy for its own source');
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(pool.stats().workerCount,0,'the cage is freed once the worker stays idle');
  const small=pool.run('read',{},{ownerKey:'source:b',generation:'g1',estimatedBytes:100,inputBytes:0});await turn();
  workers[1].complete({retainedBytes:50});(await small).release();
  await new Promise(resolve=>setTimeout(resolve,80));
  assert.equal(pool.stats().workerCount,1,'a small idle worker stays warm');
  await pool.releaseIdle(0);assert.equal(pool.stats().workerCount,0);
});
