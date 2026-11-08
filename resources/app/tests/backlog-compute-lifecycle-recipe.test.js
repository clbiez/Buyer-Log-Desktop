'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const recipe=require('../../../scripts/prototypes/ana12-backend-cancellation-20261108/route-recipe.cjs');
const sources=recipe.materialize(),file=path.join(recipe.root,recipe.readService);
const patched=new Module(file,module);patched.filename=file;patched.paths=Module._nodeModulePaths(path.dirname(file));patched._compile(sources[recipe.readService],file);
const {setup,http,params,until}=require('./fixtures/backlog-compute-lifecycle/harness.cjs');
test('exact recipe uses existing byte cache, releases rejected publication and keeps HTTP subscribers separate',async t=>{
 const f=await setup(t);let at=0;
 const service=patched.exports.createComputeReadService({compute:f.service,guard:f.guard,sourceFor:async()=>f.descriptor,paramsFor:(_p,_s,_t,parts)=>params(parts),ttlMs:10,now:()=>at});
 const a=http(),b=http('two'),one=service.run(a.req,'backlog','backlog-export',{}, {response:a.res}),two=service.run(b.req,'backlog','backlog-export',{}, {response:b.res});one.catch(()=>{});
 a.abort();await assert.rejects(one,{code:'COMPUTE_ABORTED'});(await two).release();
 assert.equal(service.stats().entries,1);assert.ok(f.pool.stats().leasedOutputBytes>0);
 const h=http();(await service.run(h.req,'backlog','backlog-export',{}, {response:h.res})).release();
 assert.equal(f.records.filter(r=>r.task==='backlog-export').length,1);
 at=11;const next=http();(await service.run(next.req,'backlog','backlog-export',{}, {response:next.res})).release();
 assert.equal(f.records.filter(r=>r.task==='backlog-export').length,2);service.clear();assert.equal(f.pool.stats().leasedOutputBytes,0);
 const disabled=patched.exports.createComputeReadService({compute:f.service,guard:f.guard,sourceFor:async()=>f.descriptor,paramsFor:()=>params({}),maxEntries:0});
 const c=http();(await disabled.run(c.req,'backlog','backlog-export',{}, {response:c.res})).release();assert.equal(disabled.stats().entries,0);assert.equal(f.pool.stats().leasedOutputBytes,0);
});
test('exact route edits pass response context on each Backlog computed route and leave shared preparation in place',()=>{
 const vm=require('node:vm');new vm.Script(sources[recipe.server]);
 for(const route of ['/api/backlog','/api/backlog-source-columns','/api/backlog-export','/api/backlog-filter-values','/api/backlog-map-details']){
  const begin=sources[recipe.server].indexOf("app."+(route.endsWith('map-details')?'post':'get')+"('"+route+"'");
  const body=sources[recipe.server].slice(begin,sources[recipe.server].indexOf('\n});',begin));
  assert.ok(body.includes('await prepareComputeBacklog(req)'));assert.ok(body.includes('response:res'));
 }
});
test('recipe rejects stale authority after real native completion and does not publish cache bytes',async t=>{
 const f=await setup(t);
 const service=patched.exports.createComputeReadService({guard:f.guard,sourceFor:async()=>f.descriptor,paramsFor:()=>params({}),compute:{async run(...args){const lease=await f.service.run(...args);f.profile.access='changed-after-native-result';return lease;}}});
 const h=http();await assert.rejects(service.run(h.req,'backlog','backlog-export',{}, {response:h.res}),{code:'COMPUTE_STALE_GENERATION'});
 assert.equal(service.stats().entries,0);assert.equal(f.pool.stats().leasedOutputBytes,0);
});
// Run existing assertions unchanged against the in-memory recipe as well.
require.cache[file]=patched;
require('./compute-read-service.test.js');
