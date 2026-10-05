'use strict';

/*
 * LCW AI arka plan oturumu (PLM Sync deseni): Electron gizli, kalıcı bölüm →
 * masaüstü köprüsü → sunucu belleği. Kullanıcı tarayıcı görmez; pencere
 * yalnız giriş gerektiğinde görünür. Token renderer'a/IPC yanıtına girmez.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../server/lib/lcwai/lcwai-config');
const { createDesktopTokenHolder, createDesktopAwareProvider } = require('../server/lib/lcwai/lcwai-desktop-session');
const { createLcwAiAuth } = require('../server/lib/lcwai/lcwai-auth');

const ROOT = path.join(__dirname, '..');
function makeToken(claims = {}) {
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = { iss: config.KEYCLOAK.issuer, azp: config.KEYCLOAK.clientId, typ: 'Bearer', exp: Math.floor(Date.now() / 1000) + 300, sub: 'user-1', ...claims };
  return `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(payload)}.${Buffer.from('signature-' + Math.random()).toString('base64url')}`;
}

test('masaüstü token tutucu: yalnız geçerli LCW AI token’ı kabul eder, bellekte tutar', () => {
  const holder = createDesktopTokenHolder();
  assert.equal(holder.desktopMode, false);
  assert.throws(() => holder.set('çöp'), error => error.code === 'LCWAI_AUTH_REQUIRED');
  assert.throws(() => holder.set(makeToken({ iss: 'https://evil/realms/x' })), error => error.code === 'LCWAI_AUTH_REQUIRED');
  assert.throws(() => holder.set(makeToken({ exp: Math.floor(Date.now() / 1000) - 600 })), error => error.code === 'LCWAI_SESSION_EXPIRED');
  const token = makeToken();
  const result = holder.set(`Bearer ${token}`);
  assert.equal(result.ok, true);
  assert.ok(!JSON.stringify(result).includes(token), 'yanıt token içermez');
  assert.equal(holder.get(), token);
  assert.equal(holder.desktopMode, true);
  holder.clear();
  assert.equal(holder.get(), '');
});

test('sağlayıcı: masaüstü token’ı önce gelir; masaüstü kipinde reddedilen token için görünür Edge sekmesine düşmez', async () => {
  const holder = createDesktopTokenHolder();
  const calls = [];
  const fallbackToken = makeToken({ sub: 'edge' });
  const fallback = { async readToken() { calls.push('edge-read'); return { token: fallbackToken, source: 'edge' }; }, async login() { calls.push('edge-login'); return { token: fallbackToken }; } };
  const provider = createDesktopAwareProvider({ holder, fallback });
  // Masaüstü yokken eski yol aynen çalışır (tarayıcı kipi / eski kabuk).
  assert.equal((await provider.readToken('u1', {})).source, 'edge');
  const token = makeToken();
  holder.set(token);
  assert.equal(provider.passiveAvailable(), true);
  const auth = createLcwAiAuth({ provider });
  assert.equal(await auth.getAuthorization('u1'), `Bearer ${token}`);
  assert.equal(auth.status('u1').source, 'desktop-sso');
  // 401 → reddedilen token; masaüstü kipinde Edge'e düşmez, oturum yenilemesi ister.
  const rejected = auth.invalidate('u1', `Bearer ${token}`);
  await assert.rejects(auth.getAuthorization('u1', { forceRefresh: true, rejectedFingerprint: rejected }), error => error.code === 'LCWAI_SESSION_EXPIRED');
  assert.deepEqual(calls, ['edge-read']);
  assert.equal((await provider.login('u1', {})).source, 'desktop-sso');
});

test('durum: masaüstü token’ı geldiyse ilk durum sorgusu sessizce "bağlı" olur', async () => {
  const holder = createDesktopTokenHolder();
  const auth = createLcwAiAuth({ provider: createDesktopAwareProvider({ holder, fallback: null }) });
  assert.equal((await auth.refreshStatus('u1')).connected, false);
  holder.set(makeToken());
  const status = await auth.refreshStatus('u1');
  assert.equal(status.connected, true);
  assert.equal(status.state, 'connected');
});

test('Electron: gizli (show:false), kalıcı ayrılmış bölüm; yalnız giriş gerekince görünür; IPC token döndürmez', () => {
  const main = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  assert.match(main, /const LCWAI_AUTH_PARTITION = 'persist:buyerlog-lcwai-auth';/);
  const block = main.slice(main.indexOf('async function acquireLcwAiToken'), main.indexOf('async function clearLcwAiAuthSession'));
  assert.match(block, /show: false/);
  assert.match(block, /partition: LCWAI_AUTH_PARTITION, nodeIntegration: false, contextIsolation: true, sandbox: true/);
  assert.match(block, /if \(!interactive \|\| settled \|\| win\.isVisible\(\)\) return;/, 'sessiz kipte pencere hiç görünmez');
  assert.match(block, /interactive \? 300000 : 12000/);
  assert.match(block, /resolve\(value\)/);
  assert.doesNotMatch(block, /finish\(\{[^}]*token/, 'sonuç token taşımaz');
  assert.doesNotMatch(block, /log\([^)]*token\)/i);
  assert.match(main, /'X-BuyerLog-Desktop-Bridge': desktopBridgeSecret/);
  const handlers = main.slice(main.indexOf("ipcMain.handle('buyerlog:lcwai-auth'"), main.indexOf("ipcMain.handle('buyerlog:lcwai-auth-clear'"));
  assert.match(handlers, /trustedBuyerLogIpcSender\(event\)/);
  const preload = fs.readFileSync(path.join(ROOT, 'electron', 'preload.js'), 'utf8');
  assert.match(preload, /ensureLcwAiAuth: \(options\) => ipcRenderer\.invoke\('buyerlog:lcwai-auth'/);
  assert.match(preload, /clearLcwAiAuth: \(\) => ipcRenderer\.invoke\('buyerlog:lcwai-auth-clear'\)/);
  const server = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/internal/desktop/lcwai-token'"), server.indexOf("app.post('/api/internal/desktop/corenectum-style-template'"));
  assert.match(route, /if \(!desktopBridgeAuthorized\(req\)\) return res\.status\(403\)/);
  assert.equal((route.match(/desktopBridgeAuthorized\(req\)/g) || []).length, 2, 'POST ve DELETE köprü sırrı ister');
});

test('istemci: bağlantı önce sessiz arka plan girişi; oturum hatasında bir kez sessiz yenileyip yeniden dener', () => {
  const source = fs.readFileSync(path.join(ROOT, 'public', 'lcwai-assistant.js'), 'utf8');
  assert.match(source, /desktop\.ensureLcwAiAuth\(\{ interactive: false \}\)/);
  assert.match(source, /await desktop\.ensureLcwAiAuth\(\{ interactive: true \}\)/);
  assert.match(source, /if \(!needsLogin\(error\) \|\| !\(await silentDesktopAuth\(\{ force: true \}\)\)\) throw error;\s*return run\(\);/);
  assert.match(source, /ask: askAuthed/);
  assert.match(source, /chat: chatAuthed/);
  assert.match(source, /desktop\.clearLcwAiAuth\(\)/);
});
