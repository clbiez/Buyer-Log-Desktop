'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const prototypeRoot = path.resolve(__dirname, '../../../scripts/prototypes/int06-bounded-snapshot-20261108');
const { observeCheckpointWrites } = require(path.join(prototypeRoot, 'metrics.cjs'));
test('INT-06 descriptor-aware observer counts successful bytes once through nested writes', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-bounded-metrics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'bytes'), observer = observeCheckpointWrites(root);
  try {
    fs.writeFileSync(file, 'İ'); fs.appendFileSync(file, '😀');
    const fd = fs.openSync(file, 'a');
    try { fs.writeFileSync(fd, Buffer.from('AB')); fs.writeSync(fd, Buffer.from('!Z?'), 1, 1); }
    finally { fs.closeSync(fd); }
  } finally { observer.restore(); }
  assert.equal(observer.metrics.bytes, fs.statSync(file).size);
  assert.deepEqual(observer.metrics, { bytes: 9, calls: 4, descriptorCalls: 1 });
});
test('INT-06 extended replay harness reports full manifest parity and separate total/checkpoint/memory metrics', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-bounded-harness-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reports = [];
  for (const arm of ['legacy-store', 'journal']) {
    const output = path.join(root, arm + '.json'), env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, [path.join(prototypeRoot, 'measure.cjs'), JSON.stringify({
      arm, orders: 12, batchSize: 4, scenario: 'split-retry', output })], { env, encoding: 'utf8' });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.parity, true); assert.equal(report.productionGainAccepted, false);
    assert.ok(report.metrics.totalReplayCpuMs >= report.metrics.checkpointCpuMs);
    assert.ok(report.metrics.totalReplayWallMs >= report.metrics.checkpointWallMs);
    for (const key of ['external', 'heapUsed', 'heapTotal', 'rss']) assert.ok(report.metrics.boundaryMax[key] > 0);
    if (arm === 'journal') assert.ok(report.metrics.descriptorWriteCalls > 0);
    reports.push(report);
  }
  for (const field of ['fixtureSha256', 'traceSha256', 'outputSha256', 'finalManifestSha256', 'finalRowsSha256', 'finalOrderStatesSha256']) {
    assert.equal(reports[0][field], reports[1][field], field);
  }
});
