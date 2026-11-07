'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')();
test('metadata uses the common pool without depending on CP sources, and releases its lease',async()=>{
  let released=0,called=0;const profile={id:'viewer',status:'ACTIVE',enabled:true},status={ok:true,recordCount:1};
  const c={Object,endeksmatik:{publicStatusAsync:async reader=>reader({file:'configured-synthetic-source',tag:'generation'})},userAccess:{sessionProfile:()=>profile},
    serverCompute:()=>({runEndeksmatikStatus:async(owner,descriptor)=>{assert.equal(owner,'viewer');assert.equal(descriptor.tag,'generation');called++;return {value:{status},release(){released++;}};}})};
  vm.createContext(c);vm.runInContext(extractFunction(source,'endeksmatikStatusForRequest')+';globalThis.run=endeksmatikStatusForRequest;',c);
  assert.equal(await c.run({currentUser:profile}),status);assert.equal(called,1);assert.equal(released,1);
});
test('logout or a disabled account during metadata work cannot publish the result',async()=>{
  for(const mode of ['logout','disabled']){
    const profile={id:'viewer',status:'ACTIVE',enabled:true};let live=profile,released=0;
    const c={Object,endeksmatik:{publicStatusAsync:async reader=>reader({tag:'generation'})},userAccess:{sessionProfile:()=>live},
      serverCompute:()=>({runEndeksmatikStatus:async()=>{if(mode==='logout')live=null;else profile.enabled=false;return {value:{status:{ok:true}},release(){released++;}};}})};
    vm.createContext(c);vm.runInContext(extractFunction(source,'endeksmatikStatusForRequest')+';globalThis.run=endeksmatikStatusForRequest;',c);
    await assert.rejects(c.run({currentUser:profile}),{code:'USER_LOGIN_REQUIRED'});assert.equal(released,1);
  }
});
