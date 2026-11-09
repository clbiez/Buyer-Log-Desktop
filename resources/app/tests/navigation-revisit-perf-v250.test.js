'use strict';
// Regression (7.0.250): sayfa geçişlerinde her seferinde yeniden hazırlık.
// Gerçek tarayıcı ölçümü (6 bin siparişlik demo veri):
//  - CP'ye her tıklama checklist senkronunu yeniden indirip CP'yi üç kez
//    çiziyordu (~1,9 sn ana iş parçacığı); her CP çizimi bütün checklist
//    hücrelerini baştan yazıyordu.
//  - Genel Bakış haritasının yükleme küresi hiç durdurulmuyor, her karede
//    yerleşim ölçümü yapıyordu.
//  - Genel Bakış aynı Backlog sorgusunu üç widget'tan istiyor, sunucu her
//    birinde bütün Backlog'u baştan hesaplıyordu.
//  - Ertelenmiş arayüz modülleri sırayla indiriliyor, açılış perdesinin profil
//    kapısı bu zincirin sonunu bekliyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('CP tab revisits reuse the checklist runtime instead of re-downloading and re-rendering', () => {
  const sync = read('public/checklist-supplier-sync.js');
  assert.match(sync, /startRuntime\(\{ ifStale: true \}\)/, 'tab clicks only refresh a stale runtime');
  assert.match(sync, /if \(!first && signature === state\.runtimeSignature\) return;/, 'an unchanged reload does not render CP again');
  assert.match(sync, /refreshColumns\(\{render:false,decision,reuse:true\}\)/, 'the render wrapper may reuse applied checklist cells');
  assert.match(sync, /applied\.rows === rows && applied\.decision === opts\.decision/);
  assert.doesNotMatch(sync, /dataRevision: Date\.now\(\)/, 'Production Focus is not forced to recompute on every checklist refresh');
  assert.match(sync, /if \(sharedSignature !== state\.sharedViewSignature\)/);
});

test('map loading uses the Working orb only while the operation is active',()=>{
  const flow=read('public/overview-global-flow.js');
  const loading=flow.slice(flow.indexOf('function syncLoadingOrb(busy)'),flow.indexOf('function syncLoadingOverlay()'));
  assert.match(flow,/id="globalFlowWorkingOrb" width="64" height="64"/);
  assert.match(loading,/window\.BLThinkingOrb\.attach/);
  assert.match(loading,/state\.orbHandle\.stop\(\)/);
  assert.match(flow,/syncLoadingOrb\(busy\);/);
  const worker=read('public/thinking-orb-working.js');
  assert.match(worker,/IntersectionObserver/);
  assert.match(worker,/visibilitychange/);
  assert.match(worker,/prefers-reduced-motion: reduce/);
  assert.doesNotMatch(loading,/requestAnimationFrame|getBoundingClientRect/);
});

test('working orb stops by itself once its canvas leaves the document', () => {
  let frames = 0, rects = 0;
  const callbacks = [];
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, globalAlpha: 1, fillStyle: '' };
  const canvas = { isConnected: true, width: 64, height: 64, getContext: () => ctx, getBoundingClientRect: () => { rects++; return { width: 64, height: 64 }; } };
  const window = {
    document: { documentElement: {},addEventListener(){},removeEventListener(){} }, devicePixelRatio: 1,
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: fn => { callbacks.push(fn); return callbacks.length; }, cancelAnimationFrame() {},
  };
  const context = { window, getComputedStyle: () => ({ getPropertyValue: () => '#123456' }) };
  context.document = window.document;
  vm.runInNewContext(read('public/thinking-orb-working.js'), context);
  window.BLThinkingOrb.attach(canvas);
  for (let i = 0; i < 5; i++) { const fn = callbacks.shift(); if (fn) { frames++; fn(16 * (i + 1)); } }
  assert.equal(rects, 1, 'size is measured once, not every frame');
  canvas.isConnected = false;
  const pending = callbacks.length;
  for (const fn of callbacks.splice(0)) fn(200);
  assert.ok(pending >= 1 && callbacks.length === 0, 'a detached canvas schedules no further frames');
  assert.equal(frames, 5);
});

