'use strict';
// Isolated source-execution checks, not a production thin protocol or UI test.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=path.resolve(__dirname,'../../../../resources/app');
const source=fs.readFileSync(path.join(app,'public/app-main.js'),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);};
const json=value=>JSON.parse(JSON.stringify(value));
const unsafe=process.env.ORDERS_SCREEN_UNSAFE==='1';
function candidate(row){
  const copy={...row};delete copy.Priority;delete copy._canEdit;
  if(unsafe)for(const key of ['_logisticSegments','__CPX_demo','__note_demo','__canonical'])delete copy[key];
  return copy;
}
function row(){return {_id:7,'Order Code':'DEMO-7','Model Name':'Model 7','C.Code':'007',
  Priority:'',_canEdit:false,License:'STALE',Licensor:'STALE',STATUS:'In production',
  __canonical:{license:'ORBIT',licensor:'DEMO'},'Order Quantity':0,Notes:'',NotesHtml:'<b>demo</b>',
  __CPX_demo:12,__note_demo:'dynamic note',empty:'',zero:0,no:false,nil:null,
  _logisticSegments:[{kind:'partial',status:'Delivered',quantity:8,priority:1},{kind:'production',status:'In production',quantity:2,priority:2}]};}
async function load(rows){
  const cp={rows:[{_id:9}]},context={
    state:{orders:null,cp,ordersLogisticExpanded:new Set([7])},ordersLoadPromise:null,
    window:{},appLang:'en',backgroundWarmupUnrendered:new Set(),currentActiveTab:()=> 'orders',
    fetchOrdersProjection:async()=>({payload:{rows,collectionCatalogs:{}}}),
    reviveServerDates(){},setOrdersLoadingState(){},invalidateUnifiedPriorityDecisions(){},
    applyPricingRulesToLoadedRows(){},applyCoreAutoFilterState(){},renderOrders(){},
    fillSelect(){},uniqueVals:(list,key)=>[...new Set(list.map(r=>r[key]))],localizeDelTypeSelect(){},
    showToast:message=>assert.fail(message),ensureCollectionCatalogLoaded:()=>assert.fail('catalog supplied')
  };
  vm.createContext(context);
  vm.runInContext(between('function buildOrdersFilters(){','// ================= CAPRAZ FILTRE'),context);
  vm.runInContext(between('async function ensureOrdersLoaded(', 'window.BLEnsureOrdersLoaded='),context);
  assert.equal(await context.ensureOrdersLoaded(),true);assert.equal(context.state.cp,cp);
  return context.state.orders.rows;
}
test('real loader and filter cleanup keep all row values for constant omissions (pricing/UI stubbed)',async()=>{
  const full=await load([row()]),screen=await load([candidate(row())]);
  assert.deepEqual(json(screen),json(full));assert.equal(screen[0]._canEdit,false);
  for(const key of ['empty','zero','no','nil'])assert.equal(screen[0][key],row()[key]);
  assert.equal(Object.hasOwn(screen[0],'missing'),false);
});
test('initial Orders status/clipboard summary requires logistic segments',()=>{
  const context={norm:v=>String(v??'').trim(),turknorm:v=>String(v).toUpperCase(),
    toNum:v=>Number(v),statusDisplay:v=>v,fmtInt:v=>String(v)};
  vm.createContext(context);
  vm.runInContext(between('function cpLogisticSegments(row)', 'function cpLogisticHasDetails(row)'),context);
  vm.runInContext(between('function cpLogisticStatusGroups(row)', 'function cpLogisticArrivalPlainText(row)'),context);
  const full=row(),thin=candidate(full);
  assert.equal(context.cpLogisticStatusPlainText(thin),context.cpLogisticStatusPlainText(full));
  const missing={...full};delete missing._logisticSegments;
  assert.notEqual(context.cpLogisticStatusPlainText(missing),context.cpLogisticStatusPlainText(full));
});
test('actual formula engine preserves dynamic source and note inputs',()=>{
  const engine=require(path.join(app,'public/formula-engine'));
  const formula=engine.compile('[__CPX_demo] * 2');assert.equal(formula.ok,true);
  const full=row(),thin=candidate(full);
  assert.deepEqual(formula.evaluate(thin,{strictColumns:true}),formula.evaluate(full,{strictColumns:true}));
  assert.equal(thin.__note_demo,full.__note_demo);
});
test('selected visible Orders feed the actual atlas engine with canonical precedence',()=>{
  const atlas=require(path.join(app,'public/order-license-atlas-engine'));
  const canonical=require(path.join(app,'public/canonical-fields'));
  const full=row(),thin=candidate(full),context={state:{ordersSelected:new Set([7]),cpSelected:new Set()},filteredOrders:()=>[thin]};
  vm.createContext(context);
  vm.runInContext(between('function selectedEndeksmatikRows(mode)', 'function selectedEndeksmatikOrder(mode)'),context);
  const selected=context.selectedEndeksmatikRows('orders');assert.equal(selected.length,1);
  const cards=[{id:'demo',license:'ORBIT',licensor:'DEMO'}];
  assert.deepEqual(atlas.match(selected,'orders',cards),atlas.match([full],'orders',cards));
  assert.equal(canonical.canonicalValue(thin,'orders','license'),'ORBIT');
});
test('real projection response parser rejects denied/malformed responses and cancels old generation',async()=>{
  const context={projectionRequestGeneration:{orders:2},performance,window:{},location:{}};
  vm.createContext(context);
  vm.runInContext(between('async function parseProjectionResponse(', 'async function fetchProjectionWithFallback('),context);
  for(const code of ['AREA_FORBIDDEN','SOURCE_FILTER_REQUIRED','COMPUTE_STALE_GENERATION']){
    await assert.rejects(context.parseProjectionResponse('orders',2,{ok:false,statusText:'denied',json:async()=>({code})}),error=>error.code===code);
  }
  assert.equal((await context.parseProjectionResponse('orders',1,{ok:true,json:async()=>({rows:[row()]})})).cancelled,true);
  await assert.rejects(context.parseProjectionResponse('orders',2,{ok:true,json:async()=>{throw SyntaxError('bad JSON');}}),/bad JSON/);
});
test('non-enumerable source bindings are not claimed to survive JSON copies',()=>{
  const original=row(),sourceOrder={synthetic:true};
  Object.defineProperty(original,'__sourceOrder',{value:sourceOrder,enumerable:false});
  assert.equal(original.__sourceOrder,sourceOrder);
  assert.equal(json(original).__sourceOrder,undefined);
  // Rejected screen uses the existing serialized wire baseline, never claims
  // that an in-memory canonical/source binding can be reconstructed this way.
  assert.notEqual(original,json(original));
});
