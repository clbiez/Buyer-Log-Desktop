'use strict';
// Temporary CI trigger for current-main final legacy OAB validation.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start: ${startNeedle}`);
  assert.ok(end > start, `missing end: ${endNeedle}`);
  return source.slice(start, end);
}

test('Get OAB uses the legacy PASS Edge/CDP flow without a separate Electron auth pre-step', () => {
  const body = between(OAB, 'async function oabFetchReport', '/* ================================================================');
  assert.doesNotMatch(body, /ensureOabAuth|oabEnsureAuthentication|oabWithAuthRetry|buyerLogDesktop/);
  assert.match(body, /OABApi\.report\(/);
  assert.match(body, /OABApi\.authStatus\(\)/);
  assert.match(body, /oabAuthProgressMessage/);
});

test('legacy OAB renderer reports PASS/Edge login progress while the report request is pending', () => {
  assert.match(OAB, /function oabAuthProgressMessage/);
  assert.match(OAB, /PASS oturum açma ekranı bekleniyor/);
  assert.match(OAB, /Edge üzerinde kullanıcı adı\/şifrenizle giriş yapın/);
  assert.match(OAB, /PASS bağlantısı doğrulanıyor/);
  assert.match(OAB, /PASS girişi tamamlandı\. OAB raporu açılıyor/);
});

test('OAB auth status is sourced from the legacy browser connector', () => {
  const start = SERVER.indexOf("app.get('/api/oab/auth/status'");
  const end = SERVER.indexOf("app.get('/api/oab/seasons'", start);
  const body = SERVER.slice(start, end);
  assert.match(body, /agentBrowserConnector\.passAuthStatus\(req\.currentUser\.id\)/);
  assert.doesNotMatch(body, /oabAuthState\.status\(\)/);
});

test('single Get OAB restores the 7.0.80 PASS viewer capture and browser-context fetch path', () => {
  const helpers = between(SERVER, 'async function ensurePassConnected', "app.get('/api/oab/auth/status'");
  assert.match(helpers, /agentBrowserConnector\.passAuthStatus/);
  assert.match(helpers, /agentBrowserConnector\.capturePassAuthorization/);
  assert.match(helpers, /agentBrowserConnector\.fetchPassReportData/);
  assert.match(helpers, /PASS_SESSION_EXPIRED/);

  const report = between(SERVER, "app.post('/api/oab/report'", '/* ===================================================================');
  assert.match(report, /await ensurePassConnected\(req\.currentUser\.id/);
  assert.match(report, /await fetchOabReportWithLoginRecovery\(req\.currentUser\.id/);
  assert.doesNotMatch(report, /oabApiClient\.fetchReportData/);
});

test('batch OAB combinations use the same legacy PASS browser transport and do not require Electron auth state', () => {
  const fetchOne = between(SERVER, 'async function oabFetchOneCombination', '/* Toplu BuyerGroupRefs');
  assert.match(fetchOne, /await ensurePassConnected\(userId, params\)/);
  assert.match(fetchOne, /await fetchOabReportWithLoginRecovery\(userId, params\)/);
  assert.doesNotMatch(fetchOne, /oabApiClient\.fetchReportData/);

  const batchRoute = between(SERVER, "app.post('/api/oab/batch'", "app.get('/api/oab/batch-status'");
  assert.doesNotMatch(batchRoute, /oabAuthState\.status\(\)\.authenticated|authPendingQueue|authRetryCount|OAB_AUTH_REQUIRED|OAB_AUTH_EXPIRED/);
  const runner = between(SERVER, 'async function runOabBatchJob', '// Planı hesaplar');
  assert.match(runner, /error\.code === 'PASS_NOT_CONNECTED'/);
  assert.doesNotMatch(SERVER, /app\.post\('\/api\/oab\/batch\/resume-auth'/);
});

test('new Electron-auth helper endpoints are absent from the active OAB web flow', () => {
  assert.doesNotMatch(SERVER, /app\.post\('\/api\/oab\/auth\/capture-existing'/);
  assert.doesNotMatch(SERVER, /app\.post\('\/api\/oab\/batch\/resume-auth'/);
  assert.doesNotMatch(OAB, /captureExistingAuth|batchResumeAuth/);
});

test('legacy connector opens the real PASS viewer and captures the real report API request through CDP', () => {
  const capture = between(CONNECTOR, 'async function capturePassAuthorization', 'function requirePassAuth');
  assert.match(capture, /ensureContext\(ownerId\)/);
  assert.match(capture, /pageForCurrentBuyerLogProfile\(context,targetUrl\)/);
  assert.match(capture, /Network\.requestWillBeSent/);
  assert.match(capture, /Network\.enable/);
  assert.match(capture, /page\.goto\(targetUrl/);

  const request = between(CONNECTOR, 'async function passRequest', '// Rapor metadata servisi');
  assert.match(request, /passPageForRequest\(context\)/);
  assert.match(request, /page\._evaluateValue\(expression\)/);
  assert.match(request, /PASS_SESSION_EXPIRED/);
});

test('retrying failed OAB combinations also stays on the legacy browser transport', () => {
  const body = between(OAB, 'async function oabRetryFailedCombinations', '// Yeni satırları mevcut raporun ÜZERİNE ekler');
  assert.match(body, /OABApi\.batchStart\(\{ combinations, forceRefresh: true \}\)/);
  assert.doesNotMatch(body, /ensureOabAuth|oabEnsureAuthentication|oabWithAuthRetry/);
});
