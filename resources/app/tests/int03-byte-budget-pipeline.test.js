'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createByteBudget } = require('../server/lib/plm-image-byte-budget');
const { fixture, png, hash } = require('./fixtures/int03-byte-budget/plm-image-memory-fixture');
const { image, gate, tick } = require('./fixtures/int03-byte-budget/mock-pipeline');

function drained(budget) {
  const s = budget.snapshot();
  assert.equal(s.reservedBytes, 0);
  assert.equal(s.activePermits, 0);
  assert.equal(s.waitingCount, 0);
  assert.ok(s.peakReservedBytes <= s.limitBytes);
}

test('slow commit retains its permit and backpressures the next download', async () => {
  const budget = createByteBudget({ limitBytes: 2048 });
  const hold = gate(), started = gate();
  const [a, b] = fixture(2, [512]);
  const first = image(budget, a, { commit: hold.promise, onStage(stage) { if (stage === 'commit') started.resolve(); } });
  await started.promise;
  let dispatched = false;
  const second = image(budget, b, { onStage(stage) { if (stage === 'download') dispatched = true; } });
  await tick();
  assert.equal(dispatched, false);
  assert.equal(budget.snapshot().reservedBytes, 2048);
  assert.equal(budget.snapshot().waitingCount, 1);
  hold.resolve();
  const outcomes = await Promise.all([first, second]);
  assert.deepEqual(outcomes.map(x => x.hash), [a, b].map(x => hash(png(x.size, x.contentTag))));
  drained(budget);
});

test('download, validation, queued commit and commit all stay charged until buffers drop', async () => {
  const budget = createByteBudget({ limitBytes: 2048 });
  const stages = [];
  const result = await image(budget, fixture(1, [512])[0], { onStage(stage, permit) {
    stages.push(stage);
    assert.equal(budget.snapshot().reservedBytes, permit.bytes);
    assert.equal(permit.bytes, 2048);
  } });
  assert.deepEqual(stages, ['download', 'validation', 'commit-wait', 'commit', 'dropped']);
  assert.equal(result.size, 512); drained(budget);
});

test('partial failure at each stage leaves successful siblings and no leaked permit', async () => {
  for (const fail of ['download', 'validation', 'commit']) {
    const budget = createByteBudget({ limitBytes: 4096 });
    const items = fixture(3, [512]);
    const settled = await Promise.allSettled(items.map((item, i) => image(budget, item, { fail: i === 1 ? fail : undefined })));
    assert.deepEqual(settled.map(x => x.status), ['fulfilled', 'rejected', 'fulfilled']);
    assert.match(settled[1].reason.message, new RegExp(fail));
    drained(budget);
    await image(budget, items[1]); drained(budget);
  }
});

test('cancelling a queued sync does not dispatch its transport or affect another sync', async () => {
  const budget = createByteBudget({ limitBytes: 2048 });
  const hold = gate(), started = gate();
  const items = fixture(3, [512]);
  const first = image(budget, items[0], { commit: hold.promise, onStage(s) { if (s === 'commit') started.resolve(); } });
  await started.promise;
  const controller = new AbortController(); let dispatched = false;
  const cancelled = image(budget, items[1], { signal: controller.signal, onStage() { dispatched = true; } });
  const rejected = assert.rejects(cancelled, { code: 'PLM_IMAGE_BUDGET_CANCELLED' });
  const next = image(budget, items[2]);
  controller.abort(); await rejected;
  assert.equal(dispatched, false);
  assert.equal(budget.snapshot().reservedBytes, 2048);
  hold.resolve(); await Promise.all([first, next]); drained(budget);
});

test('abort during a non-interruptible commit waits for quiescence before release', async () => {
  const budget = createByteBudget({ limitBytes: 2048 });
  const hold = gate(), started = gate();
  const controller = new AbortController();
  const current = image(budget, fixture(1, [512])[0], { signal: controller.signal, commit: hold.promise,
    onStage(s) { if (s === 'commit') started.resolve(); } });
  await started.promise; controller.abort(); await tick();
  assert.equal(budget.snapshot().reservedBytes, 2048);
  hold.resolve(); await current; drained(budget);
});

test('abort before commit releases only after active callback stops using buffers', async () => {
  const budget = createByteBudget({ limitBytes: 2048 });
  const hold = gate(), started = gate();
  const controller = new AbortController();
  const current = image(budget, fixture(1, [512])[0], { signal: controller.signal, beforeCommit: hold.promise,
    onStage(s) { if (s === 'commit-wait') started.resolve(); } });
  const rejected = assert.rejects(current, { name: 'AbortError' });
  await started.promise; controller.abort();
  assert.equal(budget.snapshot().reservedBytes, 2048);
  hold.resolve(); await rejected; drained(budget);
});

test('two concurrent sync jobs share one total and both make progress', async () => {
  const budget = createByteBudget({ limitBytes: 32768 });
  const starts = [];
  async function sync(id) {
    const items = fixture(32, [512, 1024, 2048, 4096]);
    return Promise.all(items.map(item => image(budget, item, { unknown: Number(item.urlId) % 2 === 0,
      maxImageBytes: item.size, onStage(s) { if (s === 'download') { starts.push(id); assert.ok(budget.snapshot().reservedBytes <= 32768); } } })));
  }
  // Interleave dispatch with the existing bounded queue shape, without workers.
  const { runBounded } = require('../server/lib/plm-image-download-queue');
  const jobs = ['a', 'b'].map(id => runBounded(fixture(16, [512, 1024, 2048, 4096]),
    item => image(budget, item, { onStage(s) { if (s === 'download') starts.push(id); } }), { concurrency: 2 }));
  const outcomes = await Promise.all(jobs);
  assert.ok(starts.slice(0, 4).includes('a') && starts.slice(0, 4).includes('b'));
  assert.ok(outcomes.every(job => job.results.every(x => x.ok)));
  // Also exercise FIFO under a deeper finite queue. Production must keep its
  // own dispatch bounded rather than enqueueing a whole inventory at once.
  await Promise.all([sync('a'), sync('b')]); drained(budget);
});

test('false Content-Length and unknown overflow release their full reservation', async () => {
  const item = fixture(1, [512])[0];
  for (const options of [{ bodySize: 513 }, { bodySize: 511 }, { unknown: true, bodySize: 513 }]) {
    const budget = createByteBudget({ limitBytes: 2048 });
    await assert.rejects(image(budget, item, options), {
      code: options.unknown ? 'PLM_IMAGE_TOO_LARGE' : 'PLM_IMAGE_LENGTH_MISMATCH',
    });
    drained(budget);
  }
});

test('2048 inherited variable-size PNGs leave only metadata in bounded queue results', async () => {
  const { runBounded } = require('../server/lib/plm-image-download-queue');
  const budget = createByteBudget({ limitBytes: 4 * 1024 * 1024 });
  const items = fixture();
  const run = await runBounded(items, item => image(budget, item), { concurrency: 8 });
  assert.equal(run.results.length, 2048);
  for (const result of run.results) {
    assert.equal(result.ok, true);
    assert.equal(result.value.size, result.item.size);
    assert.equal(result.value.hash, hash(png(result.item.size, result.item.contentTag)));
    assert.deepEqual(Object.keys(result.value).sort(), ['hash', 'id', 'size']);
  }
  drained(budget);
});
