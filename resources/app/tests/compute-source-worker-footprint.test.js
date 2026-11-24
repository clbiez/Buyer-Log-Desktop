'use strict';
// Büyük kaynak (gerçek kullanıcı verisi ≈300+ MiB) hesap işçisinde koşar; sunucu
// iş parçacığına yalnız işçi belleği gerçekten yetmediğinde düşer. Eski tahmin
// (96 MiB + 12×kaynak) ölçülen tepenin (≈96 MiB + 4,7×kaynak) 2,3 katıydı ve 16 GB
// makinede ≈324 MiB üstündeki her kaynağı ana iş parçacığına atıyordu (15–45 sn kilit).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const {EventEmitter}=require('node:events');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-compute-footprint-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])process.env[key]=path.join(root,key);
const {createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const MiB=1024*1024;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function source(label='CURRENT'){
  const rows=[{ocode:123,model:label,ccode:'R',colour:'Red',buyer:'Alice',qty:10,kalan:5,fob:5,ex:new Date(2026,6,1)}];
  return {loadedAt:label,asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};
}
const context=()=>access.createAccessContext({userId:'a',systemRole:'buyer',viewScope:{buyers:['Alice']},editScopes:{buyers:['Alice']},authority:{123:[{buyer:'Alice'}]},profiles:[]});
const params=()=>({access:context(),overrides:{},horizons:{},modules:['cp','orders'],calendar:{configured:false}});
const unpack=entry=>JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)));

test('a source within the measured worker footprint is prepared and computed in the worker, not on the server thread',async t=>{
  // 512 MiB bütçe: 33 MiB kaynak eski tahminle (96+12×33=492 > 480) sunucu iş parçacığına düşerdi.
  const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:512*MiB}),service=createComputeService({pool,root});t.after(()=>service.close());
  const raw=source();
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:33*MiB,publish:false});
  assert.notEqual(descriptor.inlineSource,true,'source must not be pinned to the server thread');
  assert.ok(descriptor.replicaFile,'worker replica is written');
  await service.publishSource(descriptor);
  const lease=await service.run('projections',descriptor,params());
  try{
    assert.equal(lease.metrics.fallbackReason,undefined);
    assert.ok(lease.metrics.threadId>0,'projection runs on a worker thread');
    assert.deepEqual(unpack(lease.value.compressed.cp),JSON.parse(tasks.serialize(tasks.buildProjections(raw,params()).cp,'projection')));
  }finally{lease.release();}
});

test('a large source copy fits the service queue limit and is prepared in the worker',async t=>{
  // 350 MiB kaynak: kuyruk girdisi 2×350=700 MiB; eski 512 MiB kuyruk sınırı COMPUTE_QUEUE_BUSY veriyordu.
  const {SERVICE_MAX_PENDING_BYTES}=require('../server/lib/compute-service');
  const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:4096*MiB,maxPendingBytes:SERVICE_MAX_PENDING_BYTES}),service=createComputeService({pool,root});t.after(()=>service.close());
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:350*MiB,publish:false});
  assert.notEqual(descriptor.inlineSource,true);assert.ok(descriptor.replicaFile);
});

test('a busy queue never fails a refreshed source copy; it uses the capacity path',async t=>{
  const pool={setGeneration(){},stats:()=>({maxWorkers:1}),close:async()=>{},
    run:async()=>{throw Object.assign(Error('busy'),{code:'COMPUTE_QUEUE_BUSY'});}};
  const service=createComputeService({pool,root});t.after(()=>service.close());
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});
  assert.equal(descriptor.inlineSource,true);
});

