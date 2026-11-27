'use strict';
/* 503 pilotu: işçi ölçümü havuz sınırını aşarsa (BUYER_LOG_COMPUTE_GC_RECHECK=1) tek GC sonrası
   yeniden ölçülür. Sınır, havuz denetimi ve bayrak kapalı davranış değişmez. */
const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const vm=require('node:vm');
const {retainedMetrics,GC_RECHECK_MIN_INTERVAL_MS}=require('../server/lib/read-model/read-model-worker');
const {createComputePool}=require('../server/lib/compute-pool');

const usage=(...values)=>{let i=0;return ()=>{const heapUsed=values[Math.min(i++,values.length-1)];return {heapUsed,arrayBuffers:0};};};
// Her test kendi işçi durumunu kullanır (modül durumu paylaşılmaz).
const fresh=()=>({lastAt:-Infinity});

test('flag off: no GC, raw measurement reported',()=>{
  let gcCalls=0;
  const m=retainedMetrics(100,10,{enabled:false,memoryUsage:usage(500,50),gc:()=>{gcCalls++;return true;},state:fresh()});
  assert.deepEqual(m,{retainedBytes:500});assert.equal(gcCalls,0);
});
test('flag on, under limit: no GC',()=>{
  let gcCalls=0;
  const m=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(90,50),gc:()=>{gcCalls++;return true;},state:fresh()});
  assert.deepEqual(m,{retainedBytes:90});assert.equal(gcCalls,0);
});
test('flag on, over limit: one GC then re-measure (result may still exceed; pool decides)',()=>{
  let gcCalls=0;
  const freed=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500,60),gc:()=>{gcCalls++;return true;},state:fresh()});
  assert.equal(freed.retainedBytes,60);assert.equal(freed.gcRecheck.beforeBytes,500);assert.equal(gcCalls,1);
  const still=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500,400),gc:()=>true,state:fresh()});
  assert.equal(still.retainedBytes,400);
});
test('flag on, no limit or GC unavailable: raw measurement',()=>{
  assert.deepEqual(retainedMetrics(undefined,10,{enabled:true,memoryUsage:usage(500),gc:()=>true,state:fresh()}),{retainedBytes:500});
  assert.deepEqual(retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500),gc:()=>false,state:fresh()}),{retainedBytes:500,gcRecheckSkipped:'unavailable'});
});
test('only the exact value 1 enables the flag; default env is off',()=>{
  const prev=process.env.BUYER_LOG_COMPUTE_GC_RECHECK;let gcCalls=0;const gc=()=>{gcCalls++;return true;};
  try{
    for(const v of [undefined,'','0','true','yes',' 1']){
      if(v===undefined)delete process.env.BUYER_LOG_COMPUTE_GC_RECHECK;else process.env.BUYER_LOG_COMPUTE_GC_RECHECK=v;
      assert.deepEqual(retainedMetrics(100,10,{memoryUsage:usage(500),gc,state:fresh()}),{retainedBytes:500},String(v));
    }
    assert.equal(gcCalls,0);
  }finally{if(prev===undefined)delete process.env.BUYER_LOG_COMPUTE_GC_RECHECK;else process.env.BUYER_LOG_COMPUTE_GC_RECHECK=prev;}
});
test('no per-query GC: 1000 under-limit jobs never collect',()=>{
  let gcCalls=0;const state=fresh();
  for(let i=0;i<1000;i++)retainedMetrics(1000,10,{enabled:true,memoryUsage:usage(500),gc:()=>{gcCalls++;return true;},now:()=>i,state});
  assert.equal(gcCalls,0);
});
test('no GC loop: still over limit after GC → exactly one GC, raw value goes to the pool',()=>{
  let gcCalls=0;
  const m=retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500,450,40),gc:()=>{gcCalls++;return true;},state:fresh()});
  assert.equal(gcCalls,1);assert.equal(m.retainedBytes,450);assert.equal(m.gcRecheck.beforeBytes,500);
});
test('rate bound: consecutive over-limit jobs collect at most once per interval per worker',()=>{
  assert.equal(GC_RECHECK_MIN_INTERVAL_MS,5000);
  let gcCalls=0,t=0;const state=fresh(),opts={enabled:true,gc:()=>{gcCalls++;return true;},now:()=>t,state};
  const outs=[];
  for(let i=0;i<50;i++){t=i*100;outs.push(retainedMetrics(100,10,{...opts,memoryUsage:usage(500,60)}));}
  assert.equal(gcCalls,1,'50 jobs in 4.9 s → one GC');
  assert.ok(outs[0].gcRecheck);
  for(const o of outs.slice(1)){assert.equal(o.gcRecheckSkipped,'interval');assert.equal(o.retainedBytes,500);}
  t=4999;retainedMetrics(100,10,{...opts,memoryUsage:usage(500,60)});assert.equal(gcCalls,1);
  t=5000;assert.ok(retainedMetrics(100,10,{...opts,memoryUsage:usage(500,60)}).gcRecheck);assert.equal(gcCalls,2);
  // GC alınamadıysa bekleme başlamaz; sonraki iş yeniden dener (yine en fazla 1 deneme / iş).
  const s2=fresh();let tries=0;
  for(let i=0;i<3;i++)retainedMetrics(100,10,{enabled:true,memoryUsage:usage(500),gc:()=>{tries++;return false;},now:()=>i,state:s2});
  assert.equal(tries,3);assert.equal(s2.lastAt,-Infinity);
});
test('real GC hook works in this runtime and does not leave --expose-gc on',()=>{
  const m=retainedMetrics(0,0,{enabled:true,state:fresh()});
  assert.ok(m.gcRecheck,'gc() must be obtainable via setFlagsFromString');
  if(typeof globalThis.gc!=='function')assert.equal(vm.runInNewContext('typeof gc'),'undefined');
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
