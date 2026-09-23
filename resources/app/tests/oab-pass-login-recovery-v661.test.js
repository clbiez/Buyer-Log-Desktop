'use strict';
// Temporary CI-only validation trigger.

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

test('Get OAB opens Buyer Log internal authentication and automatically retries the failed request', () => {
  const api = between(OAB, 'function oabIsAuthErrorCode', 'const OABApi');
  assert.match(api, /OAB_AUTH_REQUIRED/);
  assert.match(api, /OAB_AUTH_EXPIRED/);
  assert.match(api, /buyerLogDesktop/);
  assert.match(api, /ensureOabAuth\(\{ interactive:true \}\)/);
  assert.match(api, /return oabJson\(url, options, false\)/);
  assert.doesNotMatch(api, /Edge|remote debugging|9223/);
});

test('OAB renderer progress text refers to Buyer Log internal sign-in, never Edge or Remote Debugging', () => {
  const body = between(OAB, 'function oabAuthErrorMessage', '/* ================================================================');
  assert.match(body, /Buyer Log gerekirse kendi giriş ekranını açacak/);
  assert.match(body, /giriş tamamlanınca otomatik devam edecek/);
  assert.doesNotMatch(body, /Edge|uzaktan hata ayıklama|remote debugging/i);
});

test('OAB auth status is sourced only from backend RAM auth state', () => {
  const body = between(SERVER, "app.get('/api/oab/auth/status'", "app.get('/api/oab/seasons'");
  assert.match(body, /oabInternalAuthStatus\(\)/);
  assert.doesNotMatch(body, /agentBrowserConnector\.passAuthStatus/);
  assert.doesNotMatch(body, /authorization|Bearer/i);
});

test('single Get OAB fetches directly through oabApiClient after internal session auth', () => {
  const helpers = between(SERVER, 'function oabInternalAuthStatus', "app.get('/api/oab/auth/status'");
  assert.match(helpers, /oabAuthState\.status\(\)/);
  assert.match(helpers, /OAB_AUTH_REQUIRED/);
  assert.match(helpers, /oabApiClient\.fetchReportData/);
  assert.doesNotMatch(helpers, /agentBrowserConnector|capturePassAuthorization|fetchPassReportData|PASS_SESSION_EXPIRED/);

  const report = between(SERVER, "app.post('/api/oab/report'", '/* ===================================================================');
  assert.match(report, /fetchOabReportFromInternalSession\(\{ seasonRef, merchSubGroupRef, buyerGroupRef \}\)/);
  assert.doesNotMatch(report, /agentBrowserConnector|ensurePassConnected|fetchOabReportWithLoginRecovery/);
});

test('batch OAB preflights internal auth and uses the same direct API transport', () => {
  const fetchOne = between(SERVER, 'async function oabFetchOneCombination', '/* Toplu BuyerGroupRefs');
  assert.match(fetchOne, /fetchOabReportFromInternalSession\(params\)/);
  assert.doesNotMatch(fetchOne, /agentBrowserConnector|ensurePassConnected|fetchOabReportWithLoginRecovery/);

  const batchRoute = between(SERVER, "app.post('/api/oab/batch'", "app.get('/api/oab/batch-status'");
  assert.match(batchRoute, /requireOabInternalAuth\(\)/);
  const runner = between(SERVER, 'async function runOabBatchJob', '// Planı hesaplar');
  assert.match(runner, /OAB_AUTH_REQUIRED/);
  assert.match(runner, /OAB_AUTH_EXPIRED/);
});

test('OAB active server path contains no Edge/Chrome Remote Debugging fallback', () => {
  const start = SERVER.indexOf('/* ===================================================================\n   OAB (Order-Assortment-Budget)');
  const end = SERVER.indexOf('/* ===================================================================\n   INTAKE', start);
  const body = SERVER.slice(start, end);
  assert.doesNotMatch(body, /capturePassAuthorization|fetchPassReportData|passAuthStatus|ensurePassConnected|remote-debugging|9223/);
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

test('retrying failed OAB combinations inherits the same internal auth retry through oabJson', () => {
  const body = between(OAB, 'async function oabRetryFailedCombinations', '// Yeni satırları mevcut raporun ÜZERİNE ekler');
  assert.match(body, /OABApi\.batchStart\(\{ combinations, forceRefresh: true \}\)/);
  const api = between(OAB, 'function oabIsAuthErrorCode', 'const OABApi');
  assert.match(api, /ensureOabAuth/);
  assert.match(api, /return oabJson\(url, options, false\)/);
});
