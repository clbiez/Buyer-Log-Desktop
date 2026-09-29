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
