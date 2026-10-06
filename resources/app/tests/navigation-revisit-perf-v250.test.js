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

test('the map loading orb only animates while its overlay is visible and does not measure layout per frame', () => {
  const flow = read('public/overview-global-flow.js');
  assert.match(flow, /function syncLoadingOrb\(busy\)/);
  assert.match(flow, /syncLoadingOrb\(busy\);/);
  assert.match(flow, /state\.orbHandle\.stop\(\)/);
  const orb = read('public/thinking-orb-working.js');
  assert.match(orb, /function resize\(\)\{if\(!measured\)measured=measureSize\(\);return measured;\}/);
  assert.match(orb, /if\(!canvas\.isConnected\)\{running=false;/);
});

test('working orb stops by itself once its canvas leaves the document', () => {
  let frames = 0, rects = 0;
  const callbacks = [];
  const ctx = { setTransform() {}, clearRect() {}, beginPath() {}, arc() {}, fill() {}, globalAlpha: 1, fillStyle: '' };
  const canvas = { isConnected: true, width: 64, height: 64, getContext: () => ctx, getBoundingClientRect: () => { rects++; return { width: 64, height: 64 }; } };
  const window = {
    document: { documentElement: {} }, devicePixelRatio: 1,
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

test('identical Backlog requests reuse one computation keyed by every input', () => {
  const server = read('server/server.js');
  assert.match(server, /const detailRows=cachedBacklogTemplateRows\(detailRowsKey,\(\)=>buildBacklogTemplateRows\(/);
  const keyFn = server.slice(server.indexOf('function backlogRowsCacheKey'), server.indexOf('function cachedBacklogTemplateRows'));
  for (const input of ['asasOrdersByTarget', "antrepoForTarget(active,'backlog')", 'cpupdateOverrides', 'overrides._revision', 'overrides._revisions', 'accessRevision', 'localIamRevision()', 'getDate()', 'parts'])
    assert.ok(keyFn.includes(input), 'cache key includes ' + input);
  assert.match(server, /BACKLOG_ROWS_CACHE_MS=60\*1000/);
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
