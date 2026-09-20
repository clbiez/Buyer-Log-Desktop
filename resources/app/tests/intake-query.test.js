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

test('Analysis Services katalog adı boşluk içerse de güvenli isim doğrulamasından geçer', () => {
  assert.equal(modelQuery.validateName('WSSI Intake Raporu4', 'Model'), 'WSSI Intake Raporu4');
});

