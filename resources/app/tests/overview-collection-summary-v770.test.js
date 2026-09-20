'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const summary = require('../public/overview-collection-summary.js');
const ROOT = require('node:path').join(__dirname, '..');
const APP = fs.readFileSync(require('node:path').join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(require('node:path').join(ROOT, 'public', 'index.html'), 'utf8');
const STORAGE = fs.readFileSync(require('node:path').join(ROOT, 'public', 'user-storage.js'), 'utf8');

const rows = [
  { modelKod: 'M-100', inStoreMonth: '2026-08', durum: 'Fiyatlamada', pricing: { ACME: '4.5' }, confirmedManufacturer: 'ACME' },
  { modelKod: 'M-100', inStoreMonth: '2026-08', durum: 'Fiyatlamada', pricing: {}, confirmedManufacturer: '' },
  { modelKod: 'M-200', inStoreMonth: '2026-08', durum: 'Siparişe Hazır', pricing: {}, confirmedManufacturer: '' },
  { modelKod: 'M-300', inStoreMonth: '2026-09', durum: 'Siparişe Hazır', pricing: { ACME: '3' }, confirmedManufacturer: 'ACME' },
];

test('Collection Summary filters intersect and KPI counts distinct models', () => {
  const result = summary.build(rows, {
    months: ['2026-08'],
    statuses: ['Fiyatlamada', 'Siparişe Hazır'],
    confirmation: 'all',
    isConfirmed: row => Boolean(row.confirmedManufacturer && row.pricing[row.confirmedManufacturer]),
  });

  assert.deepEqual(result.kpi, { total: 2, optionCount: 3, confirmed: 1, notConfirmed: 1 });
  assert.deepEqual(result.rows.map(row => [row.status, row.modelCount, row.optionCount, row.confirmed, row.notConfirmed]), [
    ['Fiyatlamada', 1, 2, 1, 0],
    ['Siparişe Hazır', 1, 1, 0, 1],
  ]);
});

test('Collection Summary confirmation filter uses the existing confirmation callback', () => {
  const result = summary.build(rows, {
    months: ['2026-08'],
    statuses: ['Fiyatlamada'],
    confirmation: 'confirmed',
    isConfirmed: row => row.modelKod === 'M-100' && row.confirmedManufacturer === 'ACME',
  });
  assert.equal(result.kpi.total, 1);
  assert.deepEqual(result.rows[0], { status: 'Fiyatlamada', modelCount: 1, optionCount: 1, confirmed: 1, notConfirmed: 0 });
});

test('Collection Summary applies arbitrary Collection column filters without exposing model names', () => {
  const result = summary.build([
    { modelKod: 'M-100', inStoreMonth: '2026-08', durum: 'Fiyatlamada', buyer: 'Ayşe', urunTipi: 'T-shirt', confirmed: false },
    { modelKod: 'M-200', inStoreMonth: '2026-08', durum: 'Fiyatlamada', buyer: 'Ali', urunTipi: 'T-shirt', confirmed: true },
    { modelKod: 'M-300', inStoreMonth: '2026-08', durum: 'Siparişe Hazır', buyer: 'Ayşe', urunTipi: 'Sweatshirt', confirmed: false },
  ], {
    months: ['2026-08'],
    statuses: ['Fiyatlamada', 'Siparişe Hazır'],
    columnFilters: { buyer: ['Ayşe'], urunTipi: ['T-shirt'] },
    isConfirmed: row => row.confirmed,
  });
  assert.deepEqual(result.kpi, { total: 1, optionCount: 1, confirmed: 0, notConfirmed: 1 });
  assert.deepEqual(result.rows, [{ status: 'Fiyatlamada', modelCount: 1, optionCount: 1, confirmed: 0, notConfirmed: 1 }]);
  assert.equal(Object.hasOwn(result.rows[0], 'model'), false);
});

test('Collection Summary exposes all supplied Collection columns as filter choices', () => {
  assert.deepEqual(summary.availableColumns([
    { buyer: 'Ayşe', customField: 'X' },
  ], { columns: [
    { k: 'buyer', label: 'Buyer' },
    { k: 'customField', label: 'Custom field', custom: true },
  ]}), [
    { key: 'buyer', label: 'Buyer', values: ['Ayşe'] },
    { key: 'customField', label: 'Custom field', values: ['X'] },
  ]);
});

test('Collection Summary pivot groups distinct models by selected row and confirmation column', () => {
  const result = summary.build([
    { modelKod: 'M-100', durum: 'Fiyatlamada', buyer: 'Ayşe', confirmed: false },
    { modelKod: 'M-200', durum: 'Fiyatlamada', buyer: 'Ayşe', confirmed: true },
    { modelKod: 'M-300', durum: 'Siparişe Hazır', buyer: 'Ali', confirmed: false },
  ], { pivot: { rows: 'buyer', columns: 'confirmation' }, isConfirmed: row => row.confirmed });
  assert.deepEqual(result.pivotRows, [
    { row: 'Ali', modelCount: 1, optionCount: 1, confirmed: 0, notConfirmed: 1 },
    { row: 'Ayşe', modelCount: 2, optionCount: 2, confirmed: 1, notConfirmed: 1 },
  ]);
});

test('Collection Summary supports multi-level row and column pivots', () => {
  const result = summary.build([
    { modelKod: 'M-100', inStoreMonth: '2026-08', durum: 'Siparişe Hazır', country: 'Bangladesh', confirmed: false },
    { modelKod: 'M-100', inStoreMonth: '2026-08', durum: 'Siparişe Hazır', country: 'Bangladesh', confirmed: true },
    { modelKod: 'M-200', inStoreMonth: '2026-08', durum: 'Siparişe Hazır', country: 'Bangladesh', confirmed: true },
    { modelKod: 'M-300', inStoreMonth: '2026-08', durum: 'Fiyatlamada', country: 'Turkey', confirmed: false },
  ], {
    pivot: { rows: ['inStoreMonth', 'durum'], columns: ['country'] },
    isConfirmed: row => row.confirmed,
  });

  assert.deepEqual(result.pivotColumns.map(column => column.path), [['Bangladesh'], ['Turkey']]);
  assert.deepEqual(result.pivotRows.map(row => row.rowPath), [
    ['2026-08', 'Fiyatlamada'],
    ['2026-08', 'Siparişe Hazır'],
  ]);
  const ready = result.pivotRows.find(row => row.rowPath[1] === 'Siparişe Hazır');
  assert.deepEqual(ready.cells[JSON.stringify(['Bangladesh'])], {
    modelCount: 2,
    optionCount: 3,
    confirmed: 2,
    notConfirmed: 0,
  });
  assert.deepEqual(ready.cells[JSON.stringify(['Turkey'])], {
    modelCount: 0,
    optionCount: 0,
    confirmed: 0,
    notConfirmed: 0,
  });
});

test('Collection Summary defaults to one nearest month and one status', () => {
  const defaults = summary.defaultFilters(rows, { now: new Date('2026-08-15T00:00:00Z') });
  assert.deepEqual(defaults.months, ['2026-08']);
  assert.deepEqual(defaults.statuses, ['Fiyatlamada']);
  assert.notDeepEqual(defaults.months, ['2026-08', '2026-09']);
  assert.notDeepEqual(defaults.statuses, ['Fiyatlamada', 'Siparişe Hazır']);
});

test('Collection Summary is placed before OAB and uses user-scoped preferences', () => {
  assert.ok(INDEX.indexOf('id="ovCollectionSummary"') < INDEX.indexOf('id="oabSection"'));
  assert.match(INDEX, /overview-collection-summary\.js/);
  assert.match(APP, /kolConfirmedPricing\(row\)/);
  assert.match(APP, /scheduleOverviewCollectionSummaryRender/);
  assert.match(APP, /columnFilters/);
  assert.match(APP, /columnFilters,pivot,columnValue/);
  assert.match(APP, /data-pivot-rows[^>]*multiple/);
  assert.match(APP, /data-pivot-columns[^>]*multiple/);
  assert.match(APP, /overviewCollectionSummaryPivotColumns/);
  assert.doesNotMatch(APP, /<th>\$\{appLang==='en'\?'Model':'Model'\}<\/th>/);
  assert.match(STORAGE, /buyerlog\.overview\.collectionSummary\./);
});
