'use strict';
// UNRUN. Default: actual pinned production functions (expected RED cases).
// BL6A_CONFIG_DRAFT=1: same actual bodies plus exact draft seam insertions.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const pins=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/orders-config-barriers-pins.json'),'utf8'));
function read(name){const text=fs.readFileSync(path.join(ROOT,name),'utf8');assert.equal(crypto.createHash('sha256').update(text).digest('hex'),pins.files[name],name+' source drift');return text;}
const rawApp=read('public/app-main.js'),rawStorage=read('public/user-storage.js'),formula=read('public/formula-columns.js'),engineSource=read('public/formula-engine.js');
const app=rawApp,storage=rawStorage;
read('tests/helpers/app-main-functions.js');
const {extractFunction}=require(path.join(ROOT,'tests/helpers/app-main-functions.js'));
const {installLifecycle}=require('./helpers/orders-retirement-source');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});promise.catch(()=>{});return {promise,resolve,reject};}
function load(names,globals){const context=vm.createContext({...globals});installLifecycle(context);vm.runInContext(names.map(name=>extractFunction(app,name)).join('\n')+'\nglobalThis.api={'+names.join(',')+'};',context);return {api:context.api,context};}
function nativeStore(values=new Map()){return {values,get length(){return values.size;},key:index=>[...values.keys()][index]??null,getItem:key=>values.has(String(key))?values.get(String(key)):null,setItem:(key,value)=>values.set(String(key),String(value)),removeItem:key=>values.delete(String(key)),clear:()=>values.clear()};}
function bootStorage(fetch,initial){const native=nativeStore(new Map(initial||[])),window={localStorage:native,BL_USER_CONTEXT:{id:'demo'}};vm.runInNewContext(storage,{window,fetch});return {api:window.BLStorage,native,window};}
const FORMULA_KEY='bl.formulaColumns.orders.v1',FILTER_KEY='lcw.corePageFilters.auto.v1',VIEW_KEY='lcw.tableViewFocus.v1',personal=key=>'bl.user.demo.'+key;
const oldFormula='[{"id":"x","label":"X","formula":"1"}]',newFormula='[{"id":"x","label":"X","formula":"[__CPX_late] + 1"}]';
function remote(){return {entries:{[FORMULA_KEY]:{value:newFormula,updatedAt:'2026-11-08T00:00:00Z'}},deletions:{[FILTER_KEY]:'2026-11-08T00:00:00Z'},roleDefaults:{[VIEW_KEY]:{value:'{"orders":{"allHidden":[]}}'}}};}

