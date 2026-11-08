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

test('INT07: transport limitation evidence — job cancellation cannot abort the active client fetch', async t => {
  settings.saveToken('int07-active', token);
  let resolveFetch, activeSignal, cancelled = false, finished = false;
  t.mock.method(global, 'fetch', async (_url, options) => { activeSignal = options.signal; return new Promise(resolve => { resolveFetch = resolve; }); });
  const running = syncPlmBoms(records, { ownerId: 'int07-active', store: store(), isCancelled: () => cancelled }).then(r => { finished = true; return r; });
  while (!activeSignal) await pause(1);
  cancelled = true;
  await pause(35);
  assert.equal(activeSignal.aborted, false, 'Known blocker: no external signal support in the unchanged general client');
  assert.equal(finished, false, 'Do not release the permit or claim active cancellation before the HTTP call settles');
  resolveFetch(new Response(JSON.stringify(okBody)));
  assert.equal((await running).stopped, 'cancelled');
});

test('INT07: transport limitation evidence — body decoding can outlive the BOM admission deadline', async t => {
  settings.saveToken('int07-body', token);
  let resolveBody, decoding = false, finished = false;
  t.mock.method(global, 'fetch', async () => ({ ok: true, status: 200, text: async () => { decoding = true; return new Promise(resolve => { resolveBody = resolve; }); } }));
  const running = syncPlmBoms(records, { ownerId: 'int07-body', store: store(), bomAdmissionMs: 5 }).then(r => { finished = true; return r; });
  while (!decoding) await pause(1);
  await pause(20); assert.equal(finished, false, 'Known blocker: client clears timeout before response.text()');
  resolveBody(JSON.stringify(okBody)); assert.equal((await running).fetched, 1);
});
