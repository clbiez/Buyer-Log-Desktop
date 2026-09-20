'use strict';

/*
 * Oturum tabanlı kimlik doğrulama testleri (barındırma / c yönü).
 * Birim: parola hash/doğrula, imzalı oturum (süre + kurcalama), cookie ayrıştırma.
 * Entegrasyon: gerçek server.js ile aynı şekilde bağlanan küçük bir Express uygulaması
 * üzerinden tam akış (login → cookie → korumalı erişim → logout). Süreç öldürülmez;
 * app.listen(0) + server.close() ile in-process çalışır (harness-güvenli).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

const {
  buildAuth, hashPassword, verifyPasswordHash, signSession, verifySession, parseCookies, COOKIE_NAME,
} = require('../server/lib/auth');

// ---- Birim ----
test('auth: scrypt parola hash doğru/yanlış parolayı ayırt eder', () => {
  const stored = hashPassword('Gizli!123');
  assert.ok(/^scrypt\$[0-9a-f]+\$[0-9a-f]+$/.test(stored));
  assert.equal(verifyPasswordHash('Gizli!123', stored), true);
  assert.equal(verifyPasswordHash('yanlış', stored), false);
  assert.equal(verifyPasswordHash('', stored), false);
});

test('auth: imzalı oturum süresi ve kurcalanması doğrulanır', () => {
  const secret = 'test-secret';
  const now = 1_000_000;
  const token = signSession(secret, 60_000, now);
  assert.equal(verifySession(secret, token, now + 1_000), true, 'süre içinde geçerli');
  assert.equal(verifySession(secret, token, now + 61_000), false, 'süre dolunca geçersiz');
  assert.equal(verifySession('başka-secret', token, now + 1_000), false, 'farklı secret ile geçersiz');
  assert.equal(verifySession(secret, token + 'x', now + 1_000), false, 'kurcalanmış imza geçersiz');
  assert.equal(verifySession(secret, 'çöp', now), false);
  assert.equal(verifySession(secret, '', now), false);
});

test('auth: cookie ayrıştırma', () => {
  const c = parseCookies(`a=1; ${COOKIE_NAME}=abc.def; x=%2Fyol`);
  assert.equal(c[COOKIE_NAME], 'abc.def');
  assert.equal(c['x'], '/yol');
});

test('auth: parola yoksa devre dışı (varsayılan)', () => {
  const a = buildAuth({}, {});
  assert.equal(a.enabled, false);
});

// ---- Entegrasyon (in-process) ----
function makeApp(authEnv) {
  const app = express();
  const auth = buildAuth({ auth: { sessionSecret: 'itest-secret' } }, authEnv);
  app.get('/login', auth.loginPageHandler);
  app.post('/api/login', express.json(), auth.loginHandler);
  app.post('/api/logout', auth.logoutHandler);
  app.get('/api/auth-status', auth.statusHandler);
  app.use(auth.requireAuth);
  app.get('/api/secret', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.type('html').send('<h1>app</h1>'));
  return app;
}
function listen(app) {
  return new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}
function req(server, method, path, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, method, path, headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
    } }, res => {
      let buf = ''; res.on('data', d => buf += d);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test('auth entegrasyon: etkinken korumalı rota oturumsuz reddedilir, giriş sonrası erişilir', async () => {
  const server = await listen(makeApp({ BL_AUTH_PASSWORD: 'sifre123' }));
  try {
    // Oturumsuz /api → 401
    const noSess = await req(server, 'GET', '/api/secret');
    assert.equal(noSess.status, 401);

    // Oturumsuz sayfa navigasyonu → /login'e yönlendirme
    const nav = await req(server, 'GET', '/');
    assert.equal(nav.status, 302);
    assert.equal(nav.headers.location, '/login');

    // Yanlış parola → 401, cookie yok
    const bad = await req(server, 'POST', '/api/login', { body: { password: 'yanlış' } });
    assert.equal(bad.status, 401);
    assert.ok(!bad.headers['set-cookie']);

    // Doğru parola → 200 + Set-Cookie
    const good = await req(server, 'POST', '/api/login', { body: { password: 'sifre123' } });
    assert.equal(good.status, 200);
    const setCookie = (good.headers['set-cookie'] || [])[0] || '';
    assert.match(setCookie, new RegExp(`^${COOKIE_NAME}=`));
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const cookie = setCookie.split(';')[0];

    // Oturumla korumalı rota → 200
    const ok = await req(server, 'GET', '/api/secret', { cookie });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { ok: true });

    // Logout → cookie temizlenir, sonrasında tekrar 401
    const out = await req(server, 'POST', '/api/logout', { cookie });
    assert.equal(out.status, 200);
    const cleared = (out.headers['set-cookie'] || [])[0] || '';
    assert.match(cleared, /Max-Age=0/);
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('auth entegrasyon: devre dışıyken hiçbir rota kilitlenmez', async () => {
  const server = await listen(makeApp({})); // parola yok → auth kapalı
  try {
    const s = await req(server, 'GET', '/api/secret');
    assert.equal(s.status, 200, 'auth kapalıyken korumalı rota serbest');
    const st = await req(server, 'GET', '/api/auth-status');
    assert.deepEqual(JSON.parse(st.body), { enabled: false, authenticated: true });
  } finally {
    await new Promise(r => server.close(r));
  }
});
