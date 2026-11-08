'use strict';
// PREPARED ONLY. Real extracted writer bodies and lifecycle; no tests run.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const test=(name,body)=>nativeTest(name,{timeout:5000},body);
const {source,extractFunction,installLifecycle,readPinnedOriginal}=require('../../../resources/app/tests/helpers/orders-config-writer-source');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};}
function handled(p){p.catch(()=>{});return p;}
const rule=(royalty=10)=>({id:'demo-rule',countryGroup:'TR',licensor:'DEMO',license:'DEMO',royalty,hologramCost:0});
const runtimeNames=['norm','turknorm','coerceDateLoose','dateOrdinal','toISODate','normalizePricingRuleDate','normalizePricingCountryGroup','normalizePricingRuleSeasons','pricingRuleSeasonLabel','normalizePricingRules','ordersProjectionIsThin','ordersFullActionError','ensureOrdersLoaded','applyLicensorMerges','applyIncomingPricingRules','syncPricingRulesToAllLoadedViews','modelConnLoad','modelConnSave','refreshPricingRulesFromServer','persistPricingRules'];
function fixture({thin=false,offline=false,legacy=false}={}){
 const events=[],http=[],full=[];
 const state={currentUser:{id:'demo'},orders:{rows:[{_id:1}],...(thin?{projectionProfile:'thin'}:{})},ordersSelected:new Set(),ordersLogisticExpanded:new Set(),cp:{rows:[{_id:2}]},cpDirty:new Set([2]),cpSelected:new Set([2]),overrides:{pricingRules:[]},storeRevisions:{pricingRules:5},licensorMerges:{split:[]}};
 const c=vm.createContext({state,AbortController,Promise,Set,Map,Date,appLang:'en',_ordersFullViewControllers:new WeakMap(),projectionRequestGeneration:{orders:0},undoStack:[{id:'old-undo'}],redoStack:[],
  window:{SERVER_BACKED:!offline,BL_USER_CONTEXT:state.currentUser},document:{body:{dataset:{activeTab:'overview'}}},modelConnectionApiAvailable:()=>!offline,
  modelConnState:{items:[{role:'asas',id:'old'}],revision:5,supported:true,exportFolder:'',loaded:true},
  fetch:(url,opts)=>{const wait=deferred();http.push({url,opts,...wait});return wait.promise;},
  fetchOrdersProjection:opts=>{const wait=deferred();full.push({opts,...wait});return wait.promise;},
  refreshFieldMappingReadinessUI:()=>{events.push(['model-applied',c._ordersProjectionSourceEpoch,state.orders]);},
  saveLocalPricingRules:rules=>events.push(['rules-saved',c._ordersProjectionSourceEpoch,rules,state.orders]),
  applyPricingRulesToLoadedRows:()=>{events.push(['pricing-sync',state.overrides.pricingRules,state.orders]);return 0;},
  currentActiveTab:()=> 'overview',setOrdersLoadingState:()=>{},showToast:message=>events.push(['toast',message]),reviveServerDates:()=>{},invalidateUnifiedPriorityDecisions:()=>{},ensureCollectionCatalogLoaded:()=>{},buildOrdersFilters:()=>{},applyCoreAutoFilterState:()=>{},renderOrders:()=>{},
  L:(tr,en)=>en||tr,BLBusinessRules:{compareSeasonNumberThenLetter:(a,b)=>String(a).localeCompare(String(b))},
 });
 installLifecycle(c,{_ordersProjectionClient:legacy?null:{invalidate:()=>events.push(['invalidate'])}});
 vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname,'action-ownership.js'),'utf8')+'\n'+runtimeNames.map(n=>extractFunction(source,n)).join('\n'),c);
 state.overrides.pricingRules=c.normalizePricingRules([rule()]);
 return {c,state,events,http,full};
}
const respond=(request,data,extra={})=>request.resolve({ok:true,status:200,json:async()=>data,...extra});
const fullReply=f=>f.full.at(-1).resolve({payload:{rows:[{_id:1,complete:true}],collectionCatalogs:{}}});
test('actual model load captures intent before network and rejects a response from a retired source',async()=>{
 const f=fixture(),before=f.c.modelConnState.items,pending=handled(f.c.modelConnLoad());f.c.retireOrdersProjectionSource('replacement');respond(f.http[0],{items:[{id:'new'}],revision:6});
 await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,before);assert.equal(f.full.length,0);
});
test('actual model save cannot apply its late PUT result after a session retirement',async()=>{
 const f=fixture(),before=f.c.modelConnState.items,pending=handled(f.c.modelConnSave([{id:'draft'}]));f.c.retireOrdersProjectionSource('session',{sessionChanged:true});respond(f.http[0],{items:[{id:'new'}],revision:6});
 await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,before);assert.equal(f.http.length,1);assert.equal(f.http[0].opts.method,'PUT');
});
test('changed thin model payload waits for fresh ordinary full before model setters',async()=>{
 const f=fixture({thin:true}),old=f.c.modelConnState.items,pending=handled(f.c.modelConnLoad());respond(f.http[0],{items:[{id:'new',role:'asas'}],revision:6,supported:false,exportFolder:''});await turn();
 assert.equal(f.full.length,1);assert.equal(f.full[0].opts.fullOnly,true);assert.equal(f.c.modelConnState.items,old);assert.equal(f.events.some(e=>e[0]==='model-applied'),false);
 fullReply(f);await pending;assert.equal(f.c.modelConnState.supported,false);assert.equal(f.c.modelConnState.revision,6);assert.ok(f.events.find(e=>e[0]==='model-applied')[1]>0);assert.equal(f.state.orders.rows[0].complete,true);
});
test('unchanged actual model payload does not retire a thin source or request full',async()=>{
 const f=fixture({thin:true}),view=f.state.orders,pending=f.c.modelConnLoad();respond(f.http[0],{items:[{role:'asas',id:'old'}],revision:5,supported:true,exportFolder:''});await pending;
 assert.equal(f.c._ordersProjectionSourceEpoch,0);assert.equal(f.state.orders,view);assert.equal(f.full.length,0);
});
test('ordinary full model load retains rows and selection with no additional HTTP',async()=>{
 const f=fixture(),view=f.state.orders,selection=f.state.ordersSelected,pending=f.c.modelConnLoad();respond(f.http[0],{items:[],revision:0,supported:false,exportFolder:''});await pending;
 assert.equal(f.full.length,0);assert.equal(f.http.length,1);assert.equal(f.state.orders,view);assert.equal(f.state.ordersSelected,selection);assert.equal(f.c.modelConnState.revision,0);assert.equal(f.c.modelConnState.supported,false);
});
test('offline full model save remains synchronous through its setter and returns original items ref',async()=>{
 const f=fixture({offline:true}),items=[{id:'local'}],pending=f.c.modelConnSave(items);assert.equal(f.c.modelConnState.items,items);assert.equal(await pending,items);assert.equal(f.full.length,0);assert.equal(f.http.length,0);
});
test('thin model save fetches new ordinary full after the successful remote revision, never native old-parent promotion',async()=>{
 const f=fixture({thin:true}),pending=handled(f.c.modelConnSave([{id:'draft'}]));respond(f.http[0],{items:[{id:'saved'}],revision:6});await turn();assert.equal(f.full.length,1);assert.equal(f.http.length,1);fullReply(f);await pending;assert.equal(f.c.modelConnState.items[0].id,'saved');
});
test('nonempty unproved thin selection blocks model setters without clearing selection',async()=>{
 const f=fixture({thin:true}),view=f.state.orders,selected=f.state.ordersSelected,old=f.c.modelConnState.items;selected.add(view.rows[0]);
 const pending=handled(f.c.modelConnLoad());respond(f.http[0],{items:[],revision:6});await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');
 assert.equal(f.state.orders,view);assert.equal(f.state.ordersSelected,selected);assert.equal(f.c.modelConnState.items,old);assert.equal(f.full.length,0);
});
test('source retirement during fresh full wait rejects model application',async()=>{
 const f=fixture({thin:true}),old=f.c.modelConnState.items,pending=handled(f.c.modelConnLoad());respond(f.http[0],{items:[],revision:6});await turn();assert.equal(f.full.length,1);f.c.retireOrdersProjectionSource('new-source');fullReply(f);
 await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,old);assert.equal(f.c._ordersGlobalUpdateDepth,0);
});
test('remote pricing waits for fresh full and does not apply old pricing during the loader',async()=>{
 const f=fixture({thin:true}),previous=f.state.overrides.pricingRules,pending=handled(f.c.refreshPricingRulesFromServer());respond(f.http[0],{rules:[rule(20)],revision:6});await turn();
 assert.equal(f.full.length,1);assert.equal(f.state.overrides.pricingRules,previous);assert.equal(f.events.some(e=>e[0]==='pricing-sync'||e[0]==='rules-saved'),false);
 fullReply(f);await pending;assert.equal(f.state.overrides.pricingRules[0].royalty,20);assert.equal(f.events.filter(e=>e[0]==='pricing-sync').length,1);assert.equal(f.events.find(e=>e[0]==='pricing-sync')[2].rows[0].complete,true);
});
test('remote pricing singleflight joins the same source and clears only its own flight',async()=>{
 const f=fixture(),a=handled(f.c.refreshPricingRulesFromServer()),b=handled(f.c.refreshPricingRulesFromServer());assert.equal(f.http.length,1);
 f.c.retireOrdersProjectionSource('replacement');const newer=handled(f.c.refreshPricingRulesFromServer()),own=f.c.refreshPricingRulesFromServer.pending;assert.equal(f.http.length,2);
 respond(f.http[0],{rules:[rule(20)],revision:6});await assert.rejects(a,e=>e.code==='ORDERS_FULL_STALE');await assert.rejects(b,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.refreshPricingRulesFromServer.pending,own);
 respond(f.http[1],{rules:[rule(30)],revision:7});await newer;assert.equal(f.c.refreshPricingRulesFromServer.pending,null);assert.equal(f.state.overrides.pricingRules[0].royalty,30);
});
test('remote pricing continues joining its owned flight while fresh full is pending',async()=>{
 const f=fixture({thin:true}),a=handled(f.c.refreshPricingRulesFromServer());respond(f.http[0],{rules:[rule(20)],revision:6});await turn();assert.equal(f.full.length,1);
 const b=handled(f.c.refreshPricingRulesFromServer());assert.equal(f.http.length,1);fullReply(f);await Promise.all([a,b]);
});
test('stale and identical pricing responses retain actual version protection without retirement/full fetch',async()=>{
 for(const data of [{rules:[],revision:0},{rules:[rule(20)],revision:4},{rules:[rule()],revision:5}]){
  const f=fixture({thin:true}),previous=f.state.overrides.pricingRules,pending=f.c.refreshPricingRulesFromServer();respond(f.http[0],data);assert.equal(await pending,null);assert.equal(f.state.overrides.pricingRules,previous);assert.equal(f.state.storeRevisions.pricingRules,5);assert.equal(f.full.length,0);assert.equal(f.c._ordersProjectionSourceEpoch,0);
 }
});
test('licensor merges trigger full admission even when the pricing-rule revision is stale',async()=>{
 const f=fixture({thin:true}),previous=f.state.overrides.pricingRules,pending=handled(f.c.refreshPricingRulesFromServer());respond(f.http[0],{rules:[],revision:0,licensorMerges:{split:['DEMO']}});await turn();assert.equal(f.full.length,1);fullReply(f);await pending;
 assert.equal(f.state.overrides.pricingRules,previous);assert.equal(f.state.licensorMerges.split[0],'DEMO');assert.equal(f.state.storeRevisions.pricingRules,5);
});
test('full optimistic pricing remains synchronous before its one PUT, with exact Orders/CP selection and history refs',async()=>{
 const f=fixture(),view=f.state.orders,selected=f.state.ordersSelected,cp=f.state.cp,dirty=f.state.cpDirty,undo=f.c.undoStack,pending=f.c.persistPricingRules([rule(20)]);
 assert.equal(f.state.overrides.pricingRules[0].royalty,20);assert.equal(f.http.length,1);assert.equal(f.http[0].opts.method,'PUT');assert.equal(f.events.filter(e=>e[0]==='pricing-sync').length,1);assert.equal(f.full.length,0);
 respond(f.http[0],{rules:[rule(20)],revision:6});await pending;assert.equal(f.state.orders,view);assert.equal(f.state.ordersSelected,selected);assert.equal(f.state.cp,cp);assert.equal(f.state.cpDirty,dirty);assert.equal(f.c.undoStack,undo);
});
test('thin optimistic pricing waits before rule setter, recalculation and single PUT',async()=>{
 const f=fixture({thin:true}),previous=f.state.overrides.pricingRules,pending=handled(f.c.persistPricingRules([rule(20)]));await turn();assert.equal(f.full.length,1);assert.equal(f.http.length,0);assert.equal(f.state.overrides.pricingRules,previous);
 fullReply(f);await turn();assert.equal(f.http.length,1);assert.equal(f.state.overrides.pricingRules[0].royalty,20);respond(f.http[0],{rules:[rule(20)],revision:6});await pending;
});
test('ordinary 409 retains original localized error, draft guard and rollback behavior',async()=>{
 const f=fixture(),before=JSON.stringify(f.state.overrides.pricingRules),pending=handled(f.c.persistPricingRules([rule(20)]));respond(f.http[0],{code:'REVISION_CONFLICT'},{ok:false,status:409});
 await assert.rejects(pending,e=>e.status===409&&e.code==='REVISION_CONFLICT'&&e.message.includes('draft is preserved'));
 assert.equal(JSON.stringify(f.state.overrides.pricingRules),before);assert.equal(f.state.storeRevisions.pricingRules,5);assert.equal(f.events.filter(e=>e[0]==='pricing-sync').length,2);assert.equal(f.c._ordersGlobalUpdateDepth,0);
});
test('late failed pricing PUT cannot roll back or recalculate a replacement source',async()=>{
 const f=fixture(),pending=handled(f.c.persistPricingRules([rule(20)]));f.c.retireOrdersProjectionSource('replacement');const replacement=f.c.normalizePricingRules([rule(30)]);f.state.overrides.pricingRules=replacement;const count=f.events.filter(e=>e[0]==='pricing-sync').length;
 respond(f.http[0],{error:'offline'},{ok:false,status:503});await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.state.overrides.pricingRules,replacement);assert.equal(f.events.filter(e=>e[0]==='pricing-sync').length,count);
});
test('pricing change predictor agrees with unchanged actual apply helpers for stale/zero/current/new revisions',()=>{
 for(const data of [{rules:[],revision:0},{rules:[rule(20)],revision:4},{rules:[rule()],revision:5},{rules:[rule(20)],revision:6},{rules:[rule()],revision:5,licensorMerges:{split:['DEMO']}}]){
  const f=fixture(),predicted=f.c.pricingConfigurationWouldChange(data.rules,data.revision,data.licensorMerges);
  const merges=f.c.applyLicensorMerges(data.licensorMerges),rules=f.c.applyIncomingPricingRules(data.rules,data.revision);assert.equal(predicted,Boolean(merges||rules));
 }
});
test('protected source refresh POST flow, CP loader, pricing helpers and synchronous consumers remain exact',()=>{
 const baseline=readPinnedOriginal('app');
 // Preserve this older configuration layer assertion after exact reversal of the separately tested ready layer.
 const configurationSource=require('../../../resources/app/tests/fixtures/orders-ready-integration/source.cjs').base('public/app-main.js');
 for(const name of ['syncLinkedRefreshMembers','loadFromServer','ensureCpLoaded','applyIncomingPricingRules','applyLicensorMerges','applyPricingRulesToLoadedRows','syncPricingRulesToAllLoadedViews','globalFlowSourceRows'])assert.equal(extractFunction(configurationSource,name),extractFunction(baseline,name),name);
});
test('an absent or unknown selection container is not proof of empty thin selection',async()=>{
 for(const selected of [null,[],{size:0}]){
  const f=fixture({thin:true}),old=f.c.modelConnState.items;f.state.ordersSelected=selected;const pending=handled(f.c.modelConnLoad());respond(f.http[0],{items:[],revision:6});
  await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,old);assert.equal(f.state.ordersSelected,selected);assert.equal(f.full.length,0);
 }
});
function installBootstrap(f){
 const c=f.c;
 Object.assign(c,{document:{getElementById:()=>null,body:{dataset:{activeTab:'overview'}}},authHydrationPromise:null,CP_NOTE_COLUMN_DEFS_REVISION:0,CP_NOTE_COLUMN_DEFS:[],_deferredTabRenders:new Set(),
  cpClientWorkInProgress:()=>true,activeProfilePage:()=> 'overview',normalizeTransitRules:value=>value||[],normalizeNonDtrManufacturers:value=>value||[],normalizeKolLandedMultipliers:value=>value||{},cloneMatchConfig:value=>value,
  applyCachedProfilesForCurrentPage:()=>{},renderStartupActiveModule:()=> 'overview',console:{warn:(...args)=>f.events.push(['warn',...args])},refreshDiagnosisText:()=>'',
 });
 f.state.cpLogisticExpanded=new Set();
 for(const name of ['setServerStatus','updSourceHint','hideSourceFilterRequiredNotice','syncModelImageRegistry','renderAntrepoSourceControl','renderAsasSourceControl','renderLflSourceControl','saveLocalTransitRules','saveLocalNonDtrManufacturers','renderHorizonBadges','setWarnings','buildCPFilters','refreshSubmfrList','refreshLicenseList','refreshLicensorList'])c[name]=()=>{};
 vm.runInContext(extractFunction(source,'loadFromServer'),c);
}
test('legacy no-client model startup response survives actual ordinary bootstrap retirement/profile replacement',async()=>{
 const f=fixture({legacy:true}),previous=f.state.currentUser,view=f.state.orders,model=handled(f.c.modelConnLoad());installBootstrap(f);
 const bootstrap=f.c.loadFromServer(false);assert.equal(f.http.length,2);assert.equal(f.http[0].url,'/api/model-connections');assert.equal(f.http[1].url,'/api/data?mode=initial');
 respond(f.http[1],{currentUser:{id:'demo',bootstrapped:true}});assert.equal(await bootstrap,true,JSON.stringify(f.events));
 assert.notEqual(f.state.currentUser,previous);const epoch=f.c._ordersProjectionSourceEpoch;assert.ok(epoch>0);
 respond(f.http[0],{items:[{role:'asas',id:'after-bootstrap'}],revision:6,supported:true,exportFolder:''});await model;
 assert.equal(f.c.modelConnState.items[0].id,'after-bootstrap');assert.equal(f.c._ordersProjectionSourceEpoch,epoch);assert.equal(f.state.orders,view);assert.equal(f.full.length,0);
});
test('arming finite during an unarmed model request rejects that response even without an epoch change',async()=>{
 const f=fixture({legacy:true}),old=f.c.modelConnState.items,pending=handled(f.c.modelConnLoad());assert.equal(f.c._ordersProjectionSourceEpoch,0);
 f.c.window.BLOrdersFiniteLifecycleRequired=true;respond(f.http[0],{items:[],revision:6});await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');
 assert.equal(f.c.modelConnState.items,old);assert.equal(f.c._ordersProjectionSourceEpoch,0);assert.equal(f.full.length,0);
});
test('installing the real private client while a legacy save awaits cannot adopt its response',async()=>{
 const f=fixture({legacy:true}),old=f.c.modelConnState.items,pending=handled(f.c.modelConnSave([{id:'submitted'}]));
 f.c._ordersProjectionClient={invalidate:()=>f.events.push(['invalidate'])};respond(f.http[0],{items:[{id:'returned'}],revision:6});
 await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,old);
});
test('an unarmed remote pricing flight cannot hide finite activation behind its old pending promise',async()=>{
 const f=fixture({legacy:true}),old=handled(f.c.refreshPricingRulesFromServer());f.c.window.BLOrdersFiniteLifecycleRequired=true;
 const current=handled(f.c.refreshPricingRulesFromServer());assert.equal(f.http.length,2);
 respond(f.http[0],{rules:[rule(20)],revision:6});await assert.rejects(old,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.state.overrides.pricingRules[0].royalty,10);
 respond(f.http[1],{rules:[rule(30)],revision:7});await current;assert.equal(f.state.overrides.pricingRules[0].royalty,30);
});
test('captured finite involvement remains strict even if a client reference is later cleared',async()=>{
 const f=fixture(),old=f.c.modelConnState.items,pending=handled(f.c.modelConnLoad());f.c._ordersProjectionClient=null;f.c.retireOrdersProjectionSource('replace');
 respond(f.http[0],{items:[],revision:6});await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,old);
});
test('legacy full model save and pricing apply do not add epochs or run finite pre-apply comparisons',async()=>{
 const f=fixture({legacy:true,offline:true}),view=f.state.orders;
 f.c.modelConnectionPayloadChanged=()=>assert.fail('legacy model must retain its direct setter path');
 const items=[{id:'local'}];assert.equal(await f.c.modelConnSave(items),items);assert.equal(f.c._ordersProjectionSourceEpoch,0);
 f.c.pricingConfigurationWouldChange=()=>assert.fail('legacy pricing must use its original single apply helper');
 await f.c.persistPricingRules([rule(20)]);assert.equal(f.c._ordersProjectionSourceEpoch,0);assert.equal(f.full.length,0);assert.equal(f.state.orders,view);
});
test('legacy pricing response keeps original full behavior across an ordinary inactive source retirement',async()=>{
 const f=fixture({legacy:true}),pending=handled(f.c.refreshPricingRulesFromServer());f.c.retireOrdersProjectionSource('ordinary-bootstrap');f.state.currentUser={id:'demo',bootstrapped:true};f.c.window.BL_USER_CONTEXT=f.state.currentUser;
 const epoch=f.c._ordersProjectionSourceEpoch;f.c.pricingConfigurationWouldChange=()=>assert.fail('inactive pricing preview must not run');respond(f.http[0],{rules:[rule(20)],revision:6});await pending;
 assert.equal(f.state.overrides.pricingRules[0].royalty,20);assert.equal(f.c._ordersProjectionSourceEpoch,epoch);assert.equal(f.full.length,0);
});
test('marked thin or retained accepted receipt activates strict response checks without a client instance',async()=>{
 for(const activate of [f=>{f.state.orders.projectionProfile='thin';},f=>{f.c._ordersAcceptedReceipt={};},f=>{f.c._ordersRetiredFiniteView={view:f.state.orders};}]){
  const f=fixture({legacy:true}),old=f.c.modelConnState.items,pending=handled(f.c.modelConnLoad());activate(f);respond(f.http[0],{items:[],revision:6});
  await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.c.modelConnState.items,old);
 }
});
