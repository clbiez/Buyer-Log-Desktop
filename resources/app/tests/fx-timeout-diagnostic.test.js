'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const diag=require('../scripts/diagnose-fx-timeout');

test('a queued timeout has no worker execution interval; absent telemetry stays unknown',()=>{
  const events=[{kind:'submit',job:1,atMs:100,task:'excel-utility'},
    {kind:'submitted',job:1,atMs:101},{kind:'settled',job:1,atMs:5101,code:'COMPUTE_TIMEOUT',metrics:{queueWaitMs:5000,durationMs:0}}];
  const out=diag.summarizeJob(events,1);
  assert.equal(out.phase,'queue');assert.equal(out.workerExecutionMs,null);
  assert.deepEqual(out.enqueueBoundsMs,[100,101]);assert.equal(out.metrics.queueWaitMs,5000);
  assert.equal(diag.summarizeJob(events.filter(e=>e.kind!=='settled'),1).phase,'unknown');
});
test('dispatch, startup and worker execution use separate timestamp intervals',()=>{
  const events=[{kind:'submit',job:1,atMs:100,task:'excel-utility'},
    {kind:'constructor-start',job:1,atMs:110,worker:7},{kind:'constructor-end',job:1,atMs:120,worker:7},
    {kind:'dispatch',job:1,atMs:121,worker:7,nativeId:1},{kind:'worker-boot',worker:7,atMs:150},
    {kind:'worker-receive',worker:7,nativeId:1,atMs:200},{kind:'worker-finish',worker:7,nativeId:1,atMs:210},
    {kind:'settled',job:1,atMs:211,metrics:{queueWaitMs:10,durationMs:101,executionMs:9}}];
  const out=diag.summarizeJob(events,1);
  assert.equal(out.phase,'completed');assert.equal(out.constructorMs,10);assert.equal(out.dispatchToReceiveMs,79);
  assert.equal(out.workerExecutionMs,10);assert.equal(out.workerBootAtMs,150);
  assert.equal(diag.summarizeJob(events.filter(e=>e.kind!=='worker-receive'),1).workerExecutionMs,null);
});
test('a constructor opened by a later queue pump belongs to the first dispatched job on that worker',()=>{
  const events=[{kind:'submit',job:1,atMs:100,task:'excel-utility'},{kind:'submitted',job:1,atMs:101},
    {kind:'constructor-start',job:null,worker:7,atMs:110},{kind:'constructor-end',job:null,worker:7,atMs:120},
    {kind:'dispatch',job:1,worker:7,nativeId:1,atMs:121},{kind:'settled',job:1,atMs:211,metrics:{queueWaitMs:10,durationMs:101}}];
  assert.equal(diag.summarizeJob(events,1).constructorMs,10);
  events.push({kind:'submit',job:2,atMs:220,task:'excel-utility'},{kind:'dispatch',job:2,worker:7,nativeId:2,atMs:221});
  assert.equal(diag.summarizeJob(events,2).constructorMs,null,'a reused worker does not have a second constructor');
});
test('memory and serialization can block an idle slot independently of worker occupancy',()=>{
  const job={estimatedBytes:256,inputBytes:1,serializationKey:'shared-fx'};
  const base={memoryBudgetBytes:1000,reservedBytes:100,workerCount:2,activeWorkers:1,maxWorkers:2};
  assert.deepEqual(diag.blockers(base,job,[{serializationKey:'shared-fx'}]),['serializationKey']);
  assert.deepEqual(diag.blockers({...base,reservedBytes:900},job,[]),['memory']);
  assert.deepEqual(diag.blockers({...base,activeWorkers:2,reservedBytes:900},job,[{serializationKey:'shared-fx'}]),['serializationKey','slots','memory']);
});
test('synthetic observer refuses missing metadata and symbolic roots',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-fx-diag-test-'));
  try{
    assert.throws(()=>diag.validateRoot(root),/synthetic/i);
    fs.writeFileSync(path.join(root,'fx-diagnostic.json'),JSON.stringify({synthetic:true}));
    assert.equal(diag.validateRoot(root),root);
    assert.throws(()=>diag.prepareRoot(root),/fresh/i,'a diagnostic must not overwrite an existing root');
    fs.symlinkSync(root,root+'-link');
    try{assert.throws(()=>diag.validateRoot(root+'-link'),/symbolic|linked/i);}finally{fs.unlinkSync(root+'-link');}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('the generated KUR fixture passes the canonical production parser before measurement',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-fx-kur-test-'));
  try{
    const parsed=require('../server/lib/fxWorkbook').readFxWorkbook(diag.writeKurFixture(root));
    assert.equal(parsed.data.reportMonth,'2026-11');assert.equal(parsed.data.months['2026-11'].TRY,40);
    assert.equal(parsed.data.months['2026-11'].EUR,.95);assert.ok(parsed.stats.currencyCount>=3);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('native common worker observer preserves results, lease and source hashes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-fx-diag-test-'));
  fs.writeFileSync(path.join(root,'fx-diagnostic.json'),JSON.stringify({synthetic:true}));
  const observer=diag.createObserver({root}),{createComputePool}=require('../server/lib/compute-pool');
  const hashes=diag.productionHashes();
  const pool=observer.observePool(createComputePool,{maxWorkers:1,memoryBudgetBytes:512*1024*1024});
  t.after(async()=>{await pool.close();observer.flush();fs.rmSync(root,{recursive:true,force:true});});
  const lease=await pool.run('health',{}, {ownerKey:'synthetic',generation:'1',estimatedBytes:64*1024*1024})
    .catch(error=>{error.message+=' '+JSON.stringify(observer.events.filter(e=>e.kind.includes('error')));throw error;});
  assert.deepEqual(lease.value,{ok:true});assert.ok(pool.stats().leasedOutputBytes>0);lease.release();
  assert.equal(pool.stats().leasedOutputBytes,0);
  const out=diag.summarizeJob(observer.events,1);
  assert.equal(out.phase,'completed');assert.ok(out.workerExecutionMs>=0);assert.ok(out.workerBootAtMs>0);
  assert.equal(observer.events.filter(e=>e.kind==='constructor-start').length,1);
  assert.deepEqual(diag.productionHashes(),hashes,'observation must not alter production sources');
});
