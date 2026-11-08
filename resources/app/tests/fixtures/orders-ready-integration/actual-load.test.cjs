'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const pub=require('./publication/native-fixture.cjs');
const reviewed=require('./source.cjs');
const baseline=process.env.BL_ACTUAL_LOAD_BASELINE==='1';
async function fixture(options={}){
 const f=await pub.setup(options),{scope}=f,events=[];
 Object.assign(scope,{setOrdersLoadingState:(...args)=>events.push(['loading',...args]),
  buildOrdersFilters:()=>events.push(['filters']),applyCoreAutoFilterState:()=>{},renderOrders:()=>events.push(['render']),
  ensureCollectionCatalogLoaded:async()=>{},showToast:()=>{},
  invalidateUnifiedPriorityDecisions:(...args)=>{events.push(['invalidate',...args]);if(options.failInvalidate)throw Error('invalidating failed');},
  applyPricingRulesToLoadedRows:()=>{events.push(['pricing',scope.state.orders]);if(options.failPricing)throw Error('pricing failed');},
  reviveServerDates:rows=>f.f.f.reference.normalize(rows),
  fetchOrdersProjection:async()=>({payload:f.accepted.payload,accepted:f.accepted}),
  ordersReadySha256Bytes:async bytes=>pub.actual.hash(bytes),ordersReadyNonce:()=> 'publication_parent_nonce',fetch:f.callbacks.fetch,
 });
 scope.window.BLOrdersPublication=pub.candidate;scope.window.BLOrdersFullPromotion=pub.actual.promotion;
 scope.window.BLOrdersProjectionClient=pub.actual.candidate;scope.window.BLModulePreparation={setStatus:(...a)=>events.push(['status',...a])};
 scope.state.ordersLogisticExpanded=new Set(['old']);
 scope.captureOrdersReadySource=()=>f.sourceNow;
 let source=baseline?pub.app:reviewed.current('public/app-main.js');
 if(process.env.BL_ACTUAL_LOAD_BEFORE_RETRY_GUARD==='1'){
  const history=require('node:path').resolve(reviewed.APP,'../../docs/performance-program/phase-6a/actual-ready-wiring-20261108/initial-integration-edits.json');
  const edit=JSON.parse(fs.readFileSync(history,'utf8')).edits.find(e=>e.file==='public/app-main.js'&&e.old.startsWith('async function ensureOrdersLoaded('));
  assert.ok(edit,'exact pre-retry-guard ensure body');source=source.replace(pub.actual.extractFunction(source,'ensureOrdersLoaded'),edit.next);
 }
 for(const name of ['ordersProjectionIsThin','ordersFullActionError'])scope[name]=pub.fn(scope,name,source);
 scope.ensureOrdersLoaded=pub.fn(scope,'ensureOrdersLoaded',source);
 scope.ensureOrdersFullForAction=pub.fn(scope,'ensureOrdersFullForAction',source);
 return {...f,events,load:scope.ensureOrdersLoaded};
}
test('actual ensure publishes a privately registered native ready view instead of silently labelling thin as full',async()=>{
 const f=await fixture();assert.equal(await f.load({deferRender:true}),true);
 assert.equal(f.scope.ordersProjectionIsThin(),true,'real ensureOrdersLoaded must retain native finite controller');
 assert.equal(f.scope._ordersAcceptedReceipt,f.accepted);assert.equal(f.scope.state.orders.rows[0]._canEdit,false);
 assert.equal(Object.hasOwn(f.scope.state.orders.rows[0],'__CPX_UNUSED'),false);
 assert.equal(f.scope.state.ordersLogisticExpanded.size,0);assert.equal(f.events.filter(x=>x[0]==='pricing').length,1);
 assert.equal(f.events.some(x=>x[0]==='render'),false);assert.equal(f.events.at(-1)[2],'ready');
});
test('actual whole-module promotion replaces source once and applies full pricing once for concurrent actions',async()=>{
 const f=await fixture();assert.equal(await f.load(),true);
 const a=f.scope.ensureOrdersFullForAction('copy'),b=f.scope.ensureOrdersFullForAction('export');
 await f.started.promise;assert.equal(f.requests.length,1);f.gate.resolve();
 const [ar,br]=await Promise.all([a,b]);assert.equal(ar,br);assert.equal(ar,f.scope.state.orders.rows);
 assert.equal(f.scope.ordersProjectionIsThin(),false);assert.equal(Object.hasOwn(ar[0],'__CPX_UNUSED'),true);
 assert.equal(f.events.filter(x=>x[0]==='pricing').length,2);assert.equal(f.events.filter(x=>x[0]==='invalidate').length,2);
});
test('ordinary full path keeps actual row normalization and adds no publication or parent request',async()=>{
 const f=await fixture();let publications=0;f.scope.window.BLOrdersPublication={create(){publications++;throw Error('unexpected ready');}};
 const raw=JSON.parse(f.ordinaryFull);f.scope.fetchOrdersProjection=async()=>({payload:raw});
 assert.equal(await f.load(),true);assert.equal(publications,0);assert.equal(f.requests.length,0);assert.equal(f.scope.ordersProjectionIsThin(),false);
 const expected=JSON.parse(f.ordinaryFull);f.f.f.reference.normalize(expected.rows);
 assert.equal(JSON.stringify(f.scope.state.orders.rows),JSON.stringify(expected.rows.map(row=>({...row,_canEdit:false}))));
});
test('ready setup error evicts only its own empty-selection view before later ordinary retry',async()=>{
 const f=await fixture({failPricing:true});assert.equal(await f.load(),false);
 assert.equal(f.scope.state.orders,null,'failed finite setup must not leave fast-path ready rows');
 assert.equal(f.scope._ordersAcceptedReceipt,null);assert.equal(f.scope.ordersProjectionMustLoadFull(),true);
 assert.equal(f.events.at(-1)[0],'loading');
});
test('post-publication full pricing error retires unsettled full rows instead of exposing an apparently ready view',async()=>{
 const f=await fixture();assert.equal(await f.load(),true);f.scope.applyPricingRulesToLoadedRows=()=>{throw Error('full pricing failed');};
 const pending=f.scope.ensureOrdersFullForAction('copy');await f.started.promise;f.gate.resolve();
 await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.scope.state.orders,null);
 assert.equal(f.scope.ordersProjectionMustLoadFull(),true);assert.equal(f.scope._ordersAcceptedReceipt,null);
});
test('actual old source flight cannot publish ready rows after actor/profile replacement',async()=>{
 const f=await fixture(),original=f.scope.fetchOrdersProjection;
 f.scope.fetchOrdersProjection=async()=>{const result=await original();f.scope.state.currentUser={id:'other'};return result;};
 assert.equal(await f.load(),false);assert.equal(f.scope.state.orders,null);assert.equal(f.scope._ordersAcceptedReceipt,null);
});
test('exact integration restores every predecessor byte and preserves inactive lexical lifecycle',()=>{
 const current=reviewed.current('public/app-main.js'),base=reviewed.base('public/app-main.js');assert.equal(base,pub.app);
 const start=base.indexOf('let ordersLoadPromise=null;'),end=base.indexOf('let cpLoadPromise=null;',start);
 const cs=current.indexOf('let ordersLoadPromise=null;'),ce=current.indexOf('let cpLoadPromise=null;',cs);
 assert.equal(current.slice(cs,ce),base.slice(start,end));
 assert.match(current,/const ORDERS_FINITE_READY_ENABLED=false;/,'activation remains off until all final gates close');
});
test('a rejected private preparation closes finite retries so the next explicit load uses current ordinary full',async()=>{
 const f=await fixture();f.scope.reviveServerDates=()=>{throw Error('private normalizer failure');};
 assert.equal(await f.load(),false);assert.equal(f.scope.state.orders,null);assert.equal(f.scope._ordersAcceptedReceipt,null);
 assert.equal(f.scope.ordersProjectionMustLoadFull(),true);
 f.scope.reviveServerDates=rows=>f.f.f.reference.normalize(rows);let requests=0;
 f.scope.fetchOrdersProjection=async options=>{requests++;assert.equal(options.fullOnly,true);return {payload:JSON.parse(f.ordinaryFull)};};
 assert.equal(await f.load(),true);assert.equal(requests,1);assert.equal(f.scope.ordersProjectionIsThin(),false);
});
