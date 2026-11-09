'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Q = require('../public/lcwai-data-query');
const DD = require('../public/date-dimension');
DD.setMerchCalendar(require('./helpers/merch-calendar-fixture').build());
const request = "CU4E'de Mısır, Fas, Türkiye hariç, Lisans kkol tshirtlerin S7 sezon Ocak, Şubat, Mart toplam adetini ve ağırlıklı FOB ortalamasını çıkarır mısın";
function dataset(extra = []) {
  const row = (country, qty, fob, date = '2027-01-10', season = 'S7', category = 'K.KOL-LİSANS') => ({ Country: country, 'Order Quantity': qty, FOB: fob, 'In-Store (Model Budget)': date, Season: season, 'Merch Alt Grup Kod': 'CU4E', 'Buyer Grup (TR)': 'LİSANS', 'Product Description': 'T-Shirt', Category: category });
  const rows = [row('CHINA', 100, 2), row('BANGLADESH', 300, 6, '2027-02-01'), row('CHINA', 200, 5, '2027-03-01'), row('EGYPT', 999, 99), row('MOROCCO', 999, 99), row('TURKEY', 999, 99), row('CHINA', 999, 99, '2027-04-01'), row('CHINA', 999, 99, '2027-01-10', 'W6'), row('CHINA', 999, 99, '2027-01-10', 'S7', 'U.KOL-LİSANS'), ...extra];
  const columns = Object.keys(rows[0]).map(key => ({ key, label: key, type: ['Order Quantity', 'FOB'].includes(key) ? 'num' : key === 'In-Store (Model Budget)' ? 'date' : 'ro', rawValue: r => r[key], readValue: r => r[key] }));
  return Q.createDataset({ id: 'orders', screen: 'orders', rows, columns });
}
function plan() { return { dataset: 'orders', filters: [
  { field: 'MAG', values: ['CU4E'] }, { field: 'Country', op: 'not_in', values: ['Mısır', 'Fas', 'Türkiye'] },
  { field: 'Buying Group', values: ['Lisans'] }, { field: 'Product Description', values: ['T-Shirt'] },
  { field: 'Category', op: 'contains', values: ['K.KOL-LİSANS'] }, { field: 'Season', values: ['S7'] },
  { field: 'MB', values: ['2027-01', '2027-02', '2027-03'] },
], measures: [{ agg: 'sum', field: 'Order Quantity' }, { agg: 'weighted_avg', field: 'FOB', weightField: 'Order Quantity' }] }; }

test('exact request: total quantity and quantity-weighted FOB share all filters; no early rounding', () => {
  const ds = dataset(), norm = Q.normalizeSpec(plan(), [ds], { request });
  assert.equal(norm.ok, true, norm.errors.join());
  assert.equal(norm.spec.measures[1].weightField, 'Order Quantity');
  const result = Q.execute(norm.spec, ds);
  assert.equal(result.matched, 3);
  assert.deepEqual(result.rows, [[600, 5]]); // (100*2 + 300*6 + 200*5)/600
  assert.match(result.columns[1].label, /Ağırlıklı ortalama.*Order Quantity/);
  assert.match(Q.describe(norm.spec, ds, result).join('\n'), /Σ\(FOB × Order Quantity\) \/ Σ\(Order Quantity\)/);
  assert.deepEqual(Q.toWorkbook(result).sheets[0].rows, [[600, 5]]);
});

test('weighted pivot cells and all subtotals are recomputed from record weights, including hidden groups', () => {
  const ds = dataset(), spec = plan();
  spec.rows = [{ field: 'MB', bucket: 'month' }]; spec.columns = [{ field: 'Country' }];
  spec.sort = { by: 1, dir: 'desc' }; spec.limit = 1;
  const norm = Q.normalizeSpec(spec, [ds]); assert.equal(norm.ok, true, norm.errors.join());
  const result = Q.execute(norm.spec, ds);
  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.total.slice(1), [300, 6, 300, 4, 600, 5]);
  assert.equal(result.rows[0].at(-1), 6);
});
test('weighted FOB and Excel retain full numeric precision', () => {
  const ds = dataset(); ds.rows = [{ 'Order Quantity': 7, FOB: 1.234567 }, { 'Order Quantity': 11, FOB: 3.456789 }];
  const n = Q.normalizeSpec({ dataset: 'orders', measures: plan().measures }, [ds]); assert.equal(n.ok, true, n.errors.join());
  const result = Q.execute(n.spec, ds), expected = (7 * 1.234567 + 11 * 3.456789) / 18;
  assert.equal(result.rows[0][1], expected); assert.equal(Q.toWorkbook(result).sheets[0].rows[0][1], expected);
});

