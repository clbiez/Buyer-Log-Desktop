'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const USER_ACCESS = fs.readFileSync(path.join(ROOT, 'public', 'user-access-ui.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const BATCH = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'oab-batch-routes.js'), 'utf8');
const CONNECTOR = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js'), 'utf8');

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start: ${startNeedle}`);
  assert.ok(end > start, `missing end: ${endNeedle}`);
  return source.slice(start, end);
}

test('OAB user menu signs in through the hidden Electron OAB session on desktop, browser connector otherwise', () => {
  const body = between(USER_ACCESS, 'async function openOabUserLogin()', 'function openMenu(anchor)');
  assert.match(body, /desktop\.ensureOabAuth\(\{ interactive:true \}\)/);
  assert.ok(body.indexOf('ensureOabAuth') < body.indexOf("fetch('/api/oab/auth/connect'"), 'desktop session must be tried before the browser connector');
  assert.match(body, /fetch\('\/api\/oab\/auth\/connect'/);
  assert.match(body, /Açık Edge\/Chrome OAB oturumu aranıyor/);
});

test('OAB renderer uses the desktop session when available and marks requests with the desktop transport', () => {
  const body = between(OAB, 'function oabIsAuthErrorCode', 'const OABApi');
  assert.match(body, /PASS_NOT_CONNECTED/);
  assert.match(body, /PASS_SESSION_EXPIRED/);
  assert.match(body, /typeof bridge\.ensureOabAuth === 'function'/);
  assert.match(body, /'X-BuyerLog-OAB-Transport': 'desktop'/);
  assert.match(body, /await fetch\(url, oabWithTransport\(options\)\)/);
  assert.match(body, /fetch\('\/api\/oab\/auth\/connect'/);
  assert.match(body, /return oabJson\(url, options, false\)/);
});

test('server picks the OAB transport per request: desktop RAM session or existing browser connector', () => {
  const body = between(SERVER, '// OAB transport — two paths, chosen per request.', "app.get('/api/oab/seasons'");
  assert.match(body, /req\.get\('X-BuyerLog-OAB-Transport'\)/);
  assert.match(body, /oabAuthState\.status\(\)\.authenticated/);
  assert.match(body, /oabApiClient\.fetchReportData\(params \|\| \{\}\)/);
  assert.match(body, /code = 'OAB_AUTH_REQUIRED'/);
  // Desktop transport must never fall through to the CDP connector (no external browser).
  const ensure = between(body, 'async function ensurePassConnected', 'async function fetchOabReportWithLoginRecovery');
  assert.ok(ensure.indexOf('throw oabDesktopAuthRequired()') < ensure.indexOf('agentBrowserConnector'));
  assert.match(body, /agentBrowserConnector\.passAuthStatus\(userId\)/);
  assert.match(body, /agentBrowserConnector\.capturePassAuthorization\(userId, params \|\| \{\}\)/);
  assert.match(body, /app\.post\('\/api\/oab\/auth\/connect'/);
  assert.match(body, /transport: 'existing-browser-cdp'/);
  assert.match(body, /'desktop-session'/);
  assert.doesNotMatch(body, /fetchOabReportFromInternalSession|requireOabInternalAuth/);
});

test('single Get OAB captures browser auth then fetches through PASS connector', () => {
  const body = between(SERVER, "app.post('/api/oab/report'", '// ---- OAB çoklu seçim');
  assert.match(body, /await ensurePassConnected\(req\.currentUser\.id/);
  assert.match(body, /fetchOabReportWithLoginRecovery\(req\.currentUser\.id/);
  assert.match(body, /const transport = oabRequestTransport\(req\)/);
  assert.doesNotMatch(body, /fetchOabReportFromInternalSession/);
});

test('batch OAB keeps the transport of the request that started it', () => {
  assert.match(BATCH, /transport: oabRequestTransport\(req\)/);
  assert.match(BATCH, /oabFetchOneCombination\(userId, currentUser, item, job\.forceRefresh, job\.transport\)/);
  assert.match(BATCH, /await ensurePassConnected\(userId, params, transport\)/);
  assert.match(BATCH, /fetchOabReportWithLoginRecovery\(userId, params, transport\)/);
  assert.doesNotMatch(BATCH, /requireOabInternalAuth|fetchOabReportFromInternalSession/);
});

test('connector reuses an open PASS tab and creates only one when none exists', () => {
  const body = between(CONNECTOR, 'async function capturePassAuthorization', 'function requirePassAuth');
  assert.match(body, /let page=context\.pages\(\)\.find\(isPassUiPage\)/);
  assert.match(body, /if\(!page\)page=await pageForCurrentBuyerLogProfile\(context,targetUrl\)/);
  assert.match(body, /passCaptureLocks\.has\(key\)/);
  assert.match(body, /Network\.requestWillBeSent/);
  assert.ok(body.indexOf('candidate.client.on(\'Network.requestWillBeSent\'') < body.indexOf('page.goto(targetUrl'), 'network listener must be attached before navigation');
});

test('desktop OAB sign-in is detected from PASS storage, not only from a report request', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  assert.match(MAIN, /const OAB_STORAGE_PROBE = `/);
  assert.match(MAIN, /\['access_token', 'accessToken'\]/);
  assert.match(MAIN, /oidc\\\.user:/);
  const flow = between(MAIN, 'async function acquireOabAuthorization', 'async function clearOabAuthSession');
  assert.match(flow, /executeJavaScript\(OAB_STORAGE_PROBE, true\)/);
  assert.match(flow, /finishAuthorization\(authorization, 'PASS storage', target\)/);
  // Storage wins before any sign-in heuristic can send a signed-in user back to login.
  const pulse = between(flow, 'const pulseLifecycle = async () => {', 'const recoverStaleSilentProbe');
  assert.ok(pulse.indexOf('probeStoredAuthorization()') < pulse.indexOf('oabWindowLooksLikeSignIn'));
  // Candidates are validated one after another.
  assert.match(flow, /authorizationChain\.then\(\(\) => finishAuthorizationNow\(authorization, source, target\)\)/);
});

