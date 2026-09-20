'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');

function ias(overrides={}) {
  return {
    'Sipariş Kod':'7001001',
    'Ürün Ad':'MODEL-A',
    'Renk Kod':'C01',
    'Supplier Portal Statü':'Yol Operasyonları',
    'Yükleme Toplam Adet':500,
    'Net Alım Sipariş Miktarı':1000,
    ...overrides,
  };
}
function asas(overrides={}) {
  return {
    'Sipariş Kod':'7001001',
    'Model Adı':'MODEL-A',
    'Renk Kod':'C01',
    'Net Alım Sipariş Miktarı':1000,
    'Kalan Alım Sipariş Miktarı':0,
    ...overrides,
  };
}

test('v5.16 Antrepo parser does not invent missing pivot identity from the previous row', () => {
  const map = parse.parseAntrepoRows([
    ias({'Yükleme Toplam Adet':400}),
    ias({'Sipariş Kod':'','Ürün Ad':'','Renk Kod':'','Supplier Portal Statü':'','Yükleme Toplam Adet':600}),
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.equal(meta.matchableRows, 1);
  assert.equal(meta.pivotIdentityFillCount, 0);
  const hits = parse.findAntrepoHits(map, parse.parseASASRows([asas()]).orders[0]);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits.map(row=>row.loadedQty), [400]);
});

test('v5.16 exact identity written by the pivot preserves every independent partial row', () => {
  const map = parse.parseAntrepoRows([
    ias({'Yükleme Toplam Adet':400}),
    ias({'Yükleme Toplam Adet':600,'Supplier Portal Statü':'Depoda'}),
  ]);
  const meta = parse.antrepoParseMeta(map);
  assert.equal(meta.matchableRows, 2);
  assert.equal(Object.keys(map).length, 2);
  const hits = parse.findAntrepoHits(map, parse.parseASASRows([asas()]).orders[0]);
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map(row=>row.loadedQty), [400,600]);
});

test('v5.16 exact mismatch remains unmatched; no pivot reconstruction is attempted', () => {
  const map = parse.parseAntrepoRows([ias()]);
  const order = parse.parseASASRows([asas({'Renk Kod':'C02'})]).orders[0];
  assert.equal(parse.findAntrepoHit(map, order), null);
});

test('v5.16 trailing formatted blank rows are ignored without carrying identity into them', () => {
  const records = [ias({'Yükleme Toplam Adet':500})];
  for (let i=0;i<2311;i++) records.push({});
  const map = parse.parseAntrepoRows(records);
  const meta = parse.antrepoParseMeta(map);
  assert.equal(Object.keys(map).length, 1);
  assert.equal(meta.dataRows, 1);
  assert.equal(meta.matchableRows, 1);
  assert.equal(meta.blankLoadedQty, 0);
  assert.equal(meta.pivotIdentityFillCount, 0);
});
