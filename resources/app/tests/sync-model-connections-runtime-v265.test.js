'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const policy = require('../server/lib/shared-sync-policy');
const id = 'store:settings.json';
const connection = (query = 'original', at = 'local-run') => ({ id: 'asas', server: 'demo', catalog: 'demo', query, lastRun: { at, ok: true, outFile: 'local.csv' } });
function devices(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-connection-runtime-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return ['a', 'b', 'c'].map(name => createLocalDb(path.join(root, name, 'BuyerLogLocal.db')));
}
async function deliver(from, to, after = 0) {
  const state = await from.read();
  for (const event of state.journal.filter(item => item.localSequence > after)) await to.applyDelta(policy.sanitizeDelta({ ...event, sha256: undefined }));
  return state.localSequence;
}
const records = async db => (await db.read()).records[id].modelConnections;

test('repeated refresh results do not create conflicts or replace this device run results', async t => {
  const [a, b] = devices(t);
  await a.queuePatch({ id, patch: { modelConnections: [connection()] } });
  await deliver(a, b);
  await b.queuePatch({ id, patch: { modelConnections: [connection('original', 'b-run')] } });
  const before = (await b.read()).records[id]._fieldWriters.modelConnections;
  for (let i = 0; i < 6; i++) {
    await a.queuePatch({ id, patch: { modelConnections: [connection('original', `a-${i}`)] } });
    await deliver(a, b);
  }
  assert.equal((await b.listConflicts()).length, 0);
  assert.equal((await records(b))[0].lastRun.at, 'b-run');
  assert.deepEqual((await b.read()).records[id]._fieldWriters.modelConnections, before);
});

test('runtime-only local refresh does not turn an observed configuration edit into a conflict', async t => {
  const [a, b] = devices(t);
  await a.queuePatch({ id, patch: { modelConnections: [connection()] } });
  const seq = await deliver(a, b);
  const writer = (await a.read()).records[id]._fieldWriters.modelConnections;
  await a.queuePatch({ id, patch: { modelConnections: [connection('original', 'new-a-run')] } });
  assert.deepEqual((await a.read()).records[id]._fieldWriters.modelConnections, writer);
  await b.queuePatch({ id, patch: { modelConnections: [connection('edited', 'b-run')] } });
  await deliver(b, a);
  assert.equal((await a.listConflicts()).length, 0);
  assert.equal((await records(a))[0].query, 'edited');
  assert.equal((await records(a))[0].lastRun.at, 'new-a-run');
  assert.ok(seq);
});

test('genuine concurrent configuration edits remain conflicts despite equal runtime values', async t => {
  const [a, b] = devices(t);
  await a.queuePatch({ id, patch: { modelConnections: [connection()] } });
  await deliver(a, b);
  await a.queuePatch({ id, patch: { modelConnections: [connection('a-query')] } });
  await b.queuePatch({ id, patch: { modelConnections: [connection('b-query')] } });
  await deliver(b, a);
  assert.equal((await a.listConflicts()).length, 1);
  assert.equal((await records(a))[0].query, 'a-query');
});

test('legacy runtime conflicts and identical duplicate choices close with audit; distinct choices remain', async t => {
  const [db] = devices(t);
  await db.queuePatch({ id, patch: { modelConnections: [connection('mine')] } });
  await db.transaction(state => {
    const conflict = (key, current, incoming) => ({ conflictId: key, eventId: key, id, type: 'field', field: 'modelConnections', current, incoming, at: '2026-10-08T12:00:00Z', resolved: false });
    state.conflicts.push(conflict('runtime', [connection('same', 'one')], [connection('same', 'two')]));
    state.conflicts.push(conflict('first', [connection('mine')], [connection('theirs', 'one')]));
    state.conflicts.push(conflict('duplicate', [connection('mine', 'different')], [connection('theirs', 'two')]));
    state.conflicts.push(conflict('distinct', [connection('mine')], [connection('third')]));
  });
  const reopened = createLocalDb(db.file);
  assert.deepEqual((await reopened.listConflicts()).map(item => item.conflictId), ['first', 'distinct']);
  const state = await reopened.read();
  assert.equal(state.conflicts.find(item => item.conflictId === 'runtime').resolution, 'runtime-equivalent');
  assert.equal(state.conflicts.find(item => item.conflictId === 'duplicate').duplicateOf, 'first');
  assert.equal((await records(reopened))[0].query, 'mine');
  await reopened.transaction(() => {});
  assert.equal((await createLocalDb(db.file).listConflicts()).length, 2);
});

for (const choice of ['current', 'incoming']) test(`one ${choice} choice converges three causal devices and preserves local runtime`, async t => {
  const [a, b, c] = devices(t);
  await a.queuePatch({ id, patch: { modelConnections: [connection()] } });
  let aSeq = await deliver(a, b); await deliver(a, c);
  await a.queuePatch({ id, patch: { modelConnections: [connection('a-query', 'a-run')] } });
  await b.queuePatch({ id, patch: { modelConnections: [connection('b-query', 'b-run')] } });
  let bSeq = await deliver(b, a); await deliver(b, c);
  aSeq = await deliver(a, b, aSeq); await deliver(a, c);
  const conflict = (await b.listConflicts())[0];
  await b.resolveConflict(conflict.conflictId, choice);
  await deliver(b, a, bSeq); await deliver(b, c, bSeq);
  for (const db of [a, b, c]) {
    assert.equal((await db.listConflicts()).length, 0);
    assert.equal((await records(db))[0].query, choice === 'current' ? 'b-query' : 'a-query');
  }
  assert.equal((await records(a))[0].lastRun.at, 'a-run');
  assert.equal((await records(b))[0].lastRun.at, 'b-run');
});

