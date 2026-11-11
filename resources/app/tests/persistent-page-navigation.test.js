'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {loadAppMainFunctions}=require('./helpers/app-main-functions');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');

test('a background Orders response marks the table before Ready, and returning reuses the same rows',async()=>{
  const statuses=[],state={orders:null,ordersLogisticExpanded:new Set()},dirty=new Set();let requests=0,release;
  const api=loadAppMainFunctions(['ensureOrdersLoaded'],{
    state,ordersLoadPromise:null,backgroundWarmupUnrendered:dirty,appLang:'en',
    window:{BLModulePreparation:{setStatus:(module,status)=>{
      if(status==='ready')assert.equal(dirty.has('orders'),true,'Ready cannot race the pending first draw');
      statuses.push([module,status]);
    }}},
    currentActiveTab:()=> 'overview',fetchOrdersProjection:()=>{requests++;return new Promise(r=>{release=r;});},
    reviveServerDates(){},invalidateUnifiedPriorityDecisions(){},applyPricingRulesToLoadedRows(){},applyOrdersImportanceEditAccess(){},
    buildOrdersFilters(){},applyCoreAutoFilterState(){},renderOrders(){throw Error('hidden draw');},
    setOrdersLoadingState(){throw Error('hidden loading state');},showToast(){},
  });
  const first=api.ensureOrdersLoaded({deferRender:true}),second=api.ensureOrdersLoaded({deferRender:true});
  release({payload:{rows:[{'Order Code':'DEMO-1'}],collectionCatalogs:{}}});
  assert.deepEqual(await Promise.all([first,second]),[true,true]);
  const rows=state.orders.rows;assert.equal(await api.ensureOrdersLoaded(),true);
  assert.equal(requests,1);assert.equal(state.orders.rows,rows);assert.deepEqual(statuses.map(s=>s[1]),['loading','ready','ready']);
});

test('deferred hydration preserves loaded CP/Orders during passive and explicit refreshes',()=>{
  const start=APP.indexOf('    const partialRefreshTargets='),end=APP.indexOf('    if(Array.isArray(data.orderSummary))',start);
  for(const userVisibleRefresh of [false,true]){
    const cp={rows:[{id:'cp'}]},orders={rows:[{id:'orders'}]},statuses=[];
    const scope={state:{cp,orders},data:{cpDeferred:true,orderSummaryDeferred:true},targets:null,userVisibleRefresh,force:userVisibleRefresh,leanReload:!userVisibleRefresh,
      cpClientWorkInProgress:()=>false,window:{BLModulePreparation:{setStatus:(...args)=>statuses.push(args)}},
      currentActiveTab:()=> 'overview',invalidateUnifiedPriorityDecisions(){},_deferredTabRenders:new Set()};
    vm.runInNewContext(APP.slice(start,end),scope);
    assert.equal(scope.state.cp,cp);assert.equal(scope.state.orders,orders);
    assert.deepEqual(statuses,[['cp','loading'],['orders','loading']]);
  }
});

test('a required source filter clears retained data instead of showing obsolete rows',()=>{
  const start=APP.indexOf('    const partialRefreshTargets='),end=APP.indexOf('    if(Array.isArray(data.orderSummary))',start);
  const scope={state:{cp:{rows:[]},orders:{rows:[]}},data:{sourceFilterRequired:true,cpDeferred:true,orderSummaryDeferred:true},targets:null,userVisibleRefresh:false,force:false,leanReload:true,
    cpClientWorkInProgress:()=>false,window:{BLModulePreparation:{setStatus(){}}},currentActiveTab:()=> 'overview',invalidateUnifiedPriorityDecisions(){},_deferredTabRenders:new Set()};
  vm.runInNewContext(APP.slice(start,end),scope);assert.equal(scope.state.cp,null);assert.equal(scope.state.orders,null);
});

