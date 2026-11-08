'use strict';
// PREPARED ONLY. No tests or syntax checks have been executed for this packet.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const test=(name,body)=>nativeTest(name,{timeout:5000},body);
const {source,extractFunction,installLifecycle}=require('./helpers/orders-retirement-source');
const names=['ordersProjectionIsThin','ordersFullActionError','retireOrdersProjectionSource','ordersProjectionMustLoadFull','beginOrdersGlobalUpdate','assertOrdersGlobalUpdate','prepareOrdersGlobalApply','endOrdersGlobalUpdate','ordersLoadFlightCurrent','ensureOrdersLoaded','ensureOrdersFullForAction','ensureOrdersFullBeforePreferences'];
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};}
function fixture(options={}){
 const events=[],requests=[],controllers=new WeakMap(),oldRows=[{_id:0,'Order Code':'demo'}];
 const state={orders:options.empty?null:{rows:oldRows,...(options.thin?{projectionProfile:'thin'}:{})},ordersSelected:new Set(),ordersLogisticExpanded:new Set(),cp:{rows:[{_id:9}]},cpDirty:new Set([9]),cpSelected:new Set([9]),cpLogisticExpanded:new Set(),currentUser:{id:'demo'},storeRevisions:{}};
 const context=vm.createContext({state,AbortController,Promise,Set,WeakMap,appLang:'en',window:{BL_USER_CONTEXT:state.currentUser,BLCanAccessArea:()=>true,BLModulePreparation:{setStatus:(...v)=>events.push(['status',...v])}},
  _ordersFullViewControllers:controllers,projectionRequestGeneration:{orders:0},
  currentActiveTab:()=> 'overview',setOrdersLoadingState:(...v)=>events.push(['loading',...v]),showToast:v=>events.push(['toast',v]),
  fetchOrdersProjection:opts=>{const wait=deferred();requests.push({opts,...wait});return wait.promise;},
  reviveServerDates:()=>{},invalidateUnifiedPriorityDecisions:()=>{},applyPricingRulesToLoadedRows:()=>{},ensureCollectionCatalogLoaded:()=>{},buildOrdersFilters:()=>{},applyCoreAutoFilterState:()=>{},renderOrders:()=>{},
 });
 installLifecycle(context,{_ordersProjectionClient:{invalidate:()=>events.push(['invalidate'])}});
 vm.runInContext(names.map(name=>extractFunction(source,name)).join('\n'),context);
 return {state,context,events,requests,controllers,oldRows};
}
function bootstrap(options={}){
 const f=fixture(options),c=f.context,events=f.events;
 Object.assign(c,{document:{getElementById:()=>null},authHydrationPromise:null,CP_NOTE_COLUMN_DEFS_REVISION:0,CP_NOTE_COLUMN_DEFS:[],_deferredTabRenders:new Set(),undoStack:[{name:'old'}],redoStack:[],
  cpClientWorkInProgress:()=>true,activeProfilePage:()=> 'overview',normalizeTransitRules:value=>value||[],normalizeNonDtrManufacturers:value=>value||[],normalizeKolLandedMultipliers:value=>value||{},cloneMatchConfig:value=>value,
  applyCachedProfilesForCurrentPage:value=>events.push(['cached',value,f.state.orders]),renderStartupActiveModule:()=> 'overview',console:{warn:(...args)=>events.push(['warn',...args])},refreshDiagnosisText:()=>'',
  fetch:async(url,opts)=>{events.push(['fetch',url,opts]);return {ok:true,json:async()=>options.data||{}};},
  syncLinkedRefreshMembers:async()=>events.push(['sync-linked']),withLinkedRefreshTargets:v=>v,sourceRefreshTimerKey:()=> 'demo',commitOpenCellEditors:()=>events.push(['commit']),settleOverrideWrites:async()=>events.push(['settle']),
  refreshWatchCancelled:false,refreshPrewarmToken:0,sourceRefreshTimers:{},ALL_REFRESH_TARGETS:['cp','orders'],_overviewRefreshResult:null,
  beginStartupStage:()=>null,normalizeOverviewRefreshResult:v=>v,autoOpenRefreshHistory:async()=>{},
 });
 for(const name of ['setServerStatus','updSourceHint','hideSourceFilterRequiredNotice','syncModelImageRegistry','renderAntrepoSourceControl','renderAsasSourceControl','renderLflSourceControl','applyLicensorMerges','applyIncomingPricingRules','saveLocalTransitRules','saveLocalNonDtrManufacturers','renderHorizonBadges','setWarnings','buildCPFilters','refreshSubmfrList','refreshLicenseList','refreshLicensorList','setRefreshFailureState','startSourceRefreshTimer','stopSourceRefreshTimer','setReadOnlyMode','renderSourceTargets','markSourceRefreshed','scheduleRefreshPrewarm','notifyCpCoverage','notifySkippedRefreshTargets','showSourceRefreshFailureModal','endStartupStage'])c[name]=(...args)=>events.push([name,...args]);
 vm.runInContext(extractFunction(source,'loadFromServer'),c);return f;
}
test('retirement aborts owned finite and promotion work synchronously, preserving full CP/Orders refs and selection',()=>{
 const f=fixture(),c=f.context,order=f.state.orders,selection=f.state.ordersSelected,cp=f.state.cp,dirty=f.state.cpDirty,undo={};
 c._ordersFiniteLoadAbort=new AbortController();c._ordersPromotionAbort=new AbortController();const a=c._ordersFiniteLoadAbort,b=c._ordersPromotionAbort;
 c.undoStack=undo;c.retireOrdersProjectionSource('test');
 assert.equal(a.signal.aborted,true);assert.equal(b.signal.aborted,true);assert.equal(c._ordersProjectionSourceEpoch,1);assert.equal(c._ordersUiSessionEpoch,0);
 assert.equal(f.state.orders,order);assert.equal(f.state.ordersSelected,selection);assert.equal(f.state.cp,cp);assert.equal(f.state.cpDirty,dirty);assert.equal(c.undoStack,undo);
});
test('explicit auth retirement advances the shared session epoch; access-only retirement does not invent a session',()=>{
 const f=fixture();f.context.retireOrdersProjectionSource('access');assert.equal(f.context._ordersUiSessionEpoch,0);
 f.context.retireOrdersProjectionSource('page-lifetime',{sessionChanged:true});assert.equal(f.context._ordersUiSessionEpoch,1);
});
test('thin discard refuses an unproved nonempty selection without clearing or remapping it',()=>{
 const f=fixture({thin:true}),view=f.state.orders,selected=f.state.ordersSelected;selected.add(view.rows[0]);
 assert.throws(()=>f.context.retireOrdersProjectionSource('reload',{discardThin:true}),e=>e.code==='ORDERS_FULL_STALE');
 assert.equal(f.state.orders,view);assert.equal(f.state.ordersSelected,selected);assert.equal(selected.has(view.rows[0]),true);
});
test('ordinary full fast paths preserve the exact graph and make no HTTP request',async()=>{
 const f=fixture();assert.equal(await f.context.ensureOrdersLoaded(),true);assert.equal(await f.context.ensureOrdersFullForAction(),f.oldRows);assert.equal(f.requests.length,0);
});
test('a queued obsolete load is cancelled before dispatch',async()=>{
 const f=fixture({empty:true}),pending=f.context.ensureOrdersLoaded();f.context.retireOrdersProjectionSource('replace');
 for(const request of f.requests)request.resolve({payload:{rows:[],collectionCatalogs:{}}});
 assert.equal(await pending,false);assert.equal(f.requests.length,0);
});
test('late old success cannot publish or clear the newer flight or status',async()=>{
 const f=fixture({empty:true}),c=f.context,old=c.ensureOrdersLoaded();await turn();c.retireOrdersProjectionSource('replace');const fresh=c.ensureOrdersLoaded();await turn();
 const own=c.ordersLoadPromise,flight=c._ordersLoadFlight;assert.equal(f.requests[0].opts?.signal?.aborted,true);
 f.requests[0].resolve({payload:{rows:[{_id:10}]}});assert.equal(await old,false);assert.equal(c.ordersLoadPromise,own);assert.equal(c._ordersLoadFlight,flight);assert.equal(f.state.orders,null);
 f.requests[1].resolve({payload:{rows:[{_id:20}],collectionCatalogs:{}}});assert.equal(await fresh,true);assert.equal(f.state.orders.rows[0]._id,20);assert.equal(c.ordersLoadPromise,null);
});
test('late old rejection cannot show an error for the newer flight',async()=>{
 const f=fixture({empty:true}),old=f.context.ensureOrdersLoaded();await turn();f.context.retireOrdersProjectionSource('replace');const fresh=f.context.ensureOrdersLoaded();await turn();
 f.requests[0].reject(Error('old transport'));assert.equal(await old,false);assert.equal(f.events.some(e=>e[0]==='toast'||e[1]==='orders'&&e[2]==='error'),false);
 f.requests[1].resolve({payload:{rows:[],collectionCatalogs:{}}});assert.equal(await fresh,true);
});
test('profile replacement while awaiting without a matching local lifecycle rejects publication',async()=>{
 const f=fixture({empty:true}),pending=f.context.ensureOrdersLoaded();await turn();f.state.currentUser={id:'other'};
 f.requests[0].resolve({payload:{rows:[{_id:10}]}});assert.equal(await pending,false);assert.equal(f.state.orders,null);
});
test('retired promotion passes the owned abort signal and cannot be consumed',async()=>{
 const f=fixture({thin:true}),wait=deferred();let signal;
 f.controllers.set(f.state.orders,{ensure:opts=>{signal=opts?.signal;return wait.promise;}});
 const pending=f.context.ensureOrdersFullForAction();pending.catch(()=>{});f.context.retireOrdersProjectionSource('source-changed');assert.equal(signal?.aborted,true);
 wait.resolve({rows:[],assertCurrent(){assert.fail('retired result must fail before receipt use');}});await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');
});
test('global preparation captures intent then discards only empty finite view before configuration',()=>{
 const f=fixture({thin:true}),selected=f.state.ordersSelected,t=f.context.beginOrdersGlobalUpdate('reload');assert.notEqual(f.state.orders,null);
 f.context.prepareOrdersGlobalApply(t,'globals');assert.equal(f.state.orders,null);assert.equal(f.state.ordersSelected,selected);assert.equal(f.context.ordersProjectionMustLoadFull(),true);
 f.context.endOrdersGlobalUpdate(t);assert.equal(f.context._ordersGlobalUpdateDepth,0);assert.equal(f.context.ordersProjectionMustLoadFull(),true);
});
test('real beforeApply fetches fresh full without recursively awaiting global auth hydration',async()=>{
 const f=fixture({thin:true}),c=f.context,t=c.beginOrdersGlobalUpdate('reload');c.prepareOrdersGlobalApply(t,'globals');
 const pending=c.ensureOrdersFullBeforePreferences();c.authHydrationPromise=pending;await turn();assert.equal(f.requests.length,1);assert.equal(f.requests[0].opts?.fullOnly,true);
 f.requests[0].resolve({payload:{rows:[{_id:1,complete:true}],collectionCatalogs:{}}});await pending;
 c.assertOrdersGlobalUpdate(t);assert.equal(f.state.orders.rows[0].complete,true);assert.equal(c.ordersProjectionIsThin(),false);c.endOrdersGlobalUpdate(t);
});
test('whole actual loadFromServer retires before incoming profile and override application',async()=>{
 const f=bootstrap({data:{currentUser:{id:'next'}}}),c=f.context;const seen=[];
 c.window.applyUserAccessUI=()=>seen.push([c._ordersProjectionSourceEpoch,c._ordersAcceptedReceipt]);c._ordersAcceptedReceipt={};
 assert.equal(await c.loadFromServer(false),true,JSON.stringify(f.events));assert.equal(seen.length,1);assert.ok(seen[0][0]>=2);assert.equal(seen[0][1],null);assert.equal(c._ordersGlobalUpdateDepth,0);
});
test('whole full reload preserves Orders selection and CP dirty/undo references under original partial rules',async()=>{
 const f=bootstrap(),c=f.context,orders=f.state.orders,selection=f.state.ordersSelected,cp=f.state.cp,dirty=f.state.cpDirty,undo=c.undoStack;
 selection.add(orders.rows[0]);assert.equal(await c.loadFromServer(false),true,JSON.stringify(f.events));
 assert.equal(f.state.orders,orders);assert.equal(f.state.ordersSelected,selection);assert.equal(f.state.cp,cp);assert.equal(f.state.cpDirty,dirty);assert.equal(c.undoStack,undo);assert.equal(f.requests.length,0);
});
test('whole force refresh waits for actual full publication before linked/editor/POST actions, and posts once',async()=>{
 const f=bootstrap({thin:true}),wait=deferred();f.controllers.set(f.state.orders,{ensure:async()=>{await wait.promise;const rows=[{_id:0,full:true}];f.state.orders={rows};return {rows,assertCurrent(){}};}});
 // Return an ordinary HTTP error after recording the one POST: the test covers
 // preflight ordering without pretending a background refresh job completed.
 f.context.fetch=async(url,opts)=>{f.events.push(['fetch',url,opts]);return {ok:false,statusText:'fixture rejection',json:async()=>({error:'fixture rejection'})};};
 const pending=f.context.loadFromServer(true,['orders']);assert.equal(f.events.some(e=>['sync-linked','commit','settle','fetch'].includes(e[0])),false);
 wait.resolve();assert.equal(await pending,false);assert.deepEqual(f.events.filter(e=>['sync-linked','commit','settle','fetch'].includes(e[0])).map(e=>e[0]),['sync-linked','commit','settle','fetch']);
 const posts=f.events.filter(e=>e[0]==='fetch'&&e[2].method==='POST');assert.equal(posts.length,1);assert.equal(posts[0][1],'/api/refresh');
});
test('failed full promotion makes force refresh return false locally before any side effect',async()=>{
 const f=bootstrap({thin:true});f.controllers.set(f.state.orders,{ensure:async()=>{throw Error('private transport');}});
 assert.equal(await f.context.loadFromServer(true,['orders']),false);assert.equal(f.events.some(e=>['sync-linked','commit','settle','fetch'].includes(e[0])),false);
 assert.ok(f.events.some(e=>e[0]==='toast'&&e[1].includes('Refresh could not start')&&!e[1].includes('private transport')));
});
test('whole reload rechecks fresh-full admission even when auth hydration previously completed',async()=>{
 const f=bootstrap({thin:true}),pending=f.context.loadFromServer(false);await turn();assert.equal(f.requests.length,1);assert.equal(f.requests[0].opts?.fullOnly,true);
 assert.equal(f.events.some(e=>e[0]==='cached'),false);f.requests[0].resolve({payload:{rows:[{_id:2,complete:true}],collectionCatalogs:{}}});
 assert.equal(await pending,true,JSON.stringify(f.events));assert.ok(f.events.find(e=>e[0]==='cached')[2].rows[0].complete);
});
test('global reload cannot migrate profiles when required fresh full fails',async()=>{
 const f=bootstrap({thin:true}),pending=f.context.loadFromServer(false);await turn();assert.equal(f.requests.length,1);f.requests[0].reject(Error('fresh full unavailable'));
 assert.equal(await pending,false);assert.equal(f.events.some(e=>e[0]==='cached'),false);assert.equal(f.context._ordersGlobalUpdateDepth,0);
});
test('retired-source fresh full wait cannot apply the profile after its target page changed',async()=>{
 const f=bootstrap({thin:true}),pending=f.context.loadFromServer(false);await turn();
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].opts.fullOnly,true);
 f.context.activeProfilePage=()=> 'cp';
 f.requests[0].resolve({payload:{rows:[{_id:2,complete:true}],collectionCatalogs:{}}});
 assert.equal(await pending,false);assert.equal(f.events.some(e=>e[0]==='cached'),false);
 assert.equal(f.context._ordersGlobalUpdateDepth,0);
});
test('one finished promotion subscriber does not orphan the remaining subscriber abort',async()=>{
 const f=fixture({thin:true}),a=deferred(),b=deferred();let calls=0,signal;
 f.controllers.set(f.state.orders,{ensure:opts=>{signal=opts?.signal;return (++calls===1?a:b).promise;}});
 const first=f.context.ensureOrdersFullForAction(),second=f.context.ensureOrdersFullForAction();
 first.catch(()=>{});second.catch(()=>{});
 const rejected=assert.rejects(first,e=>e.code==='ORDERS_FULL_STALE');a.reject(Error('first cancelled'));await rejected;
 assert.equal(f.context._ordersPromotionSubscribers,1);f.context.retireOrdersProjectionSource('new source');assert.equal(signal?.aborted,true);
 b.resolve({rows:[],assertCurrent(){}});await assert.rejects(second,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.context._ordersPromotionSubscribers,0);
});
test('whole late metadata response cannot overwrite a newer global source intent',async()=>{
 const f=bootstrap(),wait=deferred(),oldProfile=f.state.currentUser;f.context.fetch=()=>wait.promise;
 const pending=f.context.loadFromServer(false);f.context.retireOrdersProjectionSource('newer source');
 wait.resolve({ok:true,json:async()=>({currentUser:{id:'obsolete'}})});assert.equal(await pending,false);
 assert.equal(f.state.currentUser,oldProfile);assert.equal(f.events.some(e=>e[0]==='cached'),false);assert.equal(f.context._ordersGlobalUpdateDepth,0);
});
test('actual ordinary fetch forwards the same owned abort signal through its 404 fallback',async()=>{
 const f=fixture(),calls=[],signal=new AbortController().signal,payload={rows:[]};
 Object.assign(f.context,{performance:{now:()=>0},fetch:async(url,opts)=>{calls.push({url,opts});return calls.length===1?{status:404}:{ok:true,json:async()=>payload};}});
 vm.runInContext(['parseProjectionResponse','fetchOrdersProjection'].map(n=>extractFunction(source,n)).join('\n'),f.context);
 const result=await f.context.fetchOrdersProjection({signal,fullOnly:true});assert.equal(result.payload,payload);
 assert.deepEqual(calls.map(v=>v.url),['/api/page-projection/orders','/api/data/orders']);for(const call of calls)assert.equal(call.opts.signal,signal);
});
test('actual hydration function supplies the remembered-source beforeApply gate before storage mutation',async()=>{
 const f=fixture({thin:true}),c=f.context,t=c.beginOrdersGlobalUpdate('reload');c.prepareOrdersGlobalApply(t,'globals');
 const storage={hydrate:async({beforeApply})=>{await beforeApply();f.events.push(['storage-applied',f.state.orders]);return {applied:0};}};
 Object.assign(c,{BLStorage:storage,authHydrationPromise:null,console:{warn:(...args)=>f.events.push(['warn',...args])}});c.window.BLStorage=storage;
 vm.runInContext(extractFunction(source,'hydrateUserPreferencesAfterUi'),c);
 const pending=c.hydrateUserPreferencesAfterUi();await turn();assert.equal(f.events.some(e=>e[0]==='storage-applied'),false);assert.equal(f.requests.length,1);
 f.requests[0].resolve({payload:{rows:[{_id:3,complete:true}],collectionCatalogs:{}}});await pending;
 assert.equal(f.events.find(e=>e[0]==='storage-applied')[1].rows[0].complete,true);c.assertOrdersGlobalUpdate(t);c.endOrdersGlobalUpdate(t);
});
