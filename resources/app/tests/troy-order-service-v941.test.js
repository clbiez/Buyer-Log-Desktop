'use strict';

/* v9.41 — TROY SİPARİŞ KAPATMA SERVİSİ: adım sırası, OptionRef toplama,
 * boş listede Close çağrılmaması, 401'de TAM OLARAK BİR sessiz yeniden
 * deneme, iş kilidinin sipariş bazlı (global DEĞİL) olması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function connectorError(message, code, statusCode, details) { return Object.assign(new Error(message), { code, statusCode, details }); }
function safeOwner(value) { return String(value == null ? '' : value).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'default'; }

const sessionPath = require.resolve('../server/lib/troy-session-service');
let authResults; // sıradaki getFreshAuthorization çağrılarının sırayla döneceği sonuçlar
let requestHandler; // (url, method, body) => {ok,status,statusText,json}
const authCalls = [];
require.cache[sessionPath] = {
  id: sessionPath, filename: sessionPath, loaded: true, exports: {
    getFreshAuthorization: async ownerId => { authCalls.push(ownerId); return authResults.length > 1 ? authResults.shift() : authResults[0]; },
    // Gerçek troyRequest, status 401/403'ü TROY_UNAUTHORIZED fırlatarak ele
    // alır (bkz. troy-session-service.js); sahte sürüm bu sözleşmeyi birebir
    // korur ki troy-order-service'in retry mantığı gerçek koşulda test edilsin.
    troyRequest: async (ownerId, headers, url, method, body) => {
      const resolved = await requestHandler(url, method, body);
      if (resolved.status === 401 || resolved.status === 403) throw connectorError('Troy oturumu sona ermiş görünüyor.', 'TROY_UNAUTHORIZED', 401);
      return resolved;
    },
    connectorError, safeOwner,
  },
};
const troyOrderService = require('../server/lib/troy-order-service');

const OK_AUTH = { ok: true, headers: { Authorization: 'Bearer test' } };

test.beforeEach(() => { authResults = [OK_AUTH]; authCalls.length = 0; });

function stepRouter(steps) {
  return (url, method, body) => {
    if (url.endsWith('/IsRevisedLimited')) return steps.isRevisedLimited || { ok: true, status: 200, statusText: 'OK', json: {} };
    if (url.endsWith('/ColorInfromationsByOrderCode')) return steps.colorInfo;
    if (url.endsWith('/CloseOrCancel')) return steps.closeOrCancel || { ok: true, status: 200, statusText: 'OK', json: { closed: true } };
    throw new Error(`beklenmeyen URL: ${url}`);
  };
}

test('v9.40 IsRevisedLimited 401-dışı bir HTTP hatası verirse direkt hata olarak yansır (retry yok)', async () => {
  requestHandler = stepRouter({ isRevisedLimited: { ok: false, status: 500, statusText: 'Server Error' } });
  await assert.rejects(() => troyOrderService.closeOrder('u1', '9001'), err => err.code === 'TROY_HTTP_ERROR');
  assert.equal(authCalls.length, 1, 'başarısız yeniden deneme tetiklenmemeli (yalnız 401 tetikler)');
});

test('v9.40 ColorInfromationsByOrderCode karışık UrunOptionRef/ProductOptionRef anahtarlarını iç içeden toplar ve tekilleştirir', async () => {
  requestHandler = stepRouter({
    colorInfo: {
      ok: true, status: 200, statusText: 'OK',
      json: [
        { UrunOptionRef: 'A1', nested: { ProductOptionRef: 'A2' } },
        { productoptionref: 'A1' }, // aynı değer, farklı harf — tekilleşmeli
        { list: [{ UrunOptionRef: 'A3' }, { UrunOptionRef: '' }] },
      ],
    },
  });
  const result = await troyOrderService.closeOrder('u1', '9002');
  assert.equal(result.ok, true);
  assert.equal(result.optionRefCount, 3, 'A1, A2, A3 — tekilleştirilmiş 3 ref');
});

test('v9.40 OptionRef listesi boşsa CloseOrCancel çağrılmaz', async () => {
  let closeCalled = false;
  requestHandler = (url, method, body) => {
    if (url.endsWith('/IsRevisedLimited')) return { ok: true, status: 200, statusText: 'OK', json: {} };
    if (url.endsWith('/ColorInfromationsByOrderCode')) return { ok: true, status: 200, statusText: 'OK', json: [] };
    if (url.endsWith('/CloseOrCancel')) { closeCalled = true; return { ok: true, status: 200, statusText: 'OK', json: {} }; }
    throw new Error('beklenmeyen URL');
  };
  const result = await troyOrderService.closeOrder('u1', '9003');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'TROY_NO_OPTION_REFS');
  assert.equal(closeCalled, false, 'boş liste ile CloseOrCancel asla çağrılmamalı');
});

test('v9.40 CloseOrCancel body\'si ColorInfromationsByOrderCode\'un JSON string gövdesiyle doğru sıralanır', async () => {
  const calls = [];
  requestHandler = (url, method, body) => {
    calls.push({ url, method, body });
    if (url.endsWith('/IsRevisedLimited')) return { ok: true, status: 200, statusText: 'OK', json: {} };
    if (url.endsWith('/ColorInfromationsByOrderCode')) return { ok: true, status: 200, statusText: 'OK', json: [{ UrunOptionRef: 'REF1' }] };
    if (url.endsWith('/CloseOrCancel')) return { ok: true, status: 200, statusText: 'OK', json: {} };
    throw new Error('beklenmeyen URL');
  };
  const result = await troyOrderService.closeOrder('u1', '9004');
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0].body, { OrderCode: '9004' });
  assert.equal(calls[1].body, '9004', 'ColorInfromationsByOrderCode gövdesi JSON string olmalı, nesne değil');
  assert.deepEqual(calls[2].body, { ProductOptionRefList: ['REF1'], OrderCode: '9004', SellingRegion: 2 });
});

test('v9.40 401\'de TAM OLARAK BİR sessiz yeniden deneme yapılır, sonra başarılı olur', async () => {
  let attempt = 0;
  requestHandler = (url) => {
    if (url.endsWith('/IsRevisedLimited')) {
      attempt += 1;
      if (attempt === 1) return { ok: false, status: 401, statusText: 'Unauthorized' };
      return { ok: true, status: 200, statusText: 'OK', json: {} };
    }
    if (url.endsWith('/ColorInfromationsByOrderCode')) return { ok: true, status: 200, statusText: 'OK', json: [{ UrunOptionRef: 'R' }] };
    if (url.endsWith('/CloseOrCancel')) return { ok: true, status: 200, statusText: 'OK', json: {} };
    throw new Error('beklenmeyen URL');
  };
  const result = await troyOrderService.closeOrder('u1', '9005');
  assert.equal(result.ok, true);
  assert.equal(authCalls.length, 2, 'tam olarak bir yeniden yakalama olmalı');
});

test('v9.40 ikinci 401 de gelirse TROY_LOGIN_REQUIRED olarak yansır', async () => {
  requestHandler = () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
  await assert.rejects(() => troyOrderService.closeOrder('u1', '9006'), err => err.code === 'TROY_LOGIN_REQUIRED');
  assert.equal(authCalls.length, 2);
});

test('v9.40 aynı sipariş için eşzamanlı ikinci çağrı reddedilir; farklı sipariş etkilenmez', async () => {
  let resolveFirst;
  requestHandler = (url) => {
    if (url.endsWith('/IsRevisedLimited')) return new Promise(resolve => { resolveFirst = () => resolve({ ok: true, status: 200, statusText: 'OK', json: {} }); });
    if (url.endsWith('/ColorInfromationsByOrderCode')) return { ok: true, status: 200, statusText: 'OK', json: [{ UrunOptionRef: 'R' }] };
    if (url.endsWith('/CloseOrCancel')) return { ok: true, status: 200, statusText: 'OK', json: {} };
    throw new Error('beklenmeyen URL');
  };
  const firstPromise = troyOrderService.closeOrder('u1', '9007');
  await new Promise(r => setTimeout(r, 20)); // ilk çağrının kilit almasını garanti et
  await assert.rejects(() => troyOrderService.closeOrder('u1', '9007'), err => err.code === 'TROY_OPERATION_IN_PROGRESS');

  // Farklı sipariş: kendi ayrı IsRevisedLimited'ı hemen çözülsün.
  const otherRequestHandler = requestHandler;
  requestHandler = (url) => (url.endsWith('/IsRevisedLimited') ? { ok: true, status: 200, statusText: 'OK', json: {} } : otherRequestHandler(url));
  const otherResult = await troyOrderService.closeOrder('u1', '9999-different');
  assert.equal(otherResult.ok, true, 'farklı sipariş kilitten etkilenmemeli');

  resolveFirst();
  const first = await firstPromise;
  assert.equal(first.ok, true);
});

test('v9.40 sipariş kodu boşsa net bir doğrulama hatası verir', async () => {
  await assert.rejects(() => troyOrderService.closeOrder('u1', ''), err => err.code === 'TROY_INVALID_ORDER_CODE');
});

test('v9.40 kaynak: sipariş kapatma isteği için bir zaman aşımı sınırı tanımlı', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'troy-order-service.js'), 'utf8');
  assert.match(source, /TROY_TIMEOUT/);
  assert.match(source, /CLOSE_TIMEOUT_MS/);
});
