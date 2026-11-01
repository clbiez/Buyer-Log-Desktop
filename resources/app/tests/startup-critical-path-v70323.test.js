'use strict';
/* 7.0.323 — açılış kritik yolu: sunucu hazır yoklaması, Node derleme önbelleği,
   sürüm geçişinde korunan renderer önbelleği ve gecikmeli onarım taraması. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');

const { waitForServer, readyPollDelay, READY_POLL_MS, READY_FAST_POLL_MS } = require('../electron/backend');
const { compileCacheDirectory, pruneCompileCaches } = require('../electron/portable-paths');
const { runInstallRepair, RENDERER_STORAGES_CLEARED } = require('../electron/install-repair');
const { writeIntegrityManifest } = require('../electron/update/integrity');
const compileCache = require('../server/lib/compile-cache');

const APP = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(APP, rel), 'utf8');
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

function freePort() {
  return new Promise(resolve => {
    const probe = http.createServer();
    probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
  });
}

test('hazır yoklaması ilk saniyelerde sık, sonra seyrek', () => {
  assert.equal(readyPollDelay(0), READY_FAST_POLL_MS);
  assert.ok(READY_FAST_POLL_MS <= 100);
  assert.equal(readyPollDelay(60000), READY_POLL_MS);
});

test('sunucu dinlemeye başlayınca pencere 400 ms yoklama aralığını beklemez', async t => {
  const port = await freePort();
  const server = http.createServer((_req, res) => { res.statusCode = 302; res.end(); });
  t.after(() => server.close());
  const startedAt = Date.now();
  setTimeout(() => server.listen(port, '127.0.0.1'), 250);
  const result = await waitForServer('http://127.0.0.1:' + port, 5000);
  assert.equal(result.ready, true);
  assert.equal(result.status, 302);
  assert.ok(Date.now() - startedAt < 250 + 200, 'hazır olduktan sonra en fazla bir kısa aralık beklenir');
});

test('SERVER_READY uyandırması sıradaki yoklamayı beklemeden dener ve abonelik kaldırılır', async t => {
  const port = await freePort();
  const server = http.createServer((_req, res) => res.end('ok'));
  t.after(() => server.close());
  const wakers = new Set();
  // Uzun açılış simülasyonu: hızlı pencere geçmiş gibi davranmak için zaman aşımı içinde
  // dinleme başlar ve hemen uyandırma gelir.
  const pending = waitForServer('http://127.0.0.1:' + port, 5000, () => false, {
    subscribe: wake => wakers.add(wake), unsubscribe: wake => wakers.delete(wake),
  });
  assert.equal(wakers.size, 1);
  await new Promise(resolve => setTimeout(resolve, 30));
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  for (const wake of wakers) wake();
  const result = await pending;
  assert.equal(result.ready, true);
  assert.equal(wakers.size, 0, 'bekleyici bittiğinde uyandırma aboneliği kalmaz');
});

test('backend süreci SERVER_READY işaretinde bekleyiciyi uyandırır', () => {
  const backend = read('electron/backend.js');
  assert.match(backend, /SERVER_READY \\\+\\d\+ms\\s\*\$\/\.test\(line\)\) \{\s*milestones\.server = true;\s*for \(const wake of this\.serverReadyWakers\)/);
  assert.match(backend, /subscribe: wake => this\.serverReadyWakers\.add\(wake\)/);
});

test('derleme önbelleği sürüm başına klasörde tutulur, eski sürüm klasörleri silinir', t => {
  const root = tmp('bl-ccache-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = { localDataRoot: path.join(root, 'local') };
  const current = compileCacheDirectory(paths, '7.0.323');
  const old = compileCacheDirectory(paths, '7.0.322');
  assert.notEqual(current, old);
  assert.equal(path.dirname(current), path.join(paths.localDataRoot, 'cache', 'node-compile'));
  assert.ok(!compileCacheDirectory(paths, '../../evil').includes('..' + path.sep), 'sürüm adı klasör dışına taşamaz');
  fs.mkdirSync(current, { recursive: true }); fs.mkdirSync(old, { recursive: true });
  assert.equal(pruneCompileCaches(paths, '7.0.323'), 1);
  assert.ok(fs.existsSync(current));
  assert.ok(!fs.existsSync(old));
  assert.equal(pruneCompileCaches({ localDataRoot: path.join(root, 'yok') }, '7.0.323'), 0);
});

test('backend derleme önbelleği varsayılan kapalıdır; yalnız ölçüm bayrağıyla açılır, elle verilen dizin korunur', () => {
  const backend = read('electron/backend.js');
  assert.match(backend, /if \(!env\.NODE_COMPILE_CACHE && env\.BUYER_LOG_BACKEND_COMPILE_CACHE === '1'\) \{[\s\S]*?env\.NODE_COMPILE_CACHE = compileCacheDirectory\(this\.paths, version\);/);
  const server = read('server/server.js');
  const lines = server.split('\n');
  assert.match(lines[0], /waitForTrialBackend\(\)/, 'deneme kilidi hâlâ ilk satırdır');
  assert.ok(server.indexOf('enableBackendCompileCache()') < server.indexOf("require('express')"), 'önbellek modüllerden önce açılır');
  assert.match(server, /markStartup\('SERVER_READY'[^\n]*\n\s*if \(backendCompileCacheState\.status !== 'disabled'\) backendCompileCache\.scheduleCompileCacheFlush\(\);/);
});

test('derleme önbelleği gerçekten açılır ve diske yazılır', { skip: typeof require('node:module').enableCompileCache !== 'function' }, t => {
  const root = tmp('bl-ccache-run-'); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'cache');
  const script = [
    "const cc=require(" + JSON.stringify(path.join(APP, 'server', 'lib', 'compile-cache.js')) + ");",
    'const state=cc.enableBackendCompileCache();',
    "require(" + JSON.stringify(path.join(APP, 'server', 'lib', 'static-asset-hash.js')) + ");",
    "require('node:module').flushCompileCache&&require('node:module').flushCompileCache();",
    'process.stdout.write(JSON.stringify(state));',
  ].join('\n');
  const env = { ...process.env, NODE_COMPILE_CACHE: dir };
  const run = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const state = JSON.parse(run.stdout);
  assert.ok(['enabled', 'already_enabled'].includes(state.status), state.status);
  const written = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else written.push(f); } })(dir);
  assert.ok(written.length > 0, 'önbellek dosyası yazılmalı');
});

test('derleme önbelleği yoksa veya desteklenmiyorsa açılış etkilenmez', () => {
  assert.deepEqual(compileCache.enableBackendCompileCache({ env: {} }), { status: 'disabled' });
  assert.equal(compileCache.enableBackendCompileCache({ env: { NODE_COMPILE_CACHE: '/x' }, moduleApi: {} }).status, 'unsupported');
  const failing = { enableCompileCache() { throw new Error('boom'); } };
  assert.equal(compileCache.enableBackendCompileCache({ env: { NODE_COMPILE_CACHE: '/x' }, moduleApi: failing }).status, 'failed');
  const timers = [];
  const count = compileCache.scheduleCompileCacheFlush({ moduleApi: { flushCompileCache() {} }, setTimer: (fn, ms) => { timers.push(ms); return {}; } });
  assert.equal(count, timers.length);
  assert.ok(timers.length >= 1);
  assert.equal(compileCache.scheduleCompileCacheFlush({ moduleApi: {} }), 0);
});

test('sürüm geçişinde HTTP/V8 önbelleği korunur; statik katman her yanıta önbellek başlığı verir', () => {
  assert.deepEqual(RENDERER_STORAGES_CLEARED, ['serviceworkers', 'cachestorage']);
  const repair = read('electron/install-repair.js');
  assert.doesNotMatch(repair, /\.clearCache\(\)/, 'HTTP + kod önbelleği silinmez');
  // Önkoşul: kalıcı önbellek yalnız içerik özetli veya sürümlü adreslere verilir,
  // diğer her statik yanıt yeniden doğrulanır; tahmini (heuristic) önbellek yoktur.
  const server = read('server/server.js');
  const staticBlock = server.slice(server.indexOf("app.use(express.static(path.join(__dirname, '..', 'public'), {"));
  assert.match(staticBlock.slice(0, 600), /res\.setHeader\('Cache-Control', html \? 'no-store' : immutable \? 'public, max-age=31536000, immutable' : 'no-cache'\);/);
  assert.match(server, /res\.setHeader\('Cache-Control', versioned \? 'public, max-age=31536000, immutable' : 'no-cache'\);/);
});

test('onarım raporunun ikinci çekirdek taraması gecikmeli başlar ve açılışı beklemez', async t => {
  const portable = tmp('bl-repair-delay-'); t.after(() => fs.rmSync(portable, { recursive: true, force: true }));
  const appCore = path.join(portable, 'resources', 'app');
  fs.mkdirSync(path.join(appCore, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(appCore, 'package.json'), JSON.stringify({ version: '7.0.323' }));
  writeIntegrityManifest(appCore, { version: '7.0.323' });
  const startedAt = Date.now();
  const run = await runInstallRepair({ localDataRoot: path.join(portable, 'data', 'local'), appCoreRoot: appCore, currentVersion: '7.0.323', packaged: false, integrityDelayMs: 120 });
  assert.ok(Date.now() - startedAt < 120, 'onarım çağrısı bütünlük taramasını beklemez');
  const report = await run.integrity;
  assert.ok(Date.now() - startedAt >= 110);
  assert.equal(report.steps.integrity.status, 'ok');
  assert.match(read('electron/main.js'), /integrityDelayMs: INSTALL_REPAIR_INTEGRITY_DELAY_MS/);
});

test('GPU teşhisi pencere göründükten sonra ölçülür; ANGLE DLL\'leri kurulum listesine eklenmez', () => {
  const main = read('electron/main.js');
  assert.match(main, /mainWindow\.once\('show', \(\) => \{\s*const timer = setTimeout\(\(\) => logGpuDiagnostics\('window-shown'\), GPU_DIAGNOSTIC_DELAY_MS\);/);
  assert.match(main, /logGpuDiagnostics\('gpu-gone'\)/);
  assert.match(main, /app\.getGPUInfo\('basic'\)/);
  // Yalnız donanım/sürücü kimliği yazılır; makine/kullanıcı bilgisi taşıyan alanlar seçilmez.
  const summary = main.slice(main.indexOf('function gpuInfoSummary(info)'), main.indexOf('function logGpuDiagnostics('));
  assert.match(summary, /\['active', 'vendorId', 'deviceId', 'driverVendor', 'driverVersion'\]/);
  assert.doesNotMatch(summary, /machineModel|userName|hostname/i);
  // Electron 44 resmi paketi bu DLL'leri içermez (statik ANGLE); eksik sanılıp eklenmemeli.
  const installer = read('scripts/build-installer.js');
  const required = /const REQUIRED_RUNTIME=\[([^\]]*)\]/.exec(installer)[1];
  assert.doesNotMatch(required, /libEGL|libGLESv2/);
});

test('updater durum temizliği onarım çağrısı dönmeden (senkron) biter; launcher sağlık onayıyla yarışmaz', async t => {
  const { BuyerLogUpdater } = require('../electron/update/updater');
  const portable = tmp('bl-repair-race-'); t.after(() => fs.rmSync(portable, { recursive: true, force: true }));
  const appCore = path.join(portable, 'resources', 'app');
  fs.mkdirSync(path.join(appCore, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(appCore, 'package.json'), JSON.stringify({ version: '7.0.323' }));
  writeIntegrityManifest(appCore, { version: '7.0.323' });
  const localDataRoot = path.join(portable, 'data', 'local');
  const updater = new BuyerLogUpdater({ currentVersion: '7.0.323', appCoreRoot: appCore, portableRoot: portable, localDataRoot, packaged: true });
  updater.saveState({ state: 'ROLLBACK', failedVersions: { '7.0.322': { sha256: 'x' } }, lastError: { code: 'UPDATE_HEALTH_FAILED' } });
  let releaseCache;
  const session = { defaultSession: { clearStorageData: () => new Promise(resolve => { releaseCache = resolve; }) } };
  const pending = runInstallRepair({ localDataRoot, appCoreRoot: appCore, currentVersion: '7.0.323', updater, session, packaged: true, integrityDelayMs: 1 });
  // Önbellek temizliği henüz bitmedi; durum dosyası şimdiden temiz olmalı.
  assert.equal(updater.state().state, 'IDLE');
  assert.deepEqual(updater.state().failedVersions, {});
  // Launcher'ın sağlık onayı bu arada aynı dosyaya yazar; onarımın kalanı onu ezmemeli.
  updater.saveState({ state: 'SUCCESS', lastKnownGoodVersion: '7.0.323' });
  releaseCache();
  const run = await pending; await run.integrity;
  assert.equal(updater.state().state, 'SUCCESS', 'sağlık onayı korunur');
  const main = read('electron/main.js');
  const ready = main.slice(main.indexOf('app.whenReady().then(async () => {'));
  assert.ok(ready.indexOf('void installRepairDone.then(() => {\n      scheduleUpdateChecks();') > 0, 'güncelleme kontrolü onarımdan sonra başlar');
});
