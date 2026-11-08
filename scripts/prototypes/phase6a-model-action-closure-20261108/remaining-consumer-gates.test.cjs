'use strict';
// PREPARED / UNRUN. Both modes execute exact original functions; candidate
// mode applies only the accompanying exact text edits in memory.
const nativeTest=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const test=(name,body)=>nativeTest(name,{timeout:5000},body);
const appRoot=process.env.BL_RETIREMENT_APP_ROOT||path.resolve(__dirname,'../../../resources/app');
const helper=require(path.join(appRoot,'tests/helpers/orders-retirement-source.js'));
const promotion=require(path.join(appRoot,'public/orders-full-promotion.js'));
const ui=require(path.join(appRoot,'public/orders-ui-command.js'));
const reviewed=require('./consumer-source.cjs');const baseline=process.env.BL_CONSUMER_BEHAVIOR_BASELINE==='1';
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function text(file){return baseline?reviewed.base(file):reviewed.current(file);}
const source=text('public/app-main.js'),qfgSource=text('public/quick-filter-groups.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture({thin=true,active=true}={}){
 const events=[],raw=[{'Order Code':7,hiddenModel:0}],bytes=Buffer.from(JSON.stringify({rows:raw})),fullWait=deferred();
 const identity={ownerId:'synthetic-owner',sessionId:'synthetic-page',sourceId:'synthetic-source',generation:'one',accessHash:'allow',scopeHash:'orders',module:'orders',planHash:'omit-model',fullProjectionChecksum:sha(bytes),fullByteLength:bytes.length,rowCount:1};
 let view={kind:thin?'thin':'full',identity,rows:thin?[{'Order Code':7}]:raw,ordinals:[0],selectedRows:[],requiredKeys:['Order Code'],mutationRevision:0,selectionRevision:0,dirty:false,...(thin?{projectionProfile:'thin'}:{})},receipt=null;
 const state={orders:view,ordersSelected:new Set(),cp:null,cpLogisticExpanded:new Set(),currentUser:{id:'synthetic-owner'},overrides:{imagemap:{}}};
 let allowed=true,fetches=0;
 const c=vm.createContext({state,AbortController,Set,WeakMap,Promise,appLang:'en',console:{warn(){}},window:{BL_USER_CONTEXT:state.currentUser,BLCanAccessArea:()=>allowed,BLOrdersUiCommand:ui,BLModulePreparation:{setStatus:(...x)=>events.push(['status',...x])}},
  currentActiveTab:()=> 'orders',showToast:x=>events.push(['toast',x]),projectionRequestGeneration:{orders:0,cp:1},
  renderCorePageLoadingState:()=>{},overviewCpLoadState:'idle',overviewCpLoadError:'',_unifiedPriorityDataRevision:0,ordersColumnsFromCp:value=>value,
  fetchProjectionWithFallback:async()=>({generation:1,payload:{rows:[{cp:1}],cpModelColumns:[]}}),
  fetch:async()=>({ok:true,json:async()=>({imagemap:{demo:'image'}})}),
  applyCpStartupImageRegistry:()=>events.push(['registry-apply']),applyCpSharedEditAccess:async()=>{},
  reviveServerDates:()=>events.push(['revive']),applyPricingRulesToLoadedRows:()=>events.push(['pricing']),
  syncCpModelColumns:()=>events.push(['schema']),syncUnifiedPrioritiesForTable:()=>{events.push(['priority']);return true;},
  scheduleOverviewRender:()=>{},invalidateUnifiedPriorityDecisions:()=>{},buildCPFilters:()=>{},applyCoreAutoFilterState:()=>{},refreshSubmfrList:()=>{},refreshLicenseList:()=>{},refreshLicensorList:()=>{},renderCP:()=>{},
 });
 helper.installLifecycle(c,active?{_ordersProjectionClient:{invalidate:()=>events.push(['invalidate'])}}:{});
 const guardStart=source.indexOf('const _ordersRequireFullSynchronousRead=');
 const guardEnd=source.indexOf('\n};',guardStart)+3;
 if(guardStart<0||guardEnd<guardStart)throw Error('CONSUMER_TEST_SETUP: root guard unavailable');
 vm.runInContext(source.slice(guardStart,guardEnd)+'\nwindow.BLOrdersRequireFullSynchronousRead=_ordersRequireFullSynchronousRead;\nlet cpLoadPromise=null;let globalFlowOrdersFullFailure=null;const globalFlowLoadFailed={cp:false,orders:false};let _ordersUiCommandGate=null;',c);
 const names=['ensureOrdersFullForAction','ordersUiChange','globalFlowSourceRows','globalFlowEnsure','refreshCpStartupImageRegistry','ensureCpLoaded','writeCpModelColumn'];
 vm.runInContext(fs.readFileSync(path.join(__dirname,'action-ownership.js'),'utf8')+'\nlet CP_MODEL_COLUMN_DEFS=[];\n'+names.map(n=>helper.extractFunction(source,n)).join('\n')+'\nwindow.BLOrdersUiChange=ordersUiChange;',c);
 const capturedProfile=state.currentUser,capturedEpoch=c._ordersProjectionSourceEpoch,capturedSession=c._ordersUiSessionEpoch;
 const coordinator=promotion.create({snapshot:()=>view,
  fetchFull:async()=>{fetches++;return fullWait.promise;},normalize:(rows,{ordinals})=>({rows,ordinals}),
  isCurrent:()=>allowed&&state.currentUser===capturedProfile&&c._ordersProjectionSourceEpoch===capturedEpoch&&c._ordersUiSessionEpoch===capturedSession,
  publish:(next,{assertCurrent,expected})=>{assertCurrent();assert.equal(view,expected);view=next;state.orders={rows:next.rows};return next;},
 });
 const sourceBinding=ui.createPrivateSource({moduleNow:()=>state.orders,lastFull:()=>receipt,sourceNow:()=>Object.freeze({actorId:state.currentUser.id,allowed,epoch:c._ordersProjectionSourceEpoch,session:c._ordersUiSessionEpoch,parent:identity.fullProjectionChecksum})});
 if(thin)c._ordersFullViewControllers.set(view,{ensure:async options=>(receipt=await coordinator.ensure(options)),captureUiSource:()=>sourceBinding.capture()});
 return {c,state,events,fullWait,resolve:()=>fullWait.resolve({identity,bytes:new Uint8Array(bytes)}),get fetches(){return fetches;},revoke:()=>{allowed=false;},eval:name=>vm.runInContext(helper.extractFunction(source,name),c)};
}
function qfg(f){
 let writes=0,creates=0,removed=0;
 const element=()=>({isConnected:true,remove(){removed++;this.isConnected=false;},querySelector:()=>({}),querySelectorAll:()=>[],addEventListener(){}});
 f.c.document={body:{appendChild(){}},createElement(){creates++;return element();},removeEventListener(){},addEventListener(){}};
 f.c.localStorage={getItem:()=>null,setItem:()=>writes++};f.c.window.COLS_BY_TABLE={orders:[{k:'hiddenModel',label:'Model'}]};
 vm.runInContext(qfgSource,f.c);
 return {api:f.c.window.BLQuickFilterGroups,get writes(){return writes;},get creates(){return creates;},get removed(){return removed;}};
}
test('QFG save refuses thin BEFORE invoking next getters or storage',()=>{
 const f=fixture(),q=qfg(f);let reads=0;
 assert.throws(()=>q.api.saveConfig('orders',{get hidden(){reads++;return [];}}),e=>e.code==='ORDERS_FULL_REQUIRED');assert.equal(reads,0);assert.equal(q.writes,0);
});
test('QFG finite marker without actual root guard fails closed; legacy stays usable',()=>{
 const f=fixture({thin:false,active:false}),q=qfg(f);delete f.c.window.BLOrdersRequireFullSynchronousRead;f.c.window.BLOrdersFiniteLifecycleRequired=true;
 assert.throws(()=>q.api.saveConfig('orders',{}),e=>e.code==='ORDERS_FULL_STALE');assert.equal(q.writes,0);
 delete f.c.window.BLOrdersFiniteLifecycleRequired;q.api.saveConfig('orders',{});assert.equal(q.writes,1);
});
test('QFG full open preserves synchronous undefined and does not call UI gate',()=>{
 const f=fixture({thin:false}),q=qfg(f);f.c.window.BLOrdersUiChange=()=>assert.fail('full open must remain sync');
 assert.equal(q.api.open('orders'),undefined);assert.equal(q.creates,1);assert.equal(f.fetches,0);
});
test('QFG thin open waits real whole-module promotion before modal or columns',async()=>{
 const f=fixture(),q=qfg(f),pending=q.api.open('orders');assert.equal(q.creates,0);await turn();assert.equal(f.fetches,1);
 f.resolve();await pending;assert.equal(q.creates,1);assert.equal(f.state.orders.rows[0].hiddenModel,0);
});
test('QFG source retirement during open cannot close or create a modal',async()=>{
 const f=fixture(),q=qfg(f),pending=q.api.open('orders');await turn();f.c.retireOrdersProjectionSource('replacement');f.resolve();await pending;
 assert.equal(q.creates,0);assert.equal(q.removed,0);assert.equal(q.writes,0);
});
for(const name of ['syncCpModelColumns','syncCpNoteColumns','syncOrdersColumnsFromCp'])test(name+' rejects thin before touching schema input',()=>{
 const f=fixture();f.eval(name);let reads=0;
 const trap=new Proxy([],{get(){reads++;throw Error('INPUT_READ');}});f.c.CP_COLS=trap;
 assert.throws(()=>f.c[name](trap),e=>e.code==='ORDERS_FULL_REQUIRED');assert.equal(reads,0);
});
test('Global Flow direct Orders getter rejects before unified-priority work',()=>{
 const f=fixture();assert.throws(()=>f.c.globalFlowSourceRows('orders'),e=>e.code==='ORDERS_FULL_REQUIRED');assert.equal(f.events.length,0);
});
test('Global Flow Orders ensure returns only after real promotion; CP provider stays exact',async()=>{
 const f=fixture();f.state.cp={rows:[{cp:9}]};assert.equal(await f.c.globalFlowEnsure('cp'),true);assert.equal(f.c.globalFlowSourceRows('cp'),f.state.cp.rows);
 const pending=f.c.globalFlowEnsure('orders');await turn();assert.equal(f.fetches,1);f.resolve();assert.equal(await pending,true);assert.equal(f.c.globalFlowSourceRows('orders'),f.state.orders.rows);assert.equal(f.state.orders.rows[0].hiddenModel,0);
});
test('Global Flow failed full gate rejects, waits manual retry, and never returns empty success',async()=>{
 const f=fixture();f.revoke();await assert.rejects(f.c.globalFlowEnsure('orders'),e=>e.code==='ORDERS_FULL_FORBIDDEN');await assert.rejects(f.c.globalFlowEnsure('orders'),e=>e.code==='ORDERS_FULL_FORBIDDEN');assert.equal(f.fetches,0);
});
test('CP thin loader waits before image registry, pricing or schema mutation',async()=>{
 const f=fixture(),pending=f.c.ensureCpLoaded();await turn();assert.equal(f.fetches,1);assert.equal(f.events.some(e=>['registry-apply','pricing','schema'].includes(e[0])),false);assert.equal(f.state.cp,null);
 f.resolve();assert.equal(await pending,true);assert.equal(f.events.filter(e=>e[0]==='pricing').length,1);
});
for(const change of ['source','profile','cp-request'])test('CP loader rejects '+change+' replacement during promotion before publication',async()=>{
 const f=fixture(),pending=f.c.ensureCpLoaded();await turn();
 if(change==='source')f.c.retireOrdersProjectionSource('replace');else if(change==='profile')f.state.currentUser={id:'other'};else f.c.projectionRequestGeneration.cp++;
 f.resolve();assert.equal(await pending,false);assert.equal(f.state.cp,null);assert.equal(f.events.some(e=>['registry-apply','pricing','schema'].includes(e[0])),false);
});
test('CP image registry rechecks the actual caller before mutating globals after its HTTP wait',async()=>{
 const f=fixture({thin:false}),wait=deferred();f.c.fetch=()=>wait.promise;
 const pending=f.c.ensureCpLoaded();await turn();f.c.retireOrdersProjectionSource('replacement');wait.resolve({ok:true,json:async()=>({imagemap:{x:'y'}})});
 assert.equal(await pending,false);assert.equal(f.events.some(e=>e[0]==='registry-apply'),false);assert.equal(f.state.cp,null);
});
test('ordinary full CP loader starts image fetch without added promotion and preserves Orders refs',async()=>{
 const f=fixture({thin:false,active:false}),view=f.state.orders,registryEntered=deferred();let registry=0;f.c.fetch=async()=>{registry++;registryEntered.resolve();return {ok:true,json:async()=>({})};};
 const pending=f.c.ensureCpLoaded();await registryEntered.promise;assert.equal(registry,1);assert.equal(await pending,true);assert.equal(f.fetches,0);assert.equal(f.state.orders,view);
});
test('model-column write waits full before preflight or PATCH, then uses one original PATCH',async()=>{
 const f=fixture();let loads=0,patches=0;f.c.modelConnState={items:[{id:'demo',configRevision:'one'}]};f.c.modelConnLoad=async()=>{loads++;};f.c.fetch=async()=>{patches++;return {ok:true,json:async()=>({ok:true})};};
 const pending=f.c.writeCpModelColumn('demo',{});await turn();assert.equal(loads,0);assert.equal(patches,0);f.resolve();await pending;assert.equal(loads,2);assert.equal(patches,1);
});
test('changed source during model-column preflight cannot issue PATCH',async()=>{
 const f=fixture({thin:false}),wait=deferred();let patches=0;f.c.modelConnState={items:[{id:'demo'}]};f.c.modelConnLoad=()=>wait.promise;f.c.fetch=async()=>{patches++;return {ok:true,json:async()=>({ok:true})};};
 const pending=f.c.writeCpModelColumn('demo',{});f.c.retireOrdersProjectionSource('model-config-replaced');wait.resolve();await assert.rejects(pending,e=>e.code==='ORDERS_FULL_STALE');assert.equal(patches,0);
});