test('a source larger than the worker source cache uses the capacity path instead of failing',async t=>{
  // 4 GiB bütçede 550 MiB kaynak 6× tahminle kabul edilir; işçi önbelleği (2 GiB, 4×kaynak) ise reddeder.
  const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:4096*MiB}),service=createComputeService({pool,root});t.after(()=>service.close());
  const snapshots=require('../server/lib/model-snapshot');
  await snapshots.saveModelSnapshotAsync('big',source('BIG'));
  const descriptor=await service.coldSource({ownerId:'big',generation:'disk-1',loadedAt:'BIG',uncompressedBytes:550*MiB});
  const lease=await service.run('source-info',descriptor,{});
  try{assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');assert.equal(lease.value.loadedAt,'BIG');}finally{lease.release();}
  assert.equal(pool.stats().workerCount,0,'no worker is started for a source the worker cache cannot hold');
});

test('a source copy whose worker ran out of memory after writing removes the orphaned replica file',async t=>{
  let written;
  const pool={setGeneration(){},stats:()=>({maxWorkers:1}),close:async()=>{},
    run:async(task,payload)=>{
      if(task!=='seed-source')throw Error('unexpected '+task);
      written=payload.replicaFile;fs.writeFileSync(written,Buffer.alloc(1024));
      throw Object.assign(Error('out of memory'),{code:'COMPUTE_JOB_TOO_LARGE',workerOutOfMemory:true});
    }};
  const service=createComputeService({pool,root});t.after(()=>service.close());
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});
  assert.equal(descriptor.inlineSource,true);
  assert.ok(written);assert.equal(fs.existsSync(written),false,'the partial replica is not left behind');
  assert.equal(service.stats().reservedDiskBytes,0);
});

test('a worker that runs out of memory reports a capacity rejection, other crashes stay failures',async t=>{
  const workers=[];
  class FakeWorker extends EventEmitter{
    constructor(){super();this.threadId=0;this.sent=[];this.keepAlive=setInterval(()=>{},60000);workers.push(this);}
    ref(){this.keepAlive.ref();}unref(){this.keepAlive.unref();}
    postMessage(message){this.sent.push(message);}
    terminate(){if(!this.exited){this.exited=true;clearInterval(this.keepAlive);queueMicrotask(()=>this.emit('exit',1));}return Promise.resolve(1);}
  }
  const pool=createComputePool({workerFile:__filename,WorkerClass:FakeWorker,maxWorkers:1,memoryBudgetBytes:1024,maxPendingBytes:256,workerBaseBytes:0});t.after(()=>pool.close());
  const options={ownerKey:'demo',generation:'g1',estimatedBytes:128,inputBytes:0};
  const first=pool.run('large',{},options),oom=assert.rejects(first,error=>error.code==='COMPUTE_JOB_TOO_LARGE'&&error.workerOutOfMemory===true);
  workers[0].emit('error',Object.assign(Error('Worker terminated due to reaching memory limit: JS heap out of memory'),{code:'ERR_WORKER_OUT_OF_MEMORY'}));
  await oom;await new Promise(setImmediate);
  const second=pool.run('crash',{},options),crash=assert.rejects(second,{code:'COMPUTE_WORKER_FAILED'});
  workers.at(-1).emit('error',Error('synthetic worker crash'));await crash;
});

test('an idle worker that already holds an owner source is preferred for that owner',async t=>{
  const workers=[],turn=()=>new Promise(setImmediate);
  class FakeWorker extends EventEmitter{
    constructor(){super();this.threadId=workers.length+1;this.sent=[];this.keepAlive=setInterval(()=>{},60000);workers.push(this);}
    ref(){this.keepAlive.ref();}unref(){this.keepAlive.unref();}
    postMessage(message){this.sent.push(message);}
    complete(){this.emit('message',{type:'result',id:this.sent.at(-1).id,ok:true,value:{},metrics:{retainedBytes:64,outputBytes:0}});}
    terminate(){if(!this.exited){this.exited=true;clearInterval(this.keepAlive);queueMicrotask(()=>this.emit('exit',1));}return Promise.resolve(1);}
  }
  const pool=createComputePool({workerFile:__filename,WorkerClass:FakeWorker,maxWorkers:2,memoryBudgetBytes:4096,maxPendingBytes:256,workerBaseBytes:0});t.after(()=>pool.close());
  const job=owner=>pool.run('read',{},{ownerKey:owner,generation:'g1',estimatedBytes:128,inputBytes:0});
  const x=job('source:x'),y=job('source:y');await turn();
  assert.equal(workers.length,2);workers[0].complete();workers[1].complete();(await x).release();(await y).release();
  const again=job('source:y');await turn();
  assert.equal(workers[1].sent.length,2,'the worker holding source y runs the next y job');assert.equal(workers[0].sent.length,1);
  workers[1].complete();(await again).release();
});

