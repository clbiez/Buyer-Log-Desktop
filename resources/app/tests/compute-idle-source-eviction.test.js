'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
test('idle cache eviction retires only that owner and removes published and pending compute descriptors',()=>{
  const day=24*60*60*1000,now=Date.now(),retired=[];
  const ctx={Date,SOURCE_CACHE_IDLE_EVICT_MS:day,sourceCaches:new Map([['idle',{}],['warm',{}]]),sourceCacheLastAccess:new Map([['idle',now-day-10000],['warm',now]]),initialDataLoadPromises:new Map([['idle',{}]]),publishedComputeSources:new Map([['idle',{}],['warm',{}]]),coldComputeSourcesInFlight:new Map([['idle',{}]]),retireComputeSource:id=>retired.push(id)};
  vm.createContext(ctx);vm.runInContext(extractFunction(source,'retireUserComputeSource')+extractFunction(source,'evictIdleSourceCaches')+';evictIdleSourceCaches();',ctx);
  assert.deepEqual(retired,['idle']);assert.equal(ctx.sourceCaches.has('idle'),false);assert.equal(ctx.publishedComputeSources.has('idle'),false);assert.equal(ctx.coldComputeSourcesInFlight.has('idle'),false);
  assert.ok(ctx.sourceCaches.has('warm'));assert.ok(ctx.publishedComputeSources.has('warm'));
});
