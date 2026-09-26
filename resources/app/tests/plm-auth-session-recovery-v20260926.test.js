'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const recovery = require('../public/plm-auth-recovery.js');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'plm-auth-recovery.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('PLM auth recovery yalnız CoreNectum kullanan same-origin uçları kapsar', () => {
  const base = 'http://127.0.0.1:6194/';
  const origin = 'http://127.0.0.1:6194';
  for (const url of [
    '/api/plm-sync/fetch',
    '/api/plm-sync/model-files',
    '/api/plm-style-links/sync-links',
    '/api/corenectum-api/resolve-attachment',
    '/api/model-images/import-plm',
  ]) {
    assert.equal(recovery.isProtectedPlmRequest(url, base, origin), true, url);
  }
  assert.equal(recovery.isProtectedPlmRequest('/api/oab/fetch', base, origin), false);
  assert.equal(recovery.isProtectedPlmRequest('https://example.com/api/plm-sync/fetch', base, origin), false);
});

test('yalnız gerçek CoreNectum auth kodları otomatik yenilemeyi tetikler', () => {
  for (const code of [
    'CORENECTUM_API_TOKEN_INVALID',
    'CORENECTUM_API_TOKEN_REQUIRED',
    'CORENECTUM_LOGIN_REQUIRED',
    'CORENECTUM_SIGNIN_REQUIRED',
    'CORENECTUM_AUTH_REQUIRED',
  ]) {
    assert.equal(recovery.authCodeFromPayload({ code }), code);
  }
  assert.equal(recovery.authCodeFromPayload({ code:'CORENECTUM_API_HTTP_ERROR' }), '');
  assert.equal(recovery.authCodeFromPayload({ code:'VALIDATION_ERROR' }), '');
  assert.equal(recovery.authCodeFromPayload({ details:{ code:'CORENECTUM_API_TOKEN_INVALID' } }), 'CORENECTUM_API_TOKEN_INVALID');
});

test('yenileme mevcut Electron SSO köprüsünü kullanır, token renderer içine alınmaz', () => {
  assert.match(SOURCE, /buyerLogDesktop\.ensureCoreNectumAuth/);
  assert.match(SOURCE, /interactive:\s*true/);
  assert.match(SOURCE, /recoveryInFlight/);
  assert.match(SOURCE, /response\.clone\(\)\.json\(\)/);
  assert.doesNotMatch(SOURCE, /Authorization\s*:/);
  assert.doesNotMatch(SOURCE, /Bearer\s+\$?\{/);
});

test('başarılı renew sonrası istek yalnız bir kez raw fetch ile replay edilir', () => {
  assert.match(SOURCE, /const firstResponse = await rawFetch\(request\.clone\(\)\)/);
  assert.match(SOURCE, /const recovered = await renewCoreNectumSession\(root\)/);
  assert.match(SOURCE, /return rawFetch\(request\.clone\(\)\);/);
  assert.doesNotMatch(SOURCE, /return root\.fetch\(request\.clone\(\)\)/);
});

test('recovery katmanı app-main yüklenmeden önce kuruludur', () => {
  const recoveryAt = INDEX.indexOf('plm-auth-recovery.js');
  const appAt = INDEX.indexOf('app-main.js?v=__BL_ASSET_VERSION__');
  assert.ok(recoveryAt >= 0, 'plm-auth-recovery.js index.html içinde yüklenmeli');
  assert.ok(appAt >= 0, 'app-main.js bulunmalı');
  assert.ok(recoveryAt < appAt, 'fetch recovery app-main.js öncesinde kurulmalı');
});
