'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const fs=require('node:fs'),os=require('node:os');
const {EventEmitter}=require('node:events');
const {createComputePool}=require('../server/lib/compute-pool');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const taskOptions=extra=>({ownerKey:'demo-a',generation:'g1',estimatedBytes:128,inputBytes:0,...extra});
function fakePool(options={}){
  const workers=[];
  class FakeWorker extends EventEmitter{
    constructor(){super();this.threadId=0;this.sent=[];this.autoExit=true;this.keepAlive=setInterval(()=>{},60000);workers.push(this);options.onConstruct?.(this);}
    ref(){this.keepAlive.ref();}unref(){this.keepAlive.unref();}
    postMessage(message){this.sent.push(message);}
    complete(value={},metrics={}){this.emit('message',{type:'result',id:this.sent.at(-1).id,ok:true,value,metrics:{retainedBytes:0,outputBytes:0,...metrics}});}
    terminate(){this.terminated=true;this.exitPromise??=new Promise(resolve=>{this.resolveExit=resolve;});if(this.autoExit)queueMicrotask(()=>this.finishExit());return this.exitPromise;}
    finishExit(){if(this.exited)return;this.exited=true;clearInterval(this.keepAlive);this.emit('exit',1);this.resolveExit?.(1);}
  }
  const pool=createComputePool({workerFile:__filename,WorkerClass:FakeWorker,maxWorkers:1,memoryBudgetBytes:1024,maxPendingBytes:256,workerBaseBytes:0,...options});
  return {pool,workers};
}
test('real pooled worker is retained and executes async jobs one at a time',async t=>{
  const pool=createComputePool({workerFile:path.join(__dirname,'fixtures/compute-pool-worker.js'),maxWorkers:1,memoryBudgetBytes:64*1024*1024,workerBaseBytes:1024});
  t.after(()=>pool.close());
  const run=value=>pool.run('echo',{value,delayMs:15},taskOptions({estimatedBytes:1024*1024}));
  const leases=await Promise.all([run('first'),run('second'),run('third')]);
  try{
    assert.equal(new Set(leases.map(lease=>lease.value.threadId)).size,1);
    assert.deepEqual(leases.map(lease=>lease.value.value),['first','second','third']);
    assert.deepEqual(leases.map(lease=>lease.value.concurrent),[1,1,1]);
  }finally{leases.forEach(lease=>lease.release());}
});
test('a read-only file capability and ready output bytes use real native transfers',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-compute-capability-')),file=path.join(root,'synthetic.txt');
  const source='Synthetic source: Türkçe / dates remain source data';fs.writeFileSync(file,source);
  const pool=createComputePool({workerFile:path.join(__dirname,'fixtures/compute-pool-worker.js'),maxWorkers:1,memoryBudgetBytes:64*1024*1024,workerBaseBytes:1024});
  t.after(async()=>{await pool.close();fs.rmSync(root,{recursive:true,force:true});});
  const fileHandle=await fs.promises.open(file,'r');
  try{
    const lease=await pool.run('read-capability',{fileHandle},taskOptions({estimatedBytes:1024*1024,transferList:[fileHandle]}));
    try{assert.equal(fileHandle.fd,-1);assert.ok(lease.value.bytes instanceof ArrayBuffer);assert.equal(Buffer.from(lease.value.bytes).toString('utf8'),source);}
    finally{lease.release();}
  }finally{if(fileHandle.fd>=0)await fileHandle.close();}
});
test('interactive queued work goes before older background work',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const first=pool.run('first',{},taskOptions());
  const background=pool.run('background',{},taskOptions({priority:'background'}));
  const interactive=pool.run('interactive',{},taskOptions({priority:'interactive'}));
  workers[0].complete();(await first).release();await turn();
  assert.equal(workers[0].sent.at(-1).task,'interactive');
  workers[0].complete();(await interactive).release();await turn();
  assert.equal(workers[0].sent.at(-1).task,'background');
  workers[0].complete();(await background).release();
});
test('oversized or invalid estimates are rejected before constructing a worker',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  await assert.rejects(pool.run('large',{},taskOptions({estimatedBytes:2048})),{code:'COMPUTE_JOB_TOO_LARGE'});
  for(const estimatedBytes of [-1,NaN,Infinity])await assert.rejects(pool.run('invalid',{},taskOptions({estimatedBytes})),{code:'COMPUTE_JOB_INVALID'});
  await assert.rejects(pool.run('invalid-input',{},taskOptions({inputBytes:-1})),{code:'COMPUTE_JOB_INVALID'});
  assert.equal(workers.length,0);assert.equal(pool.stats().pending,0);
});
test('pending input has a byte cap independently of job count',async t=>{
  const {pool,workers}=fakePool({maxPendingBytes:100,maxPending:20});t.after(()=>pool.close());
  const first=pool.run('first',{},taskOptions({estimatedBytes:512}));
  const queued=pool.run('queued',{},taskOptions({inputBytes:80}));
  await assert.rejects(pool.run('overflow',{},taskOptions({inputBytes:80})),{code:'COMPUTE_QUEUE_BUSY'});
  assert.equal(pool.stats().queuedInputBytes,80);assert.equal(pool.stats().pending,1);
  workers[0].complete();(await first).release();await turn();workers[0].complete();(await queued).release();
  assert.equal(pool.stats().queuedInputBytes,0);
});
test('leased output and retained worker bytes stay charged until release',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const first=pool.run('first',{},taskOptions({estimatedBytes:512}));
  workers[0].complete({data:'held'},{retainedBytes:64,outputBytes:256});const lease=await first;
  const second=pool.run('second',{},taskOptions({estimatedBytes:900}));await turn();
  assert.equal(workers[0].sent.length,1);assert.equal(pool.stats().leasedOutputBytes,256);
  assert.equal(pool.stats().retainedWorkerBytes,64);
  lease.release();lease.release();await turn();assert.equal(pool.stats().leasedOutputBytes,0);
  assert.equal(workers[0].sent.length,2);workers[0].complete();(await second).release();
});
test('an active abort rejects promptly but its memory and slot wait for actual exit',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const controller=new AbortController();
  const first=pool.run('first',{},taskOptions({signal:controller.signal,estimatedBytes:512}));
  const rejection=assert.rejects(first,{code:'COMPUTE_ABORTED'});
  workers[0].autoExit=false;controller.abort();await rejection;
  workers[0].complete({mustNotPublish:true},{outputBytes:64});assert.equal(pool.stats().leasedOutputBytes,0);
  assert.equal(pool.stats().activeWorkers,1);assert.ok(pool.stats().estimatedActiveBytes>=512);
  const second=pool.run('second',{},taskOptions());await turn();assert.equal(workers.length,1);
  workers[0].finishExit();await turn();assert.equal(workers.length,2);
  workers[1].complete();(await second).release();
});
test('old generations are cancelled per owner and cannot become current again',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const active=pool.run('old-active',{},taskOptions());const activeRejected=assert.rejects(active,{code:'COMPUTE_STALE_GENERATION'});
  const queued=pool.run('old-queued',{},taskOptions());const queuedRejected=assert.rejects(queued,{code:'COMPUTE_STALE_GENERATION'});
  const other=pool.run('other',{},taskOptions({ownerKey:'demo-b'}));
  pool.setGeneration('demo-a','g2');await Promise.all([activeRejected,queuedRejected]);await turn();
  await assert.rejects(pool.run('late-old',{},taskOptions()),{code:'COMPUTE_STALE_GENERATION'});
  assert.equal(workers.at(-1).sent.at(-1).task,'other');workers.at(-1).complete();(await other).release();
  const current=pool.run('current',{},taskOptions({generation:'g2'}));workers.at(-1).complete({current:true});
  const lease=await current;assert.equal(lease.value.current,true);lease.release();
});
test('queued abort releases its input immediately without cancelling another job',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const active=pool.run('active',{},taskOptions());const controller=new AbortController();
  const queued=pool.run('queued',{},taskOptions({inputBytes:64,signal:controller.signal}));const rejected=assert.rejects(queued,{code:'COMPUTE_ABORTED'});
  controller.abort();await rejected;assert.equal(pool.stats().queuedInputBytes,0);
  assert.equal(workers[0].terminated,undefined);workers[0].complete();(await active).release();
});
test('returned memory above the estimate is rejected and its worker is retired',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const job=pool.run('bad-estimate',{},taskOptions());const rejected=assert.rejects(job,{code:'COMPUTE_ESTIMATE_EXCEEDED'});
  workers[0].complete({unpublished:true},{retainedBytes:512,outputBytes:512});await rejected;await turn();
  assert.equal(workers[0].terminated,true);assert.equal(pool.stats().leasedOutputBytes,0);
});
test('timeouts retire the worker and close waits for its real exit',async()=>{
  const {pool,workers}=fakePool();
  const job=pool.run('timeout',{},taskOptions({timeoutMs:20}));workers[0].autoExit=false;
  await assert.rejects(job,{code:'COMPUTE_TIMEOUT'});
  let closed=false;const closing=pool.close().then(()=>{closed=true;});await turn();assert.equal(closed,false);
  workers[0].finishExit();await closing;assert.equal(pool.stats().activeWorkers,0);
  await assert.rejects(pool.run('closed',{},taskOptions()),{code:'COMPUTE_POOL_CLOSED'});
});
test('a crashed worker rejects its job and a replacement can complete new work',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const first=pool.run('first',{},taskOptions());const rejected=assert.rejects(first,{code:'COMPUTE_WORKER_FAILED'});
  workers[0].emit('error',Error('synthetic worker crash'));await rejected;await turn();
  const second=pool.run('second',{},taskOptions());assert.equal(workers.length,2);
  workers[1].complete({recovered:true});const lease=await second;assert.equal(lease.value.recovered,true);lease.release();
});
test('public pool stats never contain owners, paths, payloads or result values',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const job=pool.run('echo',{sourcePath:'SYNTHETIC_PRIVATE_PATH'},taskOptions({ownerKey:'SYNTHETIC_PRIVATE_OWNER'}));
  assert.doesNotMatch(JSON.stringify(pool.stats()),/SYNTHETIC_PRIVATE/);
  workers[0].complete({privateValue:'SYNTHETIC_PRIVATE_RESULT'});const lease=await job;
  assert.doesNotMatch(JSON.stringify(pool.stats()),/SYNTHETIC_PRIVATE/);lease.release();
});
test('invalid signal/options cannot leave retained input in the queue',async()=>{
  const {pool,workers}=fakePool();
  for(const signal of [{},true,{aborted:false,addEventListener(){}}])
    await assert.rejects(pool.run('invalid-signal',{},taskOptions({inputBytes:64,signal})),{code:'COMPUTE_JOB_INVALID'});
  for(const options of [null,'invalid',[]])await assert.rejects(pool.run('invalid-options',{},options),{code:'COMPUTE_JOB_INVALID'});
  assert.equal(pool.stats().pending,0);assert.equal(pool.stats().queuedInputBytes,0);assert.equal(workers.length,0);await pool.close();
});
test('a close requested during worker construction settles after its exit',async()=>{
  let closing;const {pool,workers}=fakePool({onConstruct:()=>{closing=pool.close();}});
  await assert.rejects(pool.run('closed-during-start',{},taskOptions()),{code:'COMPUTE_POOL_CLOSED'});
  let timer;const settled=await Promise.race([closing.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),200);})]);clearTimeout(timer);
  assert.equal(settled,true);assert.equal(workers[0].exited,true);assert.equal(pool.stats().reservedBytes,0);
});
test('a job that fits alone can reclaim more than one idle worker cache',async t=>{
  const {pool,workers}=fakePool({maxWorkers:2});t.after(()=>pool.close());
  const first=pool.run('first',{},taskOptions({estimatedBytes:512})),second=pool.run('second',{},taskOptions({estimatedBytes:512}));
  workers[0].complete({}, {retainedBytes:400});(await first).release();workers[1].complete({}, {retainedBytes:400});(await second).release();
  const big=pool.run('big',{},taskOptions({estimatedBytes:900}));big.catch(()=>{});
  await turn();await turn();
  assert.equal(workers.filter(worker=>!worker.exited).length,1);assert.equal(workers.length,3);
  assert.equal(pool.stats().pending,0);assert.equal(pool.stats().estimatedActiveBytes,900);
  workers[2].complete({big:true});const lease=await big;assert.equal(lease.value.big,true);lease.release();
});
test('queue wait and main-thread submission are measured separately from worker execution',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const first=pool.run('first',{},taskOptions()),second=pool.run('second',{},taskOptions());
  await new Promise(resolve=>setTimeout(resolve,25));workers[0].complete();(await first).release();await turn();
  workers[0].complete({}, {executionMs:3});const lease=await second;
  assert.ok(lease.metrics.queueWaitMs>=20);assert.ok(lease.metrics.durationMs>=0);assert.ok(lease.metrics.postMessageMs>=0);
  assert.equal(lease.metrics.executionMs,3);assert.ok(pool.stats().totalQueueWaitMs>=lease.metrics.queueWaitMs);lease.release();
});
test('known source failures retain their safe status without accepting arbitrary worker messages',async t=>{
  const {pool,workers}=fakePool();t.after(()=>pool.close());
  const first=pool.run('source',{},taskOptions());
  workers[0].emit('message',{type:'result',id:workers[0].sent.at(-1).id,ok:false,error:{code:'COMPUTE_SOURCE_OWNER_MISMATCH',message:'SYNTHETIC_PRIVATE_PATH',statusCode:200}});
  await assert.rejects(first,error=>error.code==='COMPUTE_SOURCE_OWNER_MISMATCH'&&error.statusCode===403&&!error.message.includes('SYNTHETIC_PRIVATE_PATH'));
  await turn();const second=pool.run('source',{},taskOptions());
  workers.at(-1).emit('message',{type:'result',id:workers.at(-1).sent.at(-1).id,ok:false,error:{code:'arbitrary',message:'SYNTHETIC_PRIVATE_PATH'}});
  await assert.rejects(second,error=>error.code==='COMPUTE_WORKER_FAILED'&&!error.message.includes('SYNTHETIC_PRIVATE_PATH'));
});