test('source jobs of one owner are serialized so a second worker does not decode another copy',async t=>{
  const seen=[];
  const pool={setGeneration(){},stats:()=>({maxWorkers:2}),close:async()=>{},
    run:async(task,payload,options)=>{seen.push(options.serializationKey);return {value:{loadedAt:'X'},metrics:{threadId:1},release(){}};}};
  const service=createComputeService({pool,root});t.after(()=>service.close());
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-1',uncompressedBytes:MiB});
  const other=await service.coldSource({ownerId:'b',generation:'disk-1',uncompressedBytes:MiB});
  await Promise.all([service.run('source-info',descriptor,{}),service.run('projections',descriptor,params()),service.run('source-info',other,{})]).then(leases=>leases.forEach(lease=>lease.release()));
  assert.deepEqual(seen,['source:a','source:a','source:b']);
});

test('source-loading jobs mark the worker source copy; source-independent jobs do not',async t=>{
  const seen=[];
  const pool={setGeneration(){},stats:()=>({maxWorkers:2}),close:async()=>{},
    run:async(task,payload,options)=>{seen.push([task,options.cachesSource]);return {value:{loadedAt:'X'},metrics:{threadId:1},release(){}};}};
  const service=createComputeService({pool,root});t.after(()=>service.close());
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-1',uncompressedBytes:MiB});
  for(const task of ['plan-actual-capture','projections','source-info','projection-envelope'])(await service.run(task,descriptor,task==='projections'?params():{})).release();
  assert.deepEqual(seen,[['plan-actual-capture',true],['projections',true],['source-info',true],['projection-envelope',false]]);
});

for(const [label,overflow] of [['out-of-memory',{code:'COMPUTE_JOB_TOO_LARGE',workerOutOfMemory:true}],['memory estimate overflow',{code:'COMPUTE_ESTIMATE_EXCEEDED'}]])
test(`after a worker ${label} that task stays on the capacity path for the same source generation`,async t=>{
  const snapshots=require('../server/lib/model-snapshot');
  await snapshots.saveModelSnapshotAsync('a',source('DISK-1'));
  let poolRuns=0;
  const pool={setGeneration(){},stats:()=>({maxWorkers:1}),close:async()=>{},
    run:async()=>{poolRuns++;throw Object.assign(Error(label),overflow);}};
  const service=createComputeService({pool,root});t.after(()=>service.close());
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-1',loadedAt:'DISK-1',uncompressedBytes:MiB});
  for(let i=0;i<2;i++){
    const lease=await service.run('projections',descriptor,params());
    try{assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'DISK-1');}
    finally{lease.release();}
  }
  assert.equal(poolRuns,1,'a task that exhausted worker memory is not retried in a worker for this generation');
  // Yalnız taşan görev yerelde kalır: diğer görevler aynı sürümde işçiyi yine dener.
  const info=await service.run('source-info',descriptor,{});info.release();
  assert.equal(poolRuns,2,'other tasks of the same generation still try the worker');
  const next=await service.coldSource({ownerId:'a',generation:'disk-2',loadedAt:'DISK-1',uncompressedBytes:MiB,replace:true});
  const lease=await service.run('projections',next,params());lease.release();
  assert.equal(poolRuns,3,'a new generation tries the worker again');
});
