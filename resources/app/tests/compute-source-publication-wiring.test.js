'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const server=require('./helpers/server-source')();
test('live source save prepares an exact replica and publishes only the active runtime',async()=>{
  for(const active of [true,false]){
    const rows=[{model:'2026-04-05T00:00:00.000Z',ex:new Date(2026,3,5)}],runtime={loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows}},events=[];let seeded;
    const service={seedSource:async input=>{events.push('prepare');seeded=input;return {generation:'g2',capability:'private'};},publishSource:async()=>events.push('publish')};
    const sandbox={Object,Array,Date,crypto:require('node:crypto'),saveModelSnapshotAsync:async()=>{events.push('disk');return {uncompressedBytes:1024};},serverCompute:()=>service,cacheForUser:()=>active?runtime:{},computeSnapshotByteEstimate:async()=>1024,rememberComputeSource(){}};
    vm.createContext(sandbox);vm.runInContext(extractFunction(server,'saveRuntimeModelSnapshot')+';globalThis.run=saveRuntimeModelSnapshot;',sandbox);
    const metrics=await sandbox.run('a',runtime);assert.equal(metrics.uncompressedBytes,1024);assert.equal(seeded.publish,false);assert.equal(seeded.ownerId,'a');
    assert.equal(seeded.source.asasOrders,rows);assert.equal(seeded.source.asasOrdersByTarget.cp,rows);assert.ok(seeded.source.asasOrders[0].ex instanceof Date);
    assert.equal(seeded.source.asasOrders[0].model,'2026-04-05T00:00:00.000Z');assert.equal(runtime._computeSourceDescriptor.generation,'g2');
    assert.equal(Object.prototype.propertyIsEnumerable.call(runtime,'_computeSourceDescriptor'),false);assert.doesNotMatch(JSON.stringify(runtime),/private/);
    assert.deepEqual(events,active?['disk','prepare','publish']:['disk','prepare']);
  }
});
test('refresh commits runtime and authority before publishing its prepared source generation',async()=>{
  const events=[],next={asasOrders:[],_computeSourceDescriptor:{generation:'g2'}};
  const sandbox={Object,saveRuntimeModelSnapshot:async()=>{events.push('prepare');return {};},replaceUserCache:()=>events.push('runtime'),userAccess:{syncProfiles:()=>events.push('authority')},serverCompute:()=>({publishSource:async()=>events.push('publish')}),rememberComputeSource(){}};
  vm.createContext(sandbox);vm.runInContext(extractFunction(server,'publishRefreshedRuntime')+';globalThis.run=publishRefreshedRuntime;',sandbox);
  assert.equal(await sandbox.run('a',next),next);assert.deepEqual(events,['prepare','runtime','authority','publish']);
});
