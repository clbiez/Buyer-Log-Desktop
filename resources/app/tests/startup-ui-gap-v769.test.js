'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb, migrateLegacyFiles } = require('../server/lib/local-db');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const PERF = read('public/perf-runtime.js');
const SERVER = read('server/server.js');
const SYNC = read('server/lib/sync-settings.js');

test('LOCAL_STATE_READY ile UI_FIRST_RENDER arasındaki bütün startup aşamaları ölçülür', () => {
  for (const marker of [
    'FRONTEND_BOOTSTRAP_START', 'FRONTEND_BOOTSTRAP_READY', 'DOM_CREATION_READY',
    'CACHE_LOAD_START', 'CACHE_LOAD_READY', 'AUTH_USER_LOAD_START', 'AUTH_USER_LOAD_READY',
    'DATASOURCE_PREPARATION_START', 'DATASOURCE_PREPARATION_READY',
    'FILTER_PIVOT_INIT_START', 'FILTER_PIVOT_INIT_READY',
    'IMAGE_THUMBNAIL_INIT_START', 'IMAGE_THUMBNAIL_INIT_READY',
    'ACTIVE_MODULE_INIT_START', 'ACTIVE_MODULE_INIT_READY',
    'TABLE_RENDER_START', 'TABLE_RENDER_READY', 'UI_FIRST_RENDER', 'UI_READY',
  ]) assert.ok(`${INDEX}\n${APP}\n${PERF}\n${SERVER}`.includes(marker), `${marker} eksik`);
  assert.match(SERVER, /STARTUP_CLIENT_MARKS/);
  assert.match(SERVER, /clientElapsedMs/);
});

test('Overview açılışında görünmeyen modül paketleri eager yüklenmez ve yalnız aktif modül render edilir', () => {
  for (const file of ['automations.js', 'lfl.js', 'lfl-order-analytics.js', 'quotations.js', 'collection-analytics.js']) {
    assert.doesNotMatch(INDEX, new RegExp(`<script[^>]+src=["']${file.replace('.', '\\.')}[?"']`));
    assert.ok(PERF.includes(file), `${file} lazy feature kaydında yok`);
  }
  assert.match(APP, /ensureFeature\('lfl'\)/);
  assert.match(APP, /ensureFeature\('automations'\)/);
  assert.match(APP, /ensureFeature\('collectionTools'\)/);
  assert.match(APP, /function renderStartupActiveModule\(/);
  const initial = APP.slice(APP.indexOf('function renderStartupActiveModule('), APP.indexOf('function renderStartupActiveModule(') + 900);
  assert.doesNotMatch(initial, /renderCP\(\)|renderOrders\(\)/);
});

test('Overview projection cache miss ham snapshotı UI kritik yolunda açmaz', () => {
  const build = SERVER.slice(SERVER.indexOf('async function buildResponse('), SERVER.indexOf("app.get('/api/data'"));
  assert.match(build, /else if \(startup\) \{/);
  assert.match(build, /overviewDeferred: startup && !cached\.hit/);
  assert.match(SERVER, /app\.get\('\/api\/data\/overview'/);
  assert.match(APP, /async function ensureOverviewLoaded\(/);
  // v20260926: UI sonrası yükleme yalnız Genel Bakış açıksa; modül sekmesinde ilk girişte (switchTab).
  assert.match(APP, /if\(state\.overviewDeferred&&currentActiveTab\(\)==='overview'\)void ensureOverviewLoaded\(\)/);
  assert.match(APP, /if\(tab==='overview'&&state\.overviewDeferred\)void ensureOverviewLoaded\(\);/);
  const startupMiss = build.slice(build.indexOf('else if (startup) {'), build.indexOf('else if (!sourceFilterRequired)'));
  assert.doesNotMatch(startupMiss, /ensureDataLoaded\(/);
});

test('kullanılmayan legacy dosya migrationı klasörleri taramadan tek seferlik retired kaydı bırakır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-retired-legacy-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  await fsp.mkdir(path.join(root, 'legacy'), { recursive: true });
  await fsp.writeFile(path.join(root, 'legacy', 'large.bin'), Buffer.alloc(1024 * 1024, 7));
  const migrated = await migrateLegacyFiles(db, [path.join(root, 'legacy')]);
  const state = await db.read();
  assert.deepEqual(migrated, []);
  assert.equal(state.migrations.legacyFiles.status, 'retired');
  assert.equal(Object.keys(state.assets || {}).length, 0);
});

test('arka plan sync yazma probu çalıştırmaz ve checkpoint kararını ölçer', () => {
  const run = SYNC.slice(SYNC.indexOf('async function runSyncOnce()'), SYNC.indexOf('async function syncOnce()'));
  assert.doesNotMatch(run, /await testConnection\(root\)/);
  assert.match(run, /SYNC_CHECKPOINT_EVALUATED/);
  assert.match(run, /LEGACY_SYNC_SCAN_START/);
  assert.match(run, /LEGACY_SYNC_SCAN_COMPLETE/);
  assert.match(run, /NETWORK_SCAN_COMPLETE/);
});
