'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

function asas(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk': 'SİYAH',
    'Net Alım Sipariş Miktarı': 100,
    'Kalan Alım Sipariş Miktarı': 100,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Orijinal Exfactory Merch Tarih': '2026-09-01',
    'Retail Depo Tarih Yıl Ay Gün': '2026-10-15',
    ...overrides,
  };
}

function ias(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Ürün Adı': 'MODEL-1',
    'Renk Kod': 'C01',
    'Renk Tanım': 'SİYAH',
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
    'HANDOVER Tarihi': '2026-09-05',
    'Vasita Tanim': 'Gemi',
    'Yükleme Toplam Adet': 50,
    '__CPX_IAS Not': 'eski satır',
    ...overrides,
  };
}

const config = {
  conditions: [
    { id: 'order', asas: { header: 'Sipariş Kod' }, ias: { header: 'Sipariş Kod' } },
    { id: 'model', asas: { header: 'Model Adı' }, ias: { header: 'Model Adı' } },
    { id: 'ccode', asas: { header: 'Renk Kod' }, ias: { header: 'Renk Kod' } },
  ],
};

test('v4.40 aynı anahtardaki IAS satırlarını birleştirmez; en yeni antrepo tarihli satırı bütünüyle seçer', () => {
  const orders = parse.parseASASRows([asas()], config).orders;
  const map = parse.parseAntrepoRows([
    ias({
      'Supplier Portal Statü': 'Depoda',
      'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
      'HANDOVER Tarihi': '2026-09-05',
      'Vasita Tanim': 'Gemi',
      '__CPX_IAS Not': 'eski satır',
    }),
    ias({
      'Supplier Portal Statü': '',
      'Tahmini Antrepo Giriş Tarihi': '2026-09-20',
      'HANDOVER Tarihi': '',
      'Vasita Tanim': '',
      '__CPX_IAS Not': 'yeni satır',
    }),
  ], config);

  const hit = parse.findAntrepoHit(map, orders[0], { config });
  assert.ok(hit);
  assert.strictEqual(hit.arr.getDate(), 20);
  assert.strictEqual(hit.statu, '', 'eski satırın statüsü yeni satıra taşınmamalı');
  assert.strictEqual(hit.handover, null, 'eski satırın handover tarihi yeni satıra taşınmamalı');
  assert.strictEqual(hit.vasita, '', 'eski satırın araç tipi yeni satıra taşınmamalı');
  assert.strictEqual(hit._cpExtra['__CPX_IAS Not'], 'yeni satır');
});

test('v4.43 CP lojistik özeti üretim bakiyesi yoksa depo öncesi parsiyeli ana detay yapar', () => {
  const orders = parse.parseASASRows([asas({ 'Kalan Alım Sipariş Miktarı': 5 })], config).orders;
  const map = parse.parseAntrepoRows([
    ias({
      'Supplier Portal Statü': 'Depoda',
      'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
      'HANDOVER Tarihi': '2026-09-05',
      'Vasita Tanim': 'Gemi',
    }),
    ias({
      'Supplier Portal Statü': 'Yol Operasyonları',
      'Tahmini Antrepo Giriş Tarihi': '2026-09-20',
      'HANDOVER Tarihi': '2026-09-18',
      'Vasita Tanim': 'Uçak',
    }),
  ], config);

  const cp = parse.buildCPRowsFromASAS(orders, map, {
    antrepoMatchConfig: config,
    licensormap: {}, submap: {}, suppfobmap: {}, suppfobmetamap: {},
    delmap: {}, notesmap: {}, pricingRules: [], transitRules: [],
  })[0];

  assert.strictEqual(cp.STATUS, 'Yol Operasyonları');
  assert.strictEqual(cp['Ant. Arrival'].getDate(), 20);
  assert.strictEqual(cp['HANDOVER Tarihi'].getDate(), 18);
  assert.strictEqual(cp['Del. Type'], 'Uçak');
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.status), ['Yol Operasyonları', 'Depoda']);
  assert.deepStrictEqual(cp._logisticSegments.map(item => item.quantity), [50, 50]);
});

test('v4.40 eşit antrepo tarihlerinde kaynakta daha sonra gelen IAS satırını bütünüyle seçer', () => {
  const orders = parse.parseASASRows([asas()], config).orders;
  const map = parse.parseAntrepoRows([
    ias({ 'Supplier Portal Statü': 'Depoda', 'Vasita Tanim': 'Gemi' }),
    ias({ 'Supplier Portal Statü': 'Yol Operasyonları', 'Vasita Tanim': 'Uçak' }),
  ], config);
  const hit = parse.findAntrepoHit(map, orders[0], { config });
  assert.strictEqual(hit.statu, 'Yol Operasyonları');
  assert.strictEqual(hit.vasita, 'Uçak');
});
