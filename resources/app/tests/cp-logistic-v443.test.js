'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));

// Yerel gece yarısına ayarlı bir Date'te toISOString() UTC'ye çevirir; UTC+X saat
// dilimlerinde bu bir gün geriye kayar (2 Ocak → "2026-01-01"). Takvim gününü
// doğrudan yerel bileşenlerden okuyoruz ki iddia saat diliminden bağımsız olsun.
function calendarDay(value) {
  const p = n => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
}


function asas(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 10000,
    'Kalan Alım Sipariş Miktarı': 3000,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Buyer Grup (TR)': 'BG',
    'Siparişin Üretildiği Ülke': 'CIN',
    'Orijinal Exfactory Merch Tarih': '2026-01-01',
    'Retail Depo Tarih Yıl Ay Gün': '2026-06-01',
    'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15',
    ...overrides,
  };
}

function ias(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Ürün Ad': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk Tanım': 'SİYAH',
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-03-01',
    'HANDOVER Tarihi': '2026-02-20',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': 3000,
    'Net Alım Sipariş Miktarı': 10000,
    ...overrides,
  };
}

function overrides(extra = {}) {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [],
    ...extra,
  };
}

function build(asasRows, iasRows, ov = overrides()) {
  const orders = parse.parseASASRows(asasRows, ov.antrepoMatchConfig).orders;
  const map = parse.parseAntrepoRows(iasRows, ov.antrepoMatchConfig);
  return parse.buildCPRowsFromASAS(orders, map, ov);
}

test('v4.49 CP siparişi tek satırda tutar; üretim bakiyesi ile parsiyelleri öncelik sırasına dizer', () => {
  const rows = build([asas()], [
    ias({
      'Supplier Portal Statü': 'Depoda',
      'Yükleme Toplam Adet': 3000,
      'Tahmini Antrepo Giriş Tarihi': '2026-03-01',
      'Vasita Tanim': 'Gemi',
    }),
    ias({
      'Supplier Portal Statü': 'Yol Operasyonları',
      'Yükleme Toplam Adet': 4000,
      'Tahmini Antrepo Giriş Tarihi': '2026-03-20',
      'Vasita Tanim': 'Tır',
    }),
  ]);

  assert.strictEqual(rows.length, 1, 'CP ana tablosunda sipariş çoğalmamalı');
  const cp = rows[0];
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.priority), [1, 2, 3]);
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.quantity), [3000, 4000, 3000]);
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.status), [
    'Üretimde', 'Yol Operasyonları', 'Depoda',
  ]);
  assert.strictEqual(cp.STATUS, 'Üretimde', 'ana lojistik detayı önce üretim bakiyesini göstermeli');
  assert.strictEqual(cp['Del. Type'], 'Gemi');
  assert.strictEqual(cp._logisticLoadedQty, 7000);
  assert.strictEqual(cp._logisticProductionQty, 3000);
  assert.strictEqual(cp._logisticPartialCount, 2);
});


test('v4.50 CP Logistic 700lük parsiyelin yanında ASAS kaynaklı 1300 Üretimde bakiyesini gösterir', () => {
  const rows = build([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [ias({
    'Net Alım Sipariş Miktarı': 9999,
    'Yükleme Toplam Adet': 700,
    'Supplier Portal Statü': 'Yol Operasyonları',
  })]);

  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0]._logisticSegments.map(item => [item.quantity, item.status]), [
    [1300, 'Üretimde'],
    [700, 'Yol Operasyonları'],
  ]);
  assert.strictEqual(rows[0]._logisticProductionQty, 1300);
  assert.strictEqual(rows[0]._logisticLoadedQty, 700);
});

test('v4.48 CP Logistic merkez sevke hazır depo bakiyesi yüzde 5i aşan Depoda parsiyelini Retaile Aktarım Bekleniyor gösterir', () => {
  const rows = build([asas({
    'Net Alım Sipariş Miktarı': 10000,
    // Aktif sipariş (Kalan 1); retaile aktarım bekleyen = 502 − 1 = 501 > %5.
    'Kalan Alım Sipariş Miktarı': 1,
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 502,
  })], [ias({
    'Supplier Portal Statü': 'Depoda',
    'Yükleme Toplam Adet': 10000,
  })]);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].STATUS, 'Retaile Aktarım Bekleniyor');
  assert.deepStrictEqual(rows[0]._logisticSegments.map(item => item.status), ['Retaile Aktarım Bekleniyor']);
  assert.deepStrictEqual(rows[0]._logisticSegments.map(item => item.priority), [3]);
});

