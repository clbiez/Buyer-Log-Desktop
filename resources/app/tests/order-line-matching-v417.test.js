'use strict';
/*
 * v4.17 — sipariş eşleşmesi: Sipariş Kodu + Model Adı + Renk Kodu.
 *
 * Bir sipariş kodunun altında AYNI renk koduna sahip birden fazla model olabiliyor.
 * Eski kural (sipariş kodu + renk tanımı) bu durumda yanlış satırın Antrepo ve
 * kumaş bilgisini getiriyordu.
 *
 * v4.37 ile kademeli düşüş tamamen kaldırıldı. Model/Ürün Adı veya Renk Kod eksikse
 * IAS satırı reddedilir; yalnız üçlü kimlik birebir eşleşir.
 */
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));

function antrepoRow(fields) {
  return Object.assign({
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-09-01',
  }, fields);
}

// ---------------------------------------------------------------------------
// Anahtar
// ---------------------------------------------------------------------------

test('satır anahtarı üç parçadan oluşur ve normalize edilir', () => {
  assert.strictEqual(parse.orderLineKey('1234567', 'Kazak A', 'blk'), '1234567|KAZAK A|BLK');
  assert.strictEqual(parse.orderLineKey('1.234.567', ' Kazak A ', 'BLK'), '1234567|KAZAK A|BLK');
  assert.strictEqual(
    parse.orderLineKeyOf({ ocode: 1234567, model: 'Kazak A', ccode: 'BLK' }),
    parse.rowLineKey({ 'Order Code': 1234567, 'Model Name': 'Kazak A', 'C.Code': 'BLK' }));
});

// ---------------------------------------------------------------------------
// Antrepo (IAS)
// ---------------------------------------------------------------------------

test('aynı sipariş ve aynı renk kodundaki iki model ayrı eşleşir', () => {
  const map = parse.parseAntrepoRows([
    antrepoRow({ 'Sipariş Kod': '1234567', 'Model Adı': 'KAZAK A', 'Renk Kod': 'BLK', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Yol Operasyonları' }),
    antrepoRow({ 'Sipariş Kod': '1234567', 'Model Adı': 'KAZAK B', 'Renk Kod': 'BLK', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Depoda' }),
  ]);
  const rule = { rule: 'order+model+ccode' };
  const a = parse.findAntrepoHit(map, { ocode: 1234567, model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH' }, rule);
  const b = parse.findAntrepoHit(map, { ocode: 1234567, model: 'KAZAK B', ccode: 'BLK', colour: 'SIYAH' }, rule);
  assert.strictEqual(a.statu, 'Yol Operasyonları');
  assert.strictEqual(b.statu, 'Depoda');
  assert.strictEqual(a._matchLevel, 'line');
  assert.strictEqual(b._matchLevel, 'line');
});

test('eski kural bu durumda yanlış satırı getiriyordu — artık getirmiyor', () => {
  // Renk tanımı ikisinde de aynı; ayırt eden tek şey model adı.
  const map = parse.parseAntrepoRows([
    antrepoRow({ 'Sipariş Kod': '1234567', 'Model Adı': 'KAZAK A', 'Renk Kod': 'BLK', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Yol Operasyonları' }),
    antrepoRow({ 'Sipariş Kod': '1234567', 'Model Adı': 'KAZAK B', 'Renk Kod': 'BLK', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Depoda' }),
  ]);
  assert.strictEqual(Object.keys(map).length, 2, 'iki ayrı kayıt olmalı, tek birleşmiş kayıt değil');
});

test('IAS tarafında model/renk kodu yoksa satır reddedilir', () => {
  const map = parse.parseAntrepoRows([
    antrepoRow({ 'Sipariş Kod': '1234567', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Yol Operasyonları' }),
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.ok, false);
  assert.strictEqual(Object.keys(map).length, 0);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 1234567, model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH' }, { rule: 'auto' }), null);
});

test('model bir tarafta yoksa renk kodu düzeyine düşülmez', () => {
  const map = parse.parseAntrepoRows([
    antrepoRow({ 'Sipariş Kod': '1234567', 'Renk Kod': 'BLK', 'Renk Tanım': 'SIYAH', 'Supplier Portal Statü': 'Depoda' }),
  ]);
  assert.strictEqual(Object.keys(map).length, 0);
  assert.strictEqual(parse.findAntrepoHit(map, { ocode: 1234567, model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH' }, { rule: 'auto' }), null);
});

test('teşhis, yalnız tam üçlü kimliği olan IAS satırlarını sayar', () => {
  const map = parse.parseAntrepoRows([
    antrepoRow({ 'Sipariş Kod': '1234567', 'Model Adı': 'KAZAK A', 'Renk Kod': 'BLK', 'Renk Tanım': 'SIYAH' }),
    antrepoRow({ 'Sipariş Kod': '1234568', 'Model Adı': '', 'Renk Kod': 'WHT', 'Renk Tanım': 'BEYAZ' }),
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.ok, true);
  assert.strictEqual(meta.dataRows, 2);
  assert.strictEqual(meta.lineKeyRows, 1);
  assert.strictEqual(meta.keyCount, 1);
});

// ---------------------------------------------------------------------------
// Kumaş
// ---------------------------------------------------------------------------

test('kumaş bilgisi de sipariş + model + renk koduyla eşleşir', () => {
  const entries = {};
  entries[parse.orderLineKey('1234567', 'KAZAK A', 'BLK')] =
    { ocode: '1234567', model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH', karisim: '%100 PAMUK', iplikNo: '30/1', kumasTipi: 'SUPREM', fabricWeight: '180' };
  entries[parse.orderLineKey('1234567', 'KAZAK B', 'BLK')] =
    { ocode: '1234567', model: 'KAZAK B', ccode: 'BLK', colour: 'SIYAH', karisim: '%50 YÜN', iplikNo: '20/2', kumasTipi: 'RIB', fabricWeight: '320' };

  const [a, b] = parse.applyFabricEntries([
    { ocode: 1234567, model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH' },
    { ocode: 1234567, model: 'KAZAK B', ccode: 'BLK', colour: 'SIYAH' },
  ], entries);
  assert.strictEqual(a.karisim, '%100 PAMUK');
  assert.strictEqual(b.karisim, '%50 YÜN');
});

test('eski anahtarla kaydedilmiş kumaş verisi çalışmaya devam eder', () => {
  const entries = { '1234567|SIYAH': { karisim: '%100 PAMUK', iplikNo: '30/1', kumasTipi: 'SUPREM', fabricWeight: '180' } };
  const [order] = parse.applyFabricEntries([{ ocode: 1234567, model: 'KAZAK A', ccode: 'BLK', colour: 'SIYAH' }], entries);
  assert.strictEqual(order.karisim, '%100 PAMUK');
});
