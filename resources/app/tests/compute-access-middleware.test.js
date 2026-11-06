'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createComputeAccessMiddleware}=require('../server/lib/compute-access-middleware');
test('compute requests wait for prepared authority and revalidate the live session; health/status bypass it',async()=>{
 let complete,preparations=0,passed=0,error,live={id:'a',enabled:true,status:'ACTIVE',accessRevision:1};
 const gate=createComputeAccessMiddleware({prepare:()=>{preparations++;return new Promise(resolve=>{complete=resolve;});},profileFor:()=>live});
 const next=value=>{if(value)error=value;else passed++;};
 for(const path of ['/api/health','/api/status','/api/current-user'])gate({path,currentUser:live},{},next);
 assert.equal(preparations,0);assert.equal(passed,3);
 const req={path:'/api/data',currentUser:live},pending=gate(req,{},next);await Promise.resolve();assert.equal(preparations,1);assert.equal(passed,3);
 live={...live,accessRevision:2};complete();await pending;assert.equal(req.currentUser.accessRevision,2);assert.equal(passed,4);
 const denied=gate({path:'/api/backlog-export',currentUser:live},{},next);await Promise.resolve();live=null;complete();await denied;
 assert.equal(passed,4);assert.equal(error.code,'SESSION_REQUIRED');
});

test('production installs readiness after authentication and prepares refresh caches before synchronous context reads',()=>{
 const source=require('./helpers/server-source')(),auth=source.indexOf('app.use(userAccess.requireSelection);'),gate=source.indexOf("app.use(require('./lib/compute-access-middleware')");assert.ok(gate>auth);
 const start=source.indexOf('async function buildAndWritePageProjectionCache('),block=source.slice(start,source.indexOf('async function ',start+20));
 assert.ok(block.indexOf('await userAccess.prepareComputeAccessContext?.()')<block.indexOf('const ctx = pageProjectionContext('));
});

test('direct CP ownership hints and case-insensitive Express paths also await authority readiness',async()=>{
 for(const path of ['/api/cp-shared-edit','/API/DATA','/API/PAGE-PROJECTION/CP']){
  let prepared=0,passed=0;const profile={id:'a',status:'ACTIVE'};
  const gate=createComputeAccessMiddleware({prepare:async()=>{prepared++;},profileFor:()=>profile});
  await gate({path,currentUser:profile},{},error=>{assert.equal(error,undefined);passed++;});assert.equal(prepared,1,path);assert.equal(passed,1);
 }
});
