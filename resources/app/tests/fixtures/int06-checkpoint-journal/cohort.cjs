'use strict';

// Caller MUST hold /tmp/buyerlog-performance-measurement.lock with flock -n -E 75.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const outputRoot = path.resolve(process.argv[2]);
const sizes = process.argv[3] ? [Number(process.argv[3])] : [30000, 100000];
const scenarios = process.argv[4] ? [process.argv[4]] : ['steady', 'split-retry'];
assert.ok(sizes.every(size => Number.isSafeInteger(size) && size > 0));
assert.ok(scenarios.every(value => ['steady', 'split-retry'].includes(value)));
fs.mkdirSync(outputRoot, { recursive: true });
const order = ['legacy-store', 'journal', 'journal', 'legacy-store', 'legacy-store', 'journal'];
for (const orders of sizes) for (const scenario of scenarios) {
  const reports = [], counters = { 'legacy-store': 0, journal: 0 };
  for (const arm of order) {
    const name = `${orders}-${scenario}-${arm}-${++counters[arm]}`;
    const output = path.join(outputRoot, name + '.json'), log = path.join(outputRoot, name + '.log');
    assert.equal(fs.existsSync(output), false, 'never overwrite evidence');
    const fd = fs.openSync(log, 'wx');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [path.join(__dirname, 'measure.cjs'), JSON.stringify({
      arm, orders, scenario, batchSize: 250, output })], { env, stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    assert.ifError(result.error); assert.equal(result.status, 0, name);
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(report.parity, true);
    if (reports.length) {
      for (const field of ['traceSha256', 'fixtureSha256', 'outputSha256']) assert.equal(report[field], reports[0][field]);
      assert.deepEqual(report.source, reports[0].source);
      assert.deepEqual(report.environment, reports[0].environment);
    }
    reports.push(report);
    process.stdout.write(`${name}: ${report.traceBatches} batches, ${report.metrics.checkpointWallMs.toFixed(1)} ms\n`);
  }
  const arms = {};
  for (const arm of ['legacy-store', 'journal']) {
    arms[arm] = {};
    for (const metric of ['checkpointBytes', 'checkpointWallMs', 'checkpointCpuMs', 'peakRssBytes']) {
      const values = reports.filter(r => r.config.arm === arm).map(r => r.metrics[metric]).sort((a, b) => a - b);
      arms[arm][metric] = { median: values[1], min: values[0], max: values[2] };
    }
  }
  fs.writeFileSync(path.join(outputRoot, `${orders}-${scenario}-summary.json`), JSON.stringify({
    stage: 'isolated-checkpoint-replay', productionGainAccepted: false, orders, scenario, order, arms,
    traceSha256: reports[0].traceSha256, outputSha256: reports[0].outputSha256 }, null, 2) + '\n', { flag: 'wx' });
}
