'use strict';
// Startup used to open three hidden native tabs (Collection/CP/Orders), each a
// full renderer that re-booted the app and re-downloaded its data (≈1.5 GiB and
// ~4 minutes of CPU contention in the 7.0.314 measurement). Modules now warm
// sequentially inside the single visible renderer.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const start=APP.indexOf('const BACKGROUND_WARMUP_GAP_MS');
const source=APP.slice(start,APP.indexOf("window.addEventListener('DOMContentLoaded'",start));

function harness({access=['cp','orders','koleksiyon','backlog'],state={},flags={},active='overview',deviceMemory=8,heap=null,curtain=false}={}){
  const timers=[],calls=[],marks=[],events=[],details=[],gates=[],revealed=[];
  const resolvers={};
  const window={BLCanAccessArea:area=>access.includes(area),BLPerf:{mark:(name,detail)=>marks.push({name,detail})},
    dispatchEvent:event=>{events.push(event.type);if(event.detail)details.push(event.detail);},BLBootGuard:{ready:gate=>gates.push(gate)},...flags};
  const delays=[];
  const context={window,state,console:{warn(){}},navigator:{deviceMemory},performance:{memory:heap},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options&&options.detail;}},
    document:{getElementById:id=>id==='blBootGuard'&&context.curtain?{}:null},curtain,
    setTimeout:(fn,ms)=>{timers.push(fn);delays.push(ms);return timers.length;},
    afterStartupReveal:fn=>{revealed.push(fn);return Promise.resolve();},
    currentActiveTab:()=>context.active,active,
    collectionCatalogsReady:catalogs=>Boolean(catalogs&&catalogs.ready),
    _unifiedPriorityCache:{cp:null,orders:null},
    scheduleUnifiedPrioritiesForTable:table=>{calls.push(['priorities:'+table]);context._unifiedPriorityCache[table]={rows:state[table].rows};return Promise.resolve(true);},
    ensureCpLoaded:options=>{calls.push(['cp',options]);return new Promise(resolve=>{resolvers.cp=ok=>{state.cp={rows:[]};resolve(ok);};});},
    ensureOrdersLoaded:options=>{calls.push(['orders',options]);return new Promise(resolve=>{resolvers.orders=ok=>{state.orders={rows:[]};resolve(ok);};});},
    ensureInitialKolWorkspace:async()=>true,
    ensureCollectionMasterCatalogLoaded:async()=>true,
    prepareBackgroundPageProfiles:async()=>true,
    backlogLoadedOnce:false,backlogPrefetch:null,
    prefetchBacklogForRefresh:()=>{calls.push(['backlog']);return new Promise(resolve=>{resolvers.backlog=ok=>{context.backlogPrefetch={data:{}};resolve(ok);};});},
    ensureCollectionCatalogLoaded:options=>{calls.push(['koleksiyon',options]);return new Promise(resolve=>{resolvers.koleksiyon=ok=>{state.collectionCatalogs={ready:true};resolve(ok);};});},
  };
  context.backgroundWarmupUnrendered=new Set();
  vm.createContext(context);vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<20;i++){await new Promise(resolve=>setImmediate(resolve));while(timers.length)timers.shift()();}};
  return {context,calls,marks,events,details,gates,delays,resolvers,flush,reveal(){context.curtain=false;revealed.splice(0).forEach(fn=>fn());}};
}

test('authorized pages prepare sequentially in Collection → CP → Orders → Backlog order', async () => {
  const h=harness();
  h.context.scheduleBackgroundModuleWarmup();h.context.scheduleBackgroundModuleWarmup();
  await h.flush();assert.deepEqual(h.calls.map(c=>c[0]),['koleksiyon']);
  h.resolvers.koleksiyon(true);await h.flush();assert.deepEqual(h.calls.map(c=>c[0]),['koleksiyon','cp']);
  h.resolvers.cp(true);await h.flush();assert.deepEqual(h.calls.map(c=>c[0]),['koleksiyon','cp','priorities:cp','orders']);
  h.resolvers.orders(true);await h.flush();h.resolvers.backlog(true);await h.flush();
  assert.deepEqual(h.calls.map(c=>c[0]),['koleksiyon','cp','priorities:cp','orders','backlog']);
  assert.equal(h.calls.find(c=>c[0]==='cp')[1].deferRender,true);
  assert.deepEqual(h.details.map(d=>d.module),['koleksiyon','cp','orders','backlog']);
  assert.deepEqual(h.gates,['modules']);
});

test('preparation waits for Continue without timers under the startup curtain', async () => {
  const h=harness({curtain:true,access:['orders']});h.context.scheduleBackgroundModuleWarmup();await h.flush();
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.delays,[]);
  h.reveal();await h.flush();h.resolvers.orders(true);await h.flush();assert.deepEqual(h.gates,['modules']);
});

test('a warmup that cannot start still releases the startup modules gate',()=>{
  const startup=APP.slice(APP.indexOf("window.addEventListener('DOMContentLoaded', async () => {"),APP.indexOf('async function refreshFolderLabel()'));
  assert.match(startup,/\.then\(scheduleBackgroundModuleWarmup\)\.catch\(error=>\{console\.warn\('Arka plan ön yükleme başlatılamadı:',error\);finishStartupModules\(\);\}\)/);
});

test('denied and source-filter-blocked model modules send no request', async () => {
  const h=harness({access:['orders','backlog'],state:{collectionCatalogs:{ready:true}},flags:{BL_CP_SOURCE_FILTER_REQUIRED:true}});
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

test('Orders still prepares on small devices and busy heaps', async () => {
  for(const options of [{deviceMemory:4},{deviceMemory:2},{heap:{usedJSHeapSize:700,jsHeapSizeLimit:1000}}]){
    const h=harness({access:['orders'],...options});h.context.scheduleBackgroundModuleWarmup();await h.flush();
    assert.deepEqual(h.calls.map(c=>c[0]),['orders']);h.resolvers.orders(true);await h.flush();
  }
});

test('a table already in memory before its warmup step is not marked for a redundant draw', async () => {
  const h=harness({access:['cp'],state:{cp:{rows:[]}}});
  h.context.scheduleBackgroundModuleWarmup();await h.flush();
  h.resolvers.cp(true);await h.flush();
  assert.equal(h.context.backgroundWarmupUnrendered.has('cp'),false);
});

test('a stale or failed CP priority job cannot publish a ready background module', async () => {
  const h=harness({access:['cp']});
  h.context.scheduleUnifiedPrioritiesForTable=()=>Promise.resolve(false);
  h.context.scheduleBackgroundModuleWarmup();await h.flush();h.resolvers.cp(true);await h.flush();
  const result=h.marks.find(mark=>mark.name==='BACKGROUND_WARMUP_READY');
  assert.equal(result.detail.ok,false);
  assert.equal(h.context.backgroundWarmupUnrendered.has('cp'),false);
});
