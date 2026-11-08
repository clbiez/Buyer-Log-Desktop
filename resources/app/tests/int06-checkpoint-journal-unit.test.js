'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDashboardRefreshManifest } = require('../server/lib/power-bi-import-dashboard');
const { openCheckpointJournal } = require('../server/lib/power-bi-checkpoint-journal');

function setup(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initial = createDashboardRefreshManifest(['A', 'B', 'C'], { refreshId: 'unit' });
  const open = extra => openCheckpointJournal({ root, initial, snapshotEvery: 64, ...options, ...extra });
  return { root, initial, open, journal: open() };
}
const delta = (seq, orderStates = { A: 'SUCCESS' }, rows = [{ 'Sipariş Kod': 'A', n: seq }]) => ({
  seq, orderStates, rows, lastBatch: { orderCodes: Object.keys(orderStates), error: null },
  updatedAt: '2026-11-08T00:00:00.000Z', retryPending: 0,
});

test('INT-06 incremental counters, transitions, replay and owned delta copies', t => {
  const { journal, open } = setup(t);
  const d = delta(1);
  assert.deepEqual(journal.commit(d), { seq: 1, durable: true, replayed: false });
  d.rows[0].n = 999;
  assert.equal(journal.materialize().rows[0].n, 1);
  assert.deepEqual(journal.commit(delta(1)), { seq: 1, durable: true, replayed: true });
  assert.throws(() => journal.commit(delta(1, { A: 'FAILED' })), { code: 'CHECKPOINT_REPLAY_CONFLICT' });
  assert.throws(() => journal.commit(delta(3)), { code: 'CHECKPOINT_SEQUENCE' });
  journal.commit(delta(2, { A: 'FAILED', B: 'NOT_FOUND' }, []));
  assert.deepEqual(journal.progress(), { seq: 2, totalOrders: 3, processedOrders: 2,
    successfulOrders: 0, notFoundOrders: 1, failedOrders: 1, retryPending: 0 });
  journal.commit(delta(3, { A: 'SUCCESS', C: 'SUCCESS' }, []));
  assert.equal(journal.progress().processedOrders, 3);
  assert.deepEqual(open().materialize(), journal.materialize());
  journal.compact();
  assert.deepEqual(open().commit(delta(1)), { seq: 1, durable: true, replayed: true });
});

test('INT-06 partial tail is truncated before another append; complete corruption fails closed', t => {
  const { root, journal, open } = setup(t);
  journal.commit(delta(1));
  const file = path.join(root, 'batches.jsonl'), prefix = fs.readFileSync(file);
  fs.appendFileSync(file, '{"partial":"İ');
  const recovered = open();
  assert.deepEqual(fs.readFileSync(file), prefix);
  recovered.commit(delta(2, { B: 'NOT_FOUND' }, []));
  assert.equal(open().sequence, 2);
  fs.appendFileSync(file, '{"broken":true}\n');
  const broken = fs.readFileSync(file);
  assert.throws(open, { code: 'CHECKPOINT_CORRUPT' });
  assert.deepEqual(fs.readFileSync(file), broken, 'retain complete corrupt evidence');
});

test('INT-06 journal fsync failure never returns ACK or publishes memory; reopen resolves uncertainty', t => {
  const { journal, open } = setup(t);
  const original = fs.fsyncSync;
  fs.fsyncSync = () => { throw Object.assign(Error('synthetic EIO'), { code: 'EIO' }); };
  try { assert.throws(() => journal.commit(delta(1)), { code: 'EIO' }); }
  finally { fs.fsyncSync = original; }
  assert.throws(() => journal.progress(), { code: 'CHECKPOINT_REOPEN_REQUIRED' });
  const recovered = open();
  assert.equal(recovered.sequence, 1, 'written but unacknowledged record may survive');
  assert.equal(recovered.commit(delta(1)).replayed, true);
});

test('INT-06 periodic snapshot only, no growing graph serialization per commit', t => {
  const { root, journal } = setup(t, { snapshotEvery: 3 });
  const snapshot = path.join(root, 'snapshot.json'), before = fs.readFileSync(snapshot);
  journal.commit(delta(1)); journal.commit(delta(2, { B: 'SUCCESS' }, []));
  assert.deepEqual(fs.readFileSync(snapshot), before);
  journal.commit(delta(3, { C: 'NOT_FOUND' }, []));
  assert.notDeepEqual(fs.readFileSync(snapshot), before);
  assert.equal(fs.statSync(path.join(root, 'batches.jsonl')).size, 0);
});

