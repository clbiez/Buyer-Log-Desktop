'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createDesktopAuthRelay } = require('../server/lib/lcwai/lcwai-desktop-relay');
const { createDesktopTokenHolder } = require('../server/lib/lcwai/lcwai-desktop-session');
const { createDefaultEngine } = require('../server/lib/lcwai');
const { fingerprint } = require('../server/lib/lcwai/lcwai-auth');
const config = require('../server/lib/lcwai/lcwai-config');
const { syncPlmBoms } = require('../server/lib/plm-bom-sync');
const { createStore } = require('../server/lib/plm-bom-store');

function token(id) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode({ iss: config.KEYCLOAK.issuer, azp: config.KEYCLOAK.clientId, exp: Math.floor(Date.now() / 1000) + 600, sub: 'demo', jti: id })}.c2ln`;
}
function bom(description = 'SPECIAL ART POSITION') {
  return { data: { coreNectumResultData: { styleBom: { styleId: 101, styleBomId: 201, styleBomComponents: [{
    styleBomComponentId: 301, componentId: 401, componentCode: 'DEMO-PRINT',
    componentType: 'Trim', mainCategoryName: 'Embellishment', categoryName: 'Print',
    categoryGroupName: 'Pigment', description, quantity: 1,
  }] } } } };
}
function aiResponse() {
  const answer = { placements: [{ componentCode: 'DEMO-PRINT', placement: 'front_body', confidence: 'high' }], confidence: 'high', notes: [] };
  return new Response(`data: ${JSON.stringify({ content: JSON.stringify(answer), chunkType: 'content' })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

async function fixture(t, { signin = false, fail = false, rejectFirst = false, staleRefresh = false } = {}) {
  const holder = createDesktopTokenHolder();
  const calls = [], apiCalls = [];
  const staleToken = token('stale');
  let sequence = 0;
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  const handlerSource = main.slice(main.indexOf('async function handleOabRelayRequest'), main.indexOf('function startOabRelay'));
  const handle = new Function('oabRelaySecretValid', 'acquireLcwAiToken', `${handlerSource};return handleOabRelayRequest;`)(
    value => value === 'test-bridge-secret',
    async options => {
      calls.push(options);
      if (fail) return { ok: false, code: 'LCWAI_NETWORK' };
      if (signin && !options.interactive) return { ok: false, code: 'LCWAI_SIGNIN_REQUIRED' };
      holder.set(staleRefresh ? staleToken : token(String(++sequence)));
      return { ok: true, token: 'must-never-be-returned', source: 'desktop-sso' };
    }
  );
  const server = http.createServer((req, res) => { void handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const env = { BUYER_LOG_DESKTOP_AUTH_RELAY_URL: `http://127.0.0.1:${server.address().port}`, BUYER_LOG_DESKTOP_BRIDGE_SECRET: 'test-bridge-secret' };
  const relay = createDesktopAuthRelay({ env });
  const engine = createDefaultEngine({ holder, desktopRelay: relay, logger() {}, connector: () => { throw new Error('External browser must never be used'); }, fetch: async (_url, init) => {
    apiCalls.push(init.headers.Authorization);
    return rejectFirst && apiCalls.length === 1 ? new Response('', { status: 401 }) : aiResponse();
  } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-lcwai-relay-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore(path.join(dir, 'bom.json'));
  const sync = (options = {}) => syncPlmBoms([{ plmId: '900001', styleId: '101', styleName: 'Demo model' }], {
    ownerId: 'demo', store, aiEngine: engine, postJson: async () => bom(), ...options,
  });
  return { holder, calls, apiCalls, env, relay, engine, sync, store };
}

test('PLM BOM first AI request acquires the embedded session without external browser; unchanged BOM reuses analysis', async t => {
  const f = await fixture(t);
  const result = await f.sync();
  assert.equal(result.aiResolved, 1);
  assert.equal(f.store.entry('900001').ai.status, 'resolved');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].interactive, false);
  assert.equal((await f.engine.getStatus('demo', { refresh: false })).source, 'desktop-sso');
  await f.sync();
  assert.equal(f.calls.length, 1);
  assert.equal(f.apiCalls.length, 1);
});

test('PLM sign-in is requested inside Electron only after silent SSO needs login', async t => {
  const f = await fixture(t, { signin: true });
  assert.equal((await f.sync()).aiResolved, 1);
  assert.deepEqual(f.calls.map(call => call.interactive), [false, true]);
});

test('passive status never opens sign-in; cleared session renews silently; 401 uses a different desktop token once', async t => {
  const f = await fixture(t, { rejectFirst: true });
  assert.equal((await f.engine.getStatus('demo')).connected, false);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.sync()).aiResolved, 1);
  assert.equal(f.apiCalls.length, 2);
  assert.notEqual(f.apiCalls[0], f.apiCalls[1]);
  assert.equal(f.calls[1].avoidFingerprint, fingerprint(f.apiCalls[0].replace('Bearer ', '')));
  f.holder.clear();
  f.engine.disconnect('demo');
  await f.engine.ensureSession('demo');
  assert.deepEqual(f.calls.map(call => call.interactive), [false, false, false]);
});

test('configured desktop with unavailable relay never falls back to Edge before its first token', async t => {
  const f = await fixture(t);
  f.env.BUYER_LOG_DESKTOP_AUTH_RELAY_URL = '';
  assert.equal((await f.sync()).aiResolved, 0);
  assert.match(f.store.entry('900001').ai.error, /LCWAI_BROWSER_UNAVAILABLE/);
  assert.deepEqual(f.calls, []);
});

test('concurrent server jobs share one acquisition and failed acquisition can be retried', async () => {
  let release, attempts = 0;
  const relay = createDesktopAuthRelay({
    env: { BUYER_LOG_DESKTOP_AUTH_RELAY_URL: 'http://127.0.0.1:1234', BUYER_LOG_DESKTOP_BRIDGE_SECRET: 'test-secret' },
    fetch: () => { attempts++; return new Promise(resolve => { release = resolve; }); },
  });
  const first = relay.ensureAuth(), second = relay.ensureAuth();
  assert.equal(attempts, 1);
  release(new Response(JSON.stringify({ ok: false, code: 'LCWAI_SIGNIN_REQUIRED' })));
  const failures = await Promise.allSettled([first, second]);
  assert.ok(failures.every(result => result.status === 'rejected' && result.reason.code === 'LCWAI_AUTH_REQUIRED'));
  const retry = relay.ensureAuth({ interactive: true });
  assert.equal(attempts, 2);
  release(new Response(JSON.stringify({ ok: true, token: 'not-exposed' })));
  assert.deepEqual(await retry, { ok: true });
});

test('clear BOM and AI-denied sync never acquire an AI session', async t => {
  const f = await fixture(t);
  await f.sync({ allowAi: false });
  await f.sync({ postJson: async () => bom('FRONT BODY') });
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.apiCalls, []);
});

