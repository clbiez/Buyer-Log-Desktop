'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { classify, normalized } = require('./diagnose-fx-timeout.cjs');
const ns = ms => String(BigInt(Math.round(ms * 1e6)));
const event = (event, ms, extra = {}) => ({ event, ns: ns(ms), ...extra });
const admission = event('admission', 0, { job: 7, label: 'fx', system: 'shared' });
const deadline = event('deadline-fired', 5001, { label: 'fx' });
test('a real pending timeout with no dispatch is queue-only, not worker execution', () => {
  const x = classify([admission, event('deadline-registered', 0.1, { label: 'fx', timeoutMs: 5000 }), deadline,
    event('settled', 5002, { label: 'fx', error: 'COMPUTE_TIMEOUT', metrics: { queueWaitMs: 5001, durationMs: 0 } })], 'fx');
  assert.equal(x.atDeadline, 'queue'); assert.equal(x.dispatchNs, null); assert.equal(x.receivedNs, null);
  assert.equal(x.timerToFireMs, 5000.9); assert.equal(x.metrics.durationMs, 0);
});
test('dispatch without receiving distinguishes startup/dispatch from queue admission', () => {
  const x = classify([admission, event('dispatch', 1, { job: 7, system: 'shared', slot: 1 }), deadline], 'fx');
  assert.equal(x.atDeadline, 'worker-startup-or-dispatch');
});
test('receiving before timeout distinguishes execution/transport without inventing a parser cause', () => {
  const x = classify([admission, event('dispatch', 1, { job: 7, system: 'shared', slot: 1 }), event('task-received', 2, { id: 7, system: 'shared' }), deadline], 'fx');
  assert.equal(x.atDeadline, 'execution-or-result-transport');
});
test('late dispatch/receive cannot retroactively reclassify a pending deadline', () => {
  const x = classify([admission, deadline, event('dispatch', 5002, { job: 7, system: 'shared' }), event('task-received', 5003, { id: 7, system: 'shared' })], 'fx');
  assert.equal(x.atDeadline, 'queue');
});
test('audit-time normalization preserves FX values, revisions, provenance and status differences', () => {
  const a = { updatedAt: '2026-01-01', _updatedAt: '2026-01-02', _revision: 1, sourceModifiedAt: '2026-01-03', months: { '2026-10': { TRY: 40 } }, folderSync: null };
  const b = { ...a, updatedAt: '2026-02-01', _updatedAt: '2026-02-02' };
  assert.deepEqual(normalized(a), normalized(b));
  for (const patch of [{ _revision: 2 }, { sourceModifiedAt: 'different' }, { months: { '2026-10': { TRY: 41 } } }, { folderSync: { reason: 'parse-failed' } }]) assert.notDeepEqual(normalized(a), normalized({ ...b, ...patch }));
});
test('all 36 native observations preserve the pinned collector and prove the queue-only failure and parity boundaries', () => {
  const proof = JSON.parse(fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8'));
  const hash = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, name))).digest('hex');
  assert.equal(hash('diagnose-fx-timeout.cjs'), proof.collectorSha256);
  assert.equal(hash('worker-observer.cjs'), proof.observerSha256);
  assert.equal(proof.runs.length, 36); assert.equal(proof.comparisons.length, 18);
  assert.equal(new Set(proof.runs.map(r => [r.rep, r.arm, r.state, r.kur].join(':'))).size, 36);
  const snapshots = new Set();
  for (const run of proof.runs) {
    assert.equal(run.synthetic, true); assert.equal(run.fixture.rows, 30000);
    snapshots.add(run.fixture.files['source.v8']);
    assert.deepEqual(classify(run.events, 'fx'), run.timing);
    assert.equal(run.api.status, 200); assert.equal(run.api.resolveStatus, 200);
    assert.equal(run.timing.timeoutMs, 5000);
    assert.deepEqual(run.api.body, { ...run.store, folderSync: run.api.body.folderSync });
    if (run.state === 'busy') assert.ok(run.blocking.length === 2 && run.blocking.every(job => job.ok));
    if (run.arm === 'candidate' && run.state === 'busy') {
      assert.equal(run.timing.atDeadline, 'queue'); assert.equal(run.timing.dispatchNs, null); assert.equal(run.timing.receivedNs, null);
      assert.equal(run.timing.metrics.durationMs, 0); assert.equal(run.timing.metrics.postMessageMs, 0);
      assert.equal(run.errors[0].code, 'COMPUTE_TIMEOUT');
      assert.deepEqual(run.store, run.initial); assert.deepEqual(run.saves, []); assert.deepEqual(run.publications, []);
      assert.equal(run.api.body.folderSync.reason, 'parse-failed');
      const deadline = run.events.find(e => e.event === 'deadline-fired' && e.label === 'fx');
      assert.equal(deadline.stats.activeWorkers, 2); assert.equal(deadline.stats.pending, 1);
      const returnedAt = run.events.find(e => e.event === 'fx-return');
      const fxCall = run.events.find(e => e.event === 'fx-call');
      assert.equal(run.events.filter(e => ['findKurWorkbook-enter', 'readFxWorkbook-enter'].includes(e.event) && BigInt(e.ns) >= BigInt(fxCall.ns) && BigInt(e.ns) <= BigInt(returnedAt.ns)).length, 0);
    } else {
      assert.equal(run.timing.atDeadline, 'no-timeout'); assert.deepEqual(run.errors, []);
      if (run.kur === 'valid') { assert.equal(run.store._revision, 2); assert.equal(run.store.months['2026-10'].TRY, 40); assert.deepEqual(run.saves, [2]); }
      else { assert.equal(run.store._revision, 1); assert.deepEqual(run.saves, []); }
    }
  }
  assert.equal(snapshots.size, 1);
  for (const comparison of proof.comparisons) {
    const busy = comparison.state === 'busy';
    assert.equal(comparison.dataEqual, !(busy && comparison.kur === 'valid'));
    assert.equal(comparison.revisionEqual, !(busy && comparison.kur === 'valid'));
    assert.equal(comparison.statusEqual, !busy); assert.equal(comparison.returnedEqual, !busy);
  }
});
