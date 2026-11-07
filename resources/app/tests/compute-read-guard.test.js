'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createComputeReadGuard}=require('../server/lib/compute-read-guard');
function fixture(){
  let profile={id:'a',enabled:true,status:'ACTIVE',area:true,context:'h1',access:'a1',credential:1},source='g1';
  const guard=createComputeReadGuard({sessionProfile:req=>req.credential===profile.credential?{...profile}:null,profileById:id=>id===profile.id?{...profile}:null,
    hasArea:(user)=>user.area,contextFor:user=>({id:user.id,contextHash:user.context}),accessFor:user=>({accessHash:user.access}),sourceTokenFor:()=>source});
  return {guard,req:{credential:1},profile,nextSource:value=>source=value};
}
test('async response rechecks the real session and changed credential/status/area',()=>{
  for(const mutation of [value=>value.credential++,value=>value.status='DISABLED',value=>value.enabled=false,value=>value.area=false]){
    const f=fixture(),snapshot=f.guard.capture(f.req,'cp');snapshot.assertResponse();mutation(f.profile);assert.throws(()=>snapshot.assertResponse(),error=>[401,403].includes(error.statusCode));
  }
});
test('changes to context, resolved authority or published source reject the old result',()=>{
  for(const change of [f=>f.profile.context='h2',f=>f.profile.access='a2',f=>f.nextSource('g2')]){
    const f=fixture(),snapshot=f.guard.capture(f.req,'cp');change(f);assert.throws(()=>snapshot.assertBuild(),{code:'COMPUTE_STALE_GENERATION'});assert.throws(()=>snapshot.assertResponse(),{code:'COMPUTE_STALE_GENERATION'});
  }
});
test('shared builds are independent of the first consumer session but every consumer is checked',()=>{
  const f=fixture(),first=f.guard.capture(f.req,'cp');f.profile.credential=2;
  first.assertBuild();assert.throws(()=>first.assertResponse(),{statusCode:401});
  const second=f.guard.capture({credential:2},'cp');second.assertBuild();second.assertResponse();assert.equal(first.key,second.key);
});
test('a different user or missing initial session cannot use a captured result',()=>{
  const f=fixture();assert.throws(()=>f.guard.capture({credential:0},'cp'),{statusCode:401});
  const snapshot=f.guard.capture(f.req,'cp');f.profile.id='b';assert.throws(()=>snapshot.assertResponse(),{code:'COMPUTE_STALE_GENERATION'});
});
