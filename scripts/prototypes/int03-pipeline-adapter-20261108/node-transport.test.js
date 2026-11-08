'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createNodeTransport } = require('./node-transport');
const { helper, fixture } = require('./pinned');
const { envelope, envelopeBytes } = require('./runtime');
const queue = require('./plm-image-download-queue.candidate');
const tick = () => new Promise(resolve => setImmediate(resolve));
function gate() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('Node HTTPS request adapter uses bounded streams, identity encoding, and waits for both close events', async () => {
  const closed = gate(); let request, opts;
  const transport = createNodeTransport({ agent: {}, get(options, callback) {
    opts = options;
    request = new EventEmitter(); request.setTimeout = () => {};
    let stopped = false;
    request.destroy = e => { if (stopped) return; stopped = true; if (e) request.emit('error', e); closed.promise.then(() => request.emit('close')); };
    setImmediate(() => {
      const response = new PassThrough({ highWaterMark: options.highWaterMark });
      response.statusCode = 200; response.headers = { 'content-type': 'image/png', 'content-length': '512' };
      callback(response); response.end(fixture.png(512, 8));
    });
    return request;
  } });
  const budget = helper.createByteBudget({ limitBytes: envelopeBytes });
  let done = false;
  const p = budget.withImage(envelope, async permit => { const image = await queue.downloadImage(fixture.url(0), { transport, permit }); return { size: image.size }; }).finally(() => { done = true; });
  await tick(); await tick();
  try { assert.equal(done, false); assert.equal(budget.snapshot().reservedBytes, envelopeBytes); assert.equal(opts.highWaterMark, 65536); assert.equal(opts.headers['Accept-Encoding'], 'identity'); }
  finally { closed.resolve(); }
  const image = await p; assert.equal(image.size, 512); assert.equal(budget.snapshot().reservedBytes, 0);
});

test('abort before headers does not return until request close, without starting any retry', async () => {
  const closed = gate(), opened = gate(); let starts = 0;
  const controller = new AbortController();
  const transport = createNodeTransport({ agent: {}, get() {
    starts++; const request = new EventEmitter(); request.setTimeout = () => {};
    let stopped = false;
    request.destroy = e => { if (stopped) return; stopped = true; if (e) request.emit('error', e); closed.promise.then(() => request.emit('close')); };
    opened.resolve(); return request;
  } });
  const budget = helper.createByteBudget({ limitBytes: envelopeBytes });
  let done = false;
  const p = budget.withImage({ ...envelope, signal: controller.signal }, permit => queue.downloadImage(fixture.url(0), { transport, permit, signal: controller.signal })).finally(() => { done = true; });
  const rejected = assert.rejects(p, { code: 'PLM_JOB_CANCELLED' });
  await opened.promise; controller.abort(); await tick();
  try { assert.equal(done, false); assert.equal(budget.snapshot().activePermits, 1); assert.equal(starts, 1); }
  finally { closed.resolve(); }
  await rejected; assert.equal(budget.snapshot().reservedBytes, 0);
});
