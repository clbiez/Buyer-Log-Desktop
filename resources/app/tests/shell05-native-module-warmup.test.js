'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const source=app.slice(app.indexOf('const BACKGROUND_WARMUP_GAP_MS'),app.indexOf('// Await only the primary projection'));
function harness({native=true,active='overview',access=['cp','orders','koleksiyon','backlog'],flags={},loaded=false,curtain=false}={}){
  const timers=[],calls=[],gates=[],events=[],reveals=[];
  const state=loaded?{cp:{rows:[]},orders:{rows:[]},collectionCatalogs:{ready:true}}:{};
  const cache={cp:loaded?{rows:state.cp.rows}:null};
  const context={URLSearchParams,window:{location:{search:native?'?workspaceTab=synthetic-tab&module='+active:'?module='+active},
    BLCanAccessArea:area=>access.includes(area),BLBootGuard:{ready:gate=>gates.push(gate)},
    dispatchEvent:event=>events.push(event.type),...flags},state,navigator:{deviceMemory:8},performance:{},console,
    document:{getElementById:()=>context.curtain?{}:null},curtain,active,
    currentActiveTab:()=>context.active,afterStartupReveal:fn=>{reveals.push(fn);return Promise.resolve();},
    setTimeout:fn=>{timers.push(fn);},CustomEvent:class{constructor(type){this.type=type;}},
    ensureInitialKolWorkspace:async()=>true,ensureCollectionMasterCatalogLoaded:async()=>true,prepareBackgroundPageProfiles:async()=>true,
    backlogLoadedOnce:loaded,backlogPrefetch:null,prefetchBacklogForRefresh:async()=>{calls.push('backlog');return true;},
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
test('native pages prepare all authorized modules even when opening on Overview',async()=>{
  for(const active of ['overview','cp','orders','koleksiyon','backlog']){
    const h=harness({active});h.context.scheduleBackgroundModuleWarmup();await h.flush();
    assert.deepEqual(h.calls,['koleksiyon','cp','orders','backlog'],active);assert.deepEqual(h.gates,['modules']);
  }
});
test('browser and native preparation follow the same fixed priority',async()=>{
  const h=harness({native:false,active:'orders'});h.context.scheduleBackgroundModuleWarmup();await h.flush();
  assert.deepEqual(h.calls,['koleksiyon','cp','orders','backlog']);
});
test('permission and source gates still apply while memory does not silently skip Orders',async()=>{
  const h=harness({access:['cp','orders','backlog'],flags:{BL_CP_SOURCE_FILTER_REQUIRED:true}});
  h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,[]);
  const low=harness({access:['orders']});low.context.navigator.deviceMemory=2;
  low.context.scheduleBackgroundModuleWarmup();await low.flush();assert.deepEqual(low.calls,['orders']);
});
test('navigation while the native queue is waiting does not cancel background pages',async()=>{
  const h=harness({active:'cp'});h.context.scheduleBackgroundModuleWarmup();h.context.active='orders';await h.flush();
  assert.deepEqual(h.calls,['koleksiyon','cp','orders','backlog']);
});
test('native preparation waits for Continue and starts once',async()=>{
  const h=harness({curtain:true});h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,[]);
  h.reveal();h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.calls,['koleksiyon','cp','orders','backlog']);assert.deepEqual(h.gates,['modules']);
});
