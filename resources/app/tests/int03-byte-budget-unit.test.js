'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createByteBudget, planImageReservation } = require('../server/lib/plm-image-byte-budget');
const tick = () => new Promise(resolve => setImmediate(resolve));

function empty(budget) {
  const s = budget.snapshot();
  assert.equal(s.reservedBytes, 0);
  assert.equal(s.activePermits, 0);
  assert.equal(s.waitingCount, 0);
  assert.ok(s.peakReservedBytes <= s.limitBytes);
}

test('shared total admits only fitting requests and release wakes a waiter', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const a = await budget.acquire(60);
  const b = await budget.acquire(40);
  let admitted = false;
  const pending = budget.acquire(1).then(p => { admitted = true; return p; });
  await tick();
  assert.equal(admitted, false);
  assert.deepEqual(budget.snapshot(), { limitBytes: 100, reservedBytes: 100, peakReservedBytes: 100, activePermits: 2, waitingCount: 1 });
  assert.equal(a.release(), true);
  const c = await pending;
  assert.equal(budget.snapshot().reservedBytes, 41);
  b.release(); c.release(); empty(budget);
});

test('FIFO prevents a small newcomer from bypassing an older large waiter', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const active = await budget.acquire(60);
  const order = [];
  const large = budget.acquire(80).then(p => { order.push('large'); return p; });
  const small = budget.acquire(10).then(p => { order.push('small'); return p; });
  await tick(); assert.deepEqual(order, []);
  active.release();
  const [a, b] = await Promise.all([large, small]);
  assert.deepEqual(order, ['large', 'small']);
  a.release(); b.release(); empty(budget);
});

test('double release cannot refund somebody else’s active bytes', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const first = await budget.acquire(100);
  const waiting = budget.acquire(100);
  assert.equal(first.release(), true);
  const second = await waiting;
  assert.equal(first.release(), false);
  assert.equal(budget.snapshot().reservedBytes, 100);
  second.release(); empty(budget);
});

test('oversized requests fail immediately even when other work is active', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const active = await budget.acquire(10);
  await assert.rejects(budget.acquire(101), { code: 'PLM_IMAGE_BUDGET_EXCEEDED' });
  assert.equal(budget.snapshot().waitingCount, 0);
  active.release(); empty(budget);
});

test('invalid byte counts and invalid signals never mutate the budget', async () => {
  for (const limitBytes of [0, -1, 1.2, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => createByteBudget({ limitBytes }));
  }
  const budget = createByteBudget({ limitBytes: 100 });
  for (const bytes of [0, -1, 1.2, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(budget.acquire(bytes));
  }
  await assert.rejects(budget.acquire(10, { signal: {} }));
  empty(budget);
});

test('already cancelled work never receives admission', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(budget.acquire(10, { signal: controller.signal }), { name: 'AbortError', code: 'PLM_IMAGE_BUDGET_CANCELLED' });
  empty(budget);
});

test('cancelling the head waiter unblocks a fitting follower without a release', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const active = await budget.acquire(60);
  const controller = new AbortController();
  const head = budget.acquire(80, { signal: controller.signal });
  const rejected = assert.rejects(head, { code: 'PLM_IMAGE_BUDGET_CANCELLED' });
  const follower = budget.acquire(40);
  assert.equal(budget.snapshot().waitingCount, 2);
  controller.abort(); await rejected;
  const next = await follower;
  assert.equal(budget.snapshot().reservedBytes, 100);
  active.release(); next.release(); empty(budget);
});

test('cancelling a non-head waiter leaves the other waiter intact', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const active = await budget.acquire(100);
  const first = budget.acquire(100);
  const controller = new AbortController();
  const second = budget.acquire(10, { signal: controller.signal });
  const rejected = assert.rejects(second, { code: 'PLM_IMAGE_BUDGET_CANCELLED' });
  controller.abort(); await rejected;
  assert.equal(budget.snapshot().waitingCount, 1);
  active.release(); (await first).release(); empty(budget);
});

test('abort after admission does not refund buffers that are still live', async () => {
  const budget = createByteBudget({ limitBytes: 100 });
  const controller = new AbortController();
  const permit = await budget.acquire(100, { signal: controller.signal });
  controller.abort();
  assert.equal(budget.snapshot().reservedBytes, 100);
  permit.release(); empty(budget);
});

