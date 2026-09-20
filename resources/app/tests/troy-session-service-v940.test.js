'use strict';

/* v9.40 — TROY OTURUM SERVİSİ: sessiz JWT yakalama, login tespiti, cache
 * OLMADIĞININ kanıtı.
 *
 * agent-browser-connector.js gerçek Edge'e CDP ile bağlanıyor; burada onun
 * yerine sahte bir context/page enjekte edilir (aynı desen tests/oab-retry-
 * v723.test.js'te de kullanılıyor: require.cache'e troy-session-service'in
 * ilk require'ından ÖNCE bir sahte agent-browser-connector exports'u koy).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

function fakePage({ url = 'about:blank', isLoginPage = false } = {}) {
  const page = {
    _url: url,
    _closed: false,
    _listeners: {},
    client: {
      on(event, cb) { (page._listeners[event] = page._listeners[event] || []).push(cb); },
      off(event, cb) { if (page._listeners[event]) page._listeners[event] = page._listeners[event].filter(fn => fn !== cb); },
      async send() {},
    },
    isClosed() { return page._closed; },
    url() { return page._url; },
    async _evaluateValue() { return isLoginPage; }, // şifre alanı sorgusu
    async goto(target) { page._url = target; },
    fireRequest(url, headers) {
      const cbs = page._listeners['Network.requestWillBeSent'] || [];
      for (const cb of cbs) cb({ request: { url, method: 'POST', headers } });
    },
  };
  return page;
}
function fakeContext(initialPages = []) {
  return {
    _pages: initialPages,
    pages() { return this._pages.filter(p => !p.isClosed()); },
    async syncPages() {},
  };
}

const connectorPath = require.resolve('../server/lib/agent-browser-connector');
const contextsByOwner = new Map();
function connectorError(message, code, statusCode, details) { return Object.assign(new Error(message), { code, statusCode, details }); }
require.cache[connectorPath] = {
  id: connectorPath, filename: connectorPath, loaded: true, exports: {
    ensureContext: async ownerId => ({ context: contextsByOwner.get(String(ownerId)) }),
    connectorError,
    safeOwner: value => String(value == null ? '' : value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default',
    // Gerçek zamanlayıcı kullanılır: bir mikro-görev döngüsü (anında çözülen
    // Promise) gerçek setTimeout tabanlı olayları (bu testteki fireRequest
    // tetikleyicisi gibi) aç açlıktan bırakabilir.
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    pageForCurrentBuyerLogProfile: async (context, initialUrl) => {
      const page = fakePage({ url: initialUrl });
      context._pages.push(page);
      return page;
    },
  },
};

const troySession = require('../server/lib/troy-session-service');

test('v9.40 sessiz yakalama: ilk purchaseorder isteğinin Authorization header\'ı yakalanır', async () => {
  const context = fakeContext([]);
  contextsByOwner.set('user-a', context);
  const resultPromise = troySession.getFreshAuthorization('user-a', { timeoutMs: 500 });
  // Sekme açılınca (pageForCurrentBuyerLogProfile) isteği "atmasını" simüle et.
  setTimeout(() => {
    const page = context.pages()[0];
    page.fireRequest('https://purchaseorder.prod.lcwaikiki.com/purchaseorder/bf/service/api/Order/IsRevisedLimited',
      { Authorization: 'Bearer abc123', Cookie: 'should-be-stripped', 'User-Agent': 'should-be-stripped' });
  }, 20);
  const result = await resultPromise;
  assert.equal(result.ok, true);
  assert.equal(result.headers.Authorization, 'Bearer abc123');
  assert.ok(!('Cookie' in result.headers), 'Cookie header taşınmamalı');
  assert.ok(!('User-Agent' in result.headers), 'User-Agent header taşınmamalı');
});

test('v9.40 yakalama zaman aşımına uğrarsa TROY_LOGIN_REQUIRED döner', async () => {
  const context = fakeContext([]);
  contextsByOwner.set('user-b', context);
  const result = await troySession.getFreshAuthorization('user-b', { timeoutMs: 200 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TROY_LOGIN_REQUIRED');
});

test('v9.40 login sayfası tespit edilirse hemen (beklemeden) pes eder', async () => {
  const loginPage = fakePage({ url: 'https://ordermanagement.lcwaikiki.com/login', isLoginPage: true });
  const context = fakeContext([loginPage]);
  contextsByOwner.set('user-c', context);
  const started = Date.now();
  const result = await troySession.getFreshAuthorization('user-c', { timeoutMs: 5000 });
  const elapsed = Date.now() - started;
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TROY_LOGIN_REQUIRED');
  assert.ok(elapsed < 1000, `login tespiti hemen dönmeli, ${elapsed}ms sürdü`);
});

test('v9.40 cache YOK: iki ayrı çağrı kendi taze header\'ını döner, birbirini etkilemez', async () => {
  const contextX = fakeContext([]), contextY = fakeContext([]);
  contextsByOwner.set('user-x', contextX);
  contextsByOwner.set('user-y', contextY);

  const firstPromise = troySession.getFreshAuthorization('user-x', { timeoutMs: 500 });
  setTimeout(() => contextX.pages()[0].fireRequest(
    'https://purchaseorder.prod.lcwaikiki.com/purchaseorder/bf/service/api/Order/IsRevisedLimited', { Authorization: 'Bearer FIRST' },
  ), 20);
  const first = await firstPromise;

  const secondPromise = troySession.getFreshAuthorization('user-y', { timeoutMs: 500 });
  setTimeout(() => contextY.pages()[0].fireRequest(
    'https://purchaseorder.prod.lcwaikiki.com/purchaseorder/bf/service/api/Order/IsRevisedLimited', { Authorization: 'Bearer SECOND' },
  ), 20);
  const second = await secondPromise;

  assert.equal(first.headers.Authorization, 'Bearer FIRST');
  assert.equal(second.headers.Authorization, 'Bearer SECOND');
  // Modül üzerinde bu iki sonucu birbirine karıştıracak hiçbir paylaşılan
  // durum yok — troySession modülünde bir "template"/cache alanı aranır.
  assert.ok(!('passAuthTemplates' in troySession) && !('cache' in troySession) && !('_cache' in troySession));
});
