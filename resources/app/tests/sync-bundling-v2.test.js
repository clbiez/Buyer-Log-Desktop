'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings, SYNC_PACKAGE_MAX_EVENTS, SYNC_PACKAGE_MAX_BYTES } = require('../server/lib/sync-settings');
const { buildSyncPackages, coalescePendingEvents, validateSyncPackage, SYNC_PACKAGE_DIR, isBundleFile, SYNC_GZIP_SUFFIX } = require('../server/lib/sync-package');
const zlib = require('node:zlib');
const { createDeltaStore } = require('../server/lib/delta-store');

function temp(t, prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix)).then(root => {
    t.after(() => fsp.rm(root, { recursive: true, force: true }));
    return root;
  });
}
function deviceRoot(shared, db) { return path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(db.getDeviceId())); }
async function readBundle(file){ const raw=await fsp.readFile(file); const text=String(file).endsWith(SYNC_GZIP_SUFFIX)?zlib.gunzipSync(raw).toString('utf8'):raw.toString('utf8'); return JSON.parse(text); }

async function advertise(sync) { await sync.syncOnce(); }

test('v2 package limits are centralized and sane', () => {
  assert.equal(SYNC_PACKAGE_MAX_EVENTS, 500);
  assert.ok(SYNC_PACKAGE_MAX_BYTES >= 512 * 1024 && SYNC_PACKAGE_MAX_BYTES <= 1024 * 1024);
});

test('50 adjacent updates to the same entity coalesce only in transport', async t => {
  const root = await temp(t, 'buyerlog-coalesce-');
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  for (let i = 0; i < 50; i++) await db.queuePatch({ id: 'collection:style-123', entityType: 'collection', patch: { value: i } });
  const pending = await db.pending(1000);
  assert.equal(pending.length, 50, 'local audit journal remains event-complete');
  const transport = coalescePendingEvents(pending);
  assert.equal(transport.length, 1, 'network transport collapses adjacent safe updates');
  assert.equal(transport[0].patch.value, 49);
  assert.equal(transport[0].sourceEventIds.length, 50);
  assert.equal((await db.read()).journal.length, 50, 'coalescing does not rewrite local journal');
});

test('10,000 pending events become about 20 bundled files, not 10,000 ready files', async t => {
  const root = await temp(t, 'buyerlog-bundle-10k-');
  const shared = path.join(root, 'shared'); await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db, networkTimeoutMs: 30000 });
  await sync.save(shared);
  await db.queuePatches(Array.from({ length: 10000 }, (_, i) => ({ id: `row-${i}`, patch: { value: i } })));
  const result = await sync.syncOnce();
  assert.equal(result.pendingUpload, 0);
  assert.equal(result.uploadedEvents, 10000);
  assert.ok(result.uploadedPackages >= 20 && result.uploadedPackages <= 40, `unexpected package count ${result.uploadedPackages}`);
  const rootFiles = await fsp.readdir(deviceRoot(shared, db));
  assert.equal(rootFiles.filter(name => name.endsWith('.ready')).length, 0, 'v2 does not emit event-per-file ready files at device root');
  const bundleFiles = (await fsp.readdir(path.join(deviceRoot(shared, db), SYNC_PACKAGE_DIR))).filter(name => isBundleFile(name));
  assert.equal(bundleFiles.length, result.uploadedPackages);
  assert.ok(bundleFiles.length <= 40);
  const sample = validateSyncPackage(await readBundle(path.join(deviceRoot(shared, db), SYNC_PACKAGE_DIR, bundleFiles[0])));
  assert.equal(sample.version, 2);
  assert.ok(sample.sourceEventCount <= 500);
});

test('package failure checkpoints completed packages and next sync resumes from remaining events', async t => {
  const root = await temp(t, 'buyerlog-bundle-fail-');
  const shared = path.join(root, 'shared'); await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db, networkTimeoutMs: 30000 });
  await sync.save(shared);
  await db.queuePatches(Array.from({ length: 10000 }, (_, i) => ({ id: `row-${i}`, patch: { value: i } })));

  const originalRename = fsp.rename;
  const seen = new Set(); let failTarget = null;
  fsp.rename = async (from, to) => {
    const target = String(to);
    if (target.includes(`${path.sep}${SYNC_PACKAGE_DIR}${path.sep}`) && isBundleFile(path.basename(target))) {
      seen.add(target);
      if (!failTarget && seen.size === 16) failTarget = target;
      if (target === failTarget) { const error = new Error('EIO: simulated network disconnect'); error.code = 'EIO'; throw error; }
    }
    return originalRename(from, to);
  };
  let first;
  try { first = await sync.syncOnce(); } finally { fsp.rename = originalRename; }
  assert.equal(first.uploadFailures, 1);
  assert.equal(first.uploadedPackages, 15);
  assert.equal(first.uploadedEvents, 7500);
  assert.equal(first.pendingUpload, 2500, 'only not-yet-packaged events remain pending');
  assert.equal(await db.pendingCount(), 2500);

  const second = await sync.syncOnce();
  assert.equal(second.uploadFailures, 0);
  assert.equal(second.uploadedEvents, 2500);
  assert.equal(second.pendingUpload, 0);
});

