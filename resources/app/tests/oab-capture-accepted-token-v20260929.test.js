'use strict';

/*
 * OAB — Get OAB'de tarayıcı/PASS sekmesinin defalarca açılıp kapanması.
 *
 * Saha gözlemi: Get OAB'ye basınca PASS sekmesi birkaç kez açılıp kapanıyor,
 * sonunda rapor geliyor. Kök neden: capturePassAuthorization, PASS viewer'ın
 * attığı İLK report-API isteğinin Authorization'ını yanıtına bakmadan
 * yakalıyordu. Viewer açılışta tarayıcıda saklı eski token'la istek atınca
 * Buyer Log o eski token'ı aldı; replay 401 → yeniden yakalama → sekme yeniden
 * açılıyor/yükleniyor; istemci de sınırsız "auth sonrası tekrar dene"
 * yaptığı için döngü, viewer kendi token'ını yenileyene kadar sürdü.
 *
 * Sözleşme:
 *   1) Yalnız PASS'in 2xx ile KABUL ettiği isteğin başlıkları yakalanır;
 *      401/403 alan aday atılır ve aynı sekmede beklemeye devam edilir.
 *   2) oabFetchReport kimlik doğrulama sonrası en fazla BİR KEZ yeniden dener.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-oab-capture-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const connector = require(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'));
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');

const REPORT_URL = 'https://pass.prod.lcwaikiki.com/pass/common/report/api/v2.0/Report/GetReportData';
const STALE = 'Bearer ' + 'stale'.repeat(8);
const FRESH = 'Bearer ' + 'fresh'.repeat(8);
function request(requestId, authorization, method = 'POST', url = REPORT_URL) {
  const headers = { 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  return { requestId, request: { url, method, headers } };
}
function response(requestId, status) { return { requestId, response: { status } }; }

test('PASS capture: 401 alan eski token atılır, 2xx alan istek yakalanır', () => {
  const tracker = connector.createPassAuthCaptureTracker();
  tracker.onRequest(request('1', STALE));
  assert.equal(tracker.captured(), null, 'yanıt gelmeden yakalanmamalı');
  tracker.onResponse(response('1', 401));
  assert.equal(tracker.captured(), null, '401 alan token kabul edilmemeli');
  assert.ok(tracker.rejectedAt() > 0, 'reddedilen aday görünür olmalı');

  tracker.onRequest(request('2', FRESH));
  tracker.onResponse(response('2', 200));
  const captured = tracker.captured();
  assert.ok(captured);
  assert.equal(captured.url, REPORT_URL);
  assert.equal(captured.headers.Authorization, FRESH);
});

test('PASS capture: Authorization taşımayan, preflight ve alakasız istekler aday olmaz', () => {
  const tracker = connector.createPassAuthCaptureTracker();
  tracker.onRequest(request('a', ''));
  tracker.onResponse(response('a', 200));
  tracker.onRequest(request('b', FRESH, 'OPTIONS'));
  tracker.onResponse(response('b', 204));
  tracker.onRequest(request('c', FRESH, 'GET', 'https://pass.lcwaikiki.com/v3/report/viewer'));
  tracker.onResponse(response('c', 200));
  assert.equal(tracker.captured(), null);
});

test('PASS capture: başarısız yüklenen istek adaydan düşer; ilk kabul edilen korunur', () => {
  const tracker = connector.createPassAuthCaptureTracker();
  tracker.onRequest(request('x', STALE));
  tracker.onFailed({ requestId: 'x' });
  tracker.onResponse(response('x', 200));
  assert.equal(tracker.captured(), null, 'yüklenemeyen istek sonradan kabul edilmemeli');

  tracker.onRequest(request('y', FRESH));
  tracker.onResponse(response('y', 200));
  tracker.onRequest(request('z', STALE));
  tracker.onResponse(response('z', 200));
  assert.equal(tracker.captured().headers.Authorization, FRESH);
});

test('capturePassAuthorization yanıt durumunu izleyen tracker ile yakalar', () => {
  const start = CONNECTOR.indexOf('async function capturePassAuthorization');
  const body = CONNECTOR.slice(start, CONNECTOR.indexOf('\nfunction requirePassAuth', start));
  assert.match(body, /createPassAuthCaptureTracker\(\)/);
  assert.match(body, /Network\.requestWillBeSent/);
  assert.match(body, /Network\.responseReceived/);
  assert.match(body, /Network\.loadingFailed/);
  assert.doesNotMatch(body, /console\.(log|warn|error)/);
});

test('oabFetchReport kimlik doğrulama sonrası en fazla bir kez yeniden dener', () => {
  const start = OAB.indexOf('async function oabFetchReport(');
  const body = OAB.slice(start, OAB.indexOf('\n  }\n', start));
  assert.match(body, /async function oabFetchReport\(forceRefresh, authRetried = false\)/);
  assert.match(body, /!authRetried/);
  assert.match(body, /return oabFetchReport\(forceRefresh, true\)/);
  assert.doesNotMatch(body, /return oabFetchReport\(forceRefresh\);/);
});

/*
 * PLM Sync modeli: PASS token'ı açık PASS sekmesinin web storage'ında
 * (access_token) duruyor. OAB isteği her seferinde token'ı SAYFADAN okur;
 * token Node'a dönmez. Token yoksa ve yakalanmış template da yoksa istek
 * atılmaz, PASS_TOKEN_MISSING döner (bağlantı akışı devreye girer).
 */
