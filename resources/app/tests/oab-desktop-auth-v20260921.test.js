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

test('OAB user menu uses backend browser connection, not Electron OAB auth window', () => {
  const body = between(USER_ACCESS, 'async function openOabUserLogin()', 'function openMenu(anchor)');
  assert.match(body, /fetch\('\/api\/oab\/auth\/connect'/);
  assert.match(body, /Açık Edge\/Chrome OAB oturumu aranıyor/);
  assert.doesNotMatch(body, /ensureOabAuth|buyerLogDesktop/);
});

test('OAB renderer reconnects through the same browser-backed backend endpoint', () => {
  const body = between(OAB, 'function oabIsAuthErrorCode', 'const OABApi');
  assert.match(body, /PASS_NOT_CONNECTED/);
  assert.match(body, /PASS_SESSION_EXPIRED/);
  assert.match(body, /fetch\('\/api\/oab\/auth\/connect'/);
  assert.match(body, /return oabJson\(url, options, false\)/);
  assert.doesNotMatch(body, /ensureOabAuth|buyerLogDesktop/);
});

test('server auth status and connect endpoint are sourced from agent browser connector', () => {
  const body = between(SERVER, '// OAB transport — restore the proven v7.0.80 existing-browser model.', "app.get('/api/oab/seasons'");
  assert.match(body, /agentBrowserConnector\.passAuthStatus\(userId\)/);
  assert.match(body, /agentBrowserConnector\.capturePassAuthorization\(userId, params \|\| \{\}\)/);
  assert.match(body, /app\.post\('\/api\/oab\/auth\/connect'/);
  assert.match(body, /transport: 'existing-browser-cdp'/);
  assert.doesNotMatch(body, /fetchOabReportFromInternalSession|requireOabInternalAuth/);
});

test('single Get OAB captures browser auth then fetches through PASS connector', () => {
  const body = between(SERVER, "app.post('/api/oab/report'", '// ---- OAB çoklu seçim');
  assert.match(body, /await ensurePassConnected\(req\.currentUser\.id/);
  assert.match(body, /fetchOabReportWithLoginRecovery\(req\.currentUser\.id/);
  assert.doesNotMatch(body, /fetchOabReportFromInternalSession/);
});

test('batch OAB uses the same existing browser session transport', () => {
  assert.match(BATCH, /await ensurePassConnected\(userId, params\)/);
  assert.match(BATCH, /fetchOabReportWithLoginRecovery\(userId, params\)/);
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

test('active renderer flow cannot accidentally invoke the legacy Electron OAB window', () => {
  assert.doesNotMatch(OAB, /buyerLogDesktop\.ensureOabAuth|bridge\.ensureOabAuth/);
  assert.doesNotMatch(USER_ACCESS, /ensureOabAuth/);
});