test('same v2 package read twice is package-idempotent and ACK can be rewritten', async t => {
  const root = await temp(t, 'buyerlog-bundle-idempotent-');
  const shared = path.join(root, 'shared'); await fsp.mkdir(shared, { recursive: true });
  const db1 = createLocalDb(path.join(root, 'd1', 'BuyerLogLocal.db'));
  const db2 = createLocalDb(path.join(root, 'd2', 'BuyerLogLocal.db'));
  const s1 = createSyncSettings({ localDataRoot: path.join(root, 's1'), localDb: db1 });
  const s2 = createSyncSettings({ localDataRoot: path.join(root, 's2'), localDb: db2 });
  await s1.save(shared); await s2.save(shared);
  await advertise(s1); await advertise(s2); await advertise(s1);
  await db1.queuePatch({ id: 'row-1', patch: { value: 'A' } });
  await s1.syncOnce();
  const first = await s2.syncOnce();
  assert.equal(first.downloadedEvents, 1);
  const state1 = await db2.read();
  assert.equal(state1.records['row-1'].value, 'A');
  assert.equal(Object.keys(state1.appliedPackages || {}).length, 1);

  const sourceId = db1.getDeviceId();
  await db2.transaction(async state => { state.syncCheckpoints[sourceId] = 0; return null; });
  const second = await s2.syncOnce();
  assert.equal(second.corruptPackages, 0);
  const state2 = await db2.read();
  assert.equal(state2.records['row-1'].value, 'A');
  assert.equal(Object.keys(state2.appliedPackages || {}).length, 1, 'package is not applied twice');
});

test('restart and repeated seedOnce do not generate a new full journal', async t => {
  const root = await temp(t, 'buyerlog-seed-once-');
  const file = path.join(root, 'local', 'BuyerLogLocal.db');
  const db1 = createLocalDb(file); await db1.ensure();
  const store1 = createDeltaStore({ localDb: db1, mode: 'shadow' });
  const entries = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`id-${i}`, { value: i }]));
  const first = await store1.seedOnce('seed-regression', entries);
  assert.equal(first.seeded, 250);
  const journalAfterFirst = (await db1.read()).journal.length;
  assert.equal(journalAfterFirst, 250);

  const db2 = createLocalDb(file); await db2.ensure();
  const store2 = createDeltaStore({ localDb: db2, mode: 'shadow' });
  const second = await store2.seedOnce('seed-regression', entries);
  assert.equal(second.skipped, true);
  assert.equal((await db2.read()).journal.length, journalAfterFirst, 'restart does not re-seed the entire dataset');
});

test('active legacy peer forces safe v1 compatibility mode instead of creating an unreadable split', async t => {
  const root = await temp(t, 'buyerlog-legacy-peer-');
  const shared = path.join(root, 'shared'); await fsp.mkdir(shared, { recursive: true });
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await sync.save(shared);
  const legacyRoot = path.join(shared, 'BUYER_LOG_SYNC', 'changes', 'legacy-device');
  await fsp.mkdir(legacyRoot, { recursive: true });
  await fsp.writeFile(path.join(legacyRoot, '_head.json'), JSON.stringify({ deviceId: 'legacy-device', latestSequence: 0, updatedAt: new Date().toISOString() }));
  await db.queuePatch({ id: 'row-1', patch: { value: 'A' } });
  const result = await sync.syncOnce();
  assert.equal(result.legacyCompatibilityMode, true);
  assert.deepEqual(result.legacyPeerDevices, ['legacy-device']);
  const files = await fsp.readdir(deviceRoot(shared, db));
  assert.equal(files.filter(name => name.endsWith('.ready')).length, 1, 'legacy peer receives v1-readable event file');
});

