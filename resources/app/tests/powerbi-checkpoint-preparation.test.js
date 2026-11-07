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

test('INT-06 failed benchmark preserves structured failure evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-failed-benchmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'failed.json');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [path.join(__dirname, '../scripts/benchmark-powerbi-checkpoint.js'),
    '--orders', '12', '--app-root', root, '--output', output], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(fs.existsSync(output), 'failed invocation must retain JSON as well as stderr');
  const report = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(report.parity, false);
  assert.equal(report.stage, 'preparation-rehearsal');
  assert.equal(report.failure.code, 'ENOENT');
  assert.equal(report.fixture.orders, 12);
});

test('INT-06 paired preparation reports enforce source/fixture parity and use three medians', () => {
  const { summarize } = require('../scripts/benchmark-powerbi-checkpoint-cohort');
  const source = { contains892: true, protectedFiles: { 'public/app-main.js': 'same-source' },
    canonicalFiles: { canonical: 'same' }, integrationSha256: 'same-integration' };
  const report = wallMs => ({ stage: 'preparation-rehearsal', parity: true,
    target: { ...structuredClone(source), revision: 'revision', moduleSha256: 'unchanged-module' },
    environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: 'synthetic', availableParallelism: 4 },
    harnessSha256: 'same-harness', fixtureSha256: 'same-fixture', outputSha256: 'same-output',
    fixture: { orders: 12, batchSize: 4, scenario: 'steady', version: 1 },
    metrics: { wallMs, cpuUserMs: wallMs, cpuSystemMs: 2, checkpointBytes: 100,
      peakRssBytes: 1024, storeSaveWallMs: 1, storeSaveCpuUserMs: 1, storeSaveCpuSystemMs: 0 } });
  const samples = [1, 100, 3].flatMap(n => [{ arm: 'before', report: report(n) }, { arm: 'after', report: report(n * 2) }]);
  const summary = summarize(samples);
  assert.equal(summary.optimizationAccepted, false, 'preparation never accepts a product speedup');
  assert.equal(summary.arms.before.median.wallMs, 3);
  assert.equal(summary.arms.after.median.wallMs, 6);
  assert.equal(summary.arms.before.median.cpuMs, 5);
  assert.throws(() => summarize(samples.slice(2)), /three/);
  for (const mutate of [
    value => { value.target.contains892 = false; },
    value => { value.target.protectedFiles['public/app-main.js'] = 'different'; },
    value => { value.fixtureSha256 = 'different'; },
    value => { value.outputSha256 = 'different'; },
    value => { value.harnessSha256 = 'different'; },
    value => { value.target.moduleSha256 = 'changed-mid-cohort'; },
    value => { value.environment.node = 'different'; },
    value => { value.parity = false; },
    value => { value.metrics.wallMs = NaN; },
  ]) {
    const invalid = structuredClone(samples); mutate(invalid[0].report);
    assert.throws(() => summarize(invalid));
  }
});

test('INT-06 measurement lock prevents overlapping fresh benchmark processes and retains rejection', t => {
  const { acquireMeasurementLock } = require('../scripts/lib/powerbi-checkpoint-provenance');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-locked-benchmark-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const release = acquireMeasurementLock();
  try {
    const output = path.join(root, 'locked.json');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, [path.join(__dirname, '../scripts/benchmark-powerbi-checkpoint.js'),
      '--orders', '12', '--output', output], { env, encoding: 'utf8' });
    assert.equal(child.status, 1);
    assert.equal(JSON.parse(fs.readFileSync(output, 'utf8')).failure.code, 'EEXIST');
  } finally { release(); }
  const releaseAgain = acquireMeasurementLock(); releaseAgain();
});

test('INT-06 source snapshot detects integration, canonical and #892 working-tree changes', t => {
  const { captureSource, assertSourceUnchanged } = require('../scripts/lib/powerbi-checkpoint-provenance');
  const sourceRoot = path.join(__dirname, '..');
  const source = captureSource(sourceRoot);
  assert.ok(source.revision);
  assert.equal(Object.keys(source.protectedFiles).length, 4);
  assert.equal(Object.keys(source.canonicalFiles).length, 2);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ['server/lib/power-bi-import-dashboard.js', 'server/server.js',
    ...Object.keys(source.canonicalFiles), ...Object.keys(source.protectedFiles)];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  }
  const snapshot = captureSource(root);
  assert.equal(snapshot.contains892, false, 'standalone copies cannot prove ancestry');
  assert.equal(snapshot.moduleSha256, source.moduleSha256);
  assert.doesNotThrow(() => assertSourceUnchanged(root, snapshot));
  for (const file of files) {
    fs.appendFileSync(path.join(root, file), '\n// synthetic mutation\n');
    assert.throws(() => assertSourceUnchanged(root, snapshot), /Target source changed/);
    fs.copyFileSync(path.join(sourceRoot, file), path.join(root, file));
  }
});

test('INT-06 cohort CLI retains six fresh samples and refuses to overwrite evidence', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-cohort-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'cohort');
  const script = path.join(__dirname, '../scripts/benchmark-powerbi-checkpoint-cohort.js');
  const appRoot = path.join(__dirname, '..');
  const args = [script, '--before-app-root', appRoot, '--after-app-root', appRoot,
    '--orders', '12', '--batch-size', '4', '--scenario', 'split-retry', '--output-dir', output];
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, args, { env, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const summary = JSON.parse(fs.readFileSync(path.join(output, 'summary.json'), 'utf8'));
  assert.deepEqual(summary.order, ['before', 'after', 'after', 'before', 'before', 'after']);
  assert.equal(summary.optimizationAccepted, false);
  assert.equal(fs.readdirSync(output).length, 13, 'six raw JSON, six logs, summary');
  const previous = fs.readFileSync(path.join(output, 'summary.json'), 'utf8');
  assert.equal(spawnSync(process.execPath, args, { env, encoding: 'utf8' }).status, 1);
  assert.equal(fs.readFileSync(path.join(output, 'summary.json'), 'utf8'), previous);
});
