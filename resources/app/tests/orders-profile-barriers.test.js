'use strict';
// PREPARED ONLY, UNRUN. Real pinned declarations/listeners, no substitute bodies.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const pins=require('./fixtures/orders-config-barriers-pins.json'),ROOT=path.resolve(__dirname,'..');
function read(name){const value=fs.readFileSync(path.join(ROOT,name),'utf8');assert.equal(crypto.createHash('sha256').update(value).digest('hex'),pins.files[name],name+' drift');return value;}
const raw=read('public/app-main.js');read('tests/helpers/app-main-functions.js');
const draft=require('./helpers/orders-profile-listener'),source=raw;
const protectedBaseline=fs.readFileSync(path.join(__dirname,'fixtures/orders-config-protected-baseline.js'),'utf8');
assert.equal(crypto.createHash('sha256').update(protectedBaseline).digest('hex'),pins.protectedBaselineSha256);
const summaryRecipe=require('./fixtures/orders-table-summary/patch-recipe.cjs');
const {extractFunction}=require(path.join(ROOT,'tests/helpers/app-main-functions.js'));
const thin=[{_id:1,'Order Code':'same'}],full=[{_id:1,'Order Code':'same',__CPX_late:7}];
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};}
function error(){return Object.assign(Error('Selection/source changed'),{code:'ORDERS_FULL_STALE'});}
function bind(code,globals,names=[]){const context=vm.createContext({...globals});vm.runInContext(names.map(name=>extractFunction(source,name)).join('\n')+'\n'+code,context);return context;}
function fixture(kind,{isThin=true,page='orders',reject=false}={}){
 const events=[],gate=deferred(),network=deferred(),nodes=new Map();let currentThin=isThin,currentPage=page,rows=isThin?thin:full;
 const select={value:'chosen',isConnected:true,addEventListener(_type,fn){this.handler=fn;}},button={isConnected:true,addEventListener(_type,fn){this.handler=fn;}};
 nodes.set(kind+'Select',select);nodes.set(kind+'DeleteBtn',button);nodes.set(kind+'ResetBtn',button);
 const item={id:'chosen',data:{__page:page,orders:{hidden:[],sorting:{key:'__CPX_late',dir:1}}}},fallback={id:'fallback',data:{__page:page,orders:{hidden:[]}}};
 const store={_revision:2,get items(){events.push('store-read');return [item];}};
 const globals={document:{getElementById:id=>nodes.get(id)||null},window:{syncProfilePicker(){}},appLang:'en',activeProfilePage:()=>currentPage,
  ordersProjectionIsThin:()=>currentThin,ordersFullActionError:error,showToast:message=>events.push('toast:'+message),alert:message=>events.push('alert:'+message),
  confirm:()=>{events.push('confirm');return true;},ensureOrdersFullForAction:async reason=>{events.push('gate:'+reason);if(reject)throw error();await gate.promise;currentThin=false;rows=full;},
  profileItem:(_kind,id)=>{events.push('item:'+id);return id==='fallback'?fallback:item;},
  applyViewState:data=>events.push({apply:'view',data,rows}),applyFilterState:data=>events.push({apply:'filter',data,rows}),rememberProfileUse:()=>events.push('used'),
  pageFavoriteId:(_kind,_page,value)=>value===store?'chosen':'fallback',
  enqueueProfileMutation:(_kind,operation)=>{events.push('enqueue');return operation();},fetchJSON:()=>{events.push('fetch');return network.promise;},
  setProfileStore:()=>{events.push('cache');return {_revision:3,items:[fallback]};},BLStorage:{removeItem:()=>events.push('favorite-remove')},fillProfileSelect:()=>events.push('fill'),
  resetViewToSystemDefault:()=>events.push('reset-view'),resetFiltersToSystemDefault:()=>events.push('reset-filter'),viewStore:store,filterStore:store};
 return {kind,events,gate,network,nodes,select,button,globals,setThin(value){currentThin=value;rows=value?thin:full;},setPage(value){currentPage=value;}};
}
function listen(f,id,event){bind(draft.handler(source,id,event),f.globals);return f.nodes.get(id).handler;}
for(const kind of ['view','filter']){
 test(kind+' actual select waits before profile capture/apply/use and then reads full rows',async()=>{
  const f=fixture(kind),handler=listen(f,kind+'Select','change'),pending=handler({target:f.select}),before=f.events.filter(e=>typeof e!=='string'||!e.startsWith('gate:'));
  f.gate.resolve();await pending;assert.deepEqual(before,[]);assert.equal(f.events.find(e=>e&&e.apply)?.rows,full);assert.equal(f.events.at(-1),'used');
 });
 test(kind+' actual full select body still captures/applies synchronously without a full request',async()=>{
  const f=fixture(kind,{isThin:false}),handler=listen(f,kind+'Select','change'),pending=handler({target:f.select});
  assert.equal(f.events[0],'item:chosen');assert.equal(f.events.at(-1),'used');assert.equal(f.events.some(e=>typeof e==='string'&&e.startsWith('gate:')),false);await pending;
 });
 test(kind+' newly async actual select catches synchronous body failure visibly',async()=>{
  const f=fixture(kind,{isThin:false});f.globals[kind==='view'?'applyViewState':'applyFilterState']=()=>{throw Error('bad saved profile');};
  const handler=listen(f,kind+'Select','change');await assert.doesNotReject(async()=>handler({target:f.select}));assert.ok(f.events.includes('toast:bad saved profile'));assert.equal(f.events.includes('used'),false);
 });
 test(kind+' actual select rejection makes no profile read/apply/use',async()=>{
  const f=fixture(kind,{reject:true}),handler=listen(f,kind+'Select','change');await handler({target:f.select});
  assert.equal(f.events.some(e=>typeof e==='object'||String(e).startsWith('item:')||e==='used'),false);assert.equal(f.events.some(e=>String(e).startsWith('toast:')),true);
 });
 for(const stale of ['selection','page','node'])test(kind+' actual select rechecks '+stale+' after its thin wait',async()=>{
  const f=fixture(kind),handler=listen(f,kind+'Select','change'),pending=handler({target:f.select});
  if(stale==='selection')f.select.value='other';else if(stale==='page')f.setPage('cp');else f.nodes.set(kind+'Select',{value:'chosen',isConnected:true});
  f.gate.resolve();await pending;assert.equal(f.events.some(e=>typeof e==='object'||String(e).startsWith('item:')||e==='used'),false);assert.equal(f.events.some(e=>String(e).startsWith('toast:')),true);
 });
 test(kind+' actual CP-active legacy profile still promotes a loaded Orders thin snapshot',async()=>{
  const f=fixture(kind,{page:'cp'});f.globals.profileItem=(_kind,id)=>{f.events.push('item:'+id);return {id,data:{orders:{hidden:[]}}};};
  const handler=listen(f,kind+'Select','change'),pending=handler({target:f.select}),before=f.events.find(e=>e&&e.apply);
  f.gate.resolve();await pending;assert.equal(before,undefined);const applied=f.events.find(e=>e&&e.apply);assert.equal(applied?.rows,full);assert.equal(Object.hasOwn(applied.data,'__page'),false);
 });
 test(kind+' actual delete waits before membership capture/confirmation/request/cache/fallback',async()=>{
  const f=fixture(kind),handler=listen(f,kind+'DeleteBtn','click'),pending=handler(),before=f.events.filter(e=>typeof e!=='string'||!e.startsWith('gate:'));
  f.gate.resolve();await turn();f.network.resolve({});await pending;assert.deepEqual(before,[]);assert.equal(f.events.find(e=>e&&e.apply)?.rows,full);assert.ok(f.events.includes('favorite-remove'));
 });
 test(kind+' actual full delete retains its existing synchronous confirmation and request start',async()=>{
  const f=fixture(kind,{isThin:false}),handler=listen(f,kind+'DeleteBtn','click'),pending=handler();
  assert.ok(f.events.includes('store-read'));assert.ok(f.events.includes('confirm'));assert.ok(f.events.includes('fetch'));assert.equal(f.events.some(e=>String(e).startsWith('gate:')),false);
  f.network.resolve({});await pending;
 });
 test(kind+' actual delete first-gate rejection sends no request and changes no favorite/cache',async()=>{
  const f=fixture(kind,{reject:true}),handler=listen(f,kind+'DeleteBtn','click');f.network.resolve({});await handler();
  for(const unwanted of ['store-read','confirm','enqueue','fetch','cache','favorite-remove','fill'])assert.equal(f.events.includes(unwanted),false,unwanted);
 });
 test(kind+' actual delete result rechecks replacement thin snapshot before first local preference mutation',async()=>{
  const f=fixture(kind,{isThin:false}),handler=listen(f,kind+'DeleteBtn','click'),pending=handler();f.setThin(true);f.network.resolve({});await turn();
  const before=f.events.slice();f.gate.resolve();await pending;assert.equal(before.includes('fetch'),true);assert.equal(before.includes('cache'),false);assert.equal(before.includes('favorite-remove'),false);
  assert.equal(f.events.find(e=>e&&e.apply)?.rows,full);
 });
 test(kind+' actual delete revalidates selected target after thin wait, before destructive request',async()=>{
  const f=fixture(kind),handler=listen(f,kind+'DeleteBtn','click'),pending=handler();f.select.value='other';f.gate.resolve();f.network.resolve({});await pending;
  assert.equal(f.events.includes('fetch'),false);assert.equal(f.events.includes('store-read'),false);assert.equal(f.events.includes('confirm'),false);
 });
 test(kind+' actual queued delete gates a thin replacement before request/revision capture',async()=>{
  const f=fixture(kind,{isThin:false}),queue=deferred();f.globals.enqueueProfileMutation=(_kind,operation)=>{f.events.push('enqueue');return queue.promise.then(operation);};
  const handler=listen(f,kind+'DeleteBtn','click'),pending=handler();f.setThin(true);queue.resolve();await turn();const before=f.events.slice();f.gate.resolve();await turn();f.network.resolve({});await pending;
  assert.equal(before.includes('fetch'),false);assert.equal(before.includes('cache'),false);assert.equal(f.events.includes('fetch'),true);assert.equal(f.events.find(e=>e&&e.apply)?.rows,full);
 });
}
function resetCode(kind){const prefix="document.getElementById('"+kind+"ResetBtn')?.addEventListener('click',",at=source.indexOf(prefix);assert.ok(at>=0);const tail=source.slice(at);return tail.startsWith(prefix+'reset')?tail.slice(0,tail.indexOf('\n')):tail.slice(0,tail.indexOf('\n});')+4);}
for(const kind of ['view','filter'])for(const isThin of [true,false])test(kind+' actual reset listener '+(isThin?'waits before the real reset body':'runs the real reset body synchronously'),async()=>{
 const f=fixture(kind,{isThin}),state={freeze:{orders:{left:1}},orders:{rows:isThin?thin:full},ordersSort:{key:'__CPX_late',dir:-1},colFilters:{orders:{__CPX_late:{values:new Set([7])}}},checkFilter:{orders:'checked'},ordersQuickActive:new Set(['Active'])};
 const cols=[{k:'Order Code'},{k:'__CPX_late'}],colmgr={orders:{order:['Order Code','__CPX_late'],hidden:new Set(['__CPX_late']),widthPx:{}}};
 f.globals={...f.globals,state,colmgr,COLS_BY_TABLE:{orders:cols},isProfilePage:()=>true,viewContextGeneration:0,ordersDimFilters:{},window:{BLTableDensity:{set:()=>f.events.push('density')}},
  forgetPersistedTableColumnState:()=>f.events.push('forget'),tableImageSizeDimensions:()=>({col:50}),tableImageSizeCurrentValue:()=>1,saveAutoTableColumnState:()=>f.events.push('save-columns'),
  saveFreezeState:()=>f.events.push('save-freeze'),clearProfileSelection:()=>f.events.push('clear-profile'),renderOrders:()=>f.events.push('render-orders'),syncFreezeButtonState(){},
  activeTableInfo:()=>({filterIds:[],rerender:()=>f.events.push('render-filter')}),saveOrdersDimFilters:()=>f.events.push('save-dim'),updateOrdersDimBtnLabels(){},saveCoreAutoFilterState:()=>f.events.push('save-filter')};
 bind(resetCode(kind),f.globals,['initColState','resetViewToSystemDefault','resetFiltersToSystemDefault']);const pending=f.button.handler({currentTarget:f.button}),before={hidden:colmgr.orders.hidden.has('__CPX_late'),sort:state.ordersSort.key,filter:Object.hasOwn(state.colFilters.orders,'__CPX_late'),events:f.events.filter(e=>!String(e).startsWith('gate:'))};
 f.gate.resolve();await pending;
 if(isThin){assert.deepEqual(before.events,[]);assert.equal(before.hidden,true);assert.equal(before.sort,'__CPX_late');assert.equal(before.filter,true);}
 else assert.ok(before.events.length>0,'existing full reset body must execute before the listener returns');
 if(kind==='view'){assert.equal(colmgr.orders.hidden.size,0);assert.equal(state.ordersSort.key,null);}else assert.equal(Object.keys(state.colFilters.orders).length,0);
});
for(const kind of ['view','filter']){
 test(kind+' actual reset rejection never runs reset body',async()=>{
  const f=fixture(kind,{reject:true});bind(resetCode(kind),f.globals);await f.button.handler({currentTarget:f.button});assert.equal(f.events.includes('reset-'+kind),false);assert.equal(f.events.some(e=>String(e).startsWith('toast:')),true);
 });
 test(kind+' newly async actual reset catches body failure visibly without a rejected event promise',async()=>{
  const f=fixture(kind,{isThin:false});f.globals[kind==='view'?'resetViewToSystemDefault':'resetFiltersToSystemDefault']=()=>{throw Error('bad reset');};bind(resetCode(kind),f.globals);
  await assert.doesNotReject(async()=>f.button.handler({currentTarget:f.button}));assert.ok(f.events.includes('toast:bad reset'));
 });
}
function profileEntry(overrides={}){let page='orders',isThin=true;const gate=deferred(),events=[],globals={profileApplyGeneration:0,activeProfilePage:()=>page,isProfilePage:()=>true,ordersProjectionIsThin:()=>isThin,
 ordersFullActionError:error,ensureOrdersFullForAction:async()=>{events.push('gate');await gate.promise;isThin=false;},applyCachedProfilesForCurrentPage:()=>events.push('cached'),refreshViewSelect:async()=>events.push('view-fetch'),refreshFilterSelect:async()=>events.push('filter-fetch'),applyStoredProfilesForCurrentPage:()=>events.push('stored'),...overrides};
 const context=bind('globalThis.run=applyProfilesForCurrentPage;',globals,['applyProfilesForCurrentPage']);return {run:context.run,gate,events,setThin:value=>{isThin=value;},setPage:value=>{page=value;}};}
