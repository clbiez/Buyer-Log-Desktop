'use strict';

// Caller MUST hold /tmp/buyerlog-performance-measurement.lock with flock -n -E 75.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const outputRoot = path.resolve(process.argv[2]);
const sizes = [100000];
const scenarios = ['steady'];
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
    assert.equal(report.traceBatches, 400);
    assert.equal(report.metrics.checkpointBytes, arm === 'legacy-store' ? 6777574427 : 193920022,
      'same historical fixture/snapshot cadence and exact same-format bytes');
    if (reports.length) {
      for (const field of ['traceSha256', 'fixtureSha256', 'outputSha256', 'finalManifestSha256', 'finalRowsSha256', 'finalOrderStatesSha256']) assert.equal(report[field], reports[0][field]);
      assert.deepEqual(report.source, reports[0].source);
      assert.deepEqual(report.environment, reports[0].environment);
    }
    reports.push(report);
    process.stdout.write(`${name}: ${report.traceBatches} batches, ${report.metrics.checkpointWallMs.toFixed(1)} ms\n`);
  }
  const arms = {};
  for (const arm of ['legacy-store', 'journal']) {
    arms[arm] = {};
    for (const metric of ['checkpointBytes', 'checkpointWallMs', 'checkpointCpuMs', 'peakRssBytes',
      'totalReplayCpuMs', 'totalReplayWallMs', 'boundaryMax.external', 'boundaryMax.heapUsed',
      'boundaryMax.heapTotal', 'boundaryMax.arrayBuffers', 'boundaryMax.rss']) {
      const values = reports.filter(r => r.config.arm === arm).map(r => metric.split('.').reduce((value, key) => value[key], r.metrics)).sort((a, b) => a - b);
      arms[arm][metric] = { median: values[1], min: values[0], max: values[2] };
    }
  }
  fs.writeFileSync(path.join(outputRoot, `${orders}-${scenario}-summary.json`), JSON.stringify({
    stage: 'isolated-checkpoint-replay', productionGainAccepted: false, orders, scenario, order, arms,
    traceSha256: reports[0].traceSha256, outputSha256: reports[0].outputSha256,
    fixtureSha256: reports[0].fixtureSha256, finalManifestSha256: reports[0].finalManifestSha256,
    finalRowsSha256: reports[0].finalRowsSha256, finalOrderStatesSha256: reports[0].finalOrderStatesSha256,
    rssMedianDeltaPercent: 100 * (arms.journal.peakRssBytes.median / arms['legacy-store'].peakRssBytes.median - 1),
    rssRegressionAccepted: false, productionIntegrated: false,
    memorySampling: 'heap/external maxima at checkpoint return boundaries; kernel process high-water RSS before load/oracle',
    storage: '/tmp tmpfs; no disk/SMB or production acceptance' }, null, 2) + '\n', { flag: 'wx' });
}
