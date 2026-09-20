'use strict';

/* v9.45 — TROY "REVİZE ET" SERVİSİ
 *
 * Kullanıcı talebi (birebir): Order Code sağ tık → Revize Et, kullanıcı Troy'da
 * manuel filtre/menü işlemi yapmadan doğru siparişin GERÇEK Troy revize
 * ekranına ulaşsın; ekran açılınca otomasyon KESİN olarak dursun (form
 * doldurmaz, Sonraki Adım/Save'e basmaz).
 *
 * Bu dosya troy-order-service.js'in openRevision/openTroyLogin'ini, sahte bir
 * agent-browser-connector + troy-session-service context/page enjekte ederek
 * test eder (aynı desen: tests/troy-order-service-v941.test.js /
 * tests/troy-session-service-v940.test.js). Gerçek Edge/CDP'ye dokunmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function connectorError(message, code, statusCode, details) { return Object.assign(new Error(message), { code, statusCode, details }); }
function safeOwner(value) { return String(value == null ? '' : value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default'; }

function fakePage({ url = 'https://troy.lcwaikiki.com/order-management/orders', evaluateResult, evaluateError } = {}) {
  const page = {
    _url: url,
    _closed: false,
    isClosed() { return page._closed; },
    url() { return page._url; },
    async goto(target) { page._url = target; },
    evaluateCalls: [],
    async _evaluateValue(expression) {
      page.evaluateCalls.push(expression);
      if (evaluateError) throw evaluateError;
      return typeof evaluateResult === 'function' ? evaluateResult(expression) : evaluateResult;
    },
  };
  return page;
}
function fakeContext(initialPages = []) {
  return { _pages: initialPages, pages() { return this._pages.filter(p => !p.isClosed()); }, async syncPages() {} };
}

const sessionPath = require.resolve('../server/lib/troy-session-service');
const contextsByOwner = new Map();
let forceLoginRequired = false;
require.cache[sessionPath] = {
  id: sessionPath, filename: sessionPath, loaded: true, exports: {
    ensureContext: async ownerId => ({ context: contextsByOwner.get(String(ownerId)) }),
    pageForCurrentBuyerLogProfile: async (context, initialUrl) => {
      const page = fakePage({ url: initialUrl });
      context._pages.push(page);
      return page;
    },
    troyPageLooksLikeLogin: async () => forceLoginRequired,
    connectorError, safeOwner,
    // openRevision bu ikisini kullanmıyor ama troy-order-service require
    // aşamasında destructure ediyor; eksik olursa undefined'a düşer, sorun
    // değil (bu testte hiç çağrılmıyorlar).
    getFreshAuthorization: async () => { throw new Error('bu testte çağrılmamalı'); },
    troyRequest: async () => { throw new Error('bu testte çağrılmamalı'); },
  },
};
const troyOrderService = require('../server/lib/troy-order-service');

test.beforeEach(() => { forceLoginRequired = false; });

test('v9.45 Troy sekmesi login sayfasıysa otomasyon HİÇ çalıştırılmadan TROY_LOGIN_REQUIRED döner', async () => {
  forceLoginRequired = true;
  const context = fakeContext([]);
  contextsByOwner.set('u-login', context);
  await assert.rejects(troyOrderService.openRevision('u-login', '7001'), err => err.code === 'TROY_LOGIN_REQUIRED');
  const page = context.pages()[0];
  assert.equal(page.evaluateCalls.length, 0, 'login sayfasında DOM otomasyonu hiç çalıştırılmamalı');
});

test('v9.45 başarılı akış: revize ekranı açılınca {ok:true,state:REVISION_SCREEN_OPEN} döner', async () => {
  const page = fakePage({ evaluateResult: { ok: true, state: 'REVISION_SCREEN_OPEN' } });
  const context = fakeContext([page]);
  contextsByOwner.set('u-ok', context);
  const result = await troyOrderService.openRevision('u-ok', '7002');
  assert.equal(result.ok, true);
  assert.equal(result.state, 'REVISION_SCREEN_OPEN');
  assert.equal(page.evaluateCalls.length, 1);
  assert.match(page.evaluateCalls[0], /"7002"/, 'order code otomasyon ifadesine gömülmeli');
});

test('v9.45 otomasyon script\'i içeriden login algılarsa TROY_LOGIN_REQUIRED olarak yansır', async () => {
  const page = fakePage({ evaluateResult: { ok: false, code: 'TROY_LOGIN_REQUIRED', message: 'TIMEOUT' } });
  const context = fakeContext([page]);
  contextsByOwner.set('u-mid-login', context);
  await assert.rejects(troyOrderService.openRevision('u-mid-login', '7003'), err => err.code === 'TROY_LOGIN_REQUIRED');
});

test('v9.45 satır/aksiyon bulunamazsa TROY_REVISION_AUTOMATION_FAILED, mesaj korunur', async () => {
  const page = fakePage({ evaluateResult: { ok: false, code: 'TROY_REVISION_AUTOMATION_FAILED', message: 'TIMEOUT' } });
  const context = fakeContext([page]);
  contextsByOwner.set('u-fail', context);
  await assert.rejects(troyOrderService.openRevision('u-fail', '7004'),
    err => err.code === 'TROY_REVISION_AUTOMATION_FAILED' && /TIMEOUT/.test(err.message));
});

test('v9.45 aynı sipariş için eşzamanlı ikinci çağrı reddedilir; farklı sipariş etkilenmez', async () => {
  let resolveEval;
  const slowPage = fakePage({ evaluateResult: () => new Promise(resolve => { resolveEval = resolve; }) });
  const context = fakeContext([slowPage]);
  contextsByOwner.set('u-lock', context);

  const firstPromise = troyOrderService.openRevision('u-lock', '7005');
  await new Promise(r => setTimeout(r, 20));
  await assert.rejects(troyOrderService.openRevision('u-lock', '7005'), err => err.code === 'TROY_OPERATION_IN_PROGRESS');

  const otherPage = fakePage({ evaluateResult: { ok: true, state: 'REVISION_SCREEN_OPEN' } });
  const otherContext = fakeContext([otherPage]);
  contextsByOwner.set('u-lock-other', otherContext);
  const other = await troyOrderService.openRevision('u-lock-other', '9999-different');
  assert.equal(other.ok, true, 'farklı sipariş/owner kilitten etkilenmemeli');

  resolveEval({ ok: true, state: 'REVISION_SCREEN_OPEN' });
  const first = await firstPromise;
  assert.equal(first.ok, true);
});

test('v9.45 sipariş kodu boşsa net bir doğrulama hatası verir', async () => {
  await assert.rejects(() => troyOrderService.openRevision('u1', ''), err => err.code === 'TROY_INVALID_ORDER_CODE');
});

test('v9.45 openTroyLogin: sekmeyi hazırlar ama HİÇBİR DOM otomasyonu çalıştırmaz', async () => {
  const page = fakePage();
  const context = fakeContext([page]);
  contextsByOwner.set('u-open-login', context);
  const result = await troyOrderService.openTroyLogin('u-open-login');
  assert.equal(result.ok, true);
  assert.equal(page.evaluateCalls.length, 0);
});

test('v9.45 kaynak: doğrulanmış selector\'lar birebir kullanılıyor, form alanlarına ASLA yazılmıyor/next-step\'e tıklanmıyor', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'troy-order-service.js'), 'utf8');
  for (const needle of [
    'button.toggle', 'i.icon.toggle', '.lcw-action-menu-w.opened', '.buttons-w button', 'i.fas.fa-clipboard-list',
    'mat-select[aria-label="Revize Tipi"]', 'mat-select[aria-label="Revize Nedeni"]',
    'textarea[formcontrolname="Description"]', 'button.next-step',
    'input[formcontrolname="orderCode"], input[placeholder="Order Code"]',
  ]) {
    assert.ok(source.includes(needle), `doğrulanmış selector eksik: ${needle}`);
  }
  // Revize ekranı elemanlarının SADECE varlığı kontrol ediliyor — hiçbirine
  // değer atanmıyor, next-step'e tıklanmıyor. "next-step" yalnız querySelector
  // içinde geçmeli, .click() ile birlikte HİÇ geçmemeli.
  assert.doesNotMatch(source, /next-step['"]\)\.click\(\)/, 'next-step tıklanmamalı');
  assert.doesNotMatch(source, /aria-label="Revize (Tipi|Nedeni)"\][^\n]*\.value\s*=/, 'revize form alanına değer atanmamalı');
});
