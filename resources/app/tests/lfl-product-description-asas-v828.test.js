'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const fields = require('../server/lib/canonical-fields');
const parse = require('../server/lib/parse');
const lfl = require('../server/lib/lfl');
const modelFields = require('../server/lib/model-fields');
const { ensureConnectionMapping } = require('../server/lib/model-refresh');

const source = {
  'Sipariş Kod': '1001', 'Net Alım Sipariş Miktarı': 100, 'Kalan Alım Sipariş Miktarı': 100,
  'FOB Fiyatı': 4.5, 'Plm Kod': 123, 'Üretici': 'MFR', 'Sezon': 'S7', 'Ürün Klasman': 'K1',
  'Merch Alt Grup Kod': 'M1', 'Merch Marka Yaş Grup Kod': 'CU4E', 'Buyer Grup (TR)': 'LİSANS',
  'Siparişin Üretildiği Ülke': 'Türkiye', 'Lisans': 'DTR', 'Model Adı': 'MOD-1',
  'Ürün Ana Tanım': 'T-SHIRT', 'Renk Kod': '3E8', 'Renk': 'Mavi', 'Buyer': 'Buyer 1', 'Line': 'Line 1', 'In-Store': '2027-06-01',
};

test('ASAS Ürün Ana Tanım Product Description canonical bindingiyle LFL filtresine taşınır', () => {
  assert.equal(fields.value({ 'Ürün Ana Tanım': 'T-SHIRT' }, 'lfl', 'productDescription'), 'T-SHIRT');
  assert.equal(fields.canonicalId('lfl', 'Ürün Ana Tanım'), 'productDescription');
  assert.notEqual(fields.canonicalId('lfl', 'Ürün Ana Tanım'), 'productMainDefinition');
});

test('ASAS parser Ürün Ana Tanım değerini korur ve LFL distinct filter seçeneklerine üretir', () => {
  const parsed = parse.parseASASRows([source]);
  assert.equal(parsed.orders[0].productDescription, 'T-SHIRT');

  const lflResult = lfl.parseLFLRows([source]);
  assert.equal(lflResult.rows[0].productDescription, 'T-SHIRT');
  assert.deepEqual(lflResult.meta.dimensions.productDescriptions, ['T-SHIRT']);
});

test('LFL Product Description distinct listesi duplicate ve boş ASAS değerlerini doğru ele alır', () => {
  const result = lfl.parseLFLRows([
    source,
    { ...source, 'Sipariş Kod': '1002' },
    { ...source, 'Sipariş Kod': '1003', 'Ürün Ana Tanım': null },
  ]);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(result.meta.dimensions.productDescriptions, ['T-SHIRT']);
  const rehydratedRows = JSON.parse(JSON.stringify(result.rows));
  assert.equal(rehydratedRows[0].productDescription, 'T-SHIRT');
});

test('ASAS otomatik mapping Ürün Tanım alanını gerçek Ürün Ana Tanım source kolonuna bağlar', () => {
  const mapped = modelFields.autoMapColumns('asas', ['Sipariş Kod', 'FOB Fiyatı', 'Net Alım Sipariş Miktarı', 'Sezon', 'Ürün Ana Tanım']);
  assert.equal(mapped.mapping['Ürün Tanım'], 'Ürün Ana Tanım');
  assert.match(read('server/lib/lfl.js'), /URUN ANA TANIM/);
  assert.match(read('server/lib/parse.js'), /Ürün Ana Tanım/);
  assert.match(read('public/canonical-fields.js'), /productDescription:[\s\S]*Ürün Ana Tanım/);
  assert.match(require('./helpers/server-source')(), /mappingEnhancementScanVersion: transientConnection\.mappingEnhancementScanVersion/);
});

test('mevcut eski ASAS mappingi schema onarımında Ürün Ana Tanım kaynağına yükseltilir', async () => {
  const required = modelFields.fieldsForRole('asas').filter(field => field.required);
  const mapping = Object.fromEntries(required.map(field => [field.header, { table: 'ASAS', name: field.header, kind: 'column' }]));
  mapping['Ürün Tanım'] = { table: 'ASAS', name: 'Ürün Tanım', kind: 'column' };
  const schemaNames = [...new Set([...required.map(field => field.header), 'Ürün Ana Tanım'])];
  const item = { role: 'asas', name: 'ASAS', server: 'db', catalog: 'catalog', mapping, mappingEnhancementScanVersion: 1, horizon: { table: 'ASAS' } };
  const result = await ensureConnectionMapping(item, {
    discoverSchema: async () => ({ columns: schemaNames.map(name => ({ table: 'ASAS', name, kind: 'column' })), measures: [] }),
  });
  assert.equal(result.mapping['Ürün Tanım'].name, 'Ürün Ana Tanım');
  // v7.0.229: aynı onarım geçişinde Initial Inspection taraması da yapılır (sürüm 3);
  // v7.0.265: Original Ex-F. tam tarih alanı da taranır (sürüm 4).
  assert.equal(item.mappingEnhancementScanVersion, 4);
});
