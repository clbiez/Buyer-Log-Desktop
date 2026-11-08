'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),server=require('./helpers/server-source')();
const {prepareModuleSchemas}=require('../server/lib/page-projection-cache');
function setup(change){
  const profile={id:'a',status:'ACTIVE'},active={loadedAt:'r1',asasOrders:[]},reusedBuffer=Buffer.from('verified existing Orders gzip');let contextHash='ctx',sourceToken='g1',calls=0,released=0,written;
  const context={Object,Array,Set,Map,Buffer,process,APP_VERSION:'test',COLLECTION_CATALOG_SCHEMA_VERSION:3,
    pageProjectionContext:()=>({id:'a',contextHash,filterStatus:{ready:true}}),cacheForUser:()=>active,
    effectiveOverridesForUser:()=>({}),pageCacheRuntimeMeta:()=>({loadedAt:'r1'}),projectionSourceRevision:()=> 'r1',
    derivedInputKeys:{keys:()=>({cp:'cp-key',orders:'orders-key',overview:'overview-key',backlog:'backlog-key'})},
    pageProjectionCache:{prepareModuleSchemas,readReusableProjections:async()=>({projections:{orders:{buffer:reusedBuffer}},manifest:{activeGeneration:'existing'}}),writeCompressedGeneration:async(_id,options)=>{options.assertCurrent();written=options;return {activeGeneration:'new'};}},
    userAccess:{hasArea:()=>true,profileById:()=>profile,computeAccessContext:()=>({accessHash:'authority'})},
    computeSourceFor:async()=>({ownerId:'a',generation:'g1'}),computeSourceToken:()=>sourceToken,
    computeParamsFor:(_profile,_descriptor,_task,parts)=>parts,
    serverCompute:()=>({run:async(task,_source,params)=>{calls++;assert.equal(task,'projections');assert.deepEqual(Array.from(params.modules).sort(),['cp','overview']);change?.({context:()=>contextHash='changed',source:()=>sourceToken='g2'});return {value:{compressed:{cp:{buffer:new ArrayBuffer(3),uncompressedBytes:30},overview:{buffer:new ArrayBuffer(2),uncompressedBytes:20}}},metrics:{executionMs:1},release:()=>released++};}}),
    ordersForTarget:()=>{throw Error('Main thread source traversal is forbidden');},logRuntimeFailure:(_key,error)=>{throw error;}};
  const names=['buildAndWritePageProjectionCache'];if(server.includes('function buildAndWriteComputedPageProjectionCache('))names.push('buildAndWriteComputedPageProjectionCache');
  vm.createContext(context);vm.runInContext(names.map(name=>extractFunction(server,name)).join('\n')+';globalThis.run=buildAndWritePageProjectionCache;',context);
  return {run:()=>context.run(profile,active),calls:()=>calls,released:()=>released,written:()=>written,reusedBuffer};
}
test('refresh delegates missing projections without traversing source records on the main thread',async()=>{
  const f=setup(),manifest=await f.run();assert.equal(manifest.activeGeneration,'new');assert.equal(f.calls(),1);assert.equal(f.released(),1);assert.equal(f.written().projections.orders.buffer,f.reusedBuffer);
});
test('a source or authority-context change cannot publish completed worker projections',async()=>{
  for(const change of [state=>state.context(),state=>state.source()]){
    const f=setup(change);await assert.rejects(f.run(),{code:'COMPUTE_STALE_GENERATION'});assert.equal(f.released(),1);assert.equal(f.written(),undefined);
  }
});
test('a fully reusable cache still rejects source changes, changed permissions and disabled profiles during queued publication',async()=>{
  for(const kind of ['source','context','disabled']){
    const profile={id:'a',enabled:true,status:'ACTIVE'},runtime={loadedAt:'r1',asasOrders:[]};let sourceToken='g1',hash='ctx',published=false;
    const c={Object,Array,Set,Map,Buffer,APP_VERSION:'test',userAccess:{profileById:()=>profile},
      pageProjectionContext:()=>({id:'a',contextHash:hash,filterStatus:{ready:true}}),computeSourceToken:()=>sourceToken,
      effectiveOverridesForUser:()=>({}),derivedInputKeys:{keys:()=>({cp:'key',backlog:'backlog'})},
      pageCacheRuntimeMeta:()=>({}),projectionSourceRevision:()=> 'r1',
      pageProjectionCache:{readReusableProjections:async()=>({manifest:{activeGeneration:'existing'},projections:{cp:{buffer:Buffer.from('gzip')}}}),
        reuseGeneration:async(_id,options)=>{await new Promise(setImmediate);if(kind==='source')sourceToken='g2';else if(kind==='context')hash='changed';else profile.enabled=false;options.assertCurrent();published=true;return {};}}
    };
    vm.createContext(c);vm.runInContext(extractFunction(server,'buildAndWritePageProjectionCache')+';globalThis.run=buildAndWritePageProjectionCache;',c);
    await assert.rejects(c.run(profile,runtime),{code:'COMPUTE_STALE_GENERATION'});assert.equal(published,false);
  }
});
