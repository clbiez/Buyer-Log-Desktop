'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'oab-batch-service.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start: ${startNeedle}`);
  assert.ok(end > start, `missing end: ${endNeedle}`);
  return source.slice(start, end);
}

test('Get OAB reconnects (desktop session or open Edge/Chrome) and retries the failed request once', () => {
  const api = between(OAB, 'function oabIsAuthErrorCode', 'const OABApi');
  assert.match(api, /PASS_NOT_CONNECTED/);
  assert.match(api, /PASS_SESSION_EXPIRED/);
  assert.match(api, /\/api\/oab\/auth\/connect/);
  assert.match(api, /bridge\.ensureOabAuth\(\{ interactive:true, \.\.\.oabLastAuthContext \}\)/);
  assert.match(api, /return oabJson\(url, options, false\)/);
});

test('OAB renderer progress text describes the external browser flow', () => {
  const body = between(OAB, 'function oabAuthErrorMessage', '/* ================================================================\n     v7.20');
  assert.match(body, /Edge\/Chrome/);
  assert.match(body, /Remote Debugging/);
  assert.match(body, /tek OAB sekmesi açacak/);
  assert.doesNotMatch(body, /kendi giriş ekranını açacak|Buyer Log giriş ekranını açacak/);
});

test('OAB auth status comes from the browser connector', () => {
  const body = between(SERVER, 'function oabBrowserAuthStatus', "app.get('/api/oab/seasons'");
  assert.match(body, /agentBrowserConnector\.passAuthStatus\(userId\)/);
  assert.match(body, /transport: 'existing-browser-cdp'/);
  assert.match(body, /app\.post\('\/api\/oab\/auth\/connect'/);
});

test('single Get OAB uses PASS connector and recaptures after session expiry', () => {
  const helpers = between(SERVER, 'async function ensurePassConnected', "app.get('/api/oab/auth/status'");
  assert.match(helpers, /capturePassAuthorization/);
  assert.match(helpers, /fetchPassReportData/);
  assert.match(helpers, /PASS_SESSION_EXPIRED/);

  const report = between(SERVER, "app.post('/api/oab/report'", '// ---- OAB çoklu seçim');
  assert.match(report, /ensurePassConnected/);
  assert.match(report, /fetchOabReportWithLoginRecovery/);
  assert.doesNotMatch(report, /fetchOabReportFromInternalSession/);
});

test('batch OAB uses the same PASS browser connection', () => {
  const fetchOne = between(BATCH, 'async function oabFetchOneCombination', '/* Toplu BuyerGroupRefs');
  assert.match(fetchOne, /ensurePassConnected\(userId, params, transport, assertAuthority\)/);
  assert.match(fetchOne, /fetchOabReportWithLoginRecovery\(userId, params, transport, assertAuthority\)/);
  assert.doesNotMatch(fetchOne, /fetchOabReportFromInternalSession|requireOabInternalAuth/);
});

test('connector reuses existing PASS page before opening a new one', () => {
  const capture = between(CONNECTOR, 'async function capturePassAuthorization', 'function requirePassAuth');
  assert.match(capture, /context\.pages\(\)\.find\(isPassUiPage\)/);
  assert.match(capture, /if\(!page\)page=await pageForCurrentBuyerLogProfile\(context,targetUrl\)/);
  assert.match(capture, /passCaptureLocks/);
  assert.match(capture, /Network\.requestWillBeSent/);

  const request = between(CONNECTOR, 'async function passRequest', '// Rapor metadata servisi');
  assert.match(request, /passPageForRequest\(context\)/);
  assert.match(request, /page\._evaluateValue\(expression\)/);
  assert.match(request, /PASS_SESSION_EXPIRED/);
});

test('retrying failed OAB combinations inherits the same browser auth retry through oabJson', () => {
  const body = between(OAB, 'async function oabRetryFailedCombinations', '// Yeni satırları mevcut raporun ÜZERİNE ekler');
  assert.match(body, /OABApi\.batchStart\(\{ combinations, forceRefresh: true \}\)/);
  const api = between(OAB, 'function oabIsAuthErrorCode', 'const OABApi');
  assert.match(api, /oabEnsureAuthentication/);
  assert.match(api, /\/api\/oab\/auth\/connect/);
  assert.match(api, /return oabJson\(url, options, false\)/);
});
