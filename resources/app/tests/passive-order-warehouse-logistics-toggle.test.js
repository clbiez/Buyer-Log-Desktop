'use strict';
/* İki ayrı regresyonu birlikte korur:
   1) Siparişler tablosundaki lojistik açılır ok, yeniden çizimden sonra da doğru
      satırın detayını açıp kapatır (delegasyon + tablo bazlı açık satır kümesi).
   2) Pasif sipariş (ASAS Kalan Alım Sipariş Miktarı = 0) Backlog'da hiçbir
      seviyede "Üretimde" sınıfına girmez; canonical operasyon aşaması Depoda'dır. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const rules = require(path.join(ROOT, 'public', 'business-rules.js'));

function asas(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 10000,
    'Kalan Alım Sipariş Miktarı': 10000,
    'Antrepoya Giren Miktar': 0,
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 0,
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

function ov(extra = {}) {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [],
    ...extra,
  };
}

function parsed(asasRows, iasRows, overrides = ov()) {
  const orders = parse.parseASASRows(asasRows, overrides.antrepoMatchConfig).orders;
  const map = parse.parseAntrepoRows(iasRows, overrides.antrepoMatchConfig);
  return { orders, map, overrides };
}

const PASSIVE = { 'Kalan Alım Sipariş Miktarı': 0 };

test('Orders logistics toggle opens and closes the correct detail row after rerender', () => {
  const js = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

  // Açık satır kümesi tablo bazındadır: CP ve Siparişler ayrı _id uzayı kullanır.
  assert.match(js, /function cpLogisticExpandedSet\(tableKey\)\{ return tableKey==='orders'\?state\.ordersLogisticExpanded:state\.cpLogisticExpanded; \}/);
  // Hücre çizimi ve detay satırı aynı kümeyi okur.
  assert.match(js, /function cpLogisticStatusCellHtml\(row,tableKey='cp'\)/);
  assert.match(js, /const expanded=cpLogisticExpandedSet\(tableKey\)\.has\(row\._id\)/);
  assert.match(js, /function cpLogisticDetailRowHtml\(row,cols,withChk,tableKey='cp'\)\{\s*\n\s*if\(row&&row\._partialViewActive\)return '';\s*\n\s*if\(!cpLogisticExpandedSet\(tableKey\)\.has\(row\._id\)\) return '';/);
  // Tablo kimliği hücre çizim zincirinde taşınır.
  assert.match(js, /opts\.cellHtmlFn\(c,r,cf,tableKey\):cellHtml\(c,r,cf,tableKey\)/);
  assert.match(js, /function ordersCellHtml\(column,row,flags,tableKey='orders'\)/);

  // Dinleyici tabloya bir kez, delegasyonla bağlanır: tbody her yeniden çizimde
  // baştan oluştuğu için satır üzerindeki doğrudan dinleyiciler yaşamaz.
  const bindSource = js.slice(js.indexOf('function bindCpLogisticToggle('));
  assert.ok(bindSource, 'bindCpLogisticToggle tanımlı olmalı');
  assert.match(bindSource.slice(0, 900), /el\.dataset\.logisticToggleBound==='1'\)return;/);
  assert.match(bindSource.slice(0, 900), /const expanded=cpLogisticExpandedSet\(tableKey\);/);
  assert.match(js, /bindCpLogisticToggle\('cpTable','cp',\(\)=>renderCP\(\)\);/);
  assert.match(js, /bindCpLogisticToggle\('ordersTable','orders',\(\)=>renderOrders\(\)\);/);

  // Siparişler tablosu detay satırını CP ile aynı canonical render zincirinden
  // üretir ve açık satır varken sanallaştırmayı devre dışı bırakır.
  const ordersRender = js.slice(js.indexOf("renderFullTable('ordersTable','orders'"));
  assert.match(ordersRender.slice(0, 1200), /detailRowHtmlFn:\(r,cols,withChk\)=>cpLogisticDetailRowHtml\(r,cols,withChk,'orders'\), detailRowClass:'cpLogisticDetailRow'/);
  assert.match(ordersRender.slice(0, 1200), /hasExpandedRows:!partialViewEnabled\('orders'\)&&state\.ordersLogisticExpanded\.size>0/);

  // Detay satırı Siparişler tablosunda da görünür olmalı (CP'ye özel CSS değil).
  const css = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
  assert.match(css, /#cpTable tbody tr\.cpLogisticDetailRow,#ordersTable tbody tr\.cpLogisticDetailRow\{content-visibility:visible!important/);
  assert.match(css, /#cpTable tbody tr\.cpLogisticDetailRow>td,#ordersTable tbody tr\.cpLogisticDetailRow>td\{/);
});

test('Passive order is classified as warehouse/Depoda in Backlog, never production/Üretimde', () => {
  const { orders, map, overrides } = parsed([asas(PASSIVE)], []);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]._status, 'Depoda');
  assert.strictEqual(rules.operationalStageOf(rows[0]._status), 'IN_WAREHOUSE');
  assert.strictEqual(rules.isProductionStatus(rows[0]._status), false);
  assert.strictEqual(rows[0]._segmentKind, 'warehouse');
  assert.strictEqual(rows[0].qty, 10000);
  // Pasif bakiye üretim bakiyesi değildir; depo miktarı olarak sayılır.
  assert.strictEqual(rows[0].kalan, 0);
  assert.strictEqual(rows[0].antrepo, 10000);

  // Gruplanmış rapor: Depoda bucket'ında, Üretimde toplamında değil.
  const grouped = parse.buildBacklogGrouped(orders, map, overrides, { groupBy: ['status'] });
  const labels = grouped.tree.map(node => node.label);
  assert.deepStrictEqual(labels, ['Depoda']);
  assert.ok(!labels.includes('Üretimde'));
  assert.strictEqual(grouped.tree[0].qty, 10000);

  // Detay raporu (Backlog Excel ile aynı eşleme) aynı canonical status'u verir.
  const detail = parse.buildBacklogDetailRows(orders, map, overrides, {});
  assert.strictEqual(detail.length, 1);
  assert.strictEqual(detail[0]['GÜNCEL DURUM\n(STATUS)'], 'Depoda');
  assert.strictEqual(detail[0]['Kalan Alım Sipariş Miktarı'], 0);
  assert.strictEqual(detail[0]['Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo'], 10000);
});

test('Aktif üretim siparişi pasif kuralından etkilenmez', () => {
  const { orders, map, overrides } = parsed([asas()], []);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0]._status, 'Üretimde');
  assert.strictEqual(rows[0]._segmentKind, 'production');
  assert.strictEqual(rows[0].kalan, 10000);
});

test('Pasif siparişin gerçek IAS parsiyelleri korunur, yalnız sentetik bakiye Depoda olur', () => {
  const { orders, map, overrides } = parsed([asas(PASSIVE)], [
    ias({ 'Supplier Portal Statü': 'Yol Operasyonları', 'Yükleme Toplam Adet': 3000 }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.deepStrictEqual(rows.map(r => r._status), ['Depoda', 'Yol Operasyonları']);
  assert.deepStrictEqual(rows.map(r => r._segmentKind), ['warehouse', 'ias']);
  assert.deepStrictEqual(rows.map(r => r.qty), [7000, 3000]);
  assert.strictEqual(rows.reduce((sum, row) => sum + row.qty, 0), 10000);
});

test('Pasif siparişte Eksik Yükleme sınıflandırması bozulmaz', () => {
  // Bakiye toplamın %10undan küçük: canonical kural bunu üretim değil operasyonel
  // istisna (Eksik Yükleme) sayar ve pasiflik bu sınıflandırmayı değiştirmez.
  const { orders, map, overrides } = parsed([asas(PASSIVE)], [
    ias({ 'Supplier Portal Statü': 'Yol Operasyonları', 'Yükleme Toplam Adet': 9500 }),
  ]);
  const rows = parse.buildBacklogOperationalRows(orders, map, overrides);
  assert.strictEqual(rows[0]._status, parse.SHORTAGE_STATUS);
  assert.strictEqual(rows[0]._segmentKind, 'shortage');
  assert.strictEqual(rules.isProductionStatus(rows[0]._status), false);
});
