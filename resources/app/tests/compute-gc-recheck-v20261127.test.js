'use strict';
/* 503 pilotu: işçi ölçümü havuz sınırını aşarsa (BUYER_LOG_COMPUTE_GC_RECHECK=1) tek GC sonrası
   yeniden ölçülür. Sınır, havuz denetimi ve bayrak kapalı davranış değişmez. */
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {retainedMetrics}=require('../server/lib/read-model/read-model-worker');
const {createComputePool}=require('../server/lib/compute-pool');

const usage=(...values)=>{let i=0;return ()=>{const heapUsed=values[Math.min(i++,values.length-1)];return {heapUsed,arrayBuffers:0};};};

test('flag off: no GC, raw measurement reported',()=>{
  let gcCalls=0;
  const m=retainedMetrics(100,10,{enabled:false,memoryUsage:usage(500,50),gc:()=>{gcCalls++;return true;}});
  assert.deepEqual(m,{retainedBytes:500});assert.equal(gcCalls,0);
});
test('flag on, under limit: no GC',()=>{
  let gcCalls=0;
  const m=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(90,50),gc:()=>{gcCalls++;return true;}});
  assert.deepEqual(m,{retainedBytes:90});assert.equal(gcCalls,0);
});
test('flag on, over limit: one GC then re-measure (result may still exceed; pool decides)',()=>{
  let gcCalls=0;
  const freed=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500,60),gc:()=>{gcCalls++;return true;}});
  assert.equal(freed.retainedBytes,60);assert.equal(freed.gcRecheck.beforeBytes,500);assert.equal(gcCalls,1);
  const still=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500,400),gc:()=>true});
  assert.equal(still.retainedBytes,400);
});
test('flag on, no limit or GC unavailable: raw measurement',()=>{
  assert.deepEqual(retainedMetrics(undefined,10,{enabled:true,memoryUsage:usage(500),gc:()=>true}),{retainedBytes:500});
  assert.deepEqual(retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500),gc:()=>false}),{retainedBytes:500});
});
test('real GC hook works in this runtime',()=>{
  const m=retainedMetrics(0,0,{enabled:true});
  assert.ok(m.gcRecheck,'gc() must be obtainable via setFlagsFromString');
});

test('pool sends retainedLimitBytes equal to its own acceptance bound and still rejects over-limit results',async()=>{
  class FakeWorker extends EventEmitter{constructor(){super();this.sent=[];FakeWorker.last=this;this.threadId=1;}postMessage(m){this.sent.push(m);}terminate(){this.threadId=-1;queueMicrotask(()=>this.emit('exit'));return Promise.resolve();}ref(){}unref(){}}
  const pool=createComputePool({workerFile:__filename,WorkerClass:FakeWorker,maxWorkers:1,memoryBudgetBytes:1024,maxPendingBytes:256,workerBaseBytes:0});
  try{
    const ok=pool.run('t',{},{ownerKey:'u',generation:'g',estimatedBytes:300,inputBytes:0});
    await new Promise(r=>setImmediate(r));
    const w=FakeWorker.last,msg=w.sent[0];
    assert.equal(msg.retainedLimitBytes,300);
    w.emit('message',{type:'result',id:msg.id,ok:true,value:1,metrics:{retainedBytes:200,outputBytes:100}});
    (await ok).release();
    const over=pool.run('t',{},{ownerKey:'u',generation:'g',estimatedBytes:300,inputBytes:0});
    await new Promise(r=>setImmediate(r));
    const msg2=w.sent[1];
    assert.equal(msg2.retainedLimitBytes,500);
    w.emit('message',{type:'result',id:msg2.id,ok:true,value:1,metrics:{retainedBytes:450,outputBytes:100}});
    await assert.rejects(over,error=>error.code==='COMPUTE_ESTIMATE_EXCEEDED');
  }finally{await pool.close?.();}
});