test('v4.43 üretim bakiyesi yoksa depo öncesi parsiyel depo parsiyelinden önce gösterilir', () => {
  const rows = build([asas({
    'Net Alım Sipariş Miktarı': 5000,
    'Kalan Alım Sipariş Miktarı': 100,
  })], [
    ias({
      'Supplier Portal Statü': 'Depoda',
      'Yükleme Toplam Adet': 2500,
      'Net Alım Sipariş Miktarı': 5000,
      'Tahmini Antrepo Giriş Tarihi': '2026-03-01',
      'Vasita Tanim': 'Gemi',
    }),
    ias({
      'Supplier Portal Statü': 'Yükleme Operasyonları',
      'Yükleme Toplam Adet': 2500,
      'Net Alım Sipariş Miktarı': 5000,
      'Tahmini Antrepo Giriş Tarihi': '2026-02-15',
      'HANDOVER Tarihi': '2026-02-10',
      'Vasita Tanim': 'Uçak',
    }),
  ]);

  const cp = rows[0];
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.priority), [2, 3]);
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.status), ['Yükleme Operasyonları', 'Depoda']);
  assert.strictEqual(cp.STATUS, 'Yükleme Operasyonları');
  assert.strictEqual(cp['Del. Type'], 'Uçak');
  assert.strictEqual(calendarDay(cp['Ant. Arrival']), '2026-02-15');
  assert.strictEqual(calendarDay(cp['HANDOVER Tarihi']), '2026-02-10');
});

test('v4.43 aynı statüdeki IAS parsiyellerini birleştirmeden ayrı detaylar olarak korur', () => {
  const rows = build([asas({
    'Net Alım Sipariş Miktarı': 5000,
    'Kalan Alım Sipariş Miktarı': 100,
  })], [
    ias({ 'Yükleme Toplam Adet': 2000, 'Net Alım Sipariş Miktarı': 5000, 'Tahmini Antrepo Giriş Tarihi': '2026-03-01' }),
    ias({ 'Yükleme Toplam Adet': 3000, 'Net Alım Sipariş Miktarı': 5000, 'Tahmini Antrepo Giriş Tarihi': '2026-03-08', 'Vasita Tanim': 'Tır' }),
  ]);

  const segments = rows[0]._logisticSegments;
  assert.strictEqual(segments.length, 2);
  assert.deepStrictEqual(segments.map(item => item.quantity), [2000, 3000]);
  assert.deepStrictEqual(segments.map(item => calendarDay(item.arrival)), ['2026-03-01', '2026-03-08']);
  assert.deepStrictEqual(segments.map(item => item.delType), ['Gemi', 'Tır']);
});

test('v4.43 CP arayüzünde açılır parsiyel detay yapısı ve üç öncelik açıklaması bulunur', () => {
  const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
  const css = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
  assert.match(html, /cpLogisticToggle/);
  assert.match(html, /cpLogisticDetailRowHtml/);
  assert.match(html, /Production \/ Shortage'.*Pre-warehouse'.*Warehouse/s);
  assert.match(css, /\.cpLogistic/);
  assert.match(css, /priority-1/);
  assert.match(css, /priority-2/);
  assert.match(css, /priority-3/);
});


