'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createComputeSourceCache}=require('../server/lib/compute-source-cache');
const descriptor=(ownerId='a',generation='g1',bytes=400)=>({ownerId,generation,loadedAt:'r1',bytes});
const snapshot=label=>{const rows=[{buyer:label,ex:new Date(2026,3,5)}];return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows}};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('same owner/generation shares one load, Dates and identity aliases remain intact',async()=>{
  let loads=0;const source=snapshot('Synthetic A'),cache=createComputeSourceCache({maxBytes:1000,loadSnapshot:async()=>{loads++;await turn();return source;}});
  const [a,b]=await Promise.all([cache.acquire(descriptor(),'a'),cache.acquire(descriptor(),'a')]);
  assert.equal(loads,1);assert.equal(a.snapshot,b.snapshot);assert.equal(a.snapshot.asasOrdersByTarget.cp,a.snapshot.asasOrders);
  assert.ok(a.snapshot.asasOrders[0].ex instanceof Date);a.release();a.release();assert.equal(cache.stats().reservedBytes,400);
  b.release();const c=await cache.acquire(descriptor(),'a');assert.equal(loads,1);c.release();cache.clear();assert.equal(cache.stats().reservedBytes,0);
});
test('owner mismatch is refused before I/O and equal generations never share across owners',async()=>{
  const owners=[],cache=createComputeSourceCache({maxBytes:1000,loadSnapshot:async owner=>{owners.push(owner);return snapshot(owner);}});
  await assert.rejects(cache.acquire(descriptor('a'),'b'),{code:'COMPUTE_SOURCE_OWNER_MISMATCH'});assert.deepEqual(owners,[]);
  const a=await cache.acquire(descriptor('a'),'a'),b=await cache.acquire(descriptor('b'),'b');
  assert.notEqual(a.snapshot,b.snapshot);assert.equal(a.snapshot.asasOrders[0].buyer,'a');assert.equal(b.snapshot.asasOrders[0].buyer,'b');
  a.release();b.release();cache.clear();
});
test('byte admission and pinning protect live snapshots, unused snapshots are evicted',async()=>{
  let loads=0;const cache=createComputeSourceCache({maxBytes:600,loadSnapshot:async owner=>{loads++;return snapshot(owner);}});
  const a=await cache.acquire(descriptor(),'a');
  await assert.rejects(cache.acquire(descriptor('b'),'b'),{code:'COMPUTE_SOURCE_BUSY'});assert.equal(loads,1);
  a.release();const b=await cache.acquire(descriptor('b'),'b');assert.equal(cache.stats().entries,1);assert.equal(cache.stats().reservedBytes,400);assert.equal(loads,2);
  b.release();cache.clear();
});
test('a source too large for the cache is rejected even when it is idle',async()=>{
  let loads=0;const cache=createComputeSourceCache({maxBytes:600,loadSnapshot:async()=>{loads++;return snapshot('a');}});
  await assert.rejects(cache.acquire(descriptor('a','g1',700),'a'),{code:'COMPUTE_SOURCE_TOO_LARGE'});assert.equal(loads,0);assert.equal(cache.stats().reservedBytes,0);
});
test('loadedAt mismatch never publishes a cache entry and cache hits are checked too',async()=>{
  const cache=createComputeSourceCache({maxBytes:1000,loadSnapshot:async()=>snapshot('a')});
  await assert.rejects(cache.acquire({...descriptor(),loadedAt:'r2'},'a'),{code:'COMPUTE_STALE_GENERATION'});
  assert.equal(cache.stats().entries,0);assert.equal(cache.stats().reservedBytes,0);
  const lease=await cache.acquire(descriptor(),'a');await assert.rejects(cache.acquire({...descriptor(),loadedAt:'r2'},'a'),{code:'COMPUTE_STALE_GENERATION'});
  assert.equal(cache.stats().pinnedEntries,1);lease.release();cache.clear();
});
test('invalidation keeps pins/loading bytes charged until their actual release',async()=>{
  let finish;const cache=createComputeSourceCache({maxBytes:1000,loadSnapshot:()=>new Promise(resolve=>{finish=resolve;})});
  const request=cache.acquire(descriptor(),'a'),rejected=assert.rejects(request,{code:'COMPUTE_STALE_GENERATION'});await turn();
  cache.invalidate('a');assert.equal(cache.stats().reservedBytes,400);finish(snapshot('a'));await rejected;assert.equal(cache.stats().reservedBytes,0);
  const second=cache.acquire(descriptor(),'a');await turn();finish(snapshot('a'));const lease=await second;
  cache.invalidate('a');assert.equal(cache.stats().reservedBytes,400);lease.release();assert.equal(cache.stats().reservedBytes,0);
});
test('a missing personal snapshot never falls back to a different owner',async()=>{
  const owners=[],cache=createComputeSourceCache({maxBytes:1000,loadSnapshot:async owner=>{owners.push(owner);return null;}});
  const lease=await cache.acquire(descriptor('buyer-a'),'buyer-a');assert.equal(lease.snapshot,null);lease.release();
  assert.deepEqual(owners,['buyer-a']);assert.equal(cache.stats().reservedBytes,0);assert.equal(cache.stats().entries,0);
});
