'use strict';
// Startup used to open three hidden native tabs (Collection/CP/Orders), each a
// full renderer that re-booted the app and re-downloaded its data (≈1.5 GiB and
// ~4 minutes of CPU contention in the 7.0.314 measurement). Modules now warm
// sequentially inside the single visible renderer.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const start=APP.indexOf('const BACKGROUND_WARMUP_GAP_MS');
const source=APP.slice(start,APP.indexOf("window.addEventListener('DOMContentLoaded'",start));

function harness({access=['cp','orders','koleksiyon'],state={},flags={},active='overview',deviceMemory=8,heap=null}={}){
  const timers=[],calls=[],marks=[],events=[];
  const resolvers={};
  const window={BLCanAccessArea:area=>access.includes(area),BLPerf:{mark:(name,detail)=>marks.push({name,detail})},
    dispatchEvent:event=>events.push(event.type),...flags};
  const context={window,state,console:{warn(){}},navigator:{deviceMemory},performance:{memory:heap},CustomEvent:class{constructor(type){this.type=type;}},
    setTimeout:fn=>{timers.push(fn);return timers.length;},
    currentActiveTab:()=>context.active,active,
    collectionCatalogsReady:catalogs=>Boolean(catalogs&&catalogs.ready),
    _unifiedPriorityCache:{cp:null,orders:null},
    scheduleUnifiedPrioritiesForTable:table=>{calls.push(['priorities:'+table]);context._unifiedPriorityCache[table]={rows:state[table].rows};return Promise.resolve(true);},
    ensureCpLoaded:options=>{calls.push(['cp',options]);return new Promise(resolve=>{resolvers.cp=ok=>{state.cp={rows:[]};resolve(ok);};});},
    ensureOrdersLoaded:options=>{calls.push(['orders',options]);return new Promise(resolve=>{resolvers.orders=ok=>{state.orders={rows:[]};resolve(ok);};});},
    ensureCollectionCatalogLoaded:options=>{calls.push(['koleksiyon',options]);return new Promise(resolve=>{resolvers.koleksiyon=ok=>{state.collectionCatalogs={ready:true};resolve(ok);};});},
  };
  context.backgroundWarmupUnrendered=new Set();
  vm.createContext(context);vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<20;i++){await new Promise(resolve=>setImmediate(resolve));while(timers.length)timers.shift()();}};
  return {context,calls,marks,events,resolvers,flush};
}

test('authorized modules warm one at a time, hidden, in CP → Orders → Collection order', async () => {
  const h=harness();
  h.context.scheduleBackgroundModuleWarmup();h.context.scheduleBackgroundModuleWarmup();
  await h.flush();
  assert.deepEqual(h.calls.map(call=>call[0]),['cp'],'only one module loads at a time');
  assert.equal(h.calls[0][1].deferRender,true,'hidden tables are not drawn while warming');
  h.resolvers.cp(true);await h.flush();
  assert.deepEqual(h.calls.map(call=>call[0]),['cp','priorities:cp','orders'],'CP priorities are prepared before the next module');
  h.resolvers.orders(true);await h.flush();
  h.resolvers.koleksiyon(true);await h.flush();
  assert.deepEqual(h.calls.map(call=>call[0]),['cp','priorities:cp','orders','koleksiyon'],'scheduled once even when called twice');
  assert.deepEqual([...h.context.backgroundWarmupUnrendered].sort(),['cp','orders'],'first visit draws the warmed table once');
  assert.ok(h.marks.some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'));
  assert.deepEqual(h.events,['bl:background-warmup-done']);
});

test('denied, already loaded or source-filter-blocked modules send no request', async () => {
  const h=harness({access:['orders','koleksiyon'],state:{collectionCatalogs:{ready:true}},flags:{BL_CP_SOURCE_FILTER_REQUIRED:true}});
  h.context.scheduleBackgroundModuleWarmup();await h.flush();
  assert.deepEqual(h.calls,[]);
  assert.ok(h.marks.some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'));
});

test('a module the user opened during warmup is not marked for a second draw', async () => {
  const h=harness({access:['cp']});
  h.context.scheduleBackgroundModuleWarmup();await h.flush();
  h.context.active='cp';h.resolvers.cp(true);await h.flush();
  assert.equal(h.context.backgroundWarmupUnrendered.has('cp'),false);
});

test('the warmed-table set exists before any script-time switchTab call',()=>{
  assert.ok(APP.indexOf('var backgroundWarmupUnrendered=new Set();')<APP.indexOf('function switchTab(tab){'));
});
test('switchTab draws a warmed table once, after the page profile, without an early deferred draw', () => {
  const body=APP.slice(APP.indexOf('function switchTab(tab){'),APP.indexOf('function activeTableInfo(){'));
  assert.match(body,/const warmedUnrendered=backgroundWarmupUnrendered\.delete\(tab\);\s*if\(warmedUnrendered\)_deferredTabRenders\.delete\(tab\);\s*flushDeferredRenderForTab\(tab\);/);
  assert.match(body,/if\(tab==='cp'&&\(!state\.cp\|\|warmedUnrendered\)\)/);
  assert.match(body,/if\(tab==='orders'&&\(!state\.orders\|\|warmedUnrendered\)\)/);
});

test('Orders warmup is skipped on low-memory machines or a nearly full renderer heap', async () => {
  for(const options of [{deviceMemory:4},{deviceMemory:2},{heap:{usedJSHeapSize:700,jsHeapSizeLimit:1000}}]){
    const h=harness({access:['cp','orders'],...options});
    h.context.scheduleBackgroundModuleWarmup();await h.flush();h.resolvers.cp(true);await h.flush();
    assert.deepEqual(h.calls.map(call=>call[0]),['cp','priorities:cp'],JSON.stringify(options));
  }
  const roomy=harness({access:['orders'],deviceMemory:8,heap:{usedJSHeapSize:200,jsHeapSizeLimit:1000}});
  roomy.context.scheduleBackgroundModuleWarmup();await roomy.flush();
  assert.deepEqual(roomy.calls.map(call=>call[0]),['orders']);
});
