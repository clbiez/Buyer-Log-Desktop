'use strict';

/* PLM Sync "Otomatik bağlan": kalıcı CoreNectum bölümündeki eski service
 * worker/önbellek ilk gezinmeyi ERR_FAILED (-2) ile düşürüyordu ve masaüstü
 * bunu doğrudan "ERR_FAILED (-2) loading ..." hatası olarak gösterip PLM
 * Sync'i kullanılamaz bırakıyordu. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const main = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');

function extractFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  const end = main.indexOf('\n}\n', start);
  return main.slice(start, end + 2);
}

const ctx = {};
vm.runInNewContext(`${extractFunction('coreNectumNavigationErrno')}; this.errno = coreNectumNavigationErrno;`, ctx);

test('CoreNectum gezinme hata kodu Electron hata nesnesinden okunur', () => {
  assert.equal(ctx.errno({ errno: -2, code: 'ERR_FAILED' }), -2);
  assert.equal(ctx.errno({ message: "ERR_FAILED (-2) loading 'https://corenectum.lcwaikiki.com/models-options/style-list'" }), -2);
  assert.equal(ctx.errno({ code: 'ERR_ABORTED' }), -3);
  assert.equal(ctx.errno({ message: "ERR_NAME_NOT_RESOLVED (-105) loading 'x'" }), -105);
  assert.equal(ctx.errno(null), 0);
});

test('CoreNectum ERR_FAILED tek seferlik SW/önbellek temizliğiyle yeniden denenir, oturum korunur', () => {
  const reset = extractFunction('resetCoreNectumNavigationCache');
  assert.match(reset, /storages: \['serviceworkers', 'cachestorage'\]/);
  assert.doesNotMatch(reset, /cookies|localstorage/, 'SSO çerezleri/localStorage silinmemeli');

  const acquire = main.slice(main.indexOf('async function acquireCoreNectumToken('), main.indexOf('async function clearCoreNectumAuthSession('));
  assert.doesNotMatch(acquire, /authWindow\.loadURL\(CORENECTUM_HOME\)\.catch\(/, 'ilk yükleme hatası doğrudan ölümcül sayılmamalı');
  assert.match(acquire, /if \(errno === -3\)[^\n]*return;/);
  assert.match(acquire, /if \(errno === -2 && attempt === 0\) \{[\s\S]*?resetCoreNectumNavigationCache\(authSession\);[\s\S]*?return loadHome\(1\);/);
  assert.match(acquire, /failNavigation\(error\);/);
});

test('PLM Kullanıcı Girişi gezinme hatasını ham Chromium kodu yerine TR/EN rehberle gösterir', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  assert.match(app, /error\.code==='CORENECTUM_AUTH_NAVIGATION_FAILED'\?`\$\{en\?'The CoreNectum page could not be opened\.[^']*':'CoreNectum sayfası açılamadı\.[^']*'\}/);
});
