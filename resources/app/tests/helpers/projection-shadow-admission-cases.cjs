'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, nextTurn, controlledFetch, observe } = require('./projection-shadow-fixture.cjs');

test('RED candidate: maxConcurrentBatches caps active backend calls globally across sessions and requests', async () => {
  const backend = controlledFetch();
  const { session, open } = fixture({ maxBatchRows: 1, maxConcurrentBatches: 2, fetchDetails: (request, rows) => backend.fetch(request, rows) });
  const pending = [observe(session.requireFull([0, 1])), observe(open().requireFull([2, 3]))];
  await nextTurn(); const activeBeforeRelease = backend.active;
  const results = await backend.drain(pending);
  assert.ok(results.every(result => result.ok), 'admission must eventually return all complete records');
  assert.equal(backend.calls.length, 4, 'all four bounded batches eventually execute');
  assert.equal(activeBeforeRelease, 2, 'exactly two requests may start before any controlled response is released');
  assert.ok(backend.peak <= 2, 'cap applies to the whole coordinator, not separately to each request/session');
});

test('RED candidate: last queued subscriber abort prevents fetch start while another queued subscriber survives', async () => {
  const backend = controlledFetch(), abandoned = new AbortController(), sharedAbort = new AbortController();
  const { session } = fixture({ maxBatchRows: 1, maxConcurrentBatches: 1, fetchDetails: (request, rows) => backend.fetch(request, rows) });
  const first = observe(session.requireFull([0]));
  const cancelled = observe(session.requireFull([1], { signal: abandoned.signal }));
  const sharedOne = observe(session.requireFull([2], { signal: sharedAbort.signal }));
  const sharedTwo = observe(session.requireFull([2]));
  await nextTurn(); abandoned.abort(); sharedAbort.abort();
  const [cancelledResult, sharedAbortedResult] = await Promise.all([cancelled, sharedOne]);
  const results = await backend.drain([first, sharedTwo]);
  assert.equal(cancelledResult.ok, false); assert.equal(cancelledResult.error.code, 'ABORTED');
  assert.equal(sharedAbortedResult.ok, false); assert.equal(sharedAbortedResult.error.code, 'ABORTED');
  assert.ok(results.every(result => result.ok), 'the running request and surviving shared subscriber must complete');
  assert.equal(results[1].value.rows[0].Probe, 2);
  const sharedCall = backend.calls.find(call => call.request.records[0].ordinal === 2);
  assert.ok(sharedCall, 'the queued batch with a live subscriber must eventually start');
  assert.equal(sharedCall.request.signal.aborted, false, 'one subscriber cannot abort another subscriber backend');
  assert.equal(backend.calls.some(call => call.request.records[0].ordinal === 1), false,
    'a batch abandoned while queued must never invoke fetchDetails');
});
