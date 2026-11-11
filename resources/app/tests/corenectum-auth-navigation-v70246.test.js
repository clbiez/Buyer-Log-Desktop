'use strict';

/* PLM Sync "Otomatik bağlan": kalıcı CoreNectum bölümündeki eski service
 * worker/önbellek ilk gezinmeyi ERR_FAILED (-2) ile düşürüyordu ve masaüstü
 * bunu doğrudan "ERR_FAILED (-2) loading ..." hatası olarak gösterip PLM
 * Sync'i kullanılamaz bırakıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

const recovery = require('../electron/portal-navigation-recovery');

test('CoreNectum gezinme hata kodu Electron hata nesnesinden okunur', () => {
  assert.equal(recovery.navigationErrno({ errno: -2, code: 'ERR_FAILED' }), -2);
  assert.equal(recovery.navigationErrno({ message: "ERR_FAILED (-2) loading 'https://corenectum.lcwaikiki.com/models-options/style-list'" }), -2);
  assert.equal(recovery.navigationErrno({ code: 'ERR_ABORTED' }), -3);
  assert.equal(recovery.navigationErrno({ message: "ERR_NAME_NOT_RESOLVED (-105) loading 'x'" }), -105);
  assert.equal(recovery.navigationErrno(null), 0);
});

test('CoreNectum ilk hatası ölümcül değil: ortak kurtarma merdiveniyle yeniden denenir', () => {
  const acquire = main.slice(main.indexOf('async function acquireCoreNectumToken('), main.indexOf('async function clearCoreNectumAuthSession('));
  assert.doesNotMatch(acquire, /authWindow\.loadURL\(CORENECTUM_HOME\)\.catch\(/, 'ilk yükleme hatası doğrudan ölümcül sayılmamalı');
  assert.match(acquire, /nextPortalRecoveryStep\(\{[\s\S]*?portalSession: authSession, baselineSession: session\.defaultSession/);
  assert.match(acquire, /if \(step\.action === 'ignore'\)[^\n]*return;/);
  assert.match(acquire, /if \(step\.action === 'retry'\) return loadHome\(attempt \+ 1\);/);
  assert.match(acquire, /failNavigation\(error, step\);/);
});

test('PLM Kullanıcı Girişi gezinme hatasını ham Chromium kodu yerine TR/EN rehberle gösterir', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  assert.match(app, /error\.code==='CORENECTUM_AUTH_NAVIGATION_FAILED'\?`\$\{en\?'The CoreNectum page could not be opened\.[^']*':'CoreNectum sayfası açılamadı\.[^']*'\}/);
});
