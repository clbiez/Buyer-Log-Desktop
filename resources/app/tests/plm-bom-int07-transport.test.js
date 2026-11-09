'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int07-transport-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
const settings = require('../server/lib/corenectum-api-settings');
const { syncPlmBoms } = require('../server/lib/plm-bom-sync');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const store = () => ({ load: () => ({ models: {} }), saveResults: entries => ({ written: entries.length, revision: 1 }) });
const token = 'int07-synthetic-token-never-sent-to-network';
const records = [{ plmId: '1', styleId: '2' }];
const okBody = { data: { success: true, coreNectumResultData: { styleBom: { styleId: 2, styleBomComponents: [] } } } };
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('INT07: real client sends four total HTTP attempts for 429/503/timeout/network, one for 400', async t => {
  for (const failure of [429, 503, 'timeout', 'network', 400]) {
    let calls = 0;
    settings.saveToken('int07-http', token);
    t.mock.method(global, 'fetch', async () => {
      calls++;
      if (failure === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      if (failure === 'network') throw new TypeError('synthetic offline');
      return new Response('{}', { status: failure });
    });
    const r = await syncPlmBoms(records, { ownerId: 'int07-http', store: store(), retryDelaysMs: [0] });
    assert.equal(calls, failure === 400 ? 1 : 4, String(failure));
    assert.equal(r.failed.length, 1);
    t.mock.restoreAll();
  }
});

test('INT07: real client auth recovery rotates generation and resumes within the same attempt budget', async t => {
  settings.saveToken('int07-auth', token);
  let calls = 0, waits = 0;
  t.mock.method(global, 'fetch', async () => ++calls === 1 ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(okBody)));
  const r = await syncPlmBoms(records, { ownerId: 'int07-auth', store: store(), retryDelaysMs: [0], currentTokenGeneration: settings.currentTokenGeneration, waitForAuth: async () => { waits++; settings.saveToken('int07-auth', token + '-rotated'); return true; } });
  assert.equal(calls, 2); assert.equal(waits, 1); assert.equal(r.fetched, 1); assert.equal(r.failed.length, 0);
});

test('INT07: job predicate cancellation reaches the active client fetch and rejects late results', async t => {
  settings.saveToken('int07-active', token);
  let activeSignal, cancelled = false, writes = 0;
  t.mock.method(global, 'fetch', async (_url, options) => {
    activeSignal = options.signal;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  });
  const running = syncPlmBoms(records, { ownerId: 'int07-active', store: { load: () => ({ models: {} }), saveResults: () => { writes++; return {}; } }, isCancelled: () => cancelled });
  while (!activeSignal) await pause(1);
  cancelled = true;
  const result = await running;
  assert.equal(activeSignal.aborted, true);
  assert.equal(result.stopped, 'cancelled'); assert.equal(result.fetched, 0); assert.equal(writes, 0);
});

test('INT07 FINAL: real client checks legacy cancellation at body completion between polls', async t => {
  settings.saveToken('int07-boundary', token);
  let cancelled = false, calls = 0, writes = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    const response = new Response(JSON.stringify(okBody));
    const text = response.text.bind(response);
    response.text = async () => { const result = await text(); cancelled = true; return result; };
    return response;
  });
  const result = await syncPlmBoms(records, { ownerId: 'int07-boundary', isCancelled: () => cancelled,
    store: { load: () => ({ models: {} }), saveResults: () => { writes++; return {}; } } });
  assert.equal(result.stopped, 'cancelled'); assert.equal(result.fetched, 0); assert.equal(calls, 1); assert.equal(writes, 0);
});
