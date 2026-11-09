'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int07-final-http-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
const settings = require('../server/lib/corenectum-api-settings');
const client = require('../server/lib/corenectum-api-client');
const bom = require('../server/lib/corenectum-bom-api');
const { syncPlmBoms } = require('../server/lib/plm-bom-sync');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const records = [{ plmId: '1', styleId: '2' }];
const payload = id => ({ data: { success: true, coreNectumResultData: { styleBom: { styleId: id, styleBomComponents: [] } } } });
const store = () => ({ load: () => ({ models: {} }), saveResults: entries => ({ written: entries.length, revision: 1 }) });
async function until(predicate) {
  const end = Date.now() + 2500;
  while (!predicate()) { assert.ok(Date.now() < end, 'event observed before safety timeout'); await pause(5); }
}
async function fixture(t, handler) {
  const sockets = new Set(), metrics = { requests: 0, active: 0, closed: 0, peak: 0 };
  const server = http.createServer((req, res) => {
    metrics.requests++; metrics.active++; metrics.peak = Math.max(metrics.peak, metrics.active);
    res.on('close', () => { metrics.active--; metrics.closed++; });
    handler(req, res, metrics);
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { t.diagnostic(JSON.stringify(metrics)); for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); });
  const realFetch = global.fetch;
  t.mock.method(global, 'fetch', (url, options) => realFetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}${new URL(url).search}`, options));
  settings.saveToken('int07-final', 'synthetic-local-only');
  return metrics;
}
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('INT07 FINAL: real active fetch cancellation closes the HTTP request, releases permits and starts no late writes', { timeout: 6000 }, async t => {
  let writes = 0;
  const metrics = await fixture(t, () => {});
  const controller = new AbortController();
  const running = syncPlmBoms(records, { ownerId: 'int07-final', signal: controller.signal, store: { load: () => ({ models: {} }), saveResults: () => { writes++; return {}; } } });
  await until(() => metrics.active === 1); controller.abort();
  const result = await running;
  await until(() => metrics.active === 0);
  assert.equal(metrics.requests, 1); assert.equal(metrics.closed, 1);
  assert.equal(result.stopped, 'cancelled'); assert.equal(result.fetched, 0); assert.equal(writes, 0);
});

test('INT07 FINAL: real headers then stalled streamed body stops at total target deadline', { timeout: 6000 }, async t => {
  const metrics = await fixture(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"data":'); });
  const started = Date.now();
  const result = await syncPlmBoms(records, { ownerId: 'int07-final', bomAdmissionMs: 150, store: store(), retryDelaysMs: [0] });
  await until(() => metrics.active === 0);
  assert.equal(result.fetched, 0); assert.equal(result.failed[0].code, 'PLM_BOM_READ_DEADLINE');
  assert.equal(metrics.requests, 1); assert.equal(metrics.closed, 1);
  assert.ok(Date.now() - started < 2500);
});

test('INT07 FINAL: target deadline also aborts a request before headers', { timeout: 6000 }, async t => {
  const metrics = await fixture(t, () => {});
  const result = await syncPlmBoms(records, { ownerId: 'int07-final', bomAdmissionMs: 150, store: store() });
  await until(() => metrics.active === 0);
  assert.equal(result.failed[0].code, 'PLM_BOM_READ_DEADLINE'); assert.equal(metrics.requests, 1);
});

test('INT07 FINAL: opt-in consumers use separate reads; cancelling one leaves the other live; success signal stays live', { timeout: 6000 }, async t => {
  const responses = [];
  const metrics = await fixture(t, (_req, res) => responses.push(res));
  const a = new AbortController(), b = new AbortController();
  const options = signal => ({ token: 'synthetic-local-only', retries: 1, bomReadControl: true, signal });
  const first = client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, options(a.signal));
  const rejected = assert.rejects(first, error => error.name === 'AbortError');
  const second = client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, options(b.signal));
  await until(() => metrics.requests === 2); a.abort(); await rejected;
  await until(() => metrics.active === 1);
  responses[1].end(JSON.stringify(payload(2)));
  assert.deepEqual(await second, payload(2)); assert.equal(b.signal.aborted, false);
  await until(() => metrics.active === 0);
});

test('INT07 FINAL: default consumers still share and clone one read and ignore unsolicited signal', { timeout: 6000 }, async t => {
  let response;
  const metrics = await fixture(t, (_req, res) => { response = res; });
  const controller = new AbortController();
  const options = { token: 'synthetic-local-only', retries: 1, signal: controller.signal };
  const first = client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, options);
  const second = client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, options);
  await until(() => metrics.requests === 1); controller.abort(); await pause(30);
  assert.equal(metrics.active, 1); response.end(JSON.stringify(payload(2)));
  const [a, b] = await Promise.all([first, second]); assert.deepEqual(a, b); assert.notStrictEqual(a, b); assert.equal(metrics.requests, 1);
});

for (const mode of ['cancel', 'deadline']) {
  test(`INT07 FINAL: ${mode} interrupts shared auth wait with no new HTTP or store writes`, { timeout: 6000 }, async t => {
    const metrics = await fixture(t, (_req, res) => { res.writeHead(401); res.end('{}'); });
    let authStarted = false, resolveAuth, writes = 0;
    const controller = new AbortController();
    const running = syncPlmBoms(records, { ownerId: 'int07-final', signal: controller.signal, bomAdmissionMs: mode === 'deadline' ? 150 : 2000,
      store: { load: () => ({ models: {} }), saveResults: () => { writes++; return {}; } }, retryDelaysMs: [0],
      waitForAuth: () => { authStarted = true; return new Promise(resolve => { resolveAuth = resolve; }); } });
    await until(() => authStarted); if (mode === 'cancel') controller.abort();
    const result = await running;
    assert.equal(result.fetched, 0); assert.equal(metrics.requests, 1); assert.equal(writes, 0);
    if (mode === 'deadline') assert.equal(result.failed[0].code, 'PLM_BOM_READ_DEADLINE');
    else assert.equal(result.stopped, 'cancelled');
    resolveAuth(true); await pause(30); assert.equal(metrics.requests, 1); assert.equal(writes, 0);
  });
  test(`INT07 FINAL: ${mode} interrupts retry delay instead of starting another read`, { timeout: 6000 }, async t => {
    const metrics = await fixture(t, (_req, res) => { res.writeHead(503); res.end('{}'); });
    const controller = new AbortController(); let retrying = false;
    const running = syncPlmBoms(records, { ownerId: 'int07-final', signal: controller.signal, bomAdmissionMs: mode === 'deadline' ? 150 : 2000,
      store: store(), retryDelaysMs: [10000], onProgress: p => { if (/yeniden|Retrying/.test(p.phase)) retrying = true; } });
    await until(() => retrying); if (mode === 'cancel') controller.abort();
    const result = await running; assert.equal(metrics.requests, 1); assert.equal(result.fetched, 0);
    if (mode === 'deadline') assert.equal(result.failed[0].code, 'PLM_BOM_READ_DEADLINE'); else assert.equal(result.stopped, 'cancelled');
  });
}

for (const mode of ['cancel', 'deadline']) {
  test(`INT07 FINAL: ${mode} removes queued reads; different owner progresses and all five permits are reusable`, { timeout: 6000 }, async t => {
    let hold = true;
    const metrics = await fixture(t, async (req, res) => {
      let text = ''; for await (const chunk of req) text += chunk;
      const id = JSON.parse(text).styleId;
      if (id >= 20 && id < 25 && hold) return;
      res.end(JSON.stringify(payload(id)));
    });
    const singles = Array.from({ length: 5 }, (_, i) => ({ plmId: String(10 + i), styleId: String(20 + i) }));
    const holder = new AbortController();
    const held = syncPlmBoms(singles, { ownerId: 'int07-final', store: store(), signal: holder.signal });
    await until(() => metrics.active === 5);
    const queuedSignal = new AbortController();
    const queued = syncPlmBoms(records, { ownerId: 'int07-final', store: store(), signal: queuedSignal.signal, bomAdmissionMs: mode === 'deadline' ? 150 : 2000 });
    settings.saveToken('int07-other', 'synthetic-local-only');
    const other = await syncPlmBoms(records, { ownerId: 'int07-other', store: store() });
    assert.equal(other.fetched, 1, 'independent owner was admitted while five same-owner reads were held');
    if (mode === 'cancel') queuedSignal.abort();
    const result = await queued;
    assert.equal(metrics.requests, 6, 'queued target made no network request');
    if (mode === 'deadline') assert.equal(result.failed[0].code, 'PLM_BOM_READ_DEADLINE'); else assert.equal(result.stopped, 'cancelled');
    holder.abort(); await held; await until(() => metrics.active === 0); hold = false;
    const reuse = await syncPlmBoms(singles, { ownerId: 'int07-final', store: store() });
    assert.equal(reuse.fetched, 5); assert.equal(metrics.requests, 11); await until(() => metrics.active === 0);
  });
}

for (const status of [429, 503, 400]) {
  test(`INT07 FINAL: real HTTP ${status} respects four attempts, permanent failure and request cleanup`, { timeout: 6000 }, async t => {
    const metrics = await fixture(t, (_req, res) => { res.writeHead(status, { 'Retry-After': '0' }); res.end('{}'); });
    const result = await syncPlmBoms(records, { ownerId: 'int07-final', store: store(), retryDelaysMs: [0] });
    assert.equal(metrics.requests, status === 400 ? 1 : 4); assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].code, 'CORENECTUM_API_HTTP_ERROR'); await until(() => metrics.active === 0);
  });
}

test('INT07 FINAL: real auth recovery cancels unread auth body, keeps generation and resumes with refreshed token', { timeout: 6000 }, async t => {
  const auth = [];
  const metrics = await fixture(t, (req, res, metrics) => {
    auth.push(req.headers.authorization);
    if (metrics.requests === 1) { res.writeHead(401); res.write('auth body need not finish'); }
    else res.end(JSON.stringify(payload(2)));
  });
  let waits = 0;
  const generation = settings.currentTokenGeneration();
  const result = await syncPlmBoms(records, { ownerId: 'int07-final', store: store(), retryDelaysMs: [0], currentTokenGeneration: settings.currentTokenGeneration,
    waitForAuth: async error => {
      waits++; assert.equal(error.details.tokenGeneration, generation);
      settings.saveToken('int07-final', 'synthetic-refreshed-local-only'); return true;
    } });
  assert.equal(waits, 1); assert.equal(result.fetched, 1, JSON.stringify(result)); assert.equal(metrics.requests, 2);
  assert.deepEqual(auth, ['Bearer synthetic-local-only', 'Bearer synthetic-refreshed-local-only']); await until(() => metrics.active === 0);
});

test('INT07 FINAL: cancellation after headers also closes a streamed error body without retry', { timeout: 6000 }, async t => {
  const metrics = await fixture(t, (_req, res) => { res.writeHead(503); res.write('slow error body'); });
  const controller = new AbortController();
  const running = syncPlmBoms(records, { ownerId: 'int07-final', store: store(), signal: controller.signal, retryDelaysMs: [0] });
  await until(() => metrics.active === 1); await pause(20); controller.abort();
  const result = await running; await until(() => metrics.active === 0);
  assert.equal(result.stopped, 'cancelled'); assert.equal(metrics.requests, 1); assert.equal(result.fetched, 0);
});

test('INT07 FINAL: a cancelled read cannot overwrite old data; previously completed safe target survives', { timeout: 6000 }, async t => {
  const metrics = await fixture(t, async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const id = JSON.parse(text).styleId;
    if (id === 2) res.end(JSON.stringify(payload(2)));
  });
  const controller = new AbortController(); let complete = false, saved = [];
  const old = { plmId: '3', styleId: '4', summary: 'last safe result' };
  const dataStore = { load: () => ({ models: { 3: old } }), saveResults: entries => { saved = entries; return { revision: 1 }; } };
  const running = syncPlmBoms([...records, { plmId: '3', styleId: '4' }], { ownerId: 'int07-final', store: dataStore, signal: controller.signal,
    onProgress: progress => { if (progress.model === '1') complete = true; } });
  await until(() => complete && metrics.requests === 2); controller.abort();
  const result = await running; await until(() => metrics.active === 0);
  assert.equal(result.fetched, 1); assert.equal(result.stopped, 'cancelled'); assert.equal(saved.length, 1);
  assert.equal(saved[0].plmId, '1'); assert.equal(old.summary, 'last safe result');
});

test('INT07 FINAL: pre-aborted opt-in starts no request; default and opt-in overlapping consumers remain independent', { timeout: 6000 }, async t => {
  const responses = [];
  const metrics = await fixture(t, (_req, res) => responses.push(res));
  const controller = new AbortController(); controller.abort();
  const opts = { token: 'synthetic-local-only', retries: 1 };
  await assert.rejects(client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, { ...opts, bomReadControl: true, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(metrics.requests, 0);
  const live = client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, opts);
  const cancel = new AbortController();
  const controlled = client.postJson('int07-final', bom.GET_STYLE_BOM_INFORMATION_URL, { styleId: 2 }, { ...opts, bomReadControl: true, signal: cancel.signal });
  const rejected = assert.rejects(controlled, { name: 'AbortError' });
  await until(() => metrics.requests === 2); cancel.abort(); await rejected;
  responses[0].end(JSON.stringify(payload(2))); assert.deepEqual(await live, payload(2)); await until(() => metrics.active === 0);
});
