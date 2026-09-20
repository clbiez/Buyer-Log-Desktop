'use strict';

// v6.00 — Endeksmatik güncelleme için iki yeni giriş noktası.
//
// Düğme yalnız Koleksiyon > Araçlar menüsünde duruyordu; kullanıcı onu Kaynak
// Veri ekranında arıyor ve bulamıyordu. Ayrıca Endeksmatik penceresindeki
// "son güncelleme" notu, güncellemek isteyenin ilk baktığı yer.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v6.00 Kaynak Veri ayar menüsünde Endeksmatik Güncelle var', () => {
  const menu = HTML.slice(HTML.indexOf('id="sourceSettingsMenu"'), HTML.indexOf('id="cpImportProgress"'));
  /* v7.81: Veri Yönetimi → Araçlar → Referans veri ve yüklemeler. */
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /id: 'endeksmatik'/);
  assert.match(DM_UI, /triggerEndeksmatikUpload\(\)/);
  void menu;
  // Etiket iki dilde korunur; artık i18n özniteliği değil, araç kaydının kendisi.
  assert.match(DM_UI, /Endeksmatik Güncelle/);
  assert.match(DM_UI, /Update Endeksmatik/);
});

test('v6.00 eski giriş noktası korundu', () => {
  // Koleksiyon > Araçlar'daki yükleyici kaldırılmadı; alışkanlık bozulmamalı.
  assert.match(HTML, /id="endeksmatikUploadBtn"/);
  assert.match(HTML, /id="endeksmatikUploadFile"/);
  // Dosya seçici TEK olmalı: yükleme akışı ve yetki kontrolü tek yerde kalsın.
  assert.equal((HTML.match(/id="endeksmatikUploadFile"/g) || []).length, 1);
});

test('v6.00 her giriş noktası aynı gizli dosya girdisini tetikliyor', () => {
  /* Dilim sınırı fonksiyonun KENDİ sonundan alınır: eski menü dinleyicisi
     silindi ve indexOf(-1) boş bir dilime bakıp testi sessizce geçirirdi. */
  const fnStart = APP.indexOf('function triggerEndeksmatikUpload()');
  assert.notEqual(fnStart, -1, 'triggerEndeksmatikUpload bulunmalı');
  const fnEnd = APP.indexOf('\nfunction ', fnStart + 10);
  assert.notEqual(fnEnd, -1);
  const fn = APP.slice(fnStart, fnEnd);
  assert.match(fn, /getElementById\('endeksmatikUploadFile'\)/);
  assert.match(fn, /input\.click\(\)/);
  // Girdi yoksa sessiz kalmamalı.
  assert.match(fn, /Endeksmatik yükleme bu ekranda kullanılamıyor/);
});

test('v7.81 yüklemeyi açan yol, önüne bir menü bırakmaz', () => {
  /* Korunan kusur: açık kalan ayarlar menüsü, işletim sisteminin dosya
     seçicisinin ÖNÜNDE kalıyordu. Menü tamamen kaldırıldığı için kusur artık
     yapısal olarak imkânsız — araç satırı sayfanın akışında ve seçicinin
     önüne geçecek bir açılır yüzey yok. */
  const DM_UI = fs.readFileSync(path.join(ROOT, 'public', 'data-management.js'), 'utf8');
  assert.match(DM_UI, /triggerEndeksmatikUpload\(\)/);
  assert.doesNotMatch(APP, /sourceSettingsMenu/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8'), /sourceSettingsMenu/);
});

test('v6.00 güncelleme notu çift tıklamayla yükleme açıyor', () => {
  assert.match(APP, /<div class="endeksmatikSourceBar" data-em-update/);
  const block = APP.slice(APP.indexOf("overlay.querySelector('[data-em-update]')"), APP.indexOf("overlay.querySelectorAll('[data-em-year-shift]')"));
  assert.match(block, /addEventListener\('dblclick'/);
  // Pencere kapatılmalı: aksi halde dosya seçici arkada kalırdı.
  assert.ok(block.indexOf('overlay.remove()') < block.indexOf('triggerEndeksmatikUpload()'));
  // Tıklanabilir olduğu görünmeli.
  assert.match(APP, /Yeni ENDEKSMATİK Excel’i yüklemek için çift tıklayın/);
  assert.match(CSS, /\.endeksmatikSourceBar\[data-em-update\]\{cursor:pointer;\}/);
});
