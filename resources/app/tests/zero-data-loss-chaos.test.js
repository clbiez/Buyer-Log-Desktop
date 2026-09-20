'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { createDurableFileRecovery } = require('../server/lib/durable-file-recovery');
const { withFileLeaseAsync } = require('../server/lib/shared-file-transaction');

async function sandbox(t, name) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `buyerlog-chaos-${name}-`));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}
async function dbAt(root, name = 'db') {
  const db = createLocalDb(path.join(root, name, 'BuyerLogLocal.db'));
  await db.ensure(); return db;
}

test('chaos 01 · network disconnect does not roll back a durable local save', async t => {
  const root = await sandbox(t, 'network-offline'), db = await dbAt(root);
  await db.queuePatch({ id: 'r1', patch: { value: 'local' } });
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await sync.save(path.join(root, 'missing-share'));
  const status = await sync.syncOnce();
  assert.equal(status.online, false); assert.equal((await db.read()).records.r1.value, 'local'); assert.equal((await db.pending()).length, 1);
});

test('chaos 02 · invalid shared-folder target leaves the event pending', async t => {
  const root = await sandbox(t, 'share-file'), db = await dbAt(root);
  const notDirectory = path.join(root, 'not-a-folder'); await fsp.writeFile(notDirectory, 'x');
  await db.queuePatch({ id: 'r1', patch: { value: 1 } });
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db }); await sync.save(notDirectory);
  assert.equal((await sync.syncOnce()).online, false); assert.equal((await db.pending()).length, 1);
});

test('chaos 03 · crash before target replace is recovered from durable intent', async t => {
  const root = await sandbox(t, 'before-replace'), target = path.join(root, 'data.json');
  await fsp.writeFile(target, '{"v":1}');
  const recovery = createDurableFileRecovery({ recoveryRoot: path.join(root, 'wal'), allowedRoots: [root] });
  recovery.prepareSync(target, Buffer.from('{"v":2}'));
  assert.equal(recovery.recoverSync().recovered, 1); assert.equal(JSON.parse(await fsp.readFile(target, 'utf8')).v, 2);
});

test('chaos 04 · crash after target replace but before cleanup is idempotent', async t => {
  const root = await sandbox(t, 'after-replace'), target = path.join(root, 'data.json');
  await fsp.writeFile(target, '{"v":1}');
  const recovery = createDurableFileRecovery({ recoveryRoot: path.join(root, 'wal'), allowedRoots: [root] });
  const intent = recovery.prepareSync(target, Buffer.from('{"v":2}'));
  await fsp.writeFile(target, '{"v":2}');
  const result = recovery.recoverSync();
  assert.equal(result.committed, 1); assert.equal(result.recovered, 0); assert.equal(recovery.recoverSync().committed, 0); assert.equal(intent.after.size, 7);
});

test('chaos 05 · local commit survives process recreation before sync', async t => {
  const root = await sandbox(t, 'restart-before-sync'), file = path.join(root, 'db', 'BuyerLogLocal.db');
  const first = createLocalDb(file); await first.queuePatch({ id: 'r1', patch: { value: 'kept' } });
  const restarted = createLocalDb(file);
  assert.equal((await restarted.read()).records.r1.value, 'kept'); assert.equal((await restarted.pending()).length, 1);
});

test('chaos 06 · repeated sync is idempotent after an interrupted upload boundary', async t => {
  const root = await sandbox(t, 'sync-retry'), shared = path.join(root, 'shared'); await fsp.mkdir(shared);
  const one = await dbAt(root, 'one'), two = await dbAt(root, 'two');
  const s1 = createSyncSettings({ localDataRoot: path.join(root, 's1'), localDb: one }), s2 = createSyncSettings({ localDataRoot: path.join(root, 's2'), localDb: two });
  await one.queuePatch({ id: 'r1', eventId: 'stable-event', patch: { value: 7 } }); await s1.save(shared); await s2.save(shared);
  await s1.syncOnce(); await s1.syncOnce(); await s2.syncOnce(); await s2.syncOnce();
  assert.equal((await two.read()).records.r1.value, 7); assert.equal(Object.keys((await two.read()).appliedEvents).length, 1);
});

test('chaos 07 · source snapshot write cannot replace a user mutation store', async t => {
  const root = await sandbox(t, 'refresh-save'), db = await dbAt(root);
  await db.queuePatch({ id: 'override:o1', patch: { price: 13 } });
  const snapshot = path.join(root, 'source-snapshot.json'); await fsp.writeFile(snapshot, JSON.stringify({ price: 12.5 }));
  assert.equal((await db.read()).records['override:o1'].price, 13);
});

test('chaos 08 · stale remote value cannot overwrite a newer local field', async t => {
  const root = await sandbox(t, 'stale-remote'), db = await dbAt(root);
  await db.queuePatch({ id: 'r1', patch: { price: 13 } });
  const result = await db.applyDelta({ eventId: 'remote-old', id: 'r1', patch: { price: 12.5 }, revision: 1, baseRevision: 0, deviceId: 'remote', localSequence: 1 });
  assert.equal((await db.read()).records.r1.price, 13); assert.equal(result.conflicts.length, 1);
});

