'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const source=app.slice(app.indexOf('const BACKGROUND_WARMUP_GAP_MS'),app.indexOf('// Await only the primary projection'));
function harness({native=true,active='overview',access=['cp','orders','koleksiyon'],flags={},loaded=false,curtain=false}={}){
  const timers=[],calls=[],gates=[],events=[],reveals=[];
  const state=loaded?{cp:{rows:[]},orders:{rows:[]},collectionCatalogs:{ready:true}}:{};
  const cache={cp:loaded?{rows:state.cp.rows}:null};
  const context={URLSearchParams,window:{location:{search:native?'?workspaceTab=synthetic-tab&module='+active:'?module='+active},
    BLCanAccessArea:area=>access.includes(area),BLBootGuard:{ready:gate=>gates.push(gate)},
    dispatchEvent:event=>events.push(event.type),...flags},state,navigator:{deviceMemory:8},performance:{},console,
    document:{getElementById:()=>context.curtain?{}:null},curtain,active,
    currentActiveTab:()=>context.active,afterStartupReveal:fn=>{reveals.push(fn);return Promise.resolve();},
    setTimeout:fn=>{timers.push(fn);},CustomEvent:class{constructor(type){this.type=type;}},
    collectionCatalogsReady:value=>value?.ready===true,_unifiedPriorityCache:cache,backgroundWarmupUnrendered:new Set(),
    ensureCpLoaded:async()=>{calls.push('cp');state.cp={rows:[]};return true;},
    ensureOrdersLoaded:async()=>{calls.push('orders');state.orders={rows:[]};return true;},
    ensureCollectionCatalogLoaded:async()=>{calls.push('koleksiyon');state.collectionCatalogs={ready:true};return true;},
    scheduleUnifiedPrioritiesForTable:async()=>{cache.cp={rows:state.cp.rows};return true;},
  };
  vm.createContext(context);vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<30;i++){while(timers.length)timers.shift()();await new Promise(resolve=>setImmediate(resolve));}};
  return {context,calls,gates,events,flush,reveal(){context.curtain=false;reveals.splice(0).forEach(fn=>fn());}};
}
test('SHELL-05: native preparation is limited to the current module, including non-warmup screens',async()=>{
  for(const active of ['overview','cp','orders','koleksiyon','backlog']){
    const h=harness({active});h.context.scheduleBackgroundModuleWarmup();await h.flush();
    assert.deepEqual(h.calls,['cp','orders','koleksiyon'].includes(active)?[active]:[],active);
    assert.deepEqual(h.gates,['modules'],active+' releases ready/modules even with no eligible steps');
  }
});
test('SHELL-05: three native renderers prepare three modules instead of nine',async()=>{
  const tabs=['cp','orders','koleksiyon'].map(active=>harness({active}));
  for(const h of tabs){h.context.scheduleBackgroundModuleWarmup();await h.flush();}
  assert.deepEqual(tabs.flatMap(h=>h.calls),['cp','orders','koleksiyon']);
});
test('SHELL-05: browser behavior keeps all three steps even with an explicit module URL',async()=>{
  const h=harness({native:false,active:'orders'});h.context.scheduleBackgroundModuleWarmup();await h.flush();
  assert.deepEqual(h.calls,['cp','orders','koleksiyon']);
});
test('SHELL-05: native permission, source filter, cached data and memory gates remain effective',async()=>{
  for(const options of [{active:'cp',access:[]},{active:'cp',flags:{BL_CP_SOURCE_FILTER_REQUIRED:true}},
    {active:'orders',flags:{BL_HAS_CACHED_MODEL_DATA:false}},{active:'koleksiyon',loaded:true},{active:'cp',loaded:true}]){
    const h=harness(options);h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,[]);
    assert.deepEqual(h.gates,['modules']);
  }
  const h=harness({active:'orders'});h.context.navigator.deviceMemory=2;
  h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,[]);
});
test('SHELL-05: a user switch before the queued native step cannot warm the old hidden module',async()=>{
  const h=harness({active:'cp'});h.context.scheduleBackgroundModuleWarmup();h.context.active='orders';await h.flush();
  assert.deepEqual(h.calls,[]);assert.deepEqual(h.gates,['modules']);
});
test('SHELL-05: native warmup still waits for Continue and runs once',async()=>{
  const h=harness({active:'cp',curtain:true});h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,[]);
  h.reveal();h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,['cp']);assert.deepEqual(h.gates,['modules']);
});
test('SHELL-05: native navigation uses the current screen rather than the stale opening URL',async()=>{
  const h=harness({active:'orders'});h.context.window.location.search='?workspaceTab=synthetic-tab&module=cp';
  h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,['orders']);
});
