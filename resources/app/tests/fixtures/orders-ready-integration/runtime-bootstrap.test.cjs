'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const pub=require('./publication/native-fixture.cjs'),reviewed=require('./source.cjs');
const APP=reviewed.APP,actual=reviewed.current('public/app-main.js');
async function fixture(){
 const f=await pub.setup(),scope=f.scope,wait=pub.deferred();let loads=0;
 Object.assign(scope,{crypto:require('node:crypto').webcrypto,TextEncoder,Uint8Array,ORDERS_FINITE_READY_ENABLED:true,
  _ordersReadyRuntime:null,_ordersReadyFeaturePromise:null,_ordersReadyProjectionLoader:null});
 Object.assign(scope.window,{BLProjectionInventoryContract:require(APP+'/public/projection-inventory-contract.js'),
  BLProjectionDependencyPlan:require(APP+'/public/projection-dependency-plan.js'),BLOrdersFiniteClosure:require(APP+'/public/orders-finite-closure.js'),
  BLOrdersProjectionClient:require(APP+'/public/orders-projection-client.js'),BLModuleProjectionSchema:require(APP+'/public/module-projection-schema.js'),
  BLOrdersOwnedJson:require(APP+'/public/orders-owned-json.js'),BLOrdersFullPromotion:require(APP+'/public/orders-full-promotion.js'),
  BLOrdersReadyLoad:require(APP+'/public/orders-ready-load.js'),BLFormulaEngine:f.f.f.engine,
  BLPerf:{ensureFeature:async name=>{assert.equal(name,'ordersProjection');loads++;await wait.promise;}}});
 for(const name of ['ordersReadyNonce','ordersReadySha256Bytes','ordersReadyFirstSliceEligible','captureOrdersReadyLoadLease','ordersReadyLoadLeaseCurrent','ensureOrdersReadyProjectionRuntime'])scope[name]=pub.fn(scope,name,actual);
 const flight={abort:new AbortController(),epoch:scope._ordersProjectionSourceEpoch,sessionEpoch:scope._ordersUiSessionEpoch,profile:scope.state.currentUser,userContext:scope.window.BL_USER_CONTEXT};
 scope._ordersLoadFlight=flight;const lease=scope.captureOrdersReadyLoadLease();return {f,scope,wait,lease,get loads(){return loads;}};
}
test('actual lazy bootstrap constructs one native compiler/client/owned reader and arms only for its current flight',async()=>{
 const s=await fixture(),pending=s.scope.ensureOrdersReadyProjectionRuntime(s.lease);assert.equal(s.loads,1);
 assert.equal(s.scope.window.BLOrdersFiniteLifecycleRequired,undefined);s.wait.resolve();const runtime=await pending;
 assert.equal(runtime.client,s.scope._ordersProjectionClient);assert.equal(s.scope.window.BLOrdersFiniteLifecycleRequired,true);
 assert.equal(typeof runtime.client.prepare,'function');assert.equal(typeof runtime.ownedJson.readSchema,'function');
 assert.equal(await s.scope.ensureOrdersReadyProjectionRuntime(s.lease),runtime);assert.equal(s.loads,1);
 const raw=JSON.stringify(s.f.f.metadata);
 const wire=await runtime.readMetadata(new Response(raw,{status:200,headers:{'Content-Type':'application/json','X-Orders-Schema-Json-Bytes':String(Buffer.byteLength(raw))}}),{current:()=>true});
 assert.equal(runtime.ownedJson.owns(wire),true);assert.equal(wire.mode,'schema');
});
test('actual bootstrap cannot arm or replace a client after profile/source changes during script loading',async()=>{
 for(const change of ['profile','retire']){
  const s=await fixture(),previous=s.scope._ordersProjectionClient,pending=s.scope.ensureOrdersReadyProjectionRuntime(s.lease);
  if(change==='profile')s.scope.state.currentUser={id:'other'};else s.scope.retireOrdersProjectionSource('bootstrap-drift');
  s.wait.resolve();await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');
  assert.equal(s.scope.window.BLOrdersFiniteLifecycleRequired,undefined);assert.equal(s.scope._ordersProjectionClient,previous);
  assert.equal(s.scope._ordersReadyRuntime,null);assert.equal(s.scope._ordersReadyProjectionLoader,null);
 }
});
