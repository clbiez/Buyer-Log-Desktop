'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
test('snapshot-free Excel fallback is published even when parsers already supplied all source fields',async()=>{
 const runtime={loadedAt:null,asasOrders:null},events=[],info={loadedAt:null,asasSourceFields:false,antrepoSourceFields:false};
 const c={computeReads:{run:async()=>({value:info,assertBuild(){},assertResponse(){},release(){}})},acceptComputedMetadata(){},loadOverrides:()=>({asasSourceMode:'excel',antrepoSourceMode:'excel'}),sourceUserId:()=> 'demo',cacheForUser:()=>runtime,ensureBacklogRuntime:async()=>{runtime.loadedAt='new';runtime.asasOrders=[{ocode:101,_sourceFields:{'Order Code':101}}];events.push('excel');return runtime;},ensureDataLoaded:async()=>runtime,ensureBacklogSourceFields:async()=>events.push('fields-already-present'),saveRuntimeModelSnapshot:async(id,value)=>{assert.equal(id,'demo');assert.equal(value,runtime);events.push('publish');}};
 vm.createContext(c);vm.runInContext(extractFunction(source,'prepareComputeBacklog')+';globalThis.prepare=prepareComputeBacklog;',c);await c.prepare({currentUser:{id:'demo'}});assert.equal(runtime.asasOrders.length,1);assert.ok(events.includes('publish'),'new Excel rows must reach a snapshot and source replica before any report runs');
});
