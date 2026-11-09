'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createComputeReadService}=require('../server/lib/compute-read-service');
const {createComputeReadGuard}=require('../server/lib/compute-read-guard');
function setup(options={}){
  const profile={id:'a',enabled:true,status:'ACTIVE',context:'ctx',access:'access'},sessions=new Map([['one',profile],['two',profile]]);let source='g1',calls=0,releases=0,complete;
  const guard=createComputeReadGuard({sessionProfile:req=>sessions.get(req.cookie),profileById:()=>profile,hasArea:()=>true,contextFor:p=>({contextHash:p.context}),accessFor:p=>({accessHash:p.access}),sourceTokenFor:()=>source});
  const compute={run:async()=>{calls++;await new Promise(resolve=>complete=resolve);return {value:{buffer:new ArrayBuffer(8)},metrics:{outputBytes:8},release:()=>releases++};}};
  const service=createComputeReadService({compute,guard,sourceFor:async()=>({generation:source}),paramsFor:()=>({overrides:{notesmap:{note:'selected snapshot'}}}),maxBytes:16,...options});
  return {service,sessions,profile,setSource:value=>source=value,finish:()=>complete(),calls:()=>calls,releases:()=>releases};
}
// Drain request preparation and its real event-loop handoff to worker dispatch.
const turn=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
test('one in-flight build serves independent consumers and holds bytes until their last release',async()=>{
  const f=setup(),one=f.service.run({cookie:'one'},'backlog','backlog-export',{q:1}),two=f.service.run({cookie:'two'},'backlog','backlog-export',{q:1});
  await turn();assert.equal(f.calls(),1);f.finish();const [a,b]=await Promise.all([one,two]);assert.equal(a.value,b.value);
  a.release();assert.equal(f.releases(),0);f.service.clear();assert.equal(f.releases(),0);b.release();b.release();assert.equal(f.releases(),1);
});
test('expiring the first consumer session does not cancel or disclose the second consumer response',async()=>{
  const f=setup(),one=f.service.run({cookie:'one'},'backlog','backlog-export',{q:1}),two=f.service.run({cookie:'two'},'backlog','backlog-export',{q:1});one.catch(()=>{});
  await turn();f.sessions.delete('one');f.finish();await assert.rejects(one,{statusCode:401});const b=await two;b.assertResponse();b.release();f.service.clear();assert.equal(f.releases(),1);
});
test('source or authority change during worker execution rejects and releases the unpublished result',async()=>{
  for(const change of [f=>f.setSource('g2'),f=>f.profile.access='new-authority']){
    const f=setup(),pending=f.service.run({cookie:'one'},'backlog','backlog-export',{});pending.catch(()=>{});await turn();change(f);f.finish();await assert.rejects(pending,{code:'COMPUTE_STALE_GENERATION'});assert.equal(f.releases(),1);assert.equal(f.service.stats().entries,0);
  }
});
test('bounded gzip cache separates query variants and expires by bytes and time',async()=>{
  let now=0;const f=setup({now:()=>now,ttlMs:10,maxBytes:8});
  const first=f.service.run({cookie:'one'},'backlog','backlog-export',{q:1});await turn();f.finish();(await first).release();
  (await f.service.run({cookie:'two'},'backlog','backlog-export',{q:1})).release();assert.equal(f.calls(),1);
  const second=f.service.run({cookie:'one'},'backlog','backlog-export',{q:2});await turn();f.finish();(await second).release();assert.equal(f.releases(),1);assert.equal(f.service.stats().bytes,8);
  now=11;const third=f.service.run({cookie:'one'},'backlog','backlog-export',{q:2});await turn();f.finish();(await third).release();assert.equal(f.calls(),3);f.service.clear();assert.equal(f.releases(),3);
});
test('response authority is checked again after caller-side async work',async()=>{
  const f=setup(),pending=f.service.run({cookie:'one'},'backlog','backlog-export',{});await turn();f.finish();const lease=await pending;
  f.sessions.delete('one');assert.throws(()=>lease.assertResponse(),{statusCode:401});lease.release();f.service.clear();assert.equal(f.releases(),1);
});
test('verified cached buffers are passed separately from the small revision/query key',async()=>{
  let received;const bytes=Buffer.from('Synthetic verified gzip bytes'),f=setup({paramsFor:(_profile,_source,_task,parts)=>{received=parts.extra;return {};}});
  const pending=f.service.run({cookie:'one'},'cp','projection-envelope',{generation:'g1'},{payload:{extra:bytes}});await turn();f.finish();const lease=await pending;
  assert.equal(received,bytes);lease.release();f.service.clear();
});
test('worker dispatch yields to the event loop and rechecks authority before admitting prepared input',async()=>{
 const f=setup(),pending=f.service.run({cookie:'one'},'backlog','backlog-export',{});pending.catch(()=>{});
 setImmediate(()=>{f.profile.access='revoked-before-dispatch';});
 try{await new Promise(setImmediate);assert.equal(f.calls(),0,'request preparation must give an actual event-loop turn before worker dispatch');await assert.rejects(pending,{code:'COMPUTE_STALE_GENERATION'});}
 finally{if(f.calls())f.finish();await pending.catch(()=>{});}
});

test('opt-in cancellation preserves source/access guards and a live peer session',async()=>{
 for(const change of [f=>f.setSource('g2'),f=>f.profile.access='new-authority']){
  const f=setup(),controller=new AbortController(),pending=f.service.run({cookie:'one'},'backlog','backlog-export',{}, {signal:controller.signal});pending.catch(()=>{});
  await turn();change(f);f.finish();await assert.rejects(pending,{code:'COMPUTE_STALE_GENERATION'});assert.equal(f.releases(),1);assert.equal(f.service.stats().bytes,0);
 }
 const f=setup(),a=new AbortController(),b=new AbortController(),one=f.service.run({cookie:'one'},'backlog','backlog-export',{}, {signal:a.signal}),two=f.service.run({cookie:'two'},'backlog','backlog-export',{}, {signal:b.signal});one.catch(()=>{});
 await turn();f.sessions.delete('one');a.abort();await assert.rejects(one,{code:'COMPUTE_ABORTED'});f.finish();const lease=await two;lease.assertResponse();lease.release();f.service.clear();assert.equal(f.releases(),1);
});