test('a rejected desktop token is never sent twice when the embedded page cannot refresh it', async t => {
  const f = await fixture(t, { rejectFirst: true, staleRefresh: true });
  assert.equal((await f.sync()).aiResolved, 0);
  assert.equal(f.apiCalls.length, 1);
  assert.match(f.store.entry('900001').ai.error, /LCWAI_SESSION_EXPIRED/);
  assert.equal(f.calls.length, 2);
  await assert.rejects(f.engine.ensureSession('demo'), error => error.code === 'LCWAI_SESSION_EXPIRED');
  assert.equal(f.apiCalls.length, 1, 'later models must not resurrect the rejected token');
});

test('desktop bridge failure never falls back to Edge and leaves BOM evidence available', async t => {
  const f = await fixture(t, { fail: true });
  assert.equal((await f.sync()).aiResolved, 0);
  assert.equal(f.store.entry('900001').ai.status, 'failed');
  assert.equal(f.store.entry('900001').placements[0].placement, 'other');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.apiCalls, []);
});

test('relay requires loopback configuration and the bridge secret, exposes status only, and blocks redirects', async t => {
  const f = await fixture(t);
  const response = await fetch(f.env.BUYER_LOG_DESKTOP_AUTH_RELAY_URL + '/lcwai/auth', { method: 'POST', body: '{}' });
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
  assert.deepEqual(await f.relay.ensureAuth({ interactive: false }), { ok: true });
  for (const url of ['https://example.com', 'http://127.0.0.1:1234/evil', 'http://127.0.0.1:1234@evil.com', 'http://localhost:1234']) {
    assert.equal(createDesktopAuthRelay({ env: { ...f.env, BUYER_LOG_DESKTOP_AUTH_RELAY_URL: url } }).configured(), false);
  }
  const redirect = http.createServer((_req, res) => { res.writeHead(302, { Location: f.env.BUYER_LOG_DESKTOP_AUTH_RELAY_URL + '/lcwai/auth' }); res.end(); });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  t.after(() => { redirect.closeAllConnections(); redirect.close(); });
  const relay = createDesktopAuthRelay({ env: { ...f.env, BUYER_LOG_DESKTOP_AUTH_RELAY_URL: `http://127.0.0.1:${redirect.address().port}` } });
  await assert.rejects(relay.ensureAuth(), error => error.code === 'LCWAI_BROWSER_UNAVAILABLE');
});
