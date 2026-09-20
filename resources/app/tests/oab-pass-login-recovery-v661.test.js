'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');

test('OAB auth: önce backend RAM durumunu, sonra mevcut Edge PASS/OAB oturumunu kullanır', () => {
  const start = OAB.indexOf('async function oabEnsureAuthentication');
  const end = OAB.indexOf('async function oabWithAuthRetry', start);
  const body = OAB.slice(start, end);
  assert.match(body, /OABApi\.authStatus\(\)/);
  assert.match(body, /status\.status\.authenticated/);
  assert.match(body, /OABApi\.captureExistingAuth\(\)/);
  assert.match(body, /existing-edge|Açık OAB oturumu/);
});

test('OAB auth: mevcut Edge oturumu kullanılamazsa kontrollü desktop login fallback korunur', () => {
  const start = OAB.indexOf('async function oabEnsureAuthentication');
  const end = OAB.indexOf('async function oabWithAuthRetry', start);
  const body = OAB.slice(start, end);
  assert.match(body, /global\.buyerLogDesktop/);
  assert.match(body, /desktop\.ensureOabAuth\(\{ interactive:true \}\)/);
  assert.match(body, /OAB_DESKTOP_AUTH_UNAVAILABLE/);
  assert.doesNotMatch(body, /password[^\n]{0,80}\.value/i);
});

test('OAB auth: 401/403 sonrası RAM auth temizlenir ve renderer aynı operasyonu yalnız bir kez yeniden dener', () => {
  const apiClient = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'oab-api-client.js'), 'utf8');
  assert.match(apiClient, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(apiClient, /authState\.clear\(\{ abortPending:false \}\)/);
  assert.match(apiClient, /OAB_AUTH_EXPIRED/);
  const start = OAB.indexOf('async function oabWithAuthRetry');
  const end = OAB.indexOf('/* ================================================================', start);
  const body = OAB.slice(start, end);
  assert.match(body, /let retried = false/);
  assert.match(body, /if \(!retried && oabIsAuthError\(error\)\)/);
  assert.match(body, /oabEnsureAuthentication\(\{ force:true \}\)/);
});

test('OAB auth capture endpoint: existing Edge authorization yalnız backend RAM state’e alınır ve doğrulanır', () => {
  const start = SERVER.indexOf("app.post('/api/oab/auth/capture-existing'");
  const end = SERVER.indexOf("app.get('/api/oab/seasons'", start);
  const body = SERVER.slice(start, end);
  assert.match(body, /captureExistingPassAuthorization/);
  assert.match(body, /oabAuthState\.setAuthorization/);
  assert.match(body, /oabApiClient\.validateAuthorization\(\)/);
  assert.doesNotMatch(body, /res[^\n]*authorization|json\([^)]*Bearer/i);
});
