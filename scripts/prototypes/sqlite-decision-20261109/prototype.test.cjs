'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { open } = require('./adapters.cjs');
const { event, query, projection } = require('./workload.cjs');
const { child } = require('./benchmark.cjs');

async function box(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-db-conformance-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const folders = [path.join(root, 'local'), path.join(root, 'sqlite')];
  for (const f of folders) await fs.mkdir(f);
  const stores = folders.map((folder, i) => open(i ? 'sqlite' : 'local', folder));
  t.after(() => stores.forEach(db => db.close()));
  for (const db of stores) { await db.ensure(); await db.initialize(); }
  return { folders, stores };
}

test('local patch subset: records, field writers, HLC, journal checksums, filters and compaction agree', async t => {
  const { stores: [a, b] } = await box(t);
  const items = Array.from({ length: 1800 }, (_, i) => event(i, 1800));
  for (const db of [a, b]) { await db.queuePatches(items); await db.queuePatch(items[0]); }
  assert.deepEqual(await a.records(), await b.records());
  assert.deepEqual(await a.pending(2000), await b.pending(2000));
  for (let i = 0; i < 24; i++) assert.deepEqual(await a.filter(query(i, 1800)), await b.filter(query(i, 1800)));
  const before = projection(await a.records());
  for (const db of [a, b]) { await db.markSynced(items.slice(0, 1700).map(e => e.eventId)); await db.compact(); }
  assert.deepEqual(projection(await a.records()), before);
  assert.deepEqual(projection(await b.records()), before);
  assert.deepEqual(await a.counts(), await b.counts());
  assert.deepEqual(await a.eventIds(), await b.eventIds());
  assert.deepEqual(await a.pending(2000), await b.pending(2000));
  // Duplicate detection must survive payload pruning.
  for (const db of [a, b]) assert.equal((await db.queuePatch(items[0])).duplicate, true);
});

test('local torn final append is repaired; checksum corruption blocks further writes', async t => {
  const { folders, stores: [db] } = await box(t);
  await db.queuePatch(event(0, 1000));
  const wal = path.join(folders[0], 'BuyerLogLocal.db.wal');
  await fs.appendFile(wal, '{"v":1,"op":"pat');
  const restarted = open('local', folders[0]);
  await restarted.queuePatch(event(1, 1000));
  assert.equal(await restarted.pendingCount(), 2);
  const line = JSON.parse((await fs.readFile(wal, 'utf8')).trim());
  line.sha256 = '0'.repeat(64);
  await fs.writeFile(wal, JSON.stringify(line) + '\n');
  await assert.rejects(open('local', folders[0]).queuePatch(event(2, 1000)), { code: 'DATA_INTEGRITY_ERROR' });
});

test('SIGKILL retains acknowledged writes in both engines', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-db-crash-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const engine of ['local', 'sqlite']) {
    const folder = path.join(root, engine); await fs.mkdir(folder);
    await child({ mode: 'crash-write', engine, folder, size: 1000 }, 'acknowledged');
    const recovered = await child({ mode: 'verify', engine, folder, size: 1000 });
    assert(recovered.ackRetained.every(Boolean));
    if (engine === 'sqlite') assert.equal(recovered.integrity, 'ok');
  }
});

test('SQLite rolls back earlier rows and sequence when a later batch member fails', async t => {
  const { stores: [, db] } = await box(t);
  const first = event(0, 1000);
  assert.throws(() => db.queuePatches([first, { ...event(1, 1000), patch: { _unsupported: true } }]));
  assert.equal(await db.get(first.id), null);
  assert.equal((await db.counts()).sequence, 0);
  await db.queuePatch(first);
  assert.equal((await db.counts()).sequence, 1);
});