function backlogHarness(){
  let requests=0,release;const applied=[],statuses=[];
  const api=loadAppMainFunctions(['prefetchBacklogForRefresh','fetchCurrentBacklog'],{
    backlogPrefetch:null,backlogPrefetchPending:null,backlogFetchGeneration:0,
    window:{BLCanAccessArea:()=>true,BLModulePreparation:{setStatus:(...args)=>statuses.push(args)}},
    backlogQueryString:params=>params.key,buildBacklogParams:()=>({key:'demo-scope'}),currentActiveTab:()=> 'backlog',
    fetchJSON:()=>{requests++;return new Promise(r=>{release=r;});},
    showBacklogLoadingState(){},applyBacklogData:data=>applied.push(data),fetchBacklog:()=>{throw Error('duplicate fetch');},console,
  });
  return {api,applied,statuses,requests:()=>requests,reply:value=>release(value)};
}
test('Backlog navigation shares a pending background query and consumes its answer once',async()=>{
  const h=backlogHarness(),warm=h.api.prefetchBacklogForRefresh(),visit=h.api.fetchCurrentBacklog();
  assert.equal(h.requests(),1);h.reply({rows:['demo']});assert.equal(await warm,true);await visit;
  assert.equal(h.applied.length,1);assert.equal(h.requests(),1);assert.equal(h.api.context.backlogPrefetch,null);
});
test('a warmed Backlog answer remains available until consumed, without a time-based eviction',async()=>{
  const h=backlogHarness(),warm=h.api.prefetchBacklogForRefresh();h.reply({rows:['demo']});await warm;
  await h.api.fetchCurrentBacklog();assert.equal(h.applied.length,1);assert.equal(h.requests(),1);
});
test('a source change invalidates an older in-flight Backlog warmup',async()=>{
  const h=backlogHarness(),warm=h.api.prefetchBacklogForRefresh();h.api.context.backlogFetchGeneration++;
  h.reply({rows:['old']});assert.equal(await warm,false);assert.equal(h.api.context.backlogPrefetch,null);assert.equal(h.applied.length,0);
});

test('CP edits begun while a background replacement is in flight keep their original row objects',async()=>{
  const old={rows:[{'Order Code':'DEMO-1',Note:'local'}]},state={cp:old};let edited=false,reply;
  const api=loadAppMainFunctions(['ensureCpLoaded'],{
    state,cpLoadPromise:null,window:{BLModulePreparation:{setStatus(){}}},
    currentActiveTab:()=> 'koleksiyon',fetchProjectionWithFallback:()=>new Promise(r=>{reply=r;}),
    reviveServerDates(){},refreshCpStartupImageRegistry:async()=>{},applyCpSharedEditAccess:async()=>{},
    cpClientWorkInProgress:()=>edited,overviewCpLoadState:'ready',overviewCpLoadError:'',console,
    showToast(){throw Error('unexpected error');},
  });
  const pending=api.ensureCpLoaded({force:true,reason:'reload'});edited=true;
  reply({payload:{rows:[{'Order Code':'DEMO-1',Note:'older server'}]}});
  assert.equal(await pending,true);assert.equal(state.cp,old);assert.equal(state.cp.rows[0].Note,'local');
});

test('rapid Backlog returns share the answer without starting a second fetch after consumption',async()=>{
  const h=backlogHarness(),warm=h.api.prefetchBacklogForRefresh();
  const first=h.api.fetchCurrentBacklog(),second=h.api.fetchCurrentBacklog();
  h.reply({rows:['demo']});await Promise.all([warm,first,second]);
  assert.equal(h.requests(),1);assert.equal(h.applied.length,1);
});
test('Backlog prefetch obeys required-source and no-cache gates',async()=>{
  for(const flag of ['BL_CP_SOURCE_FILTER_REQUIRED','BL_HAS_CACHED_MODEL_DATA']){
    const h=backlogHarness();h.api.context.window[flag]=flag==='BL_CP_SOURCE_FILTER_REQUIRED';
    assert.equal(await h.api.prefetchBacklogForRefresh(),false);assert.equal(h.requests(),0);
  }
});

test('CP priorities finishing after navigation schedule the hidden table for its next visit',async()=>{
  const rows=[{id:'demo'}],dirty=new Set();let active='cp',finish;
  const api=loadAppMainFunctions(['scheduleUnifiedPrioritiesForTable'],{
    state:{cp:{rows}},_unifiedPriorityTableRevision:{cp:1},_unifiedPriorityCache:{cp:null},cpPriorityJob:null,
    window:{BLCpAssistant:{decisionContextRevision:()=>1,computeDecisionsForRowsAsync:()=>new Promise(r=>{finish=r;})}},
    currentActiveTab:()=>active,syncUnifiedPrioritiesForTable(){},scheduleOverviewRender(){},
    renderCP:()=>dirty.add('cp'),showToast:message=>assert.fail(message),
  });
  const pending=api.scheduleUnifiedPrioritiesForTable('cp');active='orders';finish({byRow:new Map()});
  assert.equal(await pending,true);assert.equal(dirty.has('cp'),true,'a late decision result must not leave the old loading card on return');
});
