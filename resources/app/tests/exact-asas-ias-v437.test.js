'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const parse = require(path.join(__dirname, '..', 'server', 'lib', 'parse.js'));
const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));

function asasRow(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Model Adı': 'MODEL-1',
    'Renk Kod': 'B',
    'Renk': 'SIYAH',
    'Net Alım Sipariş Miktarı': 100,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Orijinal Exfactory Merch Tarih': '2026-09-01',
    ...overrides,
  };
}

function iasRow(overrides = {}) {
  return {
    'Sipariş Kod': 'A',
    'Ürün Adı': 'MODEL-1',
    'Renk Kod': 'B',
    'Renk Tanım': 'SIYAH',
    'Supplier Portal Statü': 'Depoda',
    'Tahmini Antrepo Giriş Tarihi': '2026-09-10',
    ...overrides,
  };
}

test('ASAS tekilleştirmesi sipariş + model + renk kodu üçlüsünü kullanır', () => {
  const parsed = parse.parseASASRows([
    asasRow({ 'Model Adı': 'MODEL-1', 'Renk Kod': 'B' }),
    asasRow({ 'Model Adı': 'MODEL-2', 'Renk Kod': 'C' }),
  ]);
  assert.ok(parsed);
  assert.strictEqual(parsed.orders.length, 2);
  assert.deepStrictEqual(parsed.orders.map(row => [row._matchOcode, row.model, row.ccode]), [
    ['A', 'MODEL-1', 'B'],
    ['A', 'MODEL-2', 'C'],
  ]);
});

test('aynı tam üçlü tekrar ederse ASAS satırı yalnız bir kez tutulur', () => {
  const parsed = parse.parseASASRows([asasRow(), asasRow({ 'FOB Fiyatı': 6 })]);
  assert.strictEqual(parsed.orders.length, 1);
});

test('IAS satırında üç kimlik alanından biri eksikse haritaya alınmaz', () => {
  const map = parse.parseAntrepoRows([
    iasRow(),
    iasRow({ 'Sipariş Kod': 'A2', 'Ürün Adı': '', 'Renk Kod': 'B2' }),
    iasRow({ 'Sipariş Kod': 'A3', 'Ürün Adı': 'MODEL-3', 'Renk Kod': '' }),
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.strictEqual(meta.dataRows, 3);
  assert.strictEqual(meta.lineKeyRows, 1);
  assert.strictEqual(meta.keyCount, 1);
  assert.deepStrictEqual(Object.keys(map), ['__ias_row_1']);
});

test('Field Mapping hem ASAS hem IAS için üç kimlik alanını zorunlu tutar', () => {
  const asasMissing = modelFields.missingRequired('asas', {
    'Sipariş Kod': 'Sipariş Kod', 'Model Adı': 'Model Adı',
    'Net Alım Sipariş Miktarı': 'Net Alım Sipariş Miktarı', 'FOB Fiyatı': 'FOB Fiyatı',
    'Üretici': 'Üretici', 'Sezon': 'Sezon', 'Orijinal Exfactory Merch Tarih': 'Orijinal Exfactory Merch Tarih',
  });
  const iasMissing = modelFields.missingRequired('antrepo', {
    'Sipariş Kod': 'Sipariş Kod', 'Model Adı': 'Ürün Adı',
    'Supplier Portal Statü': 'Supplier Portal Statü', 'Tahmini Antrepo Giriş Tarihi': 'Tahmini Antrepo Giriş Tarihi',
  });
  assert.ok(asasMissing.includes('Renk Kod'));
  assert.ok(iasMissing.includes('Renk Kod'));
});
