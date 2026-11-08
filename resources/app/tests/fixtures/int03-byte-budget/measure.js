'use strict';

// Isolated helper experiment, never a production before/after collector.
const assert = require('node:assert/strict');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { createByteBudget } = require('../../../server/lib/plm-image-byte-budget');
const { runBounded } = require('../../../server/lib/plm-image-download-queue');
const { fixture, hash, png } = require('./plm-image-memory-fixture');
const { image } = require('./mock-pipeline');

async function measure() {
  const descriptors = fixture();
  const budget = createByteBudget({ limitBytes: 4 * 1024 * 1024 });
  const report = {
    kind: 'isolated-helper-only', productionAcceptance: false,
    node: process.version, platform: process.platform, arch: process.arch,
    kernel: os.release(), cpu: os.cpus()[0].model,
    fixtureCount: descriptors.length, fixtureDescriptorSha256: hash(JSON.stringify(descriptors)),
    fixtureTotalBytes: descriptors.reduce((n, item) => n + item.size, 0),
    concurrentSyncJobs: 2, downloadConcurrencyPerJob: 4, mockedCommitDelayMs: 1,
    unknownLengthCount: 0, completed: 0, firstMockCompletionMs: null,
    sampledPeakRssBytes: 0, sampledPeakExternalBytes: 0, sampledPeakArrayBuffersBytes: 0,
  };
  function sample() {
    const memory = process.memoryUsage();
    report.sampledPeakRssBytes = Math.max(report.sampledPeakRssBytes, memory.rss);
    report.sampledPeakExternalBytes = Math.max(report.sampledPeakExternalBytes, memory.external);
    report.sampledPeakArrayBuffersBytes = Math.max(report.sampledPeakArrayBuffersBytes, memory.arrayBuffers);
  }
  const started = performance.now();
  sample();
  const timer = setInterval(sample, 5);
  let runs;
  try {
    runs = await Promise.all([0, 1].map(job => runBounded(descriptors.filter((_, i) => i % 2 === job), async item => {
      // Alternate inside each job so both exercise known and unknown lengths.
      const unknown = Math.floor(item.urlId / 2) % 2 === 0;
      if (unknown) report.unknownLengthCount++;
      const result = await image(budget, item, { unknown, maxImageBytes: 524288,
        commit: () => new Promise(resolve => setTimeout(resolve, 1)), onStage: sample });
      report.completed++;
      if (report.firstMockCompletionMs === null) report.firstMockCompletionMs = performance.now() - started;
      sample();
      return result;
    }, { concurrency: 4 })));
    report.totalMs = performance.now() - started;
    sample();
    report.osPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  } finally {
    clearInterval(timer);
  }
  report.reservation = budget.snapshot();
  assert.equal(report.completed, 2048);
  assert.equal(report.reservation.reservedBytes, 0);
  assert.equal(report.reservation.activePermits, 0);
  assert.equal(report.reservation.waitingCount, 0);
  assert.ok(report.reservation.peakReservedBytes <= report.reservation.limitBytes);
  // Oracle generation is outside the timed/sample window. These are mock
  // completions, not canonical links or browser visibility.
  for (const run of runs) for (const result of run.results) {
    assert.equal(result.ok, true);
    assert.equal(result.value.hash, hash(png(result.item.size, result.item.contentTag)));
  }
  report.oracleMatches = true;
  return report;
}

if (require.main === module) measure().then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { measure };
