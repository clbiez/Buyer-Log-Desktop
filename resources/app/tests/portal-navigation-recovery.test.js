'use strict';

/* Saha: bir bilgisayarda PLM (CoreNectum), OAB (PASS) ve LCW AI giriş
 * ekranlarının üçü de "ERR_FAILED (-2) loading …" ile açılmıyordu. Ortak
 * kurtarma merdiveni: hafif sıfırlama → teşhis (bölüm/ağ) → bölüm bozuksa tam
 * sıfırlama, ağ ise kanıtlı hata. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recovery = require('../electron/portal-navigation-recovery');

const URL_ = 'https://corenectum.lcwaikiki.com/models-options/style-list';
const ERR = Object.assign(new Error(`ERR_FAILED (-2) loading '${URL_}'`), { errno: -2, code: 'ERR_FAILED' });

function fakeSession({ reachable = true, status = 302, proxy = 'DIRECT' } = {}) {
  const calls = [];
  return {
    calls,
    async fetch(url, init) {
      calls.push(['fetch', url, init && init.redirect]);
      if (!reachable) throw new Error('net::ERR_FAILED');
      return { status, body: { cancel: async () => calls.push(['cancel']) } };
    },
    async resolveProxy() { return proxy; },
    async clearStorageData(options) { calls.push(['clearStorageData', options ? options.storages.join(',') : 'ALL']); },
    async clearCache() { calls.push(['clearCache']); },
    async clearAuthCache() { calls.push(['clearAuthCache']); },
    async clearHostResolverCache() { calls.push(['clearHostResolverCache']); },
    async closeAllConnections() { calls.push(['closeAllConnections']); },
  };
}

test('SSO ERR_ABORTED hata sayılmaz, hiçbir şey sıfırlanmaz', async () => {
  const portal = fakeSession();
  const step = await recovery.nextPortalRecoveryStep({ error: { code: 'ERR_ABORTED' }, attempt: 0, portalSession: portal, baselineSession: fakeSession(), url: URL_ });
  assert.equal(step.action, 'ignore');
  assert.deepEqual(portal.calls, []);
});

test('ilk hata: SSO çerezleri korunarak SW/önbellek/DNS/bağlantılar sıfırlanır ve yeniden denenir', async () => {
  const portal = fakeSession();
  const step = await recovery.nextPortalRecoveryStep({ error: ERR, attempt: 0, portalSession: portal, baselineSession: fakeSession(), url: URL_ });
  assert.equal(step.action, 'retry');
  const names = portal.calls.map(call => call.join(':'));
  assert.ok(names.includes('clearStorageData:serviceworkers,cachestorage'));
  assert.ok(names.includes('clearHostResolverCache') && names.includes('closeAllConnections'));
  assert.ok(!names.some(name => /ALL|cookies|localstorage|clearAuthCache/.test(name)), 'hafif sıfırlama oturumu silmemeli');
});

test('bölüm ulaşamıyor ama varsayılan oturum ulaşıyor → bölüm tamamen sıfırlanıp yeniden denenir', async () => {
  const portal = fakeSession({ reachable: false });
  const logs = [];
  const step = await recovery.nextPortalRecoveryStep({ error: ERR, attempt: 1, portalSession: portal, baselineSession: fakeSession(), url: URL_, label: 'CoreNectum', log: line => logs.push(line) });
  assert.equal(step.action, 'retry');
  assert.equal(step.diagnosis.verdict, 'partition');
  assert.ok(portal.calls.some(call => call[0] === 'clearStorageData' && call[1] === 'ALL'));
  assert.ok(logs.some(line => /verdict=partition · portal=ERR_FAILED \(-2\) · default=HTTP 302 · proxy=DIRECT/.test(line)), logs.join('\n'));
});

test('hiçbir oturum ulaşamıyor → ağ teşhisiyle durur, bölüm verisi silinmez', async () => {
  const portal = fakeSession({ reachable: false, proxy: 'PROXY proxy.example:8080' });
  const step = await recovery.nextPortalRecoveryStep({ error: ERR, attempt: 1, portalSession: portal, baselineSession: fakeSession({ reachable: false }), url: URL_ });
  assert.equal(step.action, 'fail');
  assert.equal(step.diagnosis.verdict, 'network');
  assert.match(step.detail, /^ERR_FAILED \(-2\) · verdict=network .*proxy=PROXY proxy\.example:8080$/);
  assert.ok(!portal.calls.some(call => call[0] === 'clearStorageData'));
});

test('bölüm şimdi ulaşıyorsa geçici sayılır ve yeniden denenir; üçüncü hata kesin başarısızlıktır', async () => {
  const step = await recovery.nextPortalRecoveryStep({ error: ERR, attempt: 1, portalSession: fakeSession(), baselineSession: fakeSession(), url: URL_ });
  assert.equal(step.action, 'retry');
  assert.equal(step.diagnosis.verdict, 'transient');
  const last = await recovery.nextPortalRecoveryStep({ error: ERR, attempt: 2, portalSession: fakeSession(), baselineSession: fakeSession(), url: URL_ });
  assert.equal(last.action, 'fail');
});

test('Electron net.fetch manual yönlendirme reddi sunucuya ulaşıldı sayılır', async () => {
  const redirecting = { fetch: async () => { throw new Error('Redirect was cancelled'); } };
  assert.deepEqual(await recovery.probeSession(redirecting, URL_, 1000), { ok: true, status: 'redirect' });
  const failing = { fetch: async () => { throw new Error('net::ERR_FAILED'); } };
  assert.deepEqual(await recovery.probeSession(failing, URL_, 1000), { ok: false, errno: -2, error: 'ERR_FAILED' });
});

test('yoklama zaman aşımı ağ hatası sayılır ve askıda kalmaz', async () => {
  const hanging = { fetch: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) };
  const probe = await recovery.probeSession(hanging, URL_, 20);
  assert.deepEqual(probe, { ok: false, error: 'TIMEOUT' });
});

test('üç portal (CoreNectum, LCW AI, OAB) aynı kurtarma merdivenini kullanır', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  for (const label of ['CoreNectum', 'LCW AI', 'OAB']) {
    assert.match(main, new RegExp(`nextPortalRecoveryStep\\(\\{[\\s\\S]{0,120}label: ?'${label}'`), label);
  }
  assert.doesNotMatch(main, /win\.loadURL\(LCWAI_HOME\)\.catch\(/, 'LCW AI SSO ERR_ABORTED ile düşmemeli');
  const oabFail = main.slice(main.indexOf("authWindow.webContents.on('did-fail-load'"), main.indexOf("authWindow.webContents.on('render-process-gone'"));
  assert.match(oabFail, /if \(navigationBusy\) return;/, 'loadURL sürerken did-fail-load akışı bitirmemeli');
});

test('sessiz (arka plan) denemede bozuk bölüm teşhisi SSO çerezlerini silmez; durur', async () => {
  const portal = fakeSession({ reachable: false });
  const step = await recovery.nextPortalRecoveryStep({ error: ERR, attempt: 1, portalSession: portal, baselineSession: fakeSession(), url: URL_, allowFullReset: false });
  assert.equal(step.action, 'fail');
  assert.equal(step.diagnosis.verdict, 'partition');
  assert.ok(!portal.calls.some(call => call[0] === 'clearStorageData' || call[0] === 'clearAuthCache'), 'arka plan denemesi oturum bölümünü silmemeli');
});

test('CoreNectum ve LCW AI sessiz girişleri tam sıfırlamayı yalnız etkileşimli modda açar', () => {
  const main = fs.readFileSync(path.join(__dirname, '../electron/main.js'), 'utf8');
  for (const label of ['CoreNectum', 'LCW AI']) {
    const call = main.match(new RegExp("nextPortalRecoveryStep\\(\\{[^}]*label: '" + label + "'[^}]*\\}"));
    assert.ok(call, label + ' kurtarma çağrısı bulunmalı');
    assert.match(call[0], /allowFullReset: interactive/);
  }
});