test('v4.51 CP Remaining ASAS Net miktarından Antrepo parsiyel toplamını çıkarır', () => {
  const rows = build([asas({ 'Net Alım Sipariş Miktarı': 2000, 'Kalan Alım Sipariş Miktarı': 999 })], [
    ias({ 'Yükleme Toplam Adet': 700, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  assert.strictEqual(rows[0]['Remaining Units'], 1300);
  assert.strictEqual(rows[0]._logisticRemainingQty, 1300);
  assert.strictEqual(rows[0]['%'], 0.35);
});

test('v6.61 CP eksik yükleme operational signalını legacy Priority etiketi olarak taşımaz', () => {
  const rows = build([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 1800, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const cp=rows[0];
  assert.strictEqual(cp.STATUS, 'Yol Operasyonları');
  assert.ok(['CRITICAL','ACTION_TODAY','ACTION_THIS_WEEK','WATCH','ON_TRACK'].includes(cp.Priority));
  assert.doesNotMatch(String(cp.Priority), /Handover|Delay|Shortage|Discount|In Time/);
  assert.strictEqual(cp._logisticAllPartialsInWarehouse, false);
  assert.strictEqual(cp['Remaining Units'], 200);
  assert.strictEqual(cp._logisticProductionQty, 0);
  assert.strictEqual(cp._logisticShortageQty, 200);
  assert.deepStrictEqual(cp._logisticSegments.map(item=>[item.kind,item.quantity,item.status]), [
    ['shortage',200,'Eksik Yükleme'], ['partial',1800,'Yol Operasyonları'],
  ]);
});

test('v4.51 CP İngilizce görünümünde Eksik Yükleme Shortage olarak çevrilir', () => {
  const html=(fs.readFileSync(path.join(ROOT,'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT,'public', 'app-main.js'), 'utf8'));
  assert.match(html,/return 'Shortage'/);
  assert.match(html,/Eksik Yükleme/);
});

test('v4.64 CP Shortage operational hesabı Ex-Factory tarihinde yüklenmiş kabul eder', () => {
  const row = {
    'Ex-factory': new Date(2026, 0, 1),
    'Retail Date': new Date(2026, 2, 25),
    'In-Store (Model Budget)': new Date(2026, 3, 20),
    'Ant. Arrival': new Date(2026, 2, 12),
    'HANDOVER Tarihi': null,
    'Buying Son Onay Tarihi': null,
    STATUS: 'Eksik Yükleme',
    'Del. Type': 'Gemi',
    Season: 'W6',
    Country: 'China',
  };
  const shortage = parse.computeFlags(row, [], new Date(2026, 1, 20));
  assert.equal(shortage.shortage, true);
  assert.equal(shortage.isDelay, false);
  assert.equal(shortage.discountWarning, false);
  assert.equal(Object.prototype.hasOwnProperty.call(shortage,'priority'), false);
});

test('v4.77 CP tüm parsiyeller Depoda ise Status kalır ve Priority unified Action Priority olur', () => {
  const rows = build([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 900, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 900, 'Supplier Portal Statü': 'Depoda' }),
  ]);
  const cp = rows[0];
  assert.strictEqual(cp.STATUS, 'Depoda');
  assert.ok(['CRITICAL','ACTION_TODAY','ACTION_THIS_WEEK','WATCH','ON_TRACK'].includes(cp.Priority), `unexpected unified Priority: ${cp.Priority}`);
  assert.doesNotMatch(String(cp.Priority), /Handover|Delay|Shortage|Discount|In Time/);
  assert.strictEqual(cp._logisticAllPartialsInWarehouse, true);
  assert.strictEqual(cp._logisticShortageQty, 200);
  assert.deepStrictEqual(cp._logisticSegments.map(item => [item.kind, item.quantity, item.status]), [
    ['shortage', 200, 'Depoda - Eksik Yükleme'],
    ['partial', 900, 'Depoda'],
    ['partial', 900, 'Depoda'],
  ]);
});

test('v4.64 CP İngilizce görünümünde Depoda - Eksik Yükleme In Warehouse - Shortage olarak gösterilir', () => {
  const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
  assert.match(html, /In Warehouse - Shortage/);
  assert.match(html, /isWarehouseShortageStatus/);
});



test('v6.61 birden fazla parsiyelin durumları farklıysa Status filtresi tüm farklı durumları taşır', () => {
  const rows = build([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 1000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 1000, 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2026-03-10' }),
  ]);
  const cp = rows[0];
  assert.deepStrictEqual(new Set(cp._logisticStatusValues), new Set(['Depoda','Yol Operasyonları']));
  assert.strictEqual(cp._logisticAllPartialsInWarehouse, false);
});

test('v6.61 tüm parsiyellerin durumu aynıysa Status değeri tekilleştirilir', () => {
  const rows = build([asas({ 'Net Alım Sipariş Miktarı': 2000 })], [
    ias({ 'Yükleme Toplam Adet': 1000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 1000, 'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-03-10' }),
  ]);
  assert.deepStrictEqual(rows[0]._logisticStatusValues, ['Depoda']);
  assert.strictEqual(rows[0]._logisticAllPartialsInWarehouse, true);
});

test('v6.61 CP/Orders Status hücresi parsiyel detaylarında çoklu durum özetini kullanır', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(js, /case 'status': return r&&r\._partialViewActive \? partialViewStatusCellHtml\(r\) : cpLogisticHasDetails\(r\) \? cpLogisticStatusCellHtml\(r,tableKey\)/);
  assert.match(js, /const partials=all\.filter\(segment=>segment&&segment\.kind==='partial'\)/);
});

test('v6.61 ana tablolar ve Collection sütun başlıklarında Excel-benzeri sağ-tık gizle/göster menüsü bulunur', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
  assert.match(js, /function openColumnVisibilityMenu\(/);
  assert.match(js, /Sütunu gizle/);
  assert.match(js, /Tüm sütunları göster/);
  assert.match(js, /th\.addEventListener\('contextmenu',e=>openManagedTableColumnMenu/);
  assert.match(js, /th\.addEventListener\('contextmenu',event=>\{[\s\S]*?kolHiddenCols/s);
});
