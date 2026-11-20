'use strict';
// #1077 — anahtar açıkken arayüz açılıştan sonra modül hazırlamaz (arka uç ön ısıtması);
// anahtar kapalıyken eski sıralı hazırlık aynen çalışır. Sunucu bağlantısı kaynak sözleşmesidir.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const SERVER=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
const start=APP.indexOf('const BACKGROUND_WARMUP_GAP_MS');
const source=APP.slice(start,APP.indexOf("window.addEventListener('DOMContentLoaded'",start));

function harness({flags={},stored=null,curtain=false}={}){
  const calls=[],marks=[],events=[],gates=[],timers=[],reveals=[];
  const window={BLCanAccessArea:()=>true,BLPerf:{mark:(name,detail)=>marks.push({name,detail})},
    dispatchEvent:event=>events.push(event),BLBootGuard:{ready:gate=>gates.push(gate)},BLModulePreparation:{setStatus:(...args)=>calls.push(['status',...args])},...flags};
  const load=name=>async()=>{calls.push([name]);return true;};
  const context={window,state:{},console:{warn(){}},navigator:{deviceMemory:8},performance:{},curtain,
    localStorage:{getItem:key=>key==='buyerlog.readModel.prewarm.v1'?stored:null},
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options&&options.detail;}},
    document:{getElementById:id=>id==='blBootGuard'&&context.curtain?{}:null},
    setTimeout:fn=>{timers.push(fn);return timers.length;},afterStartupReveal:fn=>{reveals.push(fn);return Promise.resolve();},
    currentActiveTab:()=>'overview',_unifiedPriorityCache:{cp:null},backgroundWarmupUnrendered:new Set(),
    collectionCatalogsReady:()=>false,backlogLoadedOnce:false,backlogPrefetch:null,
    ensureInitialKolWorkspace:load('kolWorkspace'),ensureCollectionMasterCatalogLoaded:load('kolMaster'),prepareBackgroundPageProfiles:load('profiles'),
    ensureCollectionCatalogLoaded:load('koleksiyon'),ensureCpLoaded:async()=>{calls.push(['cp']);context.state.cp={rows:[]};return true;},
    scheduleUnifiedPrioritiesForTable:async()=>{calls.push(['priorities']);return true;},
    ensureOrdersLoaded:load('orders'),prefetchBacklogForRefresh:load('backlog')};
  vm.createContext(context);vm.runInContext(source,context);
  const flush=async()=>{for(let i=0;i<40;i++){while(timers.length)timers.shift()();await new Promise(resolve=>setImmediate(resolve));}};
  return {context,calls,marks,events,gates,flush,reveal(){context.curtain=false;reveals.splice(0).forEach(fn=>fn());}};
}

test('key on: no module is prepared in the renderer after startup',async()=>{
  for(const options of [{flags:{BL_READ_MODEL_PREWARM:true}},{stored:'1'}]){
    const h=harness(options);
    h.context.scheduleBackgroundModuleWarmup();h.context.scheduleBackgroundModuleWarmup();await h.flush();
    assert.deepEqual(h.calls,[],'no projection, profile or priority work in the UI thread');
    assert.deepEqual(h.gates,['modules']);
    assert.deepEqual(h.marks.map(m=>[m.name,m.detail?.mode]),[['BACKGROUND_WARMUP_DONE','backend']]);
    // Siparişler okuma modeli ısınması ve ölçüm betiği bu olayı bekler.
    assert.deepEqual(h.events.map(e=>[e.type,e.detail?.mode]),[['bl:background-warmup-done','backend']]);
  }
});

test('key on still waits for Continue under the startup curtain',async()=>{
  const h=harness({flags:{BL_READ_MODEL_PREWARM:true},curtain:true});
  h.context.scheduleBackgroundModuleWarmup();await h.flush();assert.deepEqual(h.gates,[]);
  h.reveal();await h.flush();assert.deepEqual(h.gates,['modules']);assert.deepEqual(h.calls,[]);
});

test('key off (default, or explicit false over the stored opt-in) keeps the legacy sequential preparation',async()=>{
  for(const options of [{},{flags:{BL_READ_MODEL_PREWARM:false},stored:'1'}]){
    const h=harness(options);h.context.scheduleBackgroundModuleWarmup();await h.flush();
    assert.deepEqual(h.calls.filter(c=>c[0]!=='status'&&c[0]!=='profiles'&&c[0]!=='kolWorkspace'&&c[0]!=='kolMaster').map(c=>c[0]),['koleksiyon','cp','priorities','orders','backlog']);
    assert.ok(h.marks.some(m=>m.name==='BACKGROUND_WARMUP_START'));assert.deepEqual(h.gates,['modules']);
  }
});