test('identical Backlog requests reuse one computation keyed by every input', async () => {
  const server = read('server/server.js');
  // Phase 5 moved the computation and its bounded result cache to computeReads.
  // Keep testing reuse/invalidation on the live route, not its unused predecessor.
  const route = server.slice(server.indexOf("app.get('/api/backlog-export'"), server.indexOf("app.get('/api/backlog-filter-values'"));
  assert.match(route, /computeReads\.run\(req,'backlog',task,/);
  assert.match(route, /\{cache:json,signal:consumer\.signal\}\)/);
  assert.doesNotMatch(route, /buildBacklogTemplateRows|cachedBacklogTemplateRows/);
  const capture = require('./helpers/computed-backlog-request');
  const query = {format:'json',retailFrom:'2026-01-01',retailTo:'2026-12-31',inStoreFrom:'2026-02-01',inStoreTo:'2026-11-30',exFactoryFrom:'2026-03-01',exFactoryTo:'2026-10-31',buyerGrup:'DEMO',groupBy:'buyer,season',dimFilters:'{"Sezon":["S7"]}',analysisFilters:'late',antrepoFrom:'2026-04-01',antrepoTo:'2026-09-30',antrepoDateLevels:'month,week',sourceColumns:'DEMO_A,DEMO_B',previewLimit:'10',includeSourceDetails:'1',projection:'global-flow'};
  const selected = await capture(query);
  assert.equal(selected.task, 'backlog-export');
  assert.equal(selected.options.cache, true);
  const contextStart = server.indexOf('function computeReadContext(');
  const contextFn = server.slice(contextStart, server.indexOf('\nconst computeReadGuard=', contextStart));
  for (const input of ['pageProjectionContext(profile)', 'shared._revision', 'shared._revisions', 'fingerprint()', 'getFullYear()', 'getMonth()', 'getDate()'])
    assert.ok(contextFn.includes(input), 'live cache context includes ' + input);
  const guardWiring = server.slice(server.indexOf('const computeReadGuard='),server.indexOf('\nfunction computeParamsFor('));
  assert.match(guardWiring,/contextFor:computeReadContext/);
  assert.match(guardWiring,/accessFor:profile=>userAccess\.computeAccessContext\(profile\)/);
  assert.match(guardWiring,/sourceTokenFor:computeSourceToken/);

  const {createComputeReadService} = require('../server/lib/compute-read-service');
  const {createComputeReadGuard} = require('../server/lib/compute-read-guard');
  const profile = {id:'demo',status:'ACTIVE',enabled:true};
  let revision = {source:'g1',context:'c1',access:'a1'}, calls = 0, clock = 0, releases = 0;
  const guard = createComputeReadGuard({sessionProfile:()=>profile,profileById:()=>profile,hasArea:()=>true,contextFor:()=>({contextHash:revision.context}),accessFor:()=>({accessHash:revision.access}),sourceTokenFor:()=>revision.source});
  const service = createComputeReadService({guard,sourceFor:async()=>({generation:revision.source}),paramsFor:(_profile,_source,_task,parts)=>parts,now:()=>clock,
    compute:{run:async()=>({value:{build:++calls},metrics:{outputBytes:1},release:()=>releases++})}});
  const run = () => service.run({},'backlog',selected.task,selected.parts,selected.options);
  const [first,shared] = await Promise.all([run(),run()]);
  assert.equal(first.value,shared.value);first.release();shared.release();
  const cached = await run();assert.equal(cached.value,first.value);cached.release();assert.equal(calls,1);
  for (const key of Object.keys(query).filter(key=>key!=='format')) {
    const replacement = key==='dimFilters'?'{}':key==='previewLimit'?'11':key==='includeSourceDetails'?'0':key==='projection'?'full':query[key]+'-changed';
    const changed = await capture({...query,[key]:replacement});
    assert.notDeepEqual(changed.parts,selected.parts,key+' must reach the live cache key');
    const lease = await service.run({},'backlog',changed.task,changed.parts,changed.options);
    assert.notEqual(lease.value,first.value,key+' must invalidate the cached result');lease.release();
  }
  for (const key of ['source','context','access']) {
    revision = {...revision,[key]:revision[key]+'-changed'};
    const previous = calls, lease = await run();assert.equal(calls,previous+1,key+' invalidates a cached response');lease.release();
  }
  clock=60001;const previous=calls,expired=await run();assert.equal(calls,previous+1,'the production 60 second TTL expires');expired.release();
  service.clear();assert.equal(releases,calls,'every computed buffer is released');
});

test('deferred UI scripts download in parallel and the profile gate loads early', () => {
  const perf = read('public/perf-runtime.js');
  assert.match(perf, /preloadScripts\(files\);/);
  assert.match(perf, /link\.rel='preload';link\.as='script'/);
  const list = perf.slice(perf.indexOf('deferredUi:['), perf.indexOf('],', perf.indexOf('deferredUi:[')));
  assert.ok(list.indexOf('user-access-ui.js') < list.indexOf('formula-engine.js'), 'user-access-ui.js no longer waits for the whole chain');
});

test('the 5 s IAM session check does not re-render the UI when the profile is unchanged', () => {
  const ui = read('public/user-access-ui.js');
  assert.match(ui, /if \(signature === lastSessionSignature\) return;/);
  assert.match(ui, /const second = await fetch\('\/api\/current-user'/, 'a single negative answer is confirmed before redirecting to sign-in');
});

test('memoized text normalizers return exactly the same tokens', () => {
  const canonical = require('../public/canonical-fields.js');
  const samples = ['İstanbul Örme', 'ışık  ŞAL', 'Çağrı-Ünal', '', null, 'x'.repeat(400)];
  const expected = value => String(value == null ? '' : value)
    .replace(/[ıİşŞğĞüÜöÖçÇ]/g, ch => ({ ı: 'I', İ: 'I', ş: 'S', Ş: 'S', ğ: 'G', Ğ: 'G', ü: 'U', Ü: 'U', ö: 'O', Ö: 'O', ç: 'C', Ç: 'C' })[ch])
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  for (let round = 0; round < 2; round++) for (const value of samples) assert.equal(canonical.token(value), expected(value));
  const parse = read('server/lib/parse.js');
  assert.match(parse, /const TURKNORM_CACHE = new Map\(\);/);
  assert.match(parse, /if \(TURKNORM_CACHE\.size >= 50000\) TURKNORM_CACHE\.clear\(\);/);
});