test('small PLM style-link update mirrors only changed records, not the full registry', async t => {
  const { execFileSync } = require('node:child_process');
  const root = await temp(t, 'buyerlog-plm-delta-scope-');
  const serverData = path.join(root, 'server-data');
  await fsp.mkdir(serverData, { recursive: true });
  const links = {};
  for (let i = 1; i <= 5000; i++) links[String(i)] = { plmId: String(i), styleId: String(100000 + i), styleName: `Style ${i}`, specialCode: '', season: 'S7' };
  await fsp.writeFile(path.join(serverData, 'plm-style-links.json'), JSON.stringify({ schemaVersion: 1, links, _revision: 1, _updatedAt: null }));
  const modulePath = path.join(__dirname, '..', 'server', 'lib', 'plm-style-links.js');
  const script = `
    const plm = require(${JSON.stringify(modulePath)});
    let mirrored = null;
    plm.attachDeltaStore({
      isAuthoritative: false,
      writesLegacy: false,
      mirror(collection, entries) { mirrored = { collection, keys: Object.keys(entries || {}) }; },
      writeMeta() {},
    });
    const result = plm.upsertPlmStyleLinks([{ plmId: '2500', styleId: '999999', styleName: 'Changed', season: 'S7' }], { id: 'tester' });
    process.stdout.write(JSON.stringify({ result: { added: result.added, updated: result.updated }, mirrored }));
  `;
  const output = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: serverData }, encoding: 'utf8' });
  const parsed = JSON.parse(output);
  assert.equal(parsed.result.updated, 1);
  assert.deepEqual(parsed.mirrored.keys, ['2500'], 'a one-record edit must not mirror all 5,000 PLM links into the journal');
});

test('v2 ACK marks all source events in the acknowledged package range', async t => {
  const root = await temp(t, 'buyerlog-package-ack-');
  const shared = path.join(root, 'shared'); await fsp.mkdir(shared, { recursive: true });
  const db1 = createLocalDb(path.join(root, 'd1', 'BuyerLogLocal.db'));
  const db2 = createLocalDb(path.join(root, 'd2', 'BuyerLogLocal.db'));
  const s1 = createSyncSettings({ localDataRoot: path.join(root, 's1'), localDb: db1 });
  const s2 = createSyncSettings({ localDataRoot: path.join(root, 's2'), localDb: db2 });
  await s1.save(shared); await s2.save(shared);
  await advertise(s1); await advertise(s2); await advertise(s1);
  await db1.queuePatches(Array.from({ length: 25 }, (_, i) => ({ id: `ack-${i}`, patch: { value: i } })));
  const sent = await s1.syncOnce();
  assert.equal(sent.pendingUpload, 0);
  assert.equal(sent.pendingAck, 25);
  const received = await s2.syncOnce();
  assert.equal(received.downloadedEvents, 25);
  const acknowledged = await s1.syncOnce();
  assert.equal(acknowledged.pendingAck, 0, 'package-level ACK should acknowledge the complete source sequence range');
});

test('tampered v2 package is rejected without applying any event', async t => {
  const root = await temp(t, 'buyerlog-package-corrupt-');
  const shared = path.join(root, 'shared'); await fsp.mkdir(shared, { recursive: true });
  const sender = createLocalDb(path.join(root, 'sender', 'BuyerLogLocal.db'));
  const receiver = createLocalDb(path.join(root, 'receiver', 'BuyerLogLocal.db'));
  const s1 = createSyncSettings({ localDataRoot: path.join(root, 's1'), localDb: sender });
  const s2 = createSyncSettings({ localDataRoot: path.join(root, 's2'), localDb: receiver });
  await s1.save(shared); await s2.save(shared);
  await advertise(s1); await advertise(s2); await advertise(s1);
  await sender.queuePatch({ id: 'corrupt-v2', patch: { value: 'good' } });
  await s1.syncOnce();
  const bundleDir = path.join(deviceRoot(shared, sender), SYNC_PACKAGE_DIR);
  const [name] = (await fsp.readdir(bundleDir)).filter(item => isBundleFile(item));
  const file = path.join(bundleDir, name);
  const payload = await readBundle(file);
  payload.events[0].patch.value = 'tampered';
  const tampered=Buffer.from(JSON.stringify(payload),'utf8');
  await fsp.writeFile(file, name.endsWith(SYNC_GZIP_SUFFIX)?zlib.gzipSync(tampered):tampered);
  const result = await s2.syncOnce();
  assert.equal(result.corruptPackages, 1);
  assert.equal((await receiver.read()).records['corrupt-v2'], undefined);
});