test('actual profile entry gates cached application and its network side effects',async()=>{
 const f=profileEntry(),pending=f.run(true),before=f.events.filter(e=>e!=='gate');f.gate.resolve();await pending;assert.deepEqual(before,[]);assert.equal(f.events.at(-1),'stored');
});
test('actual profile entry rechecks replacement thin after remote waits',async()=>{
 const network=deferred(),gate=deferred(),events=[];let isThin=false,calls=0;
 const f=profileEntry({ordersProjectionIsThin:()=>isThin,refreshViewSelect:()=>network.promise,applyCachedProfilesForCurrentPage:()=>events.push('cached'),applyStoredProfilesForCurrentPage:()=>events.push('stored'),ensureOrdersFullForAction:async()=>{calls++;await gate.promise;isThin=false;}});
 const pending=f.run(true);isThin=true;network.resolve();await turn();const before=events.slice();gate.resolve();await pending;assert.equal(before.includes('stored'),false);assert.equal(calls,1);assert.equal(events.at(-1),'stored');
});
test('actual full profile entry keeps cached body immediate, no new await or full request',async()=>{
 const f=profileEntry();f.setThin(false);const pending=f.run(true);assert.equal(f.events[0],'cached');await pending;assert.equal(f.events.includes('gate'),false);
});
test('actual profile entry rejects before cached/network side effects when the gate fails',async()=>{
 const f=profileEntry({ensureOrdersFullForAction:async()=>{throw error();}});await assert.rejects(f.run(true),/Selection\/source changed/);assert.deepEqual(f.events,[]);
});
test('actual remote profile gate rejects and does not apply newly arrived stored profiles',async()=>{
 const events=[];let isThin=false;const f=profileEntry({ordersProjectionIsThin:()=>isThin,refreshViewSelect:async()=>{isThin=true;},ensureOrdersFullForAction:async()=>{throw error();},applyCachedProfilesForCurrentPage:()=>events.push('cached'),applyStoredProfilesForCurrentPage:()=>events.push('stored')});
 await assert.rejects(f.run(true),/Selection\/source changed/);assert.deepEqual(events,['cached']);
});
test('actual profile entry repeats its existing page cancellation after the new await',async()=>{
 const f=profileEntry(),pending=f.run(true);f.setPage('cp');f.gate.resolve();await pending;assert.equal(f.events.includes('cached'),false);
});

