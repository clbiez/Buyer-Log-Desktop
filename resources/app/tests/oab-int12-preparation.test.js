'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runCase, equivalent, sourceIdentity, scenarios } = require('./helpers/oab-int12-harness.cjs');

test('INT-12 pins native source and both arms to Main including #892', () => {
  const id = sourceIdentity();
  assert.equal(id.serviceSha256, id.expectedServiceSha256);
  assert.equal(id.mainWith892, '5a1656e98deeb573f6245f4b24a8135cc77a0d7b');
});

for (const scenario of scenarios) test('INT-12 native/2 bounded equivalence: ' + scenario, async () => {
  const before = await runCase({ scenario, width: 1 });
  const after = await runCase({ scenario, width: 2 });
  assert.deepEqual(equivalent(after), equivalent(before));
  assert.ok(before.metrics.peakReports <= 1);
  assert.ok(after.metrics.peakReports <= 2);
  assert.equal(before.metrics.refreshPostRetries, 0);
  assert.equal(after.metrics.refreshPostRetries, 0);
  assert.equal(after.metrics.activeAtFinish, 0);
  assert.equal(after.metrics.lateEffects, 0);
  if (scenario === 'cold') assert.equal(after.metrics.peakReports, 2);
  if (scenario === 'fresh-all') {
    assert.equal(before.metrics.reports, 0);
    assert.equal(before.metrics.authChecks, 0);
    assert.equal(before.metrics.cacheHits, 12);
  }
  if (scenario === 'fresh-half') assert.equal(before.metrics.cacheHits, 6);
  if (scenario === 'batch-supported' || scenario === 'probe-verified') {
    assert.equal(before.metrics.reports, 4);
    assert.equal(before.metrics.cacheWrites, 0);
  }
  if (scenario === 'probe-fallback') assert.equal(before.metrics.reports, 13);
  if (scenario === 'throttle') {
    assert.equal(before.metrics.throttles, 1);
    assert.equal(after.metrics.throttles, 1);
    assert.equal(after.metrics.reports, 12);
  }
  if (scenario === 'auth-recovery') {
    assert.equal(before.metrics.recoveries, 2);
    assert.equal(after.metrics.recoveries, 2);
  }
  if (scenario.startsWith('revoke-')) {
    assert.equal(after.metrics.cacheWrites, 0);
    assert.equal(after.snapshot, null);
  }
  if (scenario === 'cancel') {
    assert.equal(after.outcome.rows.length, 1);
    assert.equal(after.metrics.cacheWrites, 1);
    assert.equal(after.continuationError, 'OAB_CONTINUATION_UNAVAILABLE');
  }
  if (['partial', 'throttle', 'auth-fatal'].includes(scenario)) {
    assert.equal(after.continued.rows.length, 11);
    assert.equal(after.continued.sources.length, 12);
    assert.equal(after.continued.job.snapshotSaved, true);
  }
});

test('INT-12 refuses an unbounded or unsupported experiment width', async () => {
  await assert.rejects(runCase({ scenario: 'cold', width: 3 }), /width must be 1 or 2/);
});