test('INT-06 unknown orders/states and invalid sequence cannot mutate disk', t => {
  const { root, journal } = setup(t);
  const before = fs.readFileSync(path.join(root, 'batches.jsonl'));
  for (const d of [delta(1, { X: 'SUCCESS' }), delta(1, { A: 'PENDING' }), delta(0), delta(1.5)]) {
    assert.throws(() => journal.commit(d));
  }
  assert.deepEqual(fs.readFileSync(path.join(root, 'batches.jsonl')), before);
});

test('INT-06 duplicate disk records replay once; checksum, sequence and refresh corruption retain evidence', t => {
  const { root, journal, open } = setup(t);
  journal.commit(delta(1));
  const file = path.join(root, 'batches.jsonl'), record = fs.readFileSync(file);
  fs.appendFileSync(file, record);
  assert.equal(open().materialize().rows.length, 1);
  const envelope = JSON.parse(record);
  const original = JSON.parse(envelope.payload);
  const { createHash } = require('node:crypto');
  for (const mutate of [d => { d.seq = 3; }, d => { d.refreshId = 'other'; }, d => { d.orderStates.A = 'PENDING'; }]) {
    const d = structuredClone(original); mutate(d);
    const payload = JSON.stringify(d);
    fs.writeFileSync(file, record + JSON.stringify({ payload, sha256: createHash('sha256').update(payload).digest('hex') }) + '\n');
    assert.throws(open);
  }
  fs.writeFileSync(file, record.toString().replace('SUCCESS', 'FAILED'));
  assert.throws(open, { code: 'CHECKPOINT_CORRUPT' });
  fs.writeFileSync(file, record);
  journal.compact();
  fs.writeFileSync(file, record);
  assert.equal(open().materialize().rows.length, 1, 'pre-snapshot journal retained after crash is skipped exactly once');
});

test('INT-06 snapshot and retirement I/O errors preserve all durable batches', t => {
  for (const phase of ['snapshot:written', 'snapshot:renamed', 'snapshot:durable', 'retirement:written', 'retirement:renamed']) {
    let active = false;
    const { root, journal, open } = setup(t, { onPhase: current => {
      if (active && current === phase) throw Object.assign(Error('synthetic EIO'), { code: 'EIO' });
    } });
    journal.commit(delta(1)); active = true;
    assert.throws(() => journal.compact(), { code: 'EIO' });
    assert.throws(() => journal.materialize(), { code: 'CHECKPOINT_REOPEN_REQUIRED' });
    active = false;
    assert.equal(open().materialize().rows.length, 1);
    if (phase.startsWith('snapshot:')) assert.ok(fs.statSync(path.join(root, 'batches.jsonl')).size > 0);
  }
});

test('INT-06 growing prior rows and states are never visited by the commit hot path', t => {
  const { journal } = setup(t, { snapshotEvery: 64 });
  journal.commit(delta(1, { A: 'SUCCESS' }, [{ blob: 'x'.repeat(1024 * 1024) }]));
  const original = JSON.stringify;
  let maxBytes = 0;
  JSON.stringify = function(value, ...args) {
    const result = original(value, ...args); maxBytes = Math.max(maxBytes, Buffer.byteLength(result)); return result;
  };
  try { journal.commit(delta(2, { B: 'NOT_FOUND' }, [])); }
  finally { JSON.stringify = original; }
  assert.ok(maxBytes < 700, `delta-only serialization: ${maxBytes}`);
});

test('INT-06 snapshots serialize owned state without parsing a second full graph; public copies stay isolated', t => {
  const { journal, open } = setup(t, { snapshotEvery: 2 });
  journal.commit(delta(1, { A: 'SUCCESS' }, [{ blob: 'x'.repeat(1024 * 1024), nested: { n: 1 } }]));
  const original = JSON.parse;
  let fullGraphParses = 0;
  JSON.parse = function(text, ...args) {
    if (typeof text === 'string' && text.length > 1024 * 1024) fullGraphParses += 1;
    return original(text, ...args);
  };
  try {
    journal.commit(delta(2, { B: 'NOT_FOUND' }, [])); // periodic snapshot
    journal.compact(); // explicit snapshot
  } finally { JSON.parse = original; }
  assert.equal(fullGraphParses, 0, 'snapshot must not allocate a JSON-parsed duplicate manifest');
  const expected = journal.materialize(), copy = journal.materialize();
  copy.rows[0].nested.n = 99; copy.orderStates.A = 'FAILED';
  copy.allOrderCodes.push('X'); copy.lastBatch.orderCodes.push('X');
  assert.deepEqual(journal.materialize(), expected, 'public materialization remains a deep owned copy');
  assert.deepEqual(open().materialize(), expected, 'snapshot format/reopen preserves the full manifest');
});
