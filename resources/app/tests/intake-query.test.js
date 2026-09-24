'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const intake = require('../server/lib/intake-report');
const modelQuery = require('../server/lib/modelQuery');

test('INTAKE DAX yalnız aktif source alanlarını kullanır; custom label sorguya girmez', () => {
  const fields = intake.normalizeSchema({
    columns: [
      { table: 'SupplyBasket', name: 'Tedarik Cluster', kind: 'column' },
      { table: 'Dim_Urun', name: 'UrunKlasmanTanim', kind: 'column' },
      { table: 'SalesCluster', name: 'Satış Cluster', kind: 'column' },
    ],
    measures: [
      { table: 'Measures', name: 'Kümülatif Sipariş Miktar', kind: 'measure' },
      { table: 'Measures', name: 'Güncel Alım Bütçe', kind: 'measure' },
    ],
  });
  const cluster = fields.find(field => field.defaultLabel === 'Tedarik Cluster');
  const category = fields.find(field => field.defaultLabel === 'UrunKlasmanTanim');
  const measure = fields.find(field => field.defaultLabel === 'Kümülatif Sipariş Miktar');
  const filter = fields.find(field => field.defaultLabel === 'Satış Cluster');
  const view = intake.reconcileViewConfig({
    version: 1,
    query: {
      rows: [cluster, category],
      columns: [],
      measures: [measure],
      filters: [filter],
      filterValues: { [filter.id]: ['Fas'] },
    },
    display: { labels: { [measure.id]: 'Toplam Sipariş' } },
  }, fields);
  const built = intake.buildIntakeQuery({ fields, viewConfig: view });

  assert.match(built.query, /'SupplyBasket'\[Tedarik Cluster\]/);
  assert.match(built.query, /'Dim_Urun'\[UrunKlasmanTanim\]/);
  assert.match(built.query, /\[Kümülatif Sipariş Miktar\]/);
  assert.match(built.query, /TREATAS\(\{\s*"Fas"/);
  assert.doesNotMatch(built.query, /Toplam Sipariş/);
  assert.deepEqual(built.queryFields.measures, [measure.id]);
});

test('INTAKE Güncel Alım Bütçe 0 veya boş satırları varsayılan olarak DAX seviyesinde dışlar', () => {
  const fields = intake.normalizeSchema({
    columns: [{ table: 'Phase', name: 'Dönem Tanim' }],
    measures: [{ table: 'Measures', name: 'Güncel Alım Bütçe' }],
  });
  const row = fields.find(field => field.fieldType === 'dimension');
  const budget = fields.find(field => field.fieldType === 'measure');
  const view = intake.reconcileViewConfig({
    version: 2,
    query: { rows: [row], columns: [], measures: [budget], filters: [], filterValues: {} },
  }, fields);

  const built = intake.buildIntakeQuery({ fields, viewConfig: view });

  assert.match(built.query, /FILTER\(/);
  assert.match(built.query, /NOT ISBLANK\(CALCULATE\(\[Güncel Alım Bütçe\]\)\)/);
  assert.match(built.query, /CALCULATE\(\[Güncel Alım Bütçe\]\) <> 0/);
});

test('INTAKE sıfır bütçe gizleme seçeneği kapatılırsa DAX ek filtresi uygulanmaz', () => {
  const fields = intake.normalizeSchema({
    columns: [{ table: 'Phase', name: 'Dönem Tanim' }],
    measures: [{ table: 'Measures', name: 'Güncel Alım Bütçe' }],
  });
  const row = fields.find(field => field.fieldType === 'dimension');
  const budget = fields.find(field => field.fieldType === 'measure');
  const view = intake.reconcileViewConfig({
    version: 2,
    query: { rows: [row], columns: [], measures: [budget], filters: [], filterValues: {} },
    display: { hideZeroCurrentBudget: false },
  }, fields);

  const built = intake.buildIntakeQuery({ fields, viewConfig: view });

  assert.doesNotMatch(built.query, /NOT ISBLANK\(CALCULATE\(\[Güncel Alım Bütçe\]\)\)/);
});

const ORDER_FIELDS = intake.normalizeSchema({
  columns: [
    { table: 'Dim', name: 'Country' },
    { table: 'Dim', name: 'Sezon' },
    { table: 'Dim_Tarih', name: 'Merch Yil Ay', dataType: 130 },
    { table: 'SalesCluster', name: 'Satış Cluster' },
  ],
  measures: [{ table: 'Measures', name: 'Budget' }],
});
const ORDER_COUNTRY = ORDER_FIELDS.find(field => field.name === 'Country');
const ORDER_MERCH_MONTH = ORDER_FIELDS.find(field => field.name === 'Merch Yil Ay');
const ORDER_CLUSTER = ORDER_FIELDS.find(field => field.name === 'Satış Cluster');
const ORDER_MEASURE = ORDER_FIELDS.find(field => field.name === 'Budget');

function orderView({ filters = [], filterValues = {} } = {}) {
  return intake.reconcileViewConfig({
    version: 1,
    query: {
      rows: [ORDER_COUNTRY], columns: [], measures: [ORDER_MEASURE], filters, filterValues,
    },
  }, ORDER_FIELDS);
}

function assertDaxOrder(query, ...tokens) {
  let previous = -1;
  for (const token of tokens) {
    const position = query.indexOf(token);
    assert.ok(position > previous, `DAX sırası beklenmiyor: ${token}`);
    previous = position;
  }
}

test('INTAKE SUMMARIZECOLUMNS argümanları group-by → measures sırasındadır', () => {
  const built = intake.buildIntakeQuery({ fields: ORDER_FIELDS, viewConfig: orderView() });
  assertDaxOrder(built.query, "'Dim'[Country]", `[${ORDER_MEASURE.name}]`);
});

test('INTAKE normal filtre group-by sonrasında, measure öncesinde uygulanır', () => {
  const view = orderView({
    filters: [ORDER_CLUSTER],
    filterValues: { [ORDER_CLUSTER.id]: ['Fas'] },
  });
  const built = intake.buildIntakeQuery({ fields: ORDER_FIELDS, viewConfig: view });
  assertDaxOrder(built.query, "'Dim'[Country]", 'TREATAS({ "Fas" },', `[${ORDER_MEASURE.name}]`);
});

test('INTAKE horizon filtresi group-by sonrasında, measure öncesinde uygulanır', () => {
  const horizon = {
    table: 'Dim', seasonTable: 'Dim', seasonField: 'Sezon', seasons: ['2026 SS'],
  };
  const built = intake.buildIntakeQuery({ fields: ORDER_FIELDS, viewConfig: orderView(), horizon });
  assertDaxOrder(built.query, "'Dim'[Country]", 'TREATAS({ "2026 SS" },', `[${ORDER_MEASURE.name}]`);
});

test('INTAKE normal filtre ve horizon aynı SUMMARIZECOLUMNS içinde birlikte kalır', () => {
  const view = orderView({
    filters: [ORDER_CLUSTER],
    filterValues: { [ORDER_CLUSTER.id]: ['Fas'] },
  });
  const horizon = {
    table: 'Dim', seasonTable: 'Dim', seasonField: 'Sezon', seasons: ['2026 SS'],
  };
  const built = intake.buildIntakeQuery({ fields: ORDER_FIELDS, viewConfig: view, horizon });
  assertDaxOrder(
    built.query,
    "'Dim'[Country]",
    'TREATAS({ "2026 SS" },',
    'TREATAS({ "Fas" },',
    `[${ORDER_MEASURE.name}]`,
  );
});

test('INTAKE Merch Yil Ay dataType 130 değerini metin olarak korur', () => {
  const view = orderView({
    filters: [ORDER_MERCH_MONTH],
    filterValues: { [ORDER_MERCH_MONTH.id]: ['202507'] },
  });
  const built = intake.buildIntakeQuery({ fields: ORDER_FIELDS, viewConfig: view });
  assert.match(built.query, /TREATAS\(\{ "202507" \}, 'Dim_Tarih'\[Merch Yil Ay\]\)/);
  assertDaxOrder(built.query, "'Dim'[Country]", 'TREATAS({ "202507" },', `[${ORDER_MEASURE.name}]`);
});

test('Analysis Services katalog adı boşluk içerse de güvenli isim doğrulamasından geçer', () => {
  assert.equal(modelQuery.validateName('WSSI Intake Raporu4', 'Model'), 'WSSI Intake Raporu4');
});