test('module preparation badge hides the pending state of lazy modules when the key is on',()=>{
  const render=APP.slice(APP.indexOf('function renderModulePreparationStates(){'),APP.indexOf('function startupModuleIntent('));
  const pending=render.indexOf("status==='pending'&&backendPrewarmEnabled()"),create=render.indexOf("badge=document.createElement('span')");
  assert.ok(pending>0&&pending<create,'pending check runs before a badge is created');
  // Anahtar adı TDZ'ye düşmeyecek şekilde fonksiyon içinde literaldir.
  assert.match(source,/function backendPrewarmEnabled\(\)\{\n  if\(typeof window\.BL_READ_MODEL_PREWARM==='boolean'\)return window\.BL_READ_MODEL_PREWARM;\n  try\{return localStorage\.getItem\('buyerlog\.readModel\.prewarm\.v1'\)==='1';\}/);
});

test('server wires one prewarm scheduler into every read model route; only workspace opening triggers it',()=>{
  const access=SERVER.indexOf("createComputeAccessMiddleware({"),created=SERVER.indexOf("require('./lib/read-model/prewarm-scheduler').createReadModelPrewarm({");
  assert.ok(access>0&&created>access);
  assert.doesNotMatch(SERVER,/readModelPrewarm\.middleware/,'arbitrary API calls must not start background compute');
  assert.equal((SERVER.match(/ noteWorkspaceOpened\(req(, profile)?\);/g)||[]).length,2,"GET / and /api/data?mode=initial");
  const index=SERVER.slice(SERVER.indexOf("app.get('/', (req, res) => {"),SERVER.indexOf('// express.static gövdeyi akışla'));
  assert.ok(index.indexOf('noteWorkspaceOpened(req, profile);')>index.indexOf("redirect(302, '/select-user')"),'only a valid session opens the workspace');
  assert.match(SERVER,/if \(String\(req\.query\.mode \|\| ''\) === 'initial'\) noteWorkspaceOpened\(req\);/);
  const routes=SERVER.slice(SERVER.indexOf("require('./lib/read-model/overview-model-routes')(app, {"),SERVER.indexOf("app.use(express.json({ limit: '100mb' }));"));
  assert.equal((routes.match(/runReadModelCompute: readModelPrewarm\.runCompute,/g)||[]).length,5,'overview, CP computed, query, global flow and Backlog V3 share the priority-aware pool entry');
  assert.match(routes,/overviewModelService: readModelPrewarm\.overviewServiceProxy\(\),/);
  assert.match(SERVER,/runCompute: readModelPrewarm\.runCompute,\n    loadContext: createContextLoader\(cpDecisionContextSources\),/);
});

test('legacy warmup with backend CP computed columns does not wait for the Overview model or the backend result',async()=>{
  const h=harness();let beforeWarmup=0;
  h.context.window.BLOverviewReadModel={beforeWarmup:()=>{beforeWarmup++;return new Promise(()=>{});}};
  h.context.window.BLCpComputedColumns={isEnabled:()=>true,active:()=>Boolean(h.context.state.cp)};
  h.context.scheduleUnifiedPrioritiesForTable=()=>{h.calls.push(['priorities']);return new Promise(()=>{});};
  h.context.scheduleBackgroundModuleWarmup();await h.flush();
  assert.equal(beforeWarmup,0,'no wait for the Overview full model');
  assert.deepEqual(h.calls.filter(c=>['koleksiyon','cp','priorities','orders','backlog'].includes(c[0])).map(c=>c[0]),['koleksiyon','cp','priorities','orders','backlog'],'Orders and Backlog do not wait for the backend CP result');
  assert.deepEqual(h.gates,['modules']);
  // Sağlayıcı kapalıysa eski bekleme korunur.
  const legacy=harness();let waited=0;
  legacy.context.window.BLOverviewReadModel={beforeWarmup:()=>{waited++;return Promise.resolve();}};
  legacy.context.window.BLCpComputedColumns={isEnabled:()=>false,active:()=>false};
  legacy.context.scheduleBackgroundModuleWarmup();await legacy.flush();
  assert.equal(waited,1);assert.deepEqual(legacy.gates,['modules']);
});
