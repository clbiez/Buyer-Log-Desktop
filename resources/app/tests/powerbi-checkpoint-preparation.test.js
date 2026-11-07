'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createFixture, assertEquivalent, digest } = require('../scripts/lib/powerbi-checkpoint-fixture');
const { observeCheckpointWrites } = require('../scripts/lib/powerbi-checkpoint-metrics');

test('INT-06 fixture has deterministic rows and independent SUCCESS/NOT_FOUND/FAILED coverage', () => {
  const fixture = createFixture({ orders: 12, scenario: 'split-retry', batchSize: 4 });
  assert.equal(fixture.orderCodes.length, 12);
  assert.deepEqual(fixture.expected.counts, { totalOrders: 12, processedOrders: 12,
    successfulOrders: 9, notFoundOrders: 2, failedOrders: 1 });
  assert.equal(fixture.expected.rows.length, 11, 'multi-row orders remain distinct');
  assert.equal(digest(fixture.expected), digest(createFixture({ orders: 12, scenario: 'split-retry', batchSize: 4 }).expected));
  const valid = { ok: true, stopped: false, rows: fixture.expected.rows,
    manifest: { ...fixture.expected.counts, orderStates: fixture.expected.orderStates,
      remainingOrders: [], failedOrderCodes: fixture.expected.failedOrderCodes } };
  assert.doesNotThrow(() => assertEquivalent(valid, fixture.expected));
  assert.throws(() => assertEquivalent({ ...valid, rows: valid.rows.slice(1) }, fixture.expected));
  assert.throws(() => assertEquivalent({ ...valid, manifest: { ...valid.manifest, failedOrders: 0 } }, fixture.expected));
});

test('INT-06 write observer counts actual UTF-8 snapshot and journal payload once, ignoring other files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-meter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const original = fs.writeFileSync;
  const observer = observeCheckpointWrites(path.join(root, 'checkpoint'));
  try {
    fs.mkdirSync(path.join(root, 'checkpoint'));
    fs.writeFileSync(path.join(root, 'checkpoint', 'snapshot.tmp'), 'İ😀', 'utf8');
    fs.renameSync(path.join(root, 'checkpoint', 'snapshot.tmp'), path.join(root, 'checkpoint', 'snapshot.json'));
    fs.appendFileSync(path.join(root, 'checkpoint', 'journal'), Buffer.from('ç\n'));
    fs.writeFileSync(path.join(root, 'outside'), 'ignored');
    assert.equal(observer.metrics.bytes, Buffer.byteLength('İ😀ç\n'));
    assert.equal(observer.metrics.calls, 2);
  } finally { observer.restore(); }
  assert.equal(fs.writeFileSync, original);
});

test('INT-06 benchmark transport uses connector attempt metadata without retaining query history', async () => {
  const fixture = createFixture({ orders: 12, scenario: 'split-retry', batchSize: 4 });
  const transport = fixture.transport({ trace: false }), codes = fixture.orderCodes.slice(0, 2);
  await assert.rejects(transport.queryBatch(codes, { attempt: 0 }), /synthetic transient/);
  assert.equal((await transport.queryBatch(codes, { attempt: 1 })).length, 3);
  assert.deepEqual(transport.queriedCodes, []);
  assert.equal(transport.stats.transientFailures, 1);
});

test('INT-06 benchmark runs a real store and rejects an intentionally impossible byte budget', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-benchmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const script = path.join(__dirname, '../scripts/benchmark-powerbi-checkpoint.js');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [script, '--orders', '12', '--batch-size', '4',
    '--scenario', 'split-retry', '--output', path.join(root, 'result.json'), '--max-write-amplification', '0'], { env, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(root, 'result.json'), 'utf8'));
  assert.equal(report.parity, true);
  assert.equal(report.budget.passed, false);
  assert.ok(report.metrics.checkpointBytes > 0);
  assert.ok(report.metrics.checkpointWrites >= report.checkpoints);
  assert.ok(report.metrics.peakRssBytes > 0);
  assert.ok(report.metrics.cpuUserMs + report.metrics.cpuSystemMs > 0);
  assert.ok(report.metrics.storeSaveWallMs > 0);
  assert.ok(report.metrics.storeSaveCpuUserMs + report.metrics.storeSaveCpuSystemMs > 0);
  assert.equal(report.target.moduleSha256.length, 64);
  assert.equal(report.fixtureSha256.length, 64);
  assert.ok(report.transport.splitRejections > 0);
  assert.ok(report.transport.transientFailures > 0);
});