test('checkpoint repair keeps per-device lastRun while importing the shared query', () => {
  const merged = policy.mergeCheckpointRecord({ modelConnections: [connection('old', 'local')] }, policy.sanitizeSettings({ modelConnections: [connection('new', 'remote')] }));
  assert.equal(merged.modelConnections[0].query, 'new');
  assert.equal(merged.modelConnections[0].lastRun.at, 'local');
});

test('an equal refresh event that never saw a real conflict must not close that choice', async t => {
  const [a, b, c] = devices(t);
  await a.queuePatch({ id, patch: { modelConnections: [connection()] } });
  await deliver(a, b); await deliver(a, c);
  await a.queuePatch({ id, patch: { modelConnections: [connection('a-query')] } });
  await deliver(a, c);
  await b.queuePatch({ id, patch: { modelConnections: [connection('b-query')] } });
  await deliver(b, a);
  assert.equal((await a.listConflicts()).length, 1);
  await c.queuePatch({ id, patch: { modelConnections: [connection('a-query', 'c-run')] } });
  await deliver(c, a);
  assert.equal((await a.listConflicts()).length, 1);
});

test('v2 Shared Hub packages and ACKs keep repeated refreshes conflict-free', async t => {
  const { createSyncSettings } = require('../server/lib/sync-settings');
  const [a, b] = devices(t);
  const shared = path.join(path.dirname(path.dirname(a.file)), 'shared');
  fs.mkdirSync(shared);
  const sync = db => createSyncSettings({ localDataRoot: path.join(path.dirname(db.file), 'settings'), localDb: db, installationFingerprint: () => '', filterOutgoingDeltas: deltas => policy.filterDeltas(deltas), filterIncomingDeltas: deltas => policy.filterDeltas(deltas) });
  const sa = sync(a), sb = sync(b);
  await sa.save(shared); await sb.save(shared);
  await a.queuePatch({ id, patch: { modelConnections: [connection()] } });
  await sa.syncOnce(); await sb.syncOnce();
  await b.queuePatch({ id, patch: { modelConnections: [connection('original', 'b-run')] } });
  await a.queuePatch({ id, patch: { modelConnections: [connection('original', 'a-run')] } });
  for (const s of [sa, sb, sa, sb]) {
    const result = await s.syncOnce();
    assert.equal(result.lastError, null);
    assert.equal(result.corruptPackages, 0);
    assert.equal(result.conflict, 0);
  }
  assert.equal((await records(a))[0].lastRun.at, 'a-run');
  assert.equal((await records(b))[0].lastRun.at, 'b-run');
});

test('refresh after receiving a true conflict does not silently choose the local configuration', async t => {
  const [a, b, c] = devices(t);
  await a.queuePatch({ id, patch: { modelConnections: [connection('a-query')] } });
  await deliver(a, c);
  await b.queuePatch({ id, patch: { modelConnections: [connection('b-query')] } });
  await deliver(b, a); await deliver(b, c);
  assert.equal((await a.listConflicts()).length, 1);
  assert.equal((await c.listConflicts()).length, 1);
  await c.queuePatch({ id, patch: { modelConnections: [connection('a-query', 'new-c-run')] } });
  await deliver(c, a);
  assert.equal((await a.listConflicts()).length, 1, 'refresh is not a conflict-resolution decision');
  assert.equal((await records(a))[0].query, 'a-query');
});

test('runtime-only source events cannot overwrite a peer holding the other true conflict option', async t => {
  const [a, b, c] = devices(t);
  await b.queuePatch({ id, patch: { modelConnections: [connection('b-query')] } });
  await deliver(b, c);
  await a.queuePatch({ id, patch: { modelConnections: [connection('a-query')] } });
  await deliver(a, c); await deliver(b, a);
  assert.equal((await a.listConflicts()).length, 1);
  const cSeq = (await c.read()).localSequence;
  await c.queuePatch({ id, patch: { modelConnections: [connection('b-query', 'new-c-run')] } });
  const outgoing = (await c.read()).journal.at(-1);
  assert.equal(Object.hasOwn(outgoing.patch, 'modelConnections'), false, 'runtime writes carry sequence/ACK but no shared config');
  await deliver(c, a, cSeq);
  assert.equal((await records(a))[0].query, 'a-query');
  assert.equal((await a.listConflicts()).length, 1);
  const reopened = createLocalDb(c.file);
  assert.equal((await records(reopened))[0].lastRun.at, 'new-c-run', 'WAL retains the local runtime write');
  assert.equal(Object.hasOwn((await reopened.read()).journal.at(-1).patch, 'modelConnections'), false);
});
