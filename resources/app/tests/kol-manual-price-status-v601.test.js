'use strict';

// v6.01 — üç değişiklik:
//   1) Sipariş ayı girmek In Store ayını artık DEĞİŞTİRMİYOR,
//   2) Best Price / Conf. Manufacturer hücrelerine elle giriş,
//   3) Koleksiyon durumlarına "Siparişe Hazır" eklendi.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const STATUS_CATALOG = require('../public/collection-status-catalog.js');

/* ------------------------------------------------ 1) IN STORE OTOMATİĞİ */

test('v6.01 sipariş ayı In Store ayını otomatik değiştirmiyor', () => {
  // Eskiden sipariş ayının YILI In Store ayına taşınıyordu; kullanıcı elle
  // girdiği tarihin altından kaydığını görüyordu. Sipariş ve In Store aynı
  // yılda olmak zorunda değil (2025-09 sipariş → 2026-02 depo).
  assert.doesNotMatch(APP, /syncInStoreYear/);
  const block = APP.slice(APP.indexOf("[data-em-month-wrap] [data-em-field]"), APP.indexOf("[data-em-month-wrap] [data-em-field]") + 600);
  assert.doesNotMatch(block, /InStoreMonth'\)/);
  // Kronoloji doğrulaması KALMALI: tutarsız tarih sessizce kabul edilmemeli.
  assert.match(block, /validateChronology/);
});

test('v6.01 toplu doldurma için açık eylem duruyor', () => {
  // Otomatik değişiklik kaldırıldı ama kullanıcı isterse ±1 yıl düğmeleriyle
  // dönemleri yine tek hamlede doldurabilir.
  assert.match(APP, /data-em-year-shift="forward"/);
  assert.match(APP, /data-em-year-shift="backward"/);
});

/* --------------------------------------------------- 2) ELLE FİYAT GİRİŞİ */

test('v6.01 iki hücrede de elle giriş düğmesi var', () => {
  const buttons = APP.match(/data-kol-manual="\$\{r\.id\}"/g) || [];
  assert.equal(buttons.length, 2, 'Best Price ve Conf. Manufacturer');
  // Conf. Manufacturer düğmesi onay kipini açmalı.
  assert.match(APP, /data-kol-manual-confirm="1"/);
  assert.match(CSS, /\.kolManualBtn\{/);
});

test('v6.01 elle giriş Fiyat Geçmişi çift tıklamasını tetiklemiyor', () => {
  const block = APP.slice(APP.indexOf("const btn=event.target.closest('[data-kol-manual]')"), APP.indexOf("tbody.querySelectorAll('.kolBestHistoryCell"));
  // Aynı hücrede çift tıklama Fiyat Geçmişi açıyor; düğme onu tetiklememeli.
  assert.match(block, /event\.preventDefault\(\);event\.stopPropagation\(\);/);
  assert.match(block, /openKolManualPriceModal\(row,\{confirm:btn\.dataset\.kolManualConfirm==='1'\}\)/);
});

test('v6.01 elle giriş türetilmiş hücreye yazmıyor, arkadaki kaydı kuruyor', () => {
  const block = APP.slice(APP.indexOf('function openKolManualPriceModal'), APP.indexOf('function kolBestPricing'));
  // Best Price fiyat haritasının en düşüğüdür; hücreye metin yazmak bir sonraki
  // hesapta ezilecek sahte bir değer üretirdi.
  assert.match(block, /row\.pricing\[mfr\]=kolFormatMoneyDisplay\(String\(price\)\)/);
  /* v6.34 — İDDİA TERSİNE ÇEVRİLDİ. Eski test recordRequest'in KOŞULSUZ
     çağrılmasını çiviliyordu; çivilenen davranışın kendisi hataydı: fiyat mevcut
     bir Quotations kaydından gelse bile kaynağa dokunulmadan İKİNCİ bir kayıt
     açılıyordu. Artık önce yerinde güncelleme denenir, yalnız eşleşen satır
     yoksa yeni kayıt açılır. Testin asıl niyeti (elle giriş arkada bir Quotations
     kaydına bağlanır) korunuyor. */
  assert.match(block, /api\.updateCollectionLine\(row\.id,mfr/);
  assert.match(block, /updated\?null:await \(api&&api\.recordRequest/);
  assert.match(block, /api\.recordRequest\('collection',\[row\],\[\{name:mfr/);
  // Onay kutusu işaretliyse onaylı üretici yazılmalı, işaretsizse KALDIRILMALI.
  assert.match(block, /if\(wantConfirmed\)row\.confirmedManufacturer=mfr;/);
  assert.match(block, /else if\(norm\(row\.confirmedManufacturer\)===norm\(mfr\)\)row\.confirmedManufacturer='';/);
  // Geri alınabilir olmalı.
  assert.match(block, /kolPushUndo\(\);/);
});

test('v6.01 elle giriş doğrulama yapıyor', () => {
  const block = APP.slice(APP.indexOf('function openKolManualPriceModal'), APP.indexOf('function kolBestPricing'));
  assert.match(block, /if\(!mfr\)\{status\.textContent=/);
  assert.match(block, /if\(!Number\.isFinite\(price\)\|\|price<=0\)/);
  // Üretici listede yoksa eklenmeli; yoksa Quotations kaydı boş üreticiyle açılır.
  assert.match(block, /if\(!known\)kolManufacturers\.push\(\{name:mfr,email:''\}\)/);
  // Quotations kaydı açılamazsa kullanıcı bunu bilmeli.
  assert.match(block, /Quotations kaydı açılamadı/);
});

test('elle fiyat üretici önerileri ASAS kataloğundan gelir', () => {
  const catalogBlock = APP.slice(APP.indexOf('const KOL_ASAS_CATALOG_KINDS'), APP.indexOf('function kolCatalogMatch'));
  assert.match(catalogBlock, /'manufacturer'/);
  const helperBlock = APP.slice(APP.indexOf('function kolManualManufacturerSuggestions'), APP.indexOf('function kolBestPricing'));
  assert.match(helperBlock, /kolCatalogValues\('manufacturer'\)/);
  assert.match(helperBlock, /kolManufacturers\|\|\[\]/);
  assert.match(helperBlock, /await ensureCollectionCatalogLoaded\(\{deferRender:true\}\)/);
  assert.match(helperBlock, /manualManufacturers\.map\(name=>/);
});

/* ------------------------------------------------------------ 3) DURUM */

test('v6.01 "Siparişe Hazır" canonical status kataloğunda doğru sırada kalır', () => {
  const opts=STATUS_CATALOG.seed().map(entry=>entry.name);
  assert.ok(opts.includes('Siparişe Hazır'));
  // v6.48: Capacity Request araya girdi; asıl iş akışı sırası korunur.
  assert.ok(opts.indexOf('Siparişe Hazır') > opts.indexOf('Fiyatlamada'));
  assert.ok(opts.indexOf('Siparişe Hazır') < opts.indexOf('Sipariş Onayda'));
  assert.equal(opts[opts.length - 1], 'İptal');
});

test('v6.01 built-in İngilizce label korunur ve Excel rengi canonical resolverdan gelir', () => {
  assert.match(APP, /'Siparişe Hazır':'Ready for Order',/);
  const entry=STATUS_CATALOG.find(STATUS_CATALOG.seed(),'Siparişe Hazır');
  assert.ok(entry);
  assert.match(entry.color,/^#[0-9A-F]{6}$/i);
  assert.equal(STATUS_CATALOG.toArgb(entry.color).length,8);
  assert.match(APP,/kolStatusExcelArgb/);
  assert.doesNotMatch(APP,/'Siparişe Hazır':'FFEAF6E4'/);
});

