'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const source=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
function fixture(options={}){
  const state={orders:options.orders===undefined?{rows:[{_id:0,'Order Code':7}]}:options.orders};
  const controllers=new WeakMap();let loads=0,allowed=true;
  const window={BLCanAccessArea:()=>allowed};
  const globals={state,window,appLang:'en',_ordersFullViewControllers:controllers,
    ensureOrdersLoaded:async()=>{loads++;return options.load?options.load(state):false;}};
  const context=vm.createContext(globals);
  vm.runInContext(['ordersProjectionIsThin','ordersFullActionError','ensureOrdersFullForAction'].map(name=>extractFunction(source,name)).join('\n'),context);
  return {state,controllers,context,run:reason=>context.ensureOrdersFullForAction(reason),loads:()=>loads,deny:()=>{allowed=false;}};
}
test('ordinary full source preserves exact row identity without loading or a controller',async()=>{
  const f=fixture(),rows=f.state.orders.rows;assert.equal(await f.run('export'),rows);assert.equal(f.loads(),0);assert.equal(f.context.ordersProjectionIsThin(),false);
});
test('empty full source is authoritative and is not refetched',async()=>{
  const rows=[],f=fixture({orders:{rows}});assert.equal(await f.run(),rows);assert.equal(f.loads(),0);
});
test('unloaded Orders waits for its loader and returns the published full source',async()=>{
  const rows=[{_id:0}],f=fixture({orders:null,load:state=>{state.orders={rows};return true;}});
  assert.equal(await f.run(),rows);assert.equal(f.loads(),1);
});
test('failed or malformed load cannot pass the full-data gate',async()=>{
  for(const load of [()=>false,state=>{state.orders={rows:null};return true;}]){
    const f=fixture({orders:null,load});await assert.rejects(f.run(),e=>e.code==='ORDERS_FULL_LOAD_FAILED');
  }
});
test('revoked Orders access fails closed even with previously loaded full data',async()=>{
  const f=fixture(),before=f.state.orders;f.deny();await assert.rejects(f.run(),e=>e.code==='ORDERS_FULL_FORBIDDEN');assert.equal(f.state.orders,before);assert.equal(f.loads(),0);
});
test('an unrecognized thin marker is never treated as full or silently published',async()=>{
  const f=fixture({orders:{projectionProfile:'thin',rows:[{_id:0}]}}),before=f.state.orders;
  assert.equal(f.context.ordersProjectionIsThin(),true);await assert.rejects(f.run(),e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.state.orders,before);
});
test('private controller must publish full rows and validate its receipt before use',async()=>{
  const f=fixture(),thin=f.state.orders,fullRows=[{_id:0,complete:true}];let checked=0;
  f.controllers.set(thin,{ensure:async()=>{f.state.orders={rows:fullRows};return {rows:fullRows,assertCurrent(){checked++;}};}});
  assert.equal(await f.run('details'),fullRows);assert.equal(checked,1);assert.equal(f.context.ordersProjectionIsThin(),false);
});
test('a stale or uncommitted controller reply cannot expose rows to a consumer',async()=>{
  for(const reply of [{rows:[{_id:0}],assertCurrent(){}},{rows:[],assertCurrent(){throw Error('stale');}},{rows:[]}]){
    const f=fixture(),before=f.state.orders;f.controllers.set(before,{ensure:async()=>reply});
    await assert.rejects(f.run(),e=>e.code==='ORDERS_FULL_STALE');assert.equal(f.state.orders,before);
  }
});
test('revocation while the controller awaits is checked again before consumption',async()=>{
  const f=fixture(),before=f.state.orders;f.controllers.set(before,{ensure:async()=>{f.deny();f.state.orders={rows:[]};return {rows:f.state.orders.rows,assertCurrent(){}};}});
  await assert.rejects(f.run(),e=>e.code==='ORDERS_FULL_FORBIDDEN');
});
test('internal transport errors are localized at the action boundary in both languages',async()=>{
  for(const lang of ['tr','en']){
    const f=fixture();f.context.appLang=lang;f.controllers.set(f.state.orders,{ensure:async()=>{throw Error('PRIVATE_RAW_TECHNICAL_FAILURE');}});
    await assert.rejects(f.run(),e=>e.code==='ORDERS_FULL_STALE'&&!e.message.includes('PRIVATE_RAW_TECHNICAL_FAILURE')&&(lang==='tr'?e.message.includes('Sipariş'):e.message.includes('Orders')));
  }
});