test('actual hydrate waits at response-apply seam before formula write, deletion, role defaults and sync metadata',async()=>{
 const gate=deferred(),fixture=bootStorage(async()=>({ok:true,json:async()=>remote()}),[[personal(FORMULA_KEY),oldFormula],[personal(FILTER_KEY),'old filter']]);let calls=0;
 const pending=fixture.api.hydrate({beforeApply:()=>{calls++;return gate.promise;}});await turn();
 const before={formula:fixture.api.getItem(FORMULA_KEY),filter:fixture.api.getItem(FILTER_KEY),role:fixture.api.getItem(VIEW_KEY),meta:fixture.native.getItem('bl.user.demo.__syncMeta.v1')};
 gate.resolve();const result=await pending;
 assert.equal(before.formula,oldFormula);assert.equal(before.filter,'old filter');assert.equal(before.role,null);assert.equal(before.meta,null);assert.equal(calls,1);
 assert.equal(fixture.api.getItem(FORMULA_KEY),newFormula);assert.equal(fixture.api.getItem(FILTER_KEY),null);assert.equal(result.applied,1);
});
test('actual hydrate barrier rejection propagates and leaves original preferences intact',async()=>{
 const fixture=bootStorage(async()=>({ok:true,json:async()=>remote()}),[[personal(FORMULA_KEY),oldFormula],[personal(FILTER_KEY),'old filter']]);
 await assert.rejects(fixture.api.hydrate({beforeApply:async()=>{throw Error('stale-full');}}),/stale-full/);
 assert.equal(fixture.api.getItem(FORMULA_KEY),oldFormula);assert.equal(fixture.api.getItem(FILTER_KEY),'old filter');assert.equal(fixture.api.getItem(VIEW_KEY),null);
});
test('actual hydrate keeps existing optional/no-hook behavior and network-failure return',async()=>{
 const fixture=bootStorage(async()=>({ok:true,json:async()=>remote()}));assert.equal((await fixture.api.hydrate()).applied,1);
 const offline=bootStorage(async()=>{throw Error('offline');});assert.equal(JSON.stringify(await offline.api.hydrate()),'{"applied":0,"pushed":0}');
});
test('actual app hydration checks the live thin state after the HTTP response, including a thin snapshot installed in flight',async()=>{
 const network=deferred(),gate=deferred(),fixture=bootStorage(()=>network.promise,[[personal(FORMULA_KEY),oldFormula]]);let thin=false,calls=0,renders=0;
 const window={BLStorage:fixture.api,BLOverviewHome:{reload(){}},BLPerf:{mark(){}}};
 const {api}=load(['hydrateUserPreferencesAfterUi'],{window,BLStorage:fixture.api,authHydrationPromise:null,ordersProjectionIsThin:()=>thin,
  ensureOrdersFullForAction:async()=>{calls++;await gate.promise;thin=false;},refreshPersonalOrderNoteColumns(){},coreFilterAutoReady:true,applyCoreAutoFilterState(){},
  state:{orders:{rows:[]},cp:null},renderOrders(){renders++;},renderCP(){},renderOverview(){},console:{warn(){}}});
 const pending=api.hydrateUserPreferencesAfterUi();await turn();thin=true;network.resolve({ok:true,json:async()=>remote()});await turn();
 const before={value:fixture.api.getItem(FORMULA_KEY),renders,calls};gate.resolve();await pending;
 assert.equal(before.value,oldFormula);assert.equal(before.renders,0);assert.equal(before.calls,1);assert.equal(renders,1);assert.equal(fixture.api.getItem(FORMULA_KEY),newFormula);
});
function profiles(overrides={}){let thin=true,page='orders';const gate=deferred(),events=[];
 const loaded=load(['applyProfilesForCurrentPage'],{profileApplyGeneration:0,activeProfilePage:()=>page,isProfilePage:()=>true,ordersProjectionIsThin:()=>thin,
  ensureOrdersFullForAction:async reason=>{events.push('gate:'+reason);await gate.promise;thin=false;},applyCachedProfilesForCurrentPage:()=>events.push('cached'),
  refreshViewSelect:async()=>events.push('view-fetch'),refreshFilterSelect:async()=>events.push('filter-fetch'),applyStoredProfilesForCurrentPage:()=>events.push('stored'),...overrides});
 return {...loaded,gate,events,setThin:value=>{thin=value;},setPage:value=>{page=value;}};
}
test('actual applyProfiles waits before cached profile state or downstream fetch side effects',async()=>{
 const f=profiles(),pending=f.api.applyProfilesForCurrentPage(true),before=f.events.filter(value=>!value.startsWith('gate:'));f.gate.resolve();await pending;
 assert.deepEqual(before,[]);assert.ok(f.events.indexOf('cached')<f.events.indexOf('view-fetch'));assert.equal(f.events.at(-1),'stored');
});
test('actual applyProfiles rejects before cache/render/network when full promotion fails',async()=>{
 const events=[],f=profiles({ensureOrdersFullForAction:async()=>{throw Error('stale-full');},applyCachedProfilesForCurrentPage:()=>events.push('cached'),refreshViewSelect:async()=>events.push('fetch')});
 await assert.rejects(f.api.applyProfilesForCurrentPage(true),/stale-full/);assert.deepEqual(events,[]);
});
test('actual applyProfiles rechecks after remote waits when a replacement thin snapshot arrives',async()=>{
 const remoteGate=deferred(),fullGate=deferred(),events=[];let thin=false,calls=0;
 const f=profiles({ordersProjectionIsThin:()=>thin,ensureOrdersFullForAction:async()=>{calls++;await fullGate.promise;thin=false;},
  applyCachedProfilesForCurrentPage:()=>events.push('cached'),refreshViewSelect:()=>remoteGate.promise,refreshFilterSelect:async()=>events.push('filter-fetch'),applyStoredProfilesForCurrentPage:()=>events.push('stored')});
 const pending=f.api.applyProfilesForCurrentPage(true);thin=true;remoteGate.resolve();await turn();const before=events.slice();fullGate.resolve();await pending;
 assert.equal(before.includes('stored'),false);assert.equal(calls,1);assert.equal(events.at(-1),'stored');
});
test('actual full profile path keeps the cached-body synchronous and performs no full request',async()=>{
 const f=profiles();f.setThin(false);const pending=f.api.applyProfilesForCurrentPage(true);assert.equal(f.events[0],'cached');await pending;assert.equal(f.events.some(value=>value.startsWith('gate:')),false);
});
test('actual profile entry reuses existing page/generation cancellation before applying cached state after await',async()=>{
 const f=profiles(),pending=f.api.applyProfilesForCurrentPage(true);f.setPage('cp');f.gate.resolve();await pending;assert.equal(f.events.includes('cached'),false);
});

function formulaFixture(rows){
 const values=new Map(),window={document:{readyState:'loading',addEventListener(){}},COLS_BY_TABLE:{orders:[{k:'Order Code',label:'Order Code'},{k:'__CPX_late',label:'Late model',modelCustom:true}]},
  colmgr:{orders:{order:['Order Code','__CPX_late'],hidden:new Set(['__CPX_late']),widthPx:{}}},BLFormulaRows:{orders:()=>rows},tableColumnLabel:(_table,col)=>col.label,
  BLStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))}};
 const context=vm.createContext({window,document:window.document,BLStorage:window.BLStorage,appLang:'en'});vm.runInContext(engineSource,context);window.BLFormulaEngine=context.BLFormulaEngine;
 vm.runInContext(formula,context);return {api:window.BLFormulaColumns,window};
}
test('diagnostic: actual synchronous late formula save/sync/refresh cannot await a missing model field',()=>{
 const rows=[{'Order Code':'same'}],f=formulaFixture(rows);
 assert.equal(f.api.save('orders',[{id:'late',label:'Derived',formula:'[__CPX_late] + 1'}]),undefined);
 const columns=f.api.syncColumns('orders');assert.ok(Array.isArray(columns));assert.equal(typeof columns.then,'undefined');
 const result=f.api.refresh('orders',rows);assert.equal(typeof result.then,'undefined');assert.equal(rows[0].__f_late,null);assert.ok(result.errors.late);
 // This documents the blocker; a passing diagnostic does NOT admit thin data.
});
test('actual full formula calculation and legacy own-field-over-model-alias semantics remain unchanged',()=>{
 const rows=[{'Order Code':'same','Late model':7,__CPX_late:999}],f=formulaFixture(rows);
 f.api.save('orders',[{id:'late',label:'Derived',formula:'[Late model] + 1'}]);f.api.syncColumns('orders');const result=f.api.refresh('orders',rows);
 assert.equal(f.api.definitions('orders')[0].formula,'[Late model] + 1');assert.equal(rows[0].__f_late,8);assert.equal(Object.keys(result.errors).length,0);
 assert.equal(f.window.BLFormulaRows.orders(),rows);assert.equal(typeof f.window.BLFormulaRows.orders().then,'undefined');
});