function bootstrap(isThin){
 const events=[],warnings=[],gate=deferred();let thinState=isThin,page='overview';
 const state={cp:{rows:[]},orders:{rows:isThin?thin:full},storeRevisions:{},currentUser:{id:'demo'},ordersLogisticExpanded:new Set(),cpLogisticExpanded:new Set()};
 const globals={state,window:{BL_USER_CONTEXT:{id:'demo'}},document:{getElementById:()=>null},appLang:'en',authHydrationPromise:null,CP_NOTE_COLUMN_DEFS_REVISION:0,CP_NOTE_COLUMN_DEFS:[],_deferredTabRenders:new Set(),undoStack:[],redoStack:[],
  currentActiveTab:()=>page,activeProfilePage:()=>page,ordersProjectionIsThin:()=>thinState,ordersFullActionError:error,ensureOrdersFullForAction:async()=>{events.push('gate');await gate.promise;thinState=false;state.orders={rows:full};},
  fetch:async()=>({ok:true,json:async()=>({})}),cpClientWorkInProgress:()=>false,normalizeTransitRules:value=>value||[],normalizeNonDtrManufacturers:value=>value||[],normalizeKolLandedMultipliers:value=>value||{},cloneMatchConfig:value=>value,
  applyCachedProfilesForCurrentPage:value=>events.push({cached:value,rows:state.orders.rows}),renderStartupActiveModule:()=>{events.push('startup-render');return 'overview';},console:{warn:(...args)=>warnings.push(args)},refreshDiagnosisText:()=>''};
 for(const name of ['setServerStatus','updSourceHint','showToast','reviveServerDates','hideSourceFilterRequiredNotice','syncModelImageRegistry','renderAntrepoSourceControl','renderAsasSourceControl','renderLflSourceControl','applyLicensorMerges','applyIncomingPricingRules','saveLocalTransitRules','invalidateUnifiedPriorityDecisions','saveLocalNonDtrManufacturers','renderHorizonBadges','applyPricingRulesToLoadedRows','setWarnings','buildCPFilters','buildOrdersFilters','applyCoreAutoFilterState','refreshSubmfrList','refreshLicenseList','refreshLicensorList'])globals[name]=()=>{};
 const context=bind('globalThis.run=loadFromServer;',globals,['loadFromServer']);return {run:context.run,context,events,warnings,gate,setPage:value=>{page=value;}};
}
test('whole actual loadFromServer direct cached call waits and captures the hydrated full row reference',async()=>{
 const f=bootstrap(true),pending=f.run(false);await turn();const before=f.events.slice();f.gate.resolve();const result=await pending;
 assert.equal(result,true,JSON.stringify(f.warnings));assert.equal(before.some(e=>e&&typeof e==='object'&&'cached' in e),false);assert.equal(before.includes('startup-render'),false);assert.equal(f.events.find(e=>e&&typeof e==='object'&&'cached' in e)?.rows,full);
});
test('whole actual loadFromServer full path performs no extra full request and keeps the cached call',async()=>{
 const f=bootstrap(false);assert.equal(await f.run(false),true,JSON.stringify(f.warnings));assert.equal(f.events.includes('gate'),false);assert.equal(f.events.filter(e=>e&&typeof e==='object'&&'cached' in e).length,1);
});
test('whole actual loadFromServer revalidates its cached target after a thin wait',async()=>{
 const f=bootstrap(true),pending=f.run(false);await turn();f.setPage('cp');f.gate.resolve();assert.equal(await pending,false);assert.equal(f.events.some(e=>e&&typeof e==='object'&&'cached' in e),false);assert.equal(f.events.includes('startup-render'),false);
});
test('whole actual loadFromServer gate rejection uses its existing catch and never invokes cached apply/render',async()=>{
 const f=bootstrap(true);f.context.ensureOrdersFullForAction=async()=>{throw error();};assert.equal(await f.run(false),false);assert.equal(f.events.some(e=>e&&typeof e==='object'&&'cached' in e),false);assert.equal(f.events.includes('startup-render'),false);assert.equal(f.warnings.length,1);
});
test('draft preserves synchronous APIs and protected consumer function bodies exactly',()=>{
 for(const name of ['applyViewState','applyFilterState','resetViewToSystemDefault','resetFiltersToSystemDefault','ensureCpLoaded','registerManagedGridClipboard'])assert.equal(extractFunction(source,name),extractFunction(protectedBaseline,name),name);
 const section=(text,start,end)=>{const at=text.indexOf(start),stop=text.indexOf(end,at);assert.ok(at>=0&&stop>at);return text.slice(at,stop);};
 assert.equal(section(source,'window.BLFormulaRows = {','\n};'),section(protectedBaseline,'window.BLFormulaRows = {','\n};'));
 const expected=summaryRecipe.app(protectedBaseline);
 assert.equal(expected.replace(summaryRecipe.summary,''),protectedBaseline,'the separately reviewed counts adapter is the only allowed addition');
 assert.equal(section(source,'window.BLAIScreenData = {','\n};'),section(expected,'window.BLAIScreenData = {','\n};'));
});
