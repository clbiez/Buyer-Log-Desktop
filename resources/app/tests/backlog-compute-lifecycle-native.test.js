'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,http,until,turn,decode}=require('./fixtures/backlog-compute-lifecycle/harness.cjs');
test('two HTTP subscribers: first disconnect preserves the real shared Backlog job and exact output',async t=>{
 const f=await setup(t),a=http(),b=http('two');let publications=0,cacheLease;
 const one=f.subscribe(a,{}, {publish:lease=>{publications++;cacheLease=lease;}}),two=f.subscribe(b);
 assert.equal(one.jobId,two.jobId);assert.notEqual(one.requestId,two.requestId);
 a.abort();await assert.rejects(one.promise,{code:'COMPUTE_ABORTED'});
 const lease=await two.promise;
 const tasks=require('../server/lib/compute-tasks'),{params}=require('./fixtures/backlog-compute-lifecycle/harness.cjs');
 assert.deepEqual(decode(lease),JSON.parse(tasks.serialize(tasks.buildBacklog('export',f.raw,params({})))));
 assert.equal(f.records.filter(r=>r.task==='backlog-export').length,1);assert.equal(publications,1);
 assert.ok(f.pool.stats().leasedOutputBytes>0);
 b.res.writableFinished=true;b.res.emit('finish');lease.release();cacheLease.release();cacheLease.release();
 assert.equal(f.pool.stats().leasedOutputBytes,0);assert.equal(f.events.filter(e=>e.type==='job-abort').length,0);
 assert.equal(b.req.listenerCount('aborted')+b.res.listenerCount('close')+b.res.listenerCount('finish'),0);
});
test('last queued subscriber leaves: no dispatch and no leaked queued input bytes',async t=>{
 const f=await setup(t,{rows:10000});
 // A real Backlog build occupies the sole native worker.
 const run=f.service.run.bind(f.service),block=new AbortController();
 const blocker=run('backlog-export',f.descriptor,require('./fixtures/backlog-compute-lifecycle/harness.cjs').params({}),{signal:block.signal});
 blocker.catch(()=>{});
 await until(()=>f.records.filter(r=>r.task==='backlog-export').at(-1)?.['build-start']);
 const a=http(),s=f.subscribe(a,{options:{buyerGrup:'G1'}});
 await until(()=>f.records.some(r=>r.jobId===s.jobId));
 assert.equal(f.pool.stats().pending,1);a.abort();await assert.rejects(s.promise,{code:'COMPUTE_ABORTED'});
 await until(()=>f.records.find(r=>r.jobId===s.jobId)?.error);
 assert.equal(f.records.find(r=>r.jobId===s.jobId).dispatchedAt,undefined);
 block.abort();await blocker.catch(()=>{});await until(()=>f.pool.stats().activeWorkers===0);
 assert.equal(f.pool.stats().pending,0);assert.equal(f.pool.stats().queuedInputBytes,0);assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('last running subscriber terminates the native worker inside the real Backlog builder',async t=>{
 const f=await setup(t,{rows:10000}),h=http(),s=f.subscribe(h);
 await until(()=>f.records.find(r=>r.jobId===s.jobId)?.['build-start']);
 const r=f.records.find(r=>r.jobId===s.jobId);assert.equal(r['build-end'],undefined);
 h.abort();await assert.rejects(s.promise,{code:'COMPUTE_ABORTED'});
 assert.ok(f.pool.stats().activeWorkers>0,'retiring slot remains charged before native exit');
 assert.ok(f.pool.stats().estimatedActiveBytes>0);
 await until(()=>r.exitAt);assert.ok(r.terminateAt);assert.equal(r['build-end'],undefined);assert.equal(r.completedAt,undefined);
 assert.equal(r.worker.threadId,-1);assert.equal(f.pool.stats().estimatedActiveBytes,0);assert.equal(f.pool.stats().queuedInputBytes,0);
 const next=f.subscribe(http('two'),{options:{buyerGrup:'G1'}}),lease=await next.promise;assert.ok(decode(lease).rows.length>0);lease.release();
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('abort at native postMessage dispatch race retains exit accounting and same-key replacement',async t=>{
 const f=await setup(t),h=http(),worker=f.workers.at(-1),post=worker.postMessage;
 worker.postMessage=function(message,...rest){const value=post.call(this,message,...rest);if(message.task==='backlog-export')h.abort();return value;};
 const old=f.subscribe(h);await assert.rejects(old.promise,{code:'COMPUTE_ABORTED'});
 const next=f.subscribe(http('two'));assert.notEqual(next.jobId,old.jobId);
 const lease=await next.promise;lease.release();await until(()=>f.records.find(r=>r.jobId===old.jobId)?.exitAt);
 assert.equal(f.pool.stats().pending,0);assert.equal(f.pool.stats().leasedOutputBytes,0);assert.equal(f.lifecycle.inFlight,0);
});
test('includeSourceDetails and projection/query identity stay separate with native outputs',async t=>{
 const f=await setup(t),a=f.subscribe(http(),{includeSourceDetails:false}),b=f.subscribe(http('two'),{includeSourceDetails:true});
 assert.notEqual(a.jobId,b.jobId);const [thin,full]=await Promise.all([a.promise,b.promise]);
 try{assert.equal(decode(thin).rows[0]._detailSource,undefined);assert.ok(decode(full).rows[0]._detailSource);}
 finally{thin.release();full.release();}assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('live authority and source revalidation retire native work without cancelling unrelated generation',async t=>{
 for(const kind of ['authority','generation']){
  const f=await setup(t,{rows:10000});
  const otherDescriptor=await f.service.seedSource({ownerId:'other',generation:'other-g1',source:f.raw,uncompressedBytes:Math.max(1024*1024,require('node:v8').serialize(f.raw).length)});
  const access=require('../server/lib/compute-access').createAccessContext({userId:'other',systemRole:'buyer',viewScope:{buyers:['Synthetic Buyer']},authority:{},profiles:[]});
  const h=http(),old=f.subscribe(h);let published=0;
  await until(()=>f.records.find(r=>r.jobId===old.jobId)?.['build-start']);
  const otherHttp=http('other'),otherCaptured=f.guard.capture(otherHttp.req,'backlog');
  const other=f.lifecycle.subscribe({...otherHttp,captured:otherCaptured,task:'backlog-export',parts:{includeSourceDetails:true},
   build:async ctx=>{ctx.assertCurrent();return f.service.run('backlog-export',otherDescriptor,{...require('./fixtures/backlog-compute-lifecycle/harness.cjs').params(ctx.parts),access},{signal:ctx.signal,traceJobId:ctx.jobId});},
   publish:lease=>{published++;lease.release();}});
  await until(()=>f.pool.stats().pending===1);
  if(kind==='authority')f.profile.access='revoked';else f.tokens.set('demo','g2');
  f.lifecycle.revalidate();await assert.rejects(old.promise,{code:'COMPUTE_STALE_GENERATION'});
  const lease=await other.promise;assert.ok(decode(lease).rows.length);lease.release();
  const r=f.records.find(r=>r.jobId===old.jobId);await until(()=>r.exitAt);assert.equal(r['build-end'],undefined);
  assert.equal(published,1);assert.equal(f.pool.stats().leasedOutputBytes,0);assert.equal(f.pool.stats().pending,0);
 }
});
