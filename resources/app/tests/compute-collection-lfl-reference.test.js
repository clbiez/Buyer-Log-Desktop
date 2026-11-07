'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('node:zlib');
function setup(){
 const events=[],profile={id:'demo'},state={revoked:null,version:'g1',released:0};
 const access={userId:'demo',viewScope:{buyers:['Synthetic']}};
 const guard={capture:(_req,area)=>{events.push(area);return {profile,assertBuild:()=>{if(state.revoked===area)throw Object.assign(Error('revoked'),{code:'AREA_FORBIDDEN'});},assertResponse:()=>{if(state.revoked===area)throw Object.assign(Error('revoked'),{code:'AREA_FORBIDDEN'});}};}};
 const compute={collectionLflSource:async()=>({ownerId:'demo',generation:state.version}),runCollectionLfl:async(task,descriptor,params)=>{
  assert.equal(params.access,access);assert.deepEqual(params.calendar,{configured:false});assert.equal(descriptor.generation,'g1');
  return {value:task==='collection-lfl-source-info'?{available:true,version:'source-v1'}:{buffer:zlib.gzipSync(JSON.stringify({references:[{key:'demo',average:10}]})),uncompressedBytes:50},release:()=>{state.released++;}};
 }};
 const userAccess={prepareComputeAccessContext:async()=>{events.push('prepared');},computeAccessContext:()=>access};
 const create=require('../server/lib/compute-collection-lfl-reference').createComputedCollectionReferenceSource;
 return {read:create({compute:()=>compute,guard,userAccess,calendar:()=>({configured:false})}),state,events};
}
test('the readonly summary prepares authority, checks both areas and releases every native output lease',async()=>{
 const {read,state,events}=setup(),source=await read({});assert.deepEqual(events,['prepared','koleksiyon','lfl']);assert.equal(source.id,'demo');assert.equal(source.version,'source-v1');assert.equal(state.released,1);
 assert.deepEqual(await source.buildReferences(),[{key:'demo',average:10}]);assert.equal(state.released,2);
 for(const area of ['koleksiyon','lfl']){state.revoked=area;await assert.rejects(source.assertCurrent(),{code:'AREA_FORBIDDEN'});await assert.rejects(source.buildReferences(),{code:'AREA_FORBIDDEN'});}state.revoked=null;
 state.version='g2';await assert.rejects(source.buildReferences(),{code:'COMPUTE_STALE_GENERATION'});assert.equal(state.released,2);
});