function memoryStorage(entries) {
  return { getItem: key => (Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null) };
}
async function runPassExpression(headers, storages = {}) {
  const expr = connector.passRequestExpression(REPORT_URL, 'POST', headers, { a: 1 });
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push(opts); return { ok: true, status: 200, statusText: 'OK', text: async () => '{"Data":[]}' }; };
  const runner = new Function('fetch', 'Headers', 'localStorage', 'sessionStorage', `return ${expr};`);
  const result = await runner(fakeFetch, Headers, storages.local, storages.session);
  return { result, calls };
}

test('passRequestExpression token\'ı açık PASS sekmesinin localStorage\'ından okur (template\'e tercih edilir)', async () => {
  const token = 'eyJ' + 'a'.repeat(40);
  const { result, calls } = await runPassExpression({ Authorization: STALE, 'X-Custom': '1' }, { local: memoryStorage({ access_token: token }) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer ' + token);
  assert.equal(calls[0].headers.get('X-Custom'), '1', 'template\'teki diğer başlıklar korunur');
  assert.equal(calls[0].credentials, 'omit');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token), 'token Node\'a geri dönmez');
});

test('passRequestExpression JSON/tırnaklı saklanan token\'ı ve sessionStorage\'ı da okur', async () => {
  const token = 'eyJ' + 'b'.repeat(40);
  let run = await runPassExpression({}, { session: memoryStorage({ access_token: JSON.stringify(token) }) });
  assert.equal(run.calls[0].headers.get('Authorization'), 'Bearer ' + token);
  run = await runPassExpression({}, { local: memoryStorage({ access_token: JSON.stringify({ access_token: token }) }) });
  assert.equal(run.calls[0].headers.get('Authorization'), 'Bearer ' + token);
});

test('passRequestExpression: ne sayfada token ne template varsa istek atılmaz', async () => {
  const { result, calls } = await runPassExpression({}, { local: memoryStorage({}) });
  assert.equal(calls.length, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PASS_TOKEN_MISSING');
});

test('passRequest yakalanmış template zorunlu değil; token yoksa PASS_NOT_CONNECTED', () => {
  const start = CONNECTOR.indexOf('async function passRequest(');
  const body = CONNECTOR.slice(start, CONNECTOR.indexOf('// Rapor metadata servisi', start));
  assert.doesNotMatch(body, /requirePassAuth\(ownerId\)/);
  assert.match(body, /PASS_TOKEN_MISSING/);
  assert.match(body, /PASS_NOT_CONNECTED/);
});

test('ensurePassConnected önce açık PASS sekmesindeki token\'ı kullanır, yoksa yakalamaya düşer', () => {
  const SERVER = require('./helpers/server-source')();
  const start = SERVER.indexOf('async function ensurePassConnected');
  const body = SERVER.slice(start, SERVER.indexOf('\n}\n', start));
  assert.match(body, /passStorageAuthStatus\(userId\)/);
  assert.ok(body.indexOf('passStorageAuthStatus') < body.indexOf('capturePassAuthorization'));
  const status = CONNECTOR.slice(CONNECTOR.indexOf('async function passStorageAuthStatus'), CONNECTOR.indexOf('async function passStorageAuthStatus') + 1200);
  assert.doesNotMatch(status, /pageForCurrentBuyerLogProfile/, 'durum kontrolü yeni sekme açmaz');
});

test('passRequestExpression: storage token reddedilirse yakalanmış kabul görmüş token ile bir kez tekrarlar', async () => {
  const token = 'eyJ' + 'c'.repeat(40);
  const expr = connector.passRequestExpression(REPORT_URL, 'POST', { Authorization: FRESH }, { a: 1 });
  const used = [];
  const fakeFetch = async (url, opts) => {
    const auth = opts.headers.get('Authorization');
    used.push(auth);
    return auth === FRESH
      ? { ok: true, status: 200, statusText: 'OK', text: async () => '{"Data":[]}' }
      : { ok: false, status: 401, statusText: 'Unauthorized', text: async () => '' };
  };
  const runner = new Function('fetch', 'Headers', 'localStorage', `return ${expr};`);
  const result = await runner(fakeFetch, Headers, memoryStorage({ access_token: token }));
  assert.deepEqual(used, ['Bearer ' + token, FRESH]);
  assert.equal(result.ok, true);
});
