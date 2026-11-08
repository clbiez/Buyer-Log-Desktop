'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {setup,http,deferred,until,turn,params}=require('./fixtures/backlog-compute-lifecycle/harness.cjs');
test('late native completion after abort cannot publish, leak or remove a replacement flight',async t=>{
 const f=await setup(t),gate=deferred();let finished=false,published=0,releases=0;
 const old=f.subscribe(http(),{}, {build:async ctx=>{
  const lease=await f.service.run('backlog-export',f.descriptor,params(ctx.parts),{signal:ctx.signal});finished=true;await gate.promise;
  return {...lease,release(){releases++;lease.release();}};
 },publish:lease=>{published++;lease.release();}});
 await until(()=>finished);old.release();await assert.rejects(old.promise,{code:'COMPUTE_ABORTED'});
 const fresh=f.subscribe(http('two'));gate.resolve();const lease=await fresh.promise;lease.release();await turn();
 assert.equal(published,0);assert.equal(releases,1);assert.equal(f.lifecycle.inFlight,0);assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('authority/generation revalidation cancels only stale subscriptions; first expired session preserves peer',async t=>{
 const f=await setup(t),gate=deferred();let started=0;
 const build=async ctx=>{started++;await gate.promise;ctx.assertCurrent();return f.service.run('backlog-export',f.descriptor,params(ctx.parts),{signal:ctx.signal});};
 const one=f.subscribe(http(),{}, {build}),two=f.subscribe(http('two'),{}, {build});await until(()=>started===1);
 f.sessions.delete('one');f.lifecycle.revalidate();await assert.rejects(one.promise,{code:'SESSION_REQUIRED'});
 gate.resolve();(await two.promise).release();
 for(const kind of ['authority','generation']){
  const pending=deferred();let ready=false,published=0;
  const old=f.subscribe(http('two'),{}, {build:async ctx=>{ready=true;await pending.promise;ctx.assertCurrent();throw Error('stale work admitted');},publish:l=>{published++;l.release();}});
  // Independent scope/generation must not be cancelled by a local invalidation.
  const otherHttp=http('other'),otherCaptured=f.guard.capture(otherHttp.req,'backlog');
  const other=f.lifecycle.subscribe({...otherHttp,captured:otherCaptured,task:'backlog-export',parts:{},build:async ctx=>{await pending.promise;ctx.assertCurrent();return f.service.run('backlog-export',f.descriptor,params({}),{signal:ctx.signal});}});
  await until(()=>ready);
  if(kind==='authority')f.profile.access+='-new';else f.tokens.set('demo','g2');
  f.lifecycle.revalidate();await assert.rejects(old.promise,{code:'COMPUTE_STALE_GENERATION'});assert.equal(f.lifecycle.inFlight,1);
  pending.resolve();(await other.promise).release();assert.equal(published,0);
 }
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('shared pending preparation survives one cancelled query; abandoned query never submits',async t=>{
 const f=await setup(t),preparation=deferred();let preparations=0;
 const shared=(async()=>{preparations++;await preparation.promise;return f.descriptor;})();
 const build=async ctx=>{const source=await shared;ctx.assertCurrent();return f.service.run('backlog-export',source,params(ctx.parts),{signal:ctx.signal});};
 const a=f.subscribe(http(),{options:{buyerGrup:'G0'}},{build}),b=f.subscribe(http('two'),{options:{buyerGrup:'G1'}},{build});
 await turn();a.release();await assert.rejects(a.promise,{code:'COMPUTE_ABORTED'});preparation.resolve();(await b.promise).release();
 assert.equal(preparations,1);assert.equal(f.records.filter(r=>r.task==='backlog-export').length,1);assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('one query abort does not cancel real shared seed-source preparation for another query',async t=>{
 const f=await setup(t,{rows:10000});f.tokens.set('demo','g2');
 const shared=f.service.seedSource({ownerId:'demo',generation:'g2',source:f.raw,uncompressedBytes:Math.max(1024*1024,require('node:v8').serialize(f.raw).length)});
 const build=async ctx=>{const source=await shared;ctx.assertCurrent();return f.service.run('backlog-export',source,params(ctx.parts),{signal:ctx.signal,traceJobId:ctx.jobId});};
 const a=f.subscribe(http(),{options:{buyerGrup:'G0'}},{build}),b=f.subscribe(http('two'),{options:{buyerGrup:'G1'}},{build});
 a.release();await assert.rejects(a.promise,{code:'COMPUTE_ABORTED'});const prepared=await shared;assert.equal(prepared.generation,'g2');
 const lease=await b.promise;lease.release();assert.equal(f.records.some(r=>r.jobId===a.jobId),false);
 assert.equal(f.records.filter(r=>r.task==='seed-source').at(-1).error,undefined);assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('pre-aborted HTTP and response errors release once; normal request close never aborts',async t=>{
 const f=await setup(t),closed=http();closed.abort();const abandoned=f.subscribe(closed);await assert.rejects(abandoned.promise,{code:'COMPUTE_ABORTED'});
 assert.equal(f.lifecycle.inFlight,0);
 const h=http(),s=f.subscribe(h);h.req.emit('close');const lease=await s.promise;
 h.res.destroyed=true;h.res.emit('close');lease.release();s.release();
 assert.throws(()=>lease.assertResponse(),{code:'COMPUTE_ABORTED'});assert.equal(f.pool.stats().leasedOutputBytes,0);
 const failed=f.subscribe(http(),{}, {publish(){throw Error('synthetic cache publication error');}});
 await assert.rejects(failed.promise,/synthetic cache/);assert.equal(f.pool.stats().leasedOutputBytes,0);
 assert.ok(f.events.every(e=>Object.keys(e).every(k=>['type','requestId','jobId','atMs'].includes(k))));
 assert.ok(!JSON.stringify(f.events).includes('demo'));assert.equal(f.lifecycle.inFlight,0);
});
