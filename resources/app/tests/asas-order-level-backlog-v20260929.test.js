'use strict';
// ASAS sipariş düzeyi (tek satır) değerlerin IAS parsiyel satırlarına doğru
// yansıması. Kullanıcı raporu: 1289816 siparişinde ASAS "Kalan Alım Sipariş
// Miktarı_Merkez Sevke Hazır Depo" = 465 iken Backlog parsiyel adetlerini
// (2928 / 5165) yazıyordu; "Kalan Alım Sipariş Miktarı" (465) hiç görünmüyordu,
// rapor penceresinden alınan Excel'de parsiyel ANTREPO GİRİŞ TARİHİ boştu ve
// CP'ye eklenen Database/Horizon sütunları ASAS'ta veri olmasına rağmen boştu.
const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');
const PlanActual = require('../server/lib/backlog-plan-actual');

function ov(extra = {}) {
  return {
    antrepoMatchConfig: parse.defaultAntrepoMatchConfig(),
    submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {},
    pricingRules: [], transitRules: [],
    ...extra,
  };
}
function asas(extra = {}) {
  return {
    'Sipariş Kod': 1289816, 'Model Adı': 'KK.BDY,GRINCH-1-NY', 'Renk Kod': 'HJY', 'Renk': 'RED',
    'Net Alım Sipariş Miktarı': 8558, 'Kalan Alım Sipariş Miktarı': 465, 'Antrepoya Giren Miktar': 8093,
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 465, 'FOB Fiyatı': 1.54,
    'Üretici': 'ERMODA UK LTD', 'Sezon': 'W6', 'Buyer Grup (TR)': 'LİSANS', 'Siparişin Üretildiği Ülke': 'HİNDİSTAN',
    'Orijinal Exfactory Merch Tarih': '20260512', 'Retail Depo Tarih Yıl Ay Gün': '20260817',
    'Model Bütçe Tarih Yıl Ay Gün': '20260831', 'Buying Son Onay Tarihi': '20260518',
    ...extra,
  };
}
function ias(extra = {}) {
  return {
    'Sipariş Kod': 1289816, 'Ürün Ad': 'KK.BDY,GRINCH-1-NY', 'Renk Kod': 'HJY', 'Renk Tanım': 'RED',
    'Supplier Portal Statü': 'Depoda', 'Tahmini Antrepo Giriş Tarihi': '2026-07-27',
    'HANDOVER Tarihi': '2026-05-27', 'Vasita Tanim': 'Gemi', 'Yükleme Toplam Adet': 2928,
    ...extra,
  };
}
function parsed(asasRows, iasRows, overrides = ov()) {
  return {
    orders: parse.parseASASRows(asasRows, overrides.antrepoMatchConfig).orders,
    map: parse.parseAntrepoRows(iasRows, overrides.antrepoMatchConfig),
    overrides,
  };
}
const sum = (rows, header) => rows.reduce((total, row) => total + (Number(row[header]) || 0), 0);
const KALAN = 'Kalan Alım Sipariş Miktarı';
const KALAN_MERKEZ = 'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo';

test('ASAS sipariş düzeyi kalan miktarları parsiyel adetine kopyalanmaz; toplam ASAS değerine eşittir', () => {
  const { orders, map, overrides } = parsed([asas()], [
    ias(),
    ias({ 'Yükleme Toplam Adet': 5165, 'Tahmini Antrepo Giriş Tarihi': '2026-09-03' }),
  ]);
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.deepEqual(rows.map(row => row.Adet), [465, 2928, 5165]);
  assert.deepEqual(rows.map(row => row[KALAN_MERKEZ]), [465, 0, 0]);
  assert.deepEqual(rows.map(row => row[KALAN]), [465, 0, 0]);
  assert.equal(sum(rows, KALAN_MERKEZ), 465);
  assert.equal(sum(rows, KALAN), 465);
  assert.deepEqual(rows.map(row => row['Net Alım Sipariş Miktarı']), [8558, 8558, 8558]);
});