test('missing/nonpositive FOB and nonpositive/invalid weights are excluded as pairs, matching Buyer Log price footers', () => {
  const ds = dataset();
  ds.rows = [100, 200, 300, 0, -5, null, 'bad'].map((qty, i) => ({ 'Order Quantity': qty, FOB: [2, null, 0, 8, 9, 8, 9][i] }));
  const norm = Q.normalizeSpec({ dataset: 'orders', measures: plan().measures }, [ds]);
  assert.equal(norm.ok, true, norm.errors.join());
  const result = Q.execute(norm.spec, ds);
  assert.deepEqual(result.rows, [[595, 2]]);
  assert.deepEqual(result.measureStats[1], { validRows: 1, excludedRows: 6, weightSum: 100 });
  for (const lang of ['tr', 'en']) {
    const lines = Q.describe(norm.spec, ds, result, lang).join('\n');
    assert.match(lines, /100/); assert.match(lines, /6/);
    assert.match(lines, lang === 'tr' ? /hesaba katılmadı/ : /excluded/);
  }
  ds.rows = [{ 'Order Quantity': 0, FOB: 10 }, { 'Order Quantity': 100, FOB: null }];
  assert.deepEqual(Q.execute(norm.spec, ds).rows, [[100, null]], 'undefined average is blank, never zero');
  ds.rows = []; assert.deepEqual(Q.execute(norm.spec, ds).rows, [[0, null]]);
});

test('weights must be explicit known numeric fields; unsupported aggregations and excess measures cannot silently disappear', () => {
  const ds = dataset();
  for (const [weightField, code] of [[undefined, 'missing-weight-field'], ['Nope', 'unknown-field:weight:Nope'], ['Season', 'weight-needs-number:Season']]) {
    const n = Q.normalizeSpec({ dataset: 'orders', measures: [{ agg: 'weighted_avg', field: 'FOB', weightField }] }, [ds]);
    assert.equal(n.ok, false); assert.ok(n.errors.includes(code), n.errors.join());
  }
  const many = Q.normalizeSpec({ dataset: 'orders', measures: Array.from({ length: 7 }, () => ({ agg: 'sum', field: 'FOB' })) }, [ds]);
  assert.equal(many.ok, false); assert.ok(many.errors.includes('too-many-measures'));
  const wrong = Q.normalizeSpec({ dataset: 'orders', measures: [{ agg: 'weighted_avg', field: 'Season', weightField: 'Order Quantity' }] }, [ds]);
  assert.equal(wrong.ok, false);
});

test('coverage guard detects omitted quantity, omitted weighted FOB, and simple average substituted for weighted average', () => {
  const ds = dataset();
  for (const measures of [[{ agg: 'sum', field: 'Order Quantity' }], [{ agg: 'sum', field: 'Order Quantity' }, { agg: 'avg', field: 'FOB' }], [{ agg: 'weighted_avg', field: 'FOB', weightField: 'Order Quantity' }]]) {
    const norm = Q.normalizeSpec({ dataset: 'orders', measures }, [ds], { request });
    assert.equal(norm.ok, false); assert.ok(norm.errors.some(e => e.startsWith('missing-requested-measure:')), norm.errors.join());
  }
  const norm = Q.normalizeSpec(plan(), [ds], { request: 'total quantity and quantity-weighted average FOB' });
  assert.equal(norm.ok, true, norm.errors.join());
  for (const text of ['FOB basit ortalaması', 'average FOB', 'minimum FOB', 'maximum FOB']) {
    const omitted = Q.normalizeSpec({ dataset: 'orders', measures: [{ agg: 'count' }] }, [ds], { request: text });
    assert.equal(omitted.ok, false, text);
  }
  assert.equal(Q.normalizeSpec({ dataset: 'orders', rows: ['Country'], measures: [{ agg: 'avg', field: 'FOB' }] }, [ds], { request: 'FOB basit ortalaması' }).ok, true);
});
