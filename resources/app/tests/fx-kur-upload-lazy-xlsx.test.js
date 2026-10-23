'use strict';

// Regression: Kur Tahmin Raporu (KUR.xlsx) tarayıcıdan yüklenirken BLFX.importFile
// global XLSX'i doğrudan kullanıyordu. XLSX kütüphanesi perf-runtime ile tembel
// yüklendiği için oturumda başka bir Excel akışı açılmadıysa yükleme
// "XLSX is not defined" hatasıyla düşüyor, kurlar okunmuyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('xlsx');

const ROOT = path.join(__dirname, '..');
const fxSource = fs.readFileSync(path.join(ROOT, 'public/fx.js'), 'utf8');
const engineSource = fs.readFileSync(path.join(ROOT, 'public/fx-calculation-engine.js'), 'utf8');
const datesSource = fs.readFileSync(path.join(ROOT, 'public/excel-date-utils.js'), 'utf8');
const vendorXlsxSource = fs.readFileSync(path.join(ROOT, 'public/vendor/xlsx-style.js'), 'utf8');

// Güncel KUR raporunun düzeni: başlık, birleşik "Aylık Ortalama" satırı,
// ay sonu tarih başlıkları, işaret satırı, boş ayraç satırları, B'de kod.
function kurWorkbookBuffer() {
  const d = (y, m) => new Date(Date.UTC(y, m, 0));
  const rows = [
    ['KUR TAHMİN RAPORU  (EKİM 2026)\n(1 USD = X Ülke Parası)'], // i18n-ignore
    [], [],
    ['Ülke', 'Para\nBirimi', '  Aylık Ortalama Kur Tahminleri'], // i18n-ignore
    [null, null, d(2026, 10), d(2026, 11), d(2026, 12), d(2027, 1)],
    [null, null, null, null, 'o'],
    ['Türkiye', 'TRY', 49.35, 50.24, 51.15, 51.96], // i18n-ignore
    [],
    ['Euro zone', 'EUR', 0.8762, 0.8712, 0.8663, 0.8638],
    ['China', 'CNY', 6.70, 6.69, 6.69, 6.68],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  ws['!merges'] = [{ s: { r: 3, c: 2 }, e: { r: 3, c: 5 } }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ekim 2026');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function fxContext() {
  const loaded = [];
  const context = {
    console,
    crypto: require('node:crypto').webcrypto,
    window: null,
    BLStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {},
    BLPerf: {
      // perf-runtime'daki 'xlsx' kaydının aynısı: tarayıcı paketi + tarih kancaları.
      async ensureLibrary(name) {
        loaded.push(name);
        if (name !== 'xlsx') return;
        vm.runInContext(vendorXlsxSource, context);
        vm.runInContext('BLExcelDates.installSheetJsHooks(XLSX)', context);
      },
    },
  };
  context.window = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(datesSource, context);
  vm.runInContext(engineSource, context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public/fx-import-engine.js'), 'utf8'), context);
  vm.runInContext(fxSource, context);
  return { context, loaded };
}

// File.arrayBuffer() tarayıcı realm'ında ArrayBuffer döndürür; vm bağlamında da öyle olmalı.
function fileFrom(context, buffer, name) {
  return {
    name,
    async arrayBuffer() { return new (vm.runInContext('Uint8Array', context))(buffer).buffer; },
  };
}

test('KUR upload loads the lazy XLSX library before parsing', async () => {
  const { context, loaded } = fxContext();
  assert.equal(vm.runInContext('typeof XLSX', context), 'undefined', 'XLSX must start unloaded, as in a fresh session');
  const parsed = await context.BLFX.importFile(fileFrom(context, kurWorkbookBuffer(), 'KUR.xlsx'));
  assert.ok(loaded.includes('xlsx'));
  assert.equal(parsed.stats.currencyCount, 3);
  assert.equal(parsed.stats.monthCount, 4);
  assert.equal(parsed.stats.firstMonth, '2026-10');
  assert.equal(parsed.stats.lastMonth, '2027-01');
  assert.equal(parsed.data.months['2026-10'].TRY, 49.35);
  assert.equal(parsed.data.months['2027-01'].EUR, 0.8638);
});

test('KUR upload accepts a currency code moved to column A and text month headers', async () => {
  const { context } = fxContext();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Kur', null, '2026-10', '2026-11'],
    ['TRY', 'Türkiye', '49,35', '50,24'], // i18n-ignore
    ['EUR', 'Euro zone', .9, .91],
    ['GBP', 'Pound', .8, .81],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const parsed = await context.BLFX.importFile(fileFrom(context, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }), 'KUR.xlsx'));
  assert.equal(parsed.data.months['2026-10'].TRY, 49.35);
  assert.equal(parsed.data.months['2026-11'].TRY, 50.24);
});

test('KUR upload explains a missing Excel library in both languages', async () => {
  const { context } = fxContext();
  context.BLPerf.ensureLibrary = async () => {};
  await assert.rejects(context.BLFX.importFile(fileFrom(context, kurWorkbookBuffer(), 'KUR.xlsx')), /Excel/);
  context.appLang = 'en';
  await assert.rejects(context.BLFX.importFile(fileFrom(context, kurWorkbookBuffer(), 'KUR.xlsx')), /Excel library could not be loaded/);
});

// Regression: fx.js yalnız deferredUi zincirinin SONUNDAYDI. Zincir bitmeden ya
// da önceki bir dosya düşünce Ön Maliyet › Kur Güncelle "BLFX is not defined",
// Veri Yönetimi › Kur yüklemesi "Kur modülü yüklenmedi." hatası veriyordu.
test('FX upload paths load fx.js on demand instead of waiting for deferredUi', () => {
  const perf = fs.readFileSync(path.join(ROOT, 'public/perf-runtime.js'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
  const openCosting = perf.match(/openCosting:\[([^\]]*)\]/)[1];
  assert.ok(openCosting.indexOf("'fx.js'") >= 0 && openCosting.indexOf("'fx.js'") < openCosting.indexOf("'open-costing.js'"));
  assert.match(perf, /\bfx:\['fx-calculation-engine\.js','fx-import-engine\.js','fx\.js'\]/);
  assert.match(perf, /name==='openCosting'&&typeof global\.initOpenCosting==='function'&&global\.BLFX\)return;/);
  const handler = app.slice(app.indexOf("getElementById('sourceFxFile')?.addEventListener"));
  assert.ok(handler.indexOf("ensureFeature('fx')") > 0 && handler.indexOf("ensureFeature('fx')") < handler.indexOf('BLFX.importFile'));
});

test('browser and server read the same synthetic merged-header workbook with identical months', async () => {
  const buffer = kurWorkbookBuffer();
  const { context } = fxContext();
  const browser = await context.BLFX.importFile(fileFrom(context, buffer, 'KUR.xlsx'));
  const server = require('../server/lib/fxWorkbook').parseFxWorkbook(XLSX.read(buffer, { type: 'buffer', cellDates: true }), 'KUR.xlsx');
  assert.deepEqual(JSON.parse(JSON.stringify(browser.data.months)), server.data.months);
  assert.equal(browser.data.reportMonth, server.data.reportMonth);
  assert.equal(browser.data.parser, 'deterministic');
  assert.match(browser.data.sourceFingerprint, /^[a-f0-9]{64}$/);
});

test('a preview saves with its captured revision even if the live store has advanced', async () => {
  const { context } = fxContext();
  let ifMatch;
  context.fetch = async (_url, options) => {
    ifMatch = options.headers['If-Match'];
    return { ok: true, json: async () => ({ ...JSON.parse(options.body), _revision: 4 }) };
  };
  context.BLFX.store._revision = 3;
  await context.BLFX.save({ months: { '2026-11': { TRY: 50 } } }, { expectedRevision: 2 });
  assert.equal(ifMatch, '2');
});