test('ASAS kalan miktarı önce üretim, sonra yoldaki parsiyellere dağıtılır; filtre payı değiştirmez', () => {
  const { orders, map, overrides } = parsed([asas({
    'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 7000, 'Antrepoya Giren Miktar': 3000,
    'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 8000,
  })], [
    ias({ 'Yükleme Toplam Adet': 3000, 'Supplier Portal Statü': 'Depoda' }),
    ias({ 'Yükleme Toplam Adet': 4000, 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const rows = parse.buildBacklogTemplateRows(orders, map, overrides, {});
  assert.deepEqual(rows.map(row => row['GÜNCEL DURUM\n(STATUS)']), ['Üretimde', 'Retaile Aktarım Bekleniyor', 'Yol Operasyonları']);
  assert.deepEqual(rows.map(row => row[KALAN]), [3000, 0, 4000]);
  // 8000 = 3000 üretim + 4000 yol + 1000 henüz retaile aktarılmamış depo parsiyeli.
  assert.deepEqual(rows.map(row => row[KALAN_MERKEZ]), [3000, 1000, 4000]);
  const preview = parse.buildBacklogTemplateRows(orders, map, overrides, {}, [], { limit: 2 });
  assert.deepEqual(preview.map(row => row[KALAN_MERKEZ]), [3000, 1000]);
});

test('Rapor penceresi satırları Excel meta verisini taşır: parsiyel antrepo/handover/onay tarihleri boş kalmaz', () => {
  const { orders, map, overrides } = parsed([asas()], [
    ias(),
    ias({ 'Yükleme Toplam Adet': 5165, 'Tahmini Antrepo Giriş Tarihi': '2026-09-03' }),
  ]);
  const rows = parse.buildBacklogDetailRows(orders, map, overrides,
    { identities: [{ orderCode: 1289816, modelName: 'KK.BDY,GRINCH-1-NY', colourCode: 'HJY' }] },
    { includeInternalMeta: true });
  assert.equal(rows.length, 3);
  const partial = rows[1]._backlogExcel;
  assert.ok(partial, 'includeInternalMeta ile _backlogExcel korunmalı');
  assert.ok(partial.actualAntrepoDate instanceof Date);
  assert.ok(partial.handoverDate instanceof Date);
  assert.ok(partial.shipConfirmationDate instanceof Date);
  const plain = parse.buildBacklogDetailRows(orders, map, overrides,
    { identities: [{ orderCode: 1289816, modelName: 'KK.BDY,GRINCH-1-NY', colourCode: 'HJY' }] });
  assert.equal(plain[1]._backlogExcel, undefined);
});

test('Database/Horizon sütunu ASAS siparişini boş + dolu satıra bölerse değer ve miktarlar kaybolmaz', () => {
  const { orders } = parsed([
    asas({ '__CPX_insp': '', 'Net Alım Sipariş Miktarı': 3000, 'Kalan Alım Sipariş Miktarı': 100,
      'Antrepoya Giren Miktar': 2900, 'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 100 }),
    asas({ '__CPX_insp': '10.07.2026', 'Net Alım Sipariş Miktarı': 5558, 'Kalan Alım Sipariş Miktarı': 365,
      'Antrepoya Giren Miktar': 5193, 'Kalan Alım Sipariş Miktarı_Merkez Sevke Hazır Depo': 365 }),
  ], []);
  assert.equal(orders.length, 1);
  const order = orders[0];
  assert.equal(order._cpExtra.__CPX_insp, '10.07.2026');
  assert.equal(order.qty, 8558);
  assert.equal(order.kalan, 465);
  assert.equal(order.antrepo, 8093);
  assert.equal(order.merkezSevkeHazirKalan, 465);
  const cp = parse.buildCPRowsFromASAS(orders, parse.parseAntrepoRows([], ov().antrepoMatchConfig), ov());
  assert.equal(cp[0].__CPX_insp, '10.07.2026');
});

test('Aynı miktarı tekrar eden satırlar toplanmaz; yalnız boş Database değeri doldurulur', () => {
  const { orders } = parsed([
    asas({ '__CPX_insp': '' }),
    asas({ '__CPX_insp': '10.07.2026' }),
  ], []);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].qty, 8558);
  assert.equal(orders[0]._cpExtra.__CPX_insp, '10.07.2026');
});

test('CP ana satırı Üretimde bakiyesiyken IAS Database sütunu parsiyeldeki değeri gösterir', () => {
  const { orders, map, overrides } = parsed([asas({ 'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 7000 })], [
    ias({ 'Yükleme Toplam Adet': 3000, 'Supplier Portal Statü': 'Yol Operasyonları', '__CPX_tamir': 12 }),
  ]);
  const cp = parse.buildCPRowsFromASAS(orders, map, overrides);
  assert.equal(cp[0].STATUS, 'Üretimde');
  assert.equal(cp[0].__CPX_tamir, 12);
});

test('Planlanan & Gerçekleşen kalan miktarı dağıtılmış ASAS paylarının toplamıdır', () => {
  const base = {
    'Sipariş Kod': '1001', 'Model Adı': 'M', 'Renk Kod': '01', 'Net Alım Sipariş Miktarı': 10000,
    'GÜNCEL DURUM\n(STATUS)': 'Üretimde', _backlogExcel: {},
  };
  const snapshot = PlanActual.projectSnapshot(
    [{ ocode: '1001', model: 'M', ccode: '01', qty: 10000, kalan: 7000 }],
    [{ ...base, Adet: 3000, [KALAN]: 3000 }, { ...base, Adet: 4000, [KALAN]: 4000 }, { ...base, Adet: 3000, [KALAN]: 0 }],
    { capturedAt: '2026-09-29T07:00:00.000Z' });
  assert.equal(snapshot.rows[0].remainingQty, 7000);
});
