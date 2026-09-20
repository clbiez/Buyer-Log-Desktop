'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const LIVE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'live-events.js'), 'utf8');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { SYNC_PACKAGE_DIR, SYNC_GZIP_SUFFIX, isBundleFile, validateSyncPackage } = require('../server/lib/sync-package');
const zlib = require('node:zlib');
const liveEvents = require('../server/lib/live-events');

test('empty shared sync folder is rejected instead of resolving to the app folder', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-empty-root-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });

  await assert.rejects(sync.testConnection(''), /Sync klasörü bulunamadı/i);
});

test('sync writes an atomic ready package and publishes live transfer telemetry', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-ready-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db'));
  const states = [];
  const sync = createSyncSettings({
    localDataRoot: path.join(root, 'settings'),
    localDb: db,
    onStateChange: state => states.push(state),
  });
  await db.queuePatch({ id: 'ready-1', patch: { name: 'ready' } });
  await sync.save(shared);

  const result = await sync.syncOnce();
  const deviceRoot = path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(db.getDeviceId()));
  const names = await fsp.readdir(deviceRoot);
  const bundleRoot = path.join(deviceRoot, SYNC_PACKAGE_DIR);
  const ready = (await fsp.readdir(bundleRoot)).filter(name => isBundleFile(name));

  assert.equal(result.online, true);
  assert.equal(result.uploadedEvents, 1);
  assert.equal(result.uploadedPackages, 1);
  assert.ok(result.networkBytesWritten > 0);
  assert.equal(ready.length, 1);
  const bundlePath = path.join(bundleRoot, ready[0]);
  const raw = await fsp.readFile(bundlePath);
  const decoded = ready[0].endsWith(SYNC_GZIP_SUFFIX) ? zlib.gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  const manifest = validateSyncPackage(JSON.parse(decoded));
  assert.equal(manifest.events[0].id, 'ready-1');
  assert.equal(names.some(name => name.endsWith('.tmp')), false);
  assert.equal((await fsp.readdir(bundleRoot)).some(name => name.endsWith('.tmp')), false);
  assert.ok(states.some(state => state.progress && state.progress.phase === 'upload'));
  assert.ok(states.some(state => state.progress && state.progress.uploadDone === 1));
  assert.ok(states.some(state => state.progress === null && state.online === true));

  const remoteDb = createLocalDb(path.join(root, 'remote-db', 'BuyerLogLocal.db'));
  const remoteSync = createSyncSettings({ localDataRoot: path.join(root, 'remote-settings'), localDb: remoteDb });
  await remoteSync.save(shared);
  const remoteResult = await remoteSync.syncOnce();
  assert.equal(remoteResult.downloadedEvents, 1);
  assert.equal((await remoteDb.read()).records['ready-1'].name, 'ready');
});

test('Sync Status uses a hierarchy with upload/download cards, advanced details and live updates', () => {
  assert.match(APP, /syncStatusModalRenderer/);
  assert.match(APP, /syncTransferCard/);
  assert.match(APP, /syncAdvancedDetails/);
  assert.match(APP, /data-sync-status/);
  assert.match(APP, /data-sync-now/);
  assert.match(APP, /payload\.area===['"]sync['"]/);
  assert.match(APP, /new Intl\.RelativeTimeFormat/);
  assert.match(LIVE, /notifySyncStatus/);
  assert.match(CSS, /\.syncStatusModalCard/);
  assert.match(CSS, /\.syncTransferGrid/);
  assert.match(CSS, /\.syncStatusSource\{display:block/);
});

test('sync status SSE is sent only to authorized source subscribers', () => {
  const visible = [], hidden = [];
  const source = liveEvents.addClient({ write: value => visible.push(value) }, 'source-test');
  const other = liveEvents.addClient({ write: value => hidden.push(value) }, 'other-test');
  try {
    liveEvents.notifySyncStatus({ pendingUpload: 2 }, entry => entry === source);
    assert.equal(visible.length, 1);
    assert.equal(hidden.length, 0);
    assert.match(visible[0], /"area":"sync"/);
    assert.match(visible[0], /"pendingUpload":2/);
  } finally {
    liveEvents.removeClient(source);
    liveEvents.removeClient(other);
  }
});
