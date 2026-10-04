'use strict';
/* LCW AI oturum sağlayıcısı: mevcut connector üzerinden çalışır, ikinci bir
   tarayıcı sistemi kurmaz; token yalnız lcwai kökeninden okunur. Route'lar
   renderer'a token taşımaz. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/lib/lcwai/lcwai-config');
const { createLcwAiBrowserSession, TOKEN_READ_EXPRESSION, isLcwAiUrl } = require('../server/lib/lcwai/lcwai-browser-session');

function fakePage(url, read) {
  return {
    _url: url, closed: false, gotos: [],
    url() { return this._url; }, isClosed() { return this.closed; },
    async _evaluateValue(expression) { assert.equal(expression, TOKEN_READ_EXPRESSION); return typeof read === 'function' ? read(this) : read; },
    async goto(target) { this.gotos.push(target); this._url = target; },
    client: { sent: [], async send(method) { this.sent.push(method); return {}; } },
  };
}
function fakeConnector(pages, { existing = true } = {}) {
  const context = { pages: () => pages, async syncPages() {}, async newPage(url) { const page = fakePage(url, { origin: config.WEB_ORIGIN, token: 'T-new' }); pages.push(page); return page; } };
  const calls = { existing: 0, ensure: 0, opened: [] };
  return {
    calls,
    async ensureExistingContext() { calls.existing++; if (!existing) throw Object.assign(new Error('no browser'), { code: 'CORENECTUM_EXISTING_BROWSER_REQUIRED' }); return { context }; },
    async ensureContext() { calls.ensure++; return { context }; },
    coreNectumProfileBinding: () => ({ bound: true, hasContext: true, browserContextId: 'p1' }),
    pageIsInBoundProfile: page => page.profile !== 'foreign',
    reusableBlankPageInBoundProfile: () => null,
    async pageInBoundProfile(ctx, url) { calls.opened.push(url); return ctx.newPage(url); },
  };
}
const clock = () => { let t = 0; return { now: () => t, sleep: async ms => { t += ms; } }; };

test('token okuma ifadesi yalnız lcwai kökeninde access_token döndürür, sorgu dizesi dönmez', () => {
  assert.match(TOKEN_READ_EXPRESSION, /location\.origin/);
  assert.match(TOKEN_READ_EXPRESSION, /https:\/\/lcwai\.lcwaikiki\.com/);
  assert.match(TOKEN_READ_EXPRESSION, /localStorage\.getItem\('access_token'\)/);
  assert.doesNotMatch(TOKEN_READ_EXPRESSION, /refresh_token|location\.href|location\.search|sessionStorage/);
  assert.equal(isLcwAiUrl('https://lcwai.lcwaikiki.com/chat/1'), true);
  assert.equal(isLcwAiUrl('https://lcwai.lcwaikiki.com.evil.example/'), false);
});

test('sessiz okuma: mevcut tarayıcıyı kullanır, Edge başlatmaz; yabancı profil sekmesi yok sayılır', async () => {
  const foreign = Object.assign(fakePage('https://lcwai.lcwaikiki.com/', { origin: config.WEB_ORIGIN, token: 'FOREIGN' }), { profile: 'foreign' });
  const own = fakePage('https://lcwai.lcwaikiki.com/c/1', { origin: config.WEB_ORIGIN, token: 'OWN' });
  const connector = fakeConnector([foreign, own]);
  const session = createLcwAiBrowserSession({ connector, ...clock() });
  const result = await session.readToken('u1', { isUsable: token => token === 'OWN' || token === 'FOREIGN' });
  assert.equal(result.token, 'OWN');
  assert.equal(connector.calls.ensure, 0, 'sessiz okuma tarayıcı başlatmaz');
  assert.equal(own.gotos.length, 0, 'geçerli token varken sekme yenilenmez');
});

test('sessiz okuma: tarayıcı yoksa BROWSER_UNAVAILABLE; Keycloak ekranı SESSION_EXPIRED', async () => {
  await assert.rejects(createLcwAiBrowserSession({ connector: fakeConnector([], { existing: false }), ...clock() }).readToken('u1'), error => error.code === 'LCWAI_BROWSER_UNAVAILABLE');
  const login = fakePage('https://keycloak.lcwaikiki.com/auth/realms/prod/protocol/openid-connect/auth', { origin: 'https://keycloak.lcwaikiki.com', token: '', login: true });
  await assert.rejects(createLcwAiBrowserSession({ connector: fakeConnector([login]), ...clock() }).readToken('u1'), error => error.code === 'LCWAI_SESSION_EXPIRED');
});

test('sessiz yenileme: süresi dolmuş token önce beklenir, sonra sekme BİR kez yenilenir', async () => {
  let fresh = false;
  const page = fakePage('https://lcwai.lcwaikiki.com/', p => ({ origin: config.WEB_ORIGIN, token: fresh ? 'FRESH' : 'OLD' }));
  page.goto = async function (target) { this.gotos.push(target); fresh = true; };
  const session = createLcwAiBrowserSession({ connector: fakeConnector([page]), pollMs: 100, ...clock() });
  const result = await session.readToken('u1', { isUsable: token => token === 'FRESH' });
  assert.equal(result.token, 'FRESH');
  assert.deepEqual(page.gotos, [`${config.WEB_ORIGIN}/`]);
});

test('etkileşimli giriş: sekme bağlı profilde açılır, öne getirilir, kullanıcı girişi beklenir', async () => {
  const pages = [];
  const connector = fakeConnector(pages);
  let polls = 0;
  connector.pageInBoundProfile = async (ctx, url) => {
    connector.calls.opened.push(url);
    const page = fakePage(url, () => (++polls < 3 ? { origin: 'https://keycloak.lcwaikiki.com', token: '', login: true } : { origin: config.WEB_ORIGIN, token: 'LOGGED' }));
    pages.push(page);
    return page;
  };
  const phases = [];
  const result = await createLcwAiBrowserSession({ connector, pollMs: 100, ...clock() }).login('u1', { onPhase: phase => phases.push(phase), isUsable: token => token === 'LOGGED' });
  assert.equal(result.token, 'LOGGED');
  assert.equal(connector.calls.ensure, 1);
  assert.deepEqual(connector.calls.opened, [`${config.WEB_ORIGIN}/`]);
  assert.ok(pages[0].client.sent.includes('Page.bringToFront'));
  assert.ok(phases.includes('login-required') && phases.at(-1) === 'connected');
});

test('etkileşimli giriş zaman aşımı LOGIN_TIMEOUT', async () => {
  const page = fakePage('https://lcwai.lcwaikiki.com/', { origin: config.WEB_ORIGIN, token: '' });
  await assert.rejects(createLcwAiBrowserSession({ connector: fakeConnector([page]), pollMs: 1000, ...clock() }).login('u1', { timeoutMs: 5000 }), error => error.code === 'LCWAI_LOGIN_TIMEOUT');
});

test('mimari: LCW AI ikinci bir tarayıcı sistemi kurmaz; mevcut connector/browser-debug yolunu kullanır', () => {
  const dir = path.join(__dirname, '..', 'server', 'lib', 'lcwai');
  const source = fs.readdirSync(dir).map(name => fs.readFileSync(path.join(dir, name), 'utf8')).join('\n');
  assert.doesNotMatch(source, /child_process|spawn\(|msedge|--remote-debugging|connectOverCDP|new WebSocket/);
  assert.match(fs.readFileSync(path.join(dir, 'lcwai-browser-session.js'), 'utf8'), /require\('\.\.\/agent-browser-connector'\)/);
  assert.doesNotMatch(source, /writeFile|appendFile|localStorage\.setItem|refresh_token['"]?\s*[:=]/, 'token diske/depoya yazılmaz');
  assert.doesNotMatch(source, /console\.(log|info|warn|error)\([^)]*(token|authorization)/i);
  const connector = require('../server/lib/agent-browser-connector');
  for (const name of ['ensureContext', 'ensureExistingContext', 'coreNectumProfileBinding', 'pageIsInBoundProfile', 'pageInBoundProfile', 'reusableBlankPageInBoundProfile']) assert.equal(typeof connector[name], 'function', name);
});

test('routes: status/ask yanıtları token taşımaz; ask NDJSON progress/result akışıdır; hata kodlu', async () => {
  const express = require('express');
  const app = express();
  app.use((req, res, next) => { req.currentUser = { id: 'u1' }; next(); });
  const SECRET = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const engine = {
    async getStatus() { return { state: 'connected', connected: true, model: 'gpt-6-sol', activeRequests: 0 }; },
    async ask(owner, input) {
      input.onProgress({ phase: 'streaming', delta: '{"formula"', chars: 10 });
      if (input.task === 'fail') { const { lcwAiError } = require('../server/lib/lcwai/lcwai-errors'); throw lcwAiError('SESSION_EXPIRED', { detail: `Bearer ${SECRET}` }); }
      return { requestId: 'r', text: '{}', data: { formula: '[A]' }, structured: { ok: true, expected: true, errors: [] }, model: { key: 'gpt-6-sol', label: 'GPT-6 Sol' } };
    },
    cancel() { return true; }, login: async () => ({}), disconnect: async () => ({}), uploadFile: async () => ({}),
  };
  const audits = [];
  require('../server/routes/lcwai-routes')(app, { express, userAccess: { appendAudit: (...args) => audits.push(args) }, engine });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(`${base}/api/lcwai/status`)).json();
    assert.equal(status.status.state, 'connected');
    const ask = async task => (await (await fetch(`${base}/api/lcwai/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'calculated-column', task }) })).text()).trim().split('\n').map(line => JSON.parse(line));
    const ok = await ask('Margin %');
    assert.deepEqual(ok.map(event => event.type), ['progress', 'result']);
    assert.equal(ok[1].result.data.formula, '[A]');
    const failed = await ask('fail');
    assert.equal(failed.at(-1).type, 'error');
    assert.equal(failed.at(-1).error.code, 'LCWAI_SESSION_EXPIRED');
    assert.equal(failed.at(-1).error.action, 'login');
    assert.ok(!JSON.stringify(failed).includes(SECRET));
    assert.ok(audits.every(([, action, target, details]) => /^LCWAI_/.test(action) && target === 'lcwai' && !JSON.stringify(details).includes('Margin')), 'audit istek metnini yazmaz');
  } finally { server.close(); }
});