test('chaos 09 · retrying the same mutation identity creates one logical event', async t => {
  const root = await sandbox(t, 'duplicate'), db = await dbAt(root);
  const first = await db.queuePatch({ id: 'r1', eventId: 'same-id', patch: { n: 1 } });
  const second = await db.queuePatch({ id: 'r1', eventId: 'same-id', patch: { n: 1 } });
  assert.equal(first.duplicate, false); assert.equal(second.duplicate, true); assert.equal((await db.read()).journal.length, 1);
});

test('chaos 10 · two devices editing different fields merge without loss', async t => {
  const root = await sandbox(t, 'different-fields'), db = await dbAt(root);
  await db.queuePatch({ id: 'r1', patch: { price: 13 } });
  const result = await db.applyDelta({ eventId: 'remote-field', id: 'r1', patch: { note: 'remote' }, revision: 2, baseRevision: 0, deviceId: 'remote', localSequence: 1 });
  const row = (await db.read()).records.r1;
  assert.equal(row.price, 13); assert.equal(row.note, 'remote'); assert.equal(result.conflicts.length, 0);
});

test('chaos 11 · two devices editing the same field create a conflict', async t => {
  const root = await sandbox(t, 'same-field'), db = await dbAt(root);
  await db.queuePatch({ id: 'r1', patch: { note: 'local' } });
  const result = await db.applyDelta({ eventId: 'remote-conflict', id: 'r1', patch: { note: 'remote' }, revision: 2, baseRevision: 0, deviceId: 'remote', localSequence: 1 });
  assert.equal((await db.read()).records.r1.note, 'local'); assert.equal(result.conflicts[0].field, 'note');
});

test('chaos 12 · offline delete remains a recoverable pending tombstone', async t => {
  const root = await sandbox(t, 'offline-delete'), db = await dbAt(root);
  await db.queuePatch({ id: 'r1', patch: { value: 1 } }); await db.tombstone({ id: 'r1', eventId: 'delete-r1' });
  const state = await db.read();
  assert.equal(state.records.r1, undefined); assert.equal(state.tombstones.r1.id, 'r1'); assert.ok((await db.pending()).some(item => item.eventId === 'delete-r1'));
});

test('chaos 13 · busy DB lease serializes save instead of losing it', async t => {
  const root = await sandbox(t, 'busy'), db = await dbAt(root), file = db.getFile();
  let release; const gate = new Promise(resolve => { release = resolve; });
  const holder = withFileLeaseAsync(file, async () => gate);
  await new Promise(resolve => setTimeout(resolve, 30));
  const save = db.queuePatch({ id: 'r1', patch: { value: 'after-wait' } });
  setTimeout(release, 80); await Promise.all([holder, save]);
  assert.equal((await db.read()).records.r1.value, 'after-wait');
});

test('chaos 14 · save then immediate close is recoverable', async t => {
  const root = await sandbox(t, 'immediate-close'), target = path.join(root, 'business.json');
  const first = createDurableFileRecovery({ recoveryRoot: path.join(root, 'wal'), allowedRoots: [root] });
  first.prepareSync(target, Buffer.from('{"safe":true}'));
  const afterRestart = createDurableFileRecovery({ recoveryRoot: path.join(root, 'wal'), allowedRoots: [root] }); afterRestart.recoverSync();
  assert.equal(JSON.parse(await fsp.readFile(target, 'utf8')).safe, true);
});

test('chaos 15 · startup quarantines unfinished mutation when target diverged', async t => {
  const root = await sandbox(t, 'startup-conflict'), target = path.join(root, 'business.json'); await fsp.writeFile(target, 'A');
  const recovery = createDurableFileRecovery({ recoveryRoot: path.join(root, 'wal'), allowedRoots: [root] }); recovery.prepareSync(target, Buffer.from('B')); await fsp.writeFile(target, 'C');
  assert.equal(recovery.recoverSync().conflicts, 1); assert.equal(await fsp.readFile(target, 'utf8'), 'C');
});

test('chaos 16 · pending local edit survives an unrelated snapshot refresh', async t => {
  const root = await sandbox(t, 'snapshot-pending'), db = await dbAt(root);
  await db.queuePatch({ id: 'r1', patch: { userValue: 'pending' } });
  await fsp.writeFile(path.join(root, 'snapshot.json'), JSON.stringify({ sourceValue: 'new' }));
  assert.equal((await db.pending()).length, 1); assert.equal((await db.read()).records.r1.userValue, 'pending');
});

test('chaos 17 · concurrent local save and network sync preserve both events', async t => {
  const root = await sandbox(t, 'sync-save'), shared = path.join(root, 'shared'); await fsp.mkdir(shared);
  const db = await dbAt(root), sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db }); await sync.save(shared);
  await db.queuePatch({ id: 'r1', eventId: 'first', patch: { a: 1 } });
  await Promise.all([sync.syncOnce(), db.queuePatch({ id: 'r2', eventId: 'second', patch: { b: 2 } })]);
  const state = await db.read();
  assert.equal(state.records.r1.a, 1); assert.equal(state.records.r2.b, 2); assert.ok(state.journal.some(item => item.eventId === 'second'));
});