test('abort listeners are removed on grant and cancellation', async () => {
  const budget = createByteBudget({ limitBytes: 10 });
  const controller = new AbortController();
  const { getEventListeners } = require('node:events');
  const first = await budget.acquire(10, { signal: controller.signal });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const pending = budget.acquire(10, { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  controller.abort(); await rejected;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  first.release(); empty(budget);
});

test('release/abort races settle each waiter once without leaking reservations', async () => {
  for (const abortFirst of [false, true]) {
    const budget = createByteBudget({ limitBytes: 1 });
    const first = await budget.acquire(1);
    const controller = new AbortController();
    const pending = budget.acquire(1, { signal: controller.signal });
    const settled = pending.then(p => ({ p }), error => ({ error }));
    if (abortFirst) { controller.abort(); first.release(); }
    else { first.release(); controller.abort(); }
    const result = await settled;
    if (abortFirst) assert.equal(result.error.code, 'PLM_IMAGE_BUDGET_CANCELLED');
    else { assert.equal(result.p.bytes, 1); result.p.release(); }
    empty(budget);
  }
});

test('known length includes chunks/concat plus explicit validation and commit copies', () => {
  assert.deepEqual(planImageReservation({ contentLength: '512', maxImageBytes: 1024, validationCopyBytes: 128, commitCopyBytes: 2048 }), {
    contentLength: 512, maxImageBytes: 1024, bodyLimitBytes: 512,
    downloadCopyBytes: 512, validationCopyBytes: 128, commitCopyBytes: 2048, totalBytes: 3200,
  });
});

test('missing length reserves the whole per-image cap, including concat headroom', () => {
  for (const contentLength of [undefined, null, '']) {
    const plan = planImageReservation({ contentLength, maxImageBytes: 2048 });
    assert.equal(plan.contentLength, null);
    assert.equal(plan.bodyLimitBytes, 2048);
    assert.equal(plan.totalBytes, 4096);
    assert.equal(Object.isFrozen(plan), true);
  }
});

test('malformed, empty and excessive Content-Length fail closed', () => {
  for (const contentLength of [' ', 'abc', '10x', '-1', '1.5', '+10', '1e3', '1, 2', ['12'], Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => planImageReservation({ contentLength, maxImageBytes: 1024 }), { code: 'PLM_IMAGE_LENGTH_INVALID' });
  }
  assert.throws(() => planImageReservation({ contentLength: 0, maxImageBytes: 1024 }), { code: 'PLM_IMAGE_EMPTY' });
  assert.throws(() => planImageReservation({ contentLength: 1025, maxImageBytes: 1024 }), { code: 'PLM_IMAGE_TOO_LARGE' });
});

test('invalid headroom and unsafe reservation arithmetic are rejected', () => {
  for (const extra of [-1, 0.5, NaN, Infinity, '10']) {
    assert.throws(() => planImageReservation({ contentLength: 10, validationCopyBytes: extra }));
    assert.throws(() => planImageReservation({ contentLength: 10, commitCopyBytes: extra }));
  }
  assert.throws(() => planImageReservation({ contentLength: Number.MAX_SAFE_INTEGER, maxImageBytes: Number.MAX_SAFE_INTEGER }));
});

test('image larger than the whole budget is rejected including all copies', async () => {
  const budget = createByteBudget({ limitBytes: 1024 });
  await assert.rejects(budget.acquireImage({ contentLength: 513 }), { code: 'PLM_IMAGE_BUDGET_EXCEEDED' });
  await assert.rejects(budget.acquireImage({ maxImageBytes: 1024 }), { code: 'PLM_IMAGE_BUDGET_EXCEEDED' });
  await assert.rejects(budget.acquireImage({ contentLength: 512, commitCopyBytes: 1 }), { code: 'PLM_IMAGE_BUDGET_EXCEEDED' });
  empty(budget);
});

test('body guards reject false lengths and unknown-length overflow before retaining a chunk', async () => {
  const budget = createByteBudget({ limitBytes: 4096 });
  const known = await budget.acquireImage({ contentLength: 512 });
  known.checkBodySize(256);
  assert.throws(() => known.checkBodySize(513), { code: 'PLM_IMAGE_LENGTH_MISMATCH' });
  assert.throws(() => known.checkBodySize(511, { complete: true }), { code: 'PLM_IMAGE_LENGTH_MISMATCH' });
  known.checkBodySize(512, { complete: true }); known.release();
  const unknown = await budget.acquireImage({ maxImageBytes: 1024 });
  assert.throws(() => unknown.checkBodySize(1025), { code: 'PLM_IMAGE_TOO_LARGE' });
  assert.throws(() => unknown.checkBodySize(0, { complete: true }), { code: 'PLM_IMAGE_EMPTY' });
  unknown.checkBodySize(1000, { complete: true }); unknown.release(); empty(budget);
});

test('withImage releases after success, synchronous throw and asynchronous failure', async () => {
  const budget = createByteBudget({ limitBytes: 1024 });
  assert.equal(await budget.withImage({ contentLength: 512 }, async p => p.bytes), 1024);
  empty(budget);
  for (const callback of [() => { throw new Error('sync'); }, async () => { await tick(); throw new Error('async'); }]) {
    await assert.rejects(budget.withImage({ contentLength: 512 }, callback)); empty(budget);
  }
  await assert.rejects(budget.withImage({ contentLength: 512 }, null)); empty(budget);
});

test('withImage suppresses dispatch if cancelled between grant and callback', async () => {
  const budget = createByteBudget({ limitBytes: 1024 });
  const controller = new AbortController(); let called = false;
  const work = budget.withImage({ contentLength: 512, signal: controller.signal }, () => { called = true; });
  const rejected = assert.rejects(work, { code: 'PLM_IMAGE_BUDGET_CANCELLED' });
  controller.abort(); await rejected;
  assert.equal(called, false); empty(budget);
});

test('snapshot and permits cannot be used to change accounting', async () => {
  const budget = createByteBudget({ limitBytes: 1024 });
  const p = await budget.acquireImage({ contentLength: 512 });
  assert.throws(() => { budget.snapshot().reservedBytes = 0; }, TypeError);
  assert.throws(() => { p.bytes = 0; }, TypeError);
  assert.throws(() => { p.plan.totalBytes = 0; }, TypeError);
  assert.equal(budget.snapshot().reservedBytes, 1024);
  p.release(); empty(budget);
});
