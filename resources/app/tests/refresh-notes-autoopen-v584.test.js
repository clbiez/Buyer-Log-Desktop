'use strict';

// v5.84 — Yenileme bittiğinde güncelleme notları kendiliğinden açılmıyordu.
//
// Kök neden bir hata değil, eski bir tasarım kararıydı: yenileme sonucu yalnız
// Genel Bakış ekranındaki karta yazılıyor, geçmiş penceresi kullanıcı "Detayları
// aç" düğmesine basınca açılıyordu. Kullanıcı o ekranda değilse yenilikten
// haberi olmuyordu. Artık DEĞİŞİKLİK VARSA pencere kendiliğinden açılır.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function bodyOf(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = APP.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

// autoOpenRefreshHistory'yi gerçek bağımlılıklarını taklit ederek çalıştırır.
function runAutoOpen({ result, autoOpen = true, overlayOpen = false }) {
  const calls = [];
  const fn = new Function(
    'refreshHistoryAutoOpen', 'blOverlayOpen', 'openSourceRefreshHistory', 'result',
    `return (async function(){ ${bodyOf('autoOpenRefreshHistory')} })();`
  );
  return fn(
    () => autoOpen,
    () => overlayOpen,
    async id => { calls.push(id); },
    result
  ).then(opened => ({ opened, calls }));
}

const withChanges = { hasChanges: true, historyItemId: 'rec-1', totalChanges: 12 };

test('v5.84 değişiklik bulunan yenilemeden sonra notlar kendiliğinden açılır', async () => {
  const { opened, calls } = await runAutoOpen({ result: withChanges });
  assert.equal(opened, true);
  // Pencere doğrudan O yenilemenin kaydında açılmalı, listenin başında değil.
  assert.deepEqual(calls, ['rec-1']);
});

test('v5.84 değişiklik yoksa pencere açılmaz', async () => {
  // Okunacak not olmadığı hâlde pencere açmak yalnız rahatsız ederdi.
  for (const result of [
    { hasChanges: false, historyItemId: 'rec-1' },
    { hasChanges: true, historyItemId: null },
    null,
  ]) {
    const { opened, calls } = await runAutoOpen({ result });
    assert.equal(opened, false);
    assert.deepEqual(calls, []);
  }
});

test('v5.84 tercih kapatıldığında açılmaz', async () => {
  const { opened, calls } = await runAutoOpen({ result: withChanges, autoOpen: false });
  assert.equal(opened, false);
  assert.deepEqual(calls, []);
});

test('v5.84 açık bir pencere varken araya girilmez', async () => {
  // Kullanıcı başka bir pencereyle uğraşıyorsa üstüne pencere açmak yaptığı işi
  // keserdi; sonuç kartı Genel Bakış'ta durmaya devam ediyor.
  const { opened, calls } = await runAutoOpen({ result: withChanges, overlayOpen: true });
  assert.equal(opened, false);
  assert.deepEqual(calls, []);
});

test('v5.84 tercih varsayılan olarak AÇIK ve kalıcı', () => {
  const body = bodyOf('refreshHistoryAutoOpen');
  // Kayıt yoksa (getItem null) açık kabul edilmeli.
  assert.match(body, /!=='0'/);
  assert.match(APP, /const REFRESH_AUTO_OPEN_KEY='bl\.refreshHistory\.autoOpen\.v1'/);
  assert.match(bodyOf('setRefreshHistoryAutoOpen'), /BLStorage\.setItem\(REFRESH_AUTO_OPEN_KEY,on\?'1':'0'\)/);
});

test('v5.84 pencerede tercihi kapatan kutucuk var', () => {
  assert.match(APP, /id="sourceRefreshHistAutoOpen"/);
  assert.match(APP, /sourceRefreshHistAutoOpen'\)\?\.addEventListener\('change',e=>setRefreshHistoryAutoOpen\(e\.currentTarget\.checked\)\)/);
  assert.match(APP, /autoOpen: en \? 'Open automatically after a refresh that found changes'/);
  assert.match(CSS, /\.refreshAutoOpenToggle\{/);
});

test('v5.84 çağrı yenilemenin sonunda ve yalnız gerçek yenilemede yapılır', () => {
  const call = APP.indexOf('await autoOpenRefreshHistory(_overviewRefreshResult)');
  assert.ok(call > 0, 'yenileme sonunda çağrılmalı');
  // Hata yutulur: notlar açılamadı diye yenileme başarısız sayılmamalı.
  assert.match(APP.slice(call - 120, call + 200), /catch\(err\)\{ console\.warn\('Yenileme notları açılamadı:',err\); \}/);
});
