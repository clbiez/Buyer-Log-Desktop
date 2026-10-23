'use strict';

/* Fiyat Masası — üretici dönüş Excel'i içe aktarma planı (v2026-10-22).
   Plan saf bir eşleme adımıdır: satırlar gizli BL Key (rowId), PLM ID veya
   model kodu ile talepteki doğru üreticinin satırına eşlenir; aynı fiyat
   tekrar yazılmaz, eşleşmeyen satır raporlanır, üretici dosya adından
   bulunur. Önizleme onaylanmadan hiçbir fiyat yazılmaz (UI sözleşmesi). */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
// vm bağlamındaki diziler başka bir realm'dendir; karşılaştırma JSON üzerinden yapılır.
const plain = value => JSON.parse(JSON.stringify(value));

const ROOT = path.join(__dirname, '..');
const E = require(path.join(ROOT, 'public', 'pricing-desk-engine.js'));
const SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'pricing-desk.js'), 'utf8');

function loadDesk() {
  const window = { BLPricingDeskEngine: E };
  const document = { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const context = { window, document, BLStorage: { getItem: () => null, setItem() {} }, appLang: 'tr', console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(SOURCE, context, { filename: 'pricing-desk.js' });
  assert.ok(window.BLPricingDesk && window.BLPricingDesk._test, 'Fiyat Masası test yüzeyi yüklenmeli');
  return window.BLPricingDesk._test;
}

const request = () => ({
  id: 'q1',
  items: [
    { id: 'a1', rowId: 1, plmId: 'P10100', modelCode: 'KOL-101', manufacturer: 'Nova Knit', price: '9,80' },
    { id: 'b1', rowId: 1, plmId: 'P10100', modelCode: 'KOL-101', manufacturer: 'Ege Triko', price: '' },
    { id: 'a2', rowId: 2, plmId: 'P10200', modelCode: 'KOL-102', manufacturer: 'Nova Knit', price: '12,60' },
    { id: 'a3', rowId: 3, plmId: 'P10300', modelCode: 'KOL-103', manufacturer: 'Nova Knit', price: '' },
  ],
});

test('BL Key, PLM ID ve model kodu ile doğru üretici satırına eşler; aynı fiyatı atlar', () => {
  const { supplierWorkbookPlan } = loadDesk();
  const rows = [
    ['Fiyat Talebi — Nova Knit'],
    ['Model Name', 'PLM ID', 'Target Price', 'Quotation Price (USD)', 'BL Key'],
    ['KOL-101', 'P10100', '9,20', '9,45', '1'],
    ['', 'P10200', '11,50', '12,60', ''],
    ['KOL-103', '', '7,80', '7,65', ''],
    ['KOL-999', '', '', '5,00', ''],
    ['KOL-104', '', '', '', ''],
  ];
  const plan = supplierWorkbookPlan(request(), rows, 'Nova_Knit_returned.xlsx');
  assert.equal(plan.manufacturer, 'Nova Knit', 'üretici dosya adından bulunur');
  assert.deepEqual(plain(plan.changes.map(change => [change.line.id, change.before, change.value])), [['a1', 9.8, 9.45], ['a3', null, 7.65]]);
  assert.equal(plan.same, 1, 'değişmeyen fiyat yeniden yazılmaz');
  assert.deepEqual(plain(plan.unmatched), ['KOL-999']);
});

test('hedef fiyat sütunu teklif sanılmaz; fiyat sütunu yoksa açık hata verir', () => {
  const { supplierWorkbookPlan } = loadDesk();
  const noPrice = supplierWorkbookPlan(request(), [['Model Name', 'Target Price'], ['KOL-101', '9,20']], 'Nova Knit.xlsx');
  assert.match(noPrice.error, /fiyat sütunu/);
  const noHeader = supplierWorkbookPlan(request(), [['a', 'b'], ['1', '2']], 'x.xlsx');
  assert.match(noHeader.error, /model başlığı/);
});

test('birden çok üreticili talepte dosya adı eşleşmezse üretici seçimi zorunludur', () => {
  const { supplierWorkbookPlan } = loadDesk();
  const rows = [['Model Name', 'FOB'], ['KOL-101', '9,10']];
  const unknown = supplierWorkbookPlan(request(), rows, 'teklif.xlsx');
  assert.equal(unknown.manufacturer, '');
  assert.deepEqual(plain(unknown.changes), [], 'üretici bilinmeden hiçbir satıra fiyat önerilmez');
  const chosen = supplierWorkbookPlan(request(), rows, 'Ege Triko');
  assert.deepEqual(plain(chosen.changes.map(change => [change.line.id, change.value])), [['b1', 9.1]]);
});

test('Koleksiyon fiyat talebi Excel’i geri dönüş için gizli BL Key ve teklif sütunu taşır', () => {
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(app, /pricingReturnColumns/);
  assert.match(app, /'Quotation Price \(USD\)'/);
  assert.match(app, /'BL Key'/);
});

test('Türkçe başlıklar (Model Adı, Teklif Fiyatı, PLM ID) TR yerelinde de eşlenir', () => {
  const { supplierWorkbookPlan } = loadDesk();
  const rows = [['Model Adı', 'PLM ID', 'Teklif Fiyatı'], ['KOL-103', 'P10300', '7,70']];
  const plan = supplierWorkbookPlan(request(), rows, 'Nova Knit dönüş.xlsx');
  assert.deepEqual(plain(plan.changes.map(change => [change.line.id, change.value])), [['a3', 7.7]]);
});