test('desktop OAB candidates are validated inside the signed-in PASS page, never by the Node backend', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const flow = between(MAIN, 'async function acquireOabAuthorization', 'async function clearOabAuthSession');
  const finish = between(flow, 'const finishAuthorizationNow = async', 'let authorizationChain');
  assert.match(finish, /validateOabSessionInPage\(page, authorization, oabSelectionFromViewerUrl\(targetViewerUrl\(\)\)\)/);
  // PASS returns 405 for GetReportVariablesWithData; validation must use GetReportData.
  const validate = between(MAIN, 'async function validateOabSessionInPage', '/* The signed-in PASS page');
  assert.match(validate, /'Report\/GetReportData'/);
  assert.doesNotMatch(validate, /GetReportVariablesWithData/);
  assert.match(finish, /adoptOabSessionWindow\(page, authorization, parent\)/);
  assert.doesNotMatch(MAIN, /pushOabAuthorizationToBackend/);
  // The page request mirrors the proven Edge/CDP model: credentials omit + Authorization.
  const expression = between(MAIN, 'function oabPassRequestExpression', 'function oabWindowOnPass');
  assert.match(expression, /credentials:'omit'/);
  assert.match(expression, /Authorization:authorization/);
  assert.match(expression, /readStoredOabTokens\(\)/);
  // Adopted window is kept, not closed by cleanup; it never keeps the app alive alone.
  assert.match(flow, /authWindow !== keptWindow/);
  assert.match(MAIN, /function closeOrphanOabSessionWindow\(\)/);
});

test('desktop OAB relay is loopback-only, secret-guarded and endpoint-whitelisted', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const relay = between(MAIN, 'async function handleOabRelayRequest', 'function startOabRelay');
  assert.match(relay, /oabRelaySecretValid\(req\.headers\['x-buyerlog-desktop-bridge'\]\)/);
  assert.match(relay, /OAB_RELAY_ENDPOINTS\.has\(endpoint\)/);
  assert.match(relay, /size > 65536/);
  assert.match(MAIN, /server\.listen\(0, '127\.0\.0\.1'/);
  assert.match(MAIN, /desktopOabRelayUrl,/);
  const BACKEND = fs.readFileSync(path.join(ROOT, 'electron', 'backend.js'), 'utf8');
  assert.match(BACKEND, /env\.BUYER_LOG_DESKTOP_OAB_RELAY_URL = this\.desktopOabRelayUrl/);
  assert.match(SERVER, /oabDesktopRelay\.configured\(\) \? oabDesktopRelay\.fetchReportData\(params \|\| \{\}\)/);
});

test('corporate connections menu shows the OAB connection state', () => {
  assert.match(USER_ACCESS, /data-oab-badge/);
  const paint = between(USER_ACCESS, 'async function paintCorporateConnections', 'function openMenu(anchor)');
  assert.match(paint, /fetch\('\/api\/oab\/auth\/status'/);
  assert.match(paint, /'X-BuyerLog-OAB-Transport': 'desktop'/);
});

test('closing the desktop OAB sign-in window keeps checking for a completed login before cancelling', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const flow = between(MAIN, 'async function acquireOabAuthorization', 'async function clearOabAuthSession');
  const close = between(flow, "authWindow.on('close', event => {", "authWindow.on('closed'");
  assert.match(close, /if \(settled \|\| closeRequested\) return;/);
  assert.match(close, /event\.preventDefault\(\)/);
  assert.match(close, /target\.hide\(\)/);
  assert.match(close, /OAB_CLOSE_GRACE_MS/);
  assert.match(close, /probeStoredAuthorization\(\)/);
  assert.match(close, /finishFailure\('OAB_AUTH_CANCELLED'/);
  assert.match(flow, /if \(!flowState\.interactive \|\| settled \|\| closeRequested/);
});


test('desktop OAB validation accepts a Bearer PASS authorized and rejects 401/403/405', () => {
  const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
  const src = between(MAIN, 'function oabReportDataBody', 'async function validateOabSessionInPage');
  const api = new Function(`${src}; return { oabReportDataBody, oabSessionAccepted, oabSelectionFromViewerUrl };`)();
  assert.equal(api.oabSessionAccepted({ status: 200 }), true);
  assert.equal(api.oabSessionAccepted({ status: 400 }, { allowClientError: true }), true);
  assert.equal(api.oabSessionAccepted({ status: 400 }), false);
  for (const status of [401, 403, 405, 500, 0]) assert.equal(api.oabSessionAccepted({ status }, { allowClientError: true }), false, String(status));
  assert.deepEqual(api.oabSelectionFromViewerUrl('https://pass.lcwaikiki.com/v3/report/viewer?key=OrderBudget_List_Report&SeasonRef=S7&MerchSubGroupRef=CU4E&BuyerGroupRefs=12'),
    { seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRef: '12' });
  const body = api.oabReportDataBody({ seasonRef: 'S7', merchSubGroupRef: 'CU4E', buyerGroupRef: '12' });
  assert.equal(body.reportRef, 'OrderBudget_List_Report');
  assert.equal(body.parameters.BuyerGroupRefs, '12');
});
