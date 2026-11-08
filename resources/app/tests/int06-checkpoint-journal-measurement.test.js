'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('INT-06 checkpoint-only replay preserves the #890 oracle and reports separate checkpoint costs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-measure-smoke-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const reports = [];
  for (const arm of ['legacy-store', 'journal']) {
    const output = path.join(root, arm + '.json'), env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const child = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/int06-checkpoint-journal/measure.cjs'),
      JSON.stringify({ arm, orders: 12, batchSize: 4, scenario: 'split-retry', output })], { env, encoding: 'utf8' });
    assert.ifError(child.error); assert.equal(child.status, 0, child.stderr);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.parity, true); assert.equal(report.productionGainAccepted, false);
    assert.equal(report.traceBatches, 7);
    for (const metric of ['checkpointBytes', 'payloadWriteCalls', 'checkpointWallMs', 'checkpointCpuMs', 'peakRssBytes']) {
      assert.ok(report.metrics[metric] > 0, metric);
    }
    assert.equal(report.metrics.wallMs, undefined, 'no total refresh duration attributed to checkpoint');
    assert.equal(report.source.journalSha256.length, 64);
    reports.push(report);
  }
  for (const field of ['fixtureSha256', 'traceSha256', 'outputSha256']) assert.equal(reports[0][field], reports[1][field]);
});
