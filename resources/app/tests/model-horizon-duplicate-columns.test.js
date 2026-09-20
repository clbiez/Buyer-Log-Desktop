'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const modelHorizon = require(path.join(__dirname, '..', 'server', 'lib', 'modelHorizon.js'));
const modelFields = require(path.join(__dirname, '..', 'server', 'lib', 'model-fields.js'));
const modelRefresh = require(path.join(__dirname, '..', 'server', 'lib', 'model-refresh.js'));

test('SUMMARIZECOLUMNS aynı fiziksel grup sütununu yalnızca bir kez üretir', () => {
  const built = modelHorizon.buildMappedQuery(
    { table: 'Siparis Bilgileri', groups: [] },
    {
      'Ürün Açıklaması': { table: ' IAS ', name: ' Ürün Ana Tanım ', kind: 'column' },
      'Product Description': { table: 'ias', name: 'ürün ana tanım', kind: 'column' },
      'Sipariş Kod': { table: 'Siparis Bilgileri', name: 'Sipariş Kod', kind: 'column' },
      'Model Count': { table: 'Ithalat', name: 'Model Count', kind: 'measure' },
    },
  );

  assert.equal((built.query.match(/'ias'\[ürün ana tanım\]/gi) || []).length, 1);
  assert.equal(built.columnCount, 2);
  assert.equal(built.measureCount, 1);
  assert.match(built.query, /"Model Count", \[Model Count\]/);
});

test('refresh yolu final üretilen DAX sorgusunu tanılama kancasına verir', async () => {
  const mapping = Object.fromEntries(
    modelFields.fieldsForRole('asas')
      .filter(field => field.required)
      .map(field => [field.header, {
        table: 'ASAS', name: field.header,
        kind: field.header === 'FOB Fiyatı' ? 'measure' : 'column',
      }]),
  );
  mapping['Ürün Açıklaması'] = { table: 'ASAS', name: 'Ürün Ana Tanım', kind: 'column' };
  mapping['Product Description'] = { table: ' asas ', name: ' ürün ana tanım ', kind: 'column' };
  const messages = [];

  await modelRefresh.queryConnectionRows(
    { name: 'ASAS', role: 'asas', mode: 'auto', server: 'db', catalog: 'catalog',
      mapping, mappingEnhancementScanVersion: 1, horizon: { table: 'ASAS' } },
    {
      debugDax: true,
      debugLogger: message => messages.push(message),
      runModelRows: async () => ({ rows: [], elapsedMs: 0 }),
    },
  );

  assert.equal(messages.length, 1);
  assert.match(messages[0], /^\[MODEL_QUERY_DAX\] ASAS/);
  assert.equal((messages[0].match(/'asas'\[ürün ana tanım\]/gi) || []).length, 1);
});
