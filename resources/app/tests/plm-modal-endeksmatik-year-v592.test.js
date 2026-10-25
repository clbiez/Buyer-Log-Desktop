'use strict';

// v5.92 — iki düzeltme/ekleme:
//   1) "Import from PLM Excel" penceresinin zemini şeffaftı,
//   2) Endeksmatik'te dört dönemi tek tek girmek yerine ±1 yıl eşleştirme.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

/* ------------------------------------------------- 1) PLM PENCERESİ ZEMİNİ */

test('v5.92 PLM pencereleri kart zeminini veren sınıfı taşıyor', () => {
  // Kök neden: kart yalnız .verHistCard + .plmImportCard taşıyordu; arka plan,
  // kenarlık ve gölgeyi veren .modalCard yoktu, bu yüzden zemin şeffaftı.
  // Sürüm geçmişi penceresi .modalCard taşıdığı için sorun orada görünmüyordu.
  ['plmImportCard', 'plmDecisionCard'].forEach(name => {
    const hits = APP.match(new RegExp(`class="modalCard verHistCard[^"]*${name}[^"]*"`, 'g')) || [];
    assert.ok(hits.length >= 1, `${name} .modalCard taşımalı`);
  });
  // Zeminsiz kalan bir .verHistCard kullanımı kalmamalı.
  const bare = APP.match(/class="verHistCard[^"]*"/g) || [];
  assert.deepEqual(bare, [], 'her verHistCard modalCard ile birlikte kullanılmalı');
});

test('v5.92 başlık bloğunun taban kuralı var', () => {
  // .verHistHead yalnız .plmTranslationCard içinde tanımlıydı; bu pencerede
  // dolgusuz ve ayırıcısız kalıyor, başlık ile açıklama üst üste biniyordu.
  assert.match(CSS, /\.verHistCard > \.verHistHead\{[^}]*padding:16px 20px 12px/);
  require('./helpers/manifest-css').assertReset();
  assert.match(CSS, /\.verHistCard > \.verHistHead strong\{display:block/);
  // Gövde de kart zeminini almalı: aksi halde kaydırırken arkadaki tablo
  // hücreleri metnin altından görünüyordu.
  assert.match(CSS, /\.plmImportCard > \.plmImportBody[\s\S]{0,120}background:var\(--ui-surface\)/);
});

/* --------------------------------------------- 2) ENDEKSMATİK YIL KAYDIRMA */

const shiftMonth = new Function('kolMonthCode', `return function endeksmatikShiftMonthCode(value, years){${
  APP.slice(APP.indexOf('function endeksmatikShiftMonthCode(value, years){') + 'function endeksmatikShiftMonthCode(value, years){'.length,
            APP.indexOf('function endeksmatikMonthPickerValue'))
    .replace(/\}\s*$/, '')
}};`)(value => {
  const raw = String(value == null ? '' : value).trim();
  const m = /^(\d{4})(\d{2})$/.exec(raw);
  return m ? raw : '';
});

test('v5.92 ay kodu yıl bazında kaydırılıyor, ay korunuyor', () => {
  assert.equal(shiftMonth('202607', 1), '202707');
  assert.equal(shiftMonth('202607', -1), '202507');
  // Ocak/Aralık sınırlarında ay değişmemeli — kaydırma yalnız YIL üzerinde.
  assert.equal(shiftMonth('202601', -1), '202501');
  assert.equal(shiftMonth('202612', 1), '202712');
});

test('v5.92 geçersiz ya da boş değer kaydırılmaz', () => {
  assert.equal(shiftMonth('', 1), '');
  assert.equal(shiftMonth('abc', 1), '');
  assert.equal(shiftMonth(null, -1), '');
  // Makul yıl aralığının dışına taşan sonuç üretilmemeli.
  assert.equal(shiftMonth('190001', -1), '');
});

test('v5.92 iki yönlü doldurma düğmeleri var', () => {
  assert.match(APP, /data-em-year-shift="forward"/);
  assert.match(APP, /data-em-year-shift="backward"/);
  assert.match(APP, /Yeni dönemi eskiden doldur \(\+1 yıl\)/);
  assert.match(APP, /Eski dönemi yeniden doldur \(−1 yıl\)/);
  assert.match(CSS, /\.endeksmatikPeriodSync\{/);
});

test('v5.92 doldurma sipariş ve In Store dönemlerini birlikte eşliyor', () => {
  const block = APP.slice(APP.indexOf('const YEAR_SHIFT_PAIRS='), APP.indexOf("overlay.querySelectorAll('[data-em-year-shift]')"));
  assert.match(block, /\['previousOrderMonth','newOrderMonth'\]/);
  assert.match(block, /\['previousInStoreMonth','newInStoreMonth'\]/);
  // Ayrı TR dönemleri açıksa onlar da eşlenmeli.
  assert.match(block, /separateToggle&&separateToggle\.checked/);
  assert.match(block, /previousTryOrderMonth','newOrderMonth'/);
  // Kaynağı boş olan alan atlanmalı: boş bir dönemden tarih türetilemez.
  assert.match(block, /if\(!source\)return;/);
  // Hangi tarihlerin dolduğu bildirilmeli; sessizce üzerine yazmak, elle
  // girilmiş bir tarihi fark ettirmeden değiştirebilirdi.
  assert.match(block, /filled\.push/);
  assert.match(block, /Doldurulacak bir şey yok/);
  // Doldurmadan sonra kronoloji doğrulaması yeniden çalışmalı.
  assert.match(block, /validateChronology\(\{toast:true\}\)/);
});

test('v5.92 geçen In Store ayı ilk açılışta yeni dönem −1 yıl olarak geliyor', () => {
  const block = APP.slice(APP.indexOf('const seededNewInStore='), APP.indexOf('previousUsdPrice:saved.previousUsdPrice!==undefined'));
  assert.match(block, /const seededNewInStore=saved\.newInStoreMonth\|\|kolMonthCode\(row&&row\.inStoreMonth\)/);
  assert.match(block, /const seededPreviousInStore=saved\.previousInStoreMonth\|\|endeksmatikShiftMonthCode\(seededNewInStore,-1\)/);
  // Kayıtlı değer varsa ona dokunulmamalı — kullanıcının seçimi korunur.
  assert.match(block, /saved\.previousInStoreMonth\|\|/);
  assert.match(block, /previousInStoreMonth:seededPreviousInStore/);
  // TR ayrı dönemi de aynı tohumdan başlar.
  assert.match(block, /previousTryInStoreMonth:saved\.previousTryInStoreMonth\|\|seededPreviousInStore/);
});
