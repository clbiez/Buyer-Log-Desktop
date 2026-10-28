'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const PERF = fs.readFileSync(path.join(ROOT, 'public', 'perf-runtime.js'), 'utf8');
const SYNC = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'sync-settings.js'), 'utf8');
const WORKER = fs.readFileSync(path.join(ROOT, 'server', 'workers', 'excel-worker.js'), 'utf8');

test('startup kritik yolu sunucu dinlemeden önce ağdaki KUR dosyasına erişmez', () => {
  const beforeListen = SERVER.slice(0, SERVER.indexOf('const httpServer = app.listen'));
  assert.doesNotMatch(beforeListen, /const startupFxSync\s*=\s*syncFxFromKurWorkbook\(/);
  assert.match(WORKER, /task === 'loadFxWorkbookFromDirectories'/);
  assert.match(SERVER, /runExcelTask\('loadFxWorkbookFromDirectories'/);
});

test('UI yerel state ile hazır olur; yardımcı yükler ve sync sonradan başlar', () => {
  const start = APP.indexOf("window.addEventListener('DOMContentLoaded', async ()");
  const block = APP.slice(start, start + 2200);
  assert.ok(start >= 0, 'local-first DOMContentLoaded başlangıcı bulunamadı');
  assert.match(block, /await loadInitialBuyerLogData\(\)/);
  assert.doesNotMatch(block, /await Promise\.all\(\[loadInitialBuyerLogData\(\),loadPlmStyleLinks/);
  assert.match(block, /scheduleStartupScreenReady[\s\S]*UI_READY[\s\S]*signalStartupReady/);
  const scheduler=APP.slice(APP.indexOf('function scheduleStartupScreenReady('),start);
  assert.match(scheduler,/requestAnimationFrame\(\(\)=>requestAnimationFrame\(callback\)\)/,'visible startup still waits for two paint frames');
  assert.doesNotMatch(APP,/startupWarm/,'no hidden native startup tabs: modules warm inside this renderer');
  assert.match(APP.slice(start,start+4000),/\.then\(scheduleBackgroundModuleWarmup\)/,'authorized modules warm in the background after the first screen');
  assert.match(SERVER, /app\.post\('\/api\/startup\/ready'/);
  assert.match(SERVER, /BACKGROUND_SYNC_DELAY_MS\s*=\s*2500/);
  assert.match(SERVER, /if\s*\(!uiReadySignaled\)\s*return/);
  assert.match(SERVER, /const localDbReadyPromise\s*=\s*\(async \(\)\s*=>/);
  assert.doesNotMatch(SERVER, /await localBootstrapPromise/);
  assert.doesNotMatch(SERVER, /migrateLegacyFiles\(localDb/);
});

test('startup ve ağ performans işaretleri tek performans günlüğünde bulunur', () => {
  assert.match(PERF, /function mark\(/);
  assert.match(PERF, /timeline/);
  for (const marker of [
    'APP_BOOT_START', 'LOCAL_CONFIG_READY', 'LOCAL_DB_READY', 'LOCAL_STATE_READY',
    'UI_FIRST_RENDER', 'UI_READY', 'BACKGROUND_SYNC_START', 'NETWORK_FIRST_ACCESS',
    'NETWORK_SCAN_COMPLETE', 'SYNC_COMPLETE',
  ]) assert.ok(`${SERVER}\n${APP}\n${PERF}\n${SYNC}`.includes(marker), `${marker} eksik`);
});

test('checkpoint head bilgisi değişmeyen büyük cihaz klasörünü paket taramadan atlar', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-local-first-sync-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const traces = [];
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db, trace: (name, detail) => traces.push({ name, detail }) });
  await fsp.mkdir(shared, { recursive: true });
  await sync.save(shared);

  const foreign = 'foreign-device';
  const foreignDir = path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(foreign));
  await fsp.mkdir(foreignDir, { recursive: true });
  const delta = {
    eventId: 'foreign-1', id: 'row-1', patch: { name: 'remote' }, revision: 1,
    baseRevision: 0, deviceId: foreign, localSequence: 1,
  };
  const crypto = require('node:crypto');
  delta.sha256 = crypto.createHash('sha256').update(JSON.stringify({ ...delta, sha256: undefined }), 'utf8').digest('hex');
  await fsp.writeFile(path.join(foreignDir, '000000000001-foreign-1.json'), JSON.stringify(delta));
  await sync.syncOnce();
  await fsp.writeFile(path.join(foreignDir, '_head.json'), JSON.stringify({ latestSequence: 1 }));

  const second = await sync.syncOnce();
  assert.equal(second.scannedPackages, 0);
  assert.equal(second.skippedDeviceFolders, 1);
  assert.ok(traces.some(item => item.name === 'NETWORK_FIRST_ACCESS'));
  assert.ok(traces.some(item => item.name === 'NETWORK_SCAN_COMPLETE'));
  assert.ok(traces.some(item => item.name === 'SYNC_COMPLETE'));
});

test('Sync & Local Data gerekli yerel/ağ ölçümlerini gösterir', () => {
  for (const field of ['downloadedEvents', 'uploadedEvents', 'lastDurationMs', 'networkBytesRead', 'networkBytesWritten', 'localSnapshotDate']) {
    assert.ok(APP.includes(field), `${field} UI alanı eksik`);
  }
});
