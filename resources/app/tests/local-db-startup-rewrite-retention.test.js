'use strict';
/* Yerel DB'nin veri büyüdükçe açılışı yavaşlatmaması için sözleşmeler:
   - Tamamlanmış tek seferlik geçiş her açılışta tam anlık görüntüyü yeniden
     yazmaz (300 MB'lık DB'de her açılışta ~3x DB boyutu disk yazımı ve
     onlarca saniyelik kira/olay döngüsü kilidi ölçüldü).
   - Yüklenmiş + onaylanmış eski journal kayıtlarının tam payload'ı sınırsız
     birikmez; kimlik/sıra defteri ve bekleyen işler korunur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { quarantineLegacyCollectionDeltas } = require('../server/lib/collection-replication');

async function tempDb(t, options) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-startup-rewrite-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'BuyerLogLocal.db');
  const db = createLocalDb(file, options);
  await db.ensure();
  return { root, file, db };
}
const stamp = file => { const s = fs.statSync(file); return `${s.ino}-${s.size}-${s.mtimeMs}`; };

test('tamamlanmış Collection karantina geçişi açılışta DB anlık görüntüsünü yeniden yazmaz', async t => {
  const { root, file, db } = await tempDb(t);
  await db.queuePatch({ id: 'cp-order:1', patch: { importance: 'High' } });
  const first = await quarantineLegacyCollectionDeltas({ localDb: db, workspaceFileForOwner: () => path.join(root, 'absent.json') });
  assert.equal(first.skipped, undefined);
  const before = stamp(file);
  const traces = [];
  const second = await quarantineLegacyCollectionDeltas({ localDb: db, workspaceFileForOwner: () => path.join(root, 'absent.json'), onTrace: name => traces.push(name) });
  assert.equal(second.skipped, true);
  assert.equal(stamp(file), before, 'no-op migration must not rewrite the snapshot');
  assert.deepEqual(traces, ['COLLECTION_LEGACY_DELTA_QUARANTINED']);
  // A fresh process (new instance, same files) also skips without rewriting.
  const reopened = createLocalDb(file);
  const third = await quarantineLegacyCollectionDeltas({ localDb: reopened, workspaceFileForOwner: () => path.join(root, 'absent.json') });
  assert.equal(third.skipped, true);
  assert.equal(stamp(file), before);
});

async function settledFixture(t, { total = 120, unackedAt = null, pending = 3, journalRetention = { keepTail: 10, minBatch: 20 } } = {}) {
  const ctx = await tempDb(t, { walMaxBytes: 64 * 1024 * 1024, journalRetention });
  const { db } = ctx;
  const bulk = await db.queuePatches(Array.from({ length: total }, (_, i) => ({ id: `cp-order:${i % 40}`, patch: { suppFob: String(i), note: 'x'.repeat(50) } })));
  const ids = bulk.results.map(item => item.eventId);
  await db.markSynced(ids);
  const acked = unackedAt == null ? ids : ids.filter((_, i) => i !== unackedAt);
  await db.markAcknowledgedThrough(Math.floor(total / 2));
  await db.markAcknowledged(acked);
  const open = await db.queuePatches(Array.from({ length: pending }, (_, i) => ({ id: `cp-order:p${i}`, patch: { importance: 'High' } })));
  return { ...ctx, ids, openIds: open.results.map(item => item.eventId) };
}

test('otomatik saklama yalnız yüklenmiş+onaylanmış öneki düşürür; iş verisi, bekleyenler ve onay sayıları aynı kalır', async t => {
  const { db, file, ids, openIds } = await settledFixture(t);
  const before = { hash: await db.businessHash(), pending: await db.pendingCount(), unacked: await db.unacknowledgedCount(), stats: await db.stats() };
  const result = await db.pruneJournal();
  assert.equal(result.pruned, 110, 'keeps the newest settled tail and every open event');
  const state = await db.read();
  assert.equal(state.journal.length, 10 + openIds.length);
  assert.deepEqual(state.journal.slice(-openIds.length).map(item => item.eventId), openIds);
  assert.equal(await db.businessHash(), before.hash);
  assert.equal(await db.pendingCount(), before.pending);
  assert.equal(await db.unacknowledgedCount(), before.unacked, 'pruning must neither acknowledge nor un-acknowledge events');
  const after = await db.stats();
  assert.equal(after.acknowledged, before.stats.acknowledged);
  assert.equal(after.ledgerEventIds, 110);
  assert.equal(state.syncLedger.compactedThrough, 110);
  for (const id of ids.slice(0, 110)) { assert.equal(state.events[id], undefined); assert.ok(state.syncLedger.eventIds[id]); }
  // Replaying a pruned local event (WAL/backup replay or echo) stays a duplicate.
  const replay = await db.queuePatch({ id: 'cp-order:0', patch: { suppFob: 'replayed' }, eventId: ids[0] });
  assert.equal(replay.duplicate, true);
  assert.notEqual((await db.read()).records['cp-order:0'].suppFob, 'replayed');
  // Fresh process sees the identical durable state; no second rewrite is needed.
  const reopened = createLocalDb(file, { walMaxBytes: 64 * 1024 * 1024, journalRetention: { keepTail: 10, minBatch: 20 } });
  assert.equal(await reopened.businessHash(), before.hash);
  assert.equal(await reopened.unacknowledgedCount(), before.unacked);
  const statBefore = stamp(file);
  assert.deepEqual(await reopened.pruneJournal(), { pruned: 0, skipped: true });
  assert.equal(stamp(file), statBefore, 'below threshold no snapshot is written');
});

test('onaylanmamış bir olay, sırası üstündeki yerleşmiş geçmişin budanmasını durdurur', async t => {
  const { db, ids } = await settledFixture(t, { unackedAt: 80 });
  const result = await db.pruneJournal();
  // Contiguous ACK covers 1..60; event #81 is open. Only sequences 1..80 are eligible: 80 - keepTail(10) = 70.
  assert.equal(result.pruned, 70);
  const state = await db.read();
  assert.ok(state.journal.some(item => item.eventId === ids[80] && !item.acknowledged), 'open event payload stays');
  assert.ok(state.syncLedger.compactedThrough < 81, 'published watermark never passes an open event');
});

test('saklama anlık görüntü yazımına eklenir ve kapatılabilir', async t => {
  const on = await settledFixture(t);
  await on.db.transaction(async () => null);
  assert.equal((await on.db.read()).journal.length, 13, 'an existing snapshot write prunes without an extra write');
  const off = await settledFixture(t, { journalRetention: false });
  await off.db.transaction(async () => null);
  assert.equal((await off.db.read()).journal.length, 123);
  assert.deepEqual(await off.db.pruneJournal(), { pruned: 0, skipped: true });
});

test('WAL döndürme eşiği küçük DB için aynı kalır, büyük DB için sınırlı biçimde büyür', () => {
  const { walRotationLimits } = require('../server/lib/local-db');
  assert.deepEqual(walRotationLimits(200 * 1024), { bytes: 1024 * 1024, entries: 2000 });
  assert.deepEqual(walRotationLimits(16 * 1024 * 1024), { bytes: 1024 * 1024, entries: 2000 });
  const mid = walRotationLimits(160 * 1024 * 1024);
  assert.equal(mid.bytes, 10 * 1024 * 1024); assert.equal(mid.entries, 10240);
  assert.deepEqual(walRotationLimits(2 * 1024 * 1024 * 1024), { bytes: 32 * 1024 * 1024, entries: 20000 });
  assert.deepEqual(walRotationLimits(2 * 1024 * 1024 * 1024, 4096), { bytes: 4096, entries: 2000 }, 'explicit limit wins');
});
