'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const MAIN = fs.readFileSync(path.join(ROOT, 'electron', 'main.js'), 'utf8');
const API_CLIENT = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'oab-api-client.js'), 'utf8');

function between(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start: ${startNeedle}`);
  assert.ok(end > start, `missing end: ${endNeedle}`);
  return source.slice(start, end);
}

test('OAB auth precedence is backend RAM -> existing Edge -> Electron fallback', () => {
  const body = between(OAB, 'async function oabEnsureAuthentication', 'async function oabWithAuthRetry');
  const memory = body.indexOf('OABApi.authStatus()');
  const existing = body.indexOf('OABApi.captureExistingAuth()');
  const desktop = body.indexOf("desktop.ensureOabAuth({ interactive:true })");
  assert.ok(memory >= 0 && existing > memory && desktop > existing);

  // A valid backend RAM session exits before either browser capture path.
  const memoryReturn = body.indexOf('status.status.authenticated) return true');
  assert.ok(memoryReturn > memory && memoryReturn < existing);

  // A successful existing Edge capture exits before Electron fallback opens.
  const existingSuccess = body.indexOf("source:'existing-edge'");
  const existingReturn = body.indexOf('return true;', existing);
  assert.ok(existingReturn > existing && existingReturn < desktop);
  assert.match(body, /existing-edge|Açık OAB oturumu/);
});

test('OAB auth existing Edge miss falls through to controlled desktop login without credential scraping', () => {
  const body = between(OAB, 'async function oabEnsureAuthentication', 'async function oabWithAuthRetry');
  assert.match(body, /OAB_EXISTING_BROWSER_UNAVAILABLE/);
  assert.match(body, /OAB_EXISTING_TAB_NOT_FOUND/);
  assert.match(body, /OAB_EXISTING_AUTH_NOT_CAPTURED/);
  assert.match(body, /global\.buyerLogDesktop/);
  assert.match(body, /await desktop\.ensureOabAuth\(\{ interactive:true \}\)/);
  assert.match(body, /OAB_DESKTOP_AUTH_UNAVAILABLE/);
  assert.doesNotMatch(body, /password[^\n]{0,80}\.value/i);
});

test('interactive Electron success resolves the same pending renderer authentication await', () => {
  const authBody = between(OAB, 'async function oabEnsureAuthentication', 'async function oabWithAuthRetry');
  const fetchBody = between(OAB, 'async function oabFetchReport', '/* ================================================================');
  assert.match(authBody, /const result = await desktop\.ensureOabAuth\(\{ interactive:true \}\)/);
  assert.match(authBody, /oabSetBusyStatus\(oabT\('OAB oturumu doğrulandı'/);
  assert.match(fetchBody, /await oabEnsureAuthentication\(\);/);
  assert.match(fetchBody, /await oabWithAuthRetry\(\(\) => OABApi\.report/);

  // Main resolves only from validated capture or explicit failure/cancel; there
  // is no "viewer opened == success" shortcut.
  const mainBody = between(MAIN, 'async function acquireOabAuthorization', 'async function clearOabAuthSession');
  assert.match(mainBody, /pushOabAuthorizationToBackend\(authorization\)/);
  assert.match(mainBody, /resolvePromise\(\{ ok:true, authenticated:true, source:'desktop-oab-sso' \}\)/);
  assert.doesNotMatch(mainBody, /did-finish-load[^\n]*resolve\(\{\s*ok:true/);
});

test('OAB auth 401/403 clears RAM auth and renderer retries the same operation only once', () => {
  assert.match(API_CLIENT, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(API_CLIENT, /authState\.clear\(\{ abortPending:false \}\)/);
  assert.match(API_CLIENT, /OAB_AUTH_EXPIRED/);

  const body = between(OAB, 'async function oabWithAuthRetry', '/* ================================================================');
  assert.match(body, /let retried = false/);
  assert.match(body, /if \(!retried && oabIsAuthError\(error\)\)/);
  assert.match(body, /retried = true/);
  assert.match(body, /await oabEnsureAuthentication\(\{ force:true \}\)/);
  assert.match(body, /continue;/);
});

test('existing Edge capture endpoint keeps Authorization in backend RAM and validates it', () => {
  const start = SERVER.indexOf("app.post('/api/oab/auth/capture-existing'");
  const end = SERVER.indexOf("app.get('/api/oab/seasons'", start);
  const body = SERVER.slice(start, end);
  assert.match(body, /captureExistingPassAuthorization/);
  assert.match(body, /oabAuthState\.setAuthorization/);
  assert.match(body, /oabApiClient\.validateAuthorization\(\)/);
  assert.doesNotMatch(body, /res[^\n]*authorization|json\([^)]*Bearer/i);
});

test('manual Electron login-window close remains a cancellation, not an auth success', () => {
  const body = between(MAIN, 'async function acquireOabAuthorization', 'async function clearOabAuthSession');
  assert.match(body, /authWindow\.on\('closed'/);
  assert.match(body, /code:'OAB_AUTH_CANCELLED'/);
  assert.doesNotMatch(body, /authWindow\.on\('closed'[\s\S]{0,500}authenticated:true/);
});
