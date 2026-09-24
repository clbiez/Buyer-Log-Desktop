'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../public/business-rules');
const { createTableSearch } = require('./helpers/bl-table-search');

const ROOT = path.join(__dirname, '..');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');

function loadApi() {
  const context = {
    BLTableSearch: createTableSearch(),
    BLBusinessRules: rules,
    window: {
      classifyDtrByManufacturer() { return 'DTR'; },
      isNonDtrManufacturer() { return false; },
    },
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    console,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(LFL, context, { filename: 'public/lfl.js' });
  return context.window.__lflTest;
}

function row(id, productDescription, fob, quantity, country = 'TURKIYE', manufacturer = 'MFR') {
  return {
    id,
    orderCode: id,
    modelName: `MODEL-${id}`,
    mag: 'CK4E',
    mmyg: 'MMYG1',
    classification: 'K1',
    productDescription,
    manufacturer,
    country,
    buyingGroup: 'LISANS',
    buyer: 'BUYER',
    season: 'S7',
    inStoreMonth: '2026-09',
    fob,
    quantity,
  };
}

test('LFL FOB change uses only breakdown + currency pairs present in both periods', () => {
  const api = loadApi();
  const current = [
    row('current-match', 'T-Shirt', 2, 100),
    row('current-only', 'Sweat', 100, 900),
  ];
  const previous = [
    row('previous-match', 'T-Shirt', 1, 100),
    row('previous-only', 'Hırka', 50, 500),
  ];

  const comparable = api.comparablePeriodRows(current, previous, ['mag', 'productDescription']);
  assert.deepEqual(comparable.currentRows.map(item => item.id), ['current-match']);
  assert.deepEqual(comparable.referenceRows.map(item => item.id), ['previous-match']);
  assert.equal(api.comparableMetricBetweenRows(current, previous, ['mag', 'productDescription'], 'change'), 100);

  const rawChange = api.metricBetween(api.summary(current), api.summary(previous), 'change');
  assert.notEqual(rawChange, 100);
});

test('LFL does not compare a breakdown when the two periods have different currencies', () => {
  const api = loadApi();
  const current = [row('current-try', 'T-Shirt', 2, 100, 'TURKIYE')];
  const previous = [row('previous-usd', 'T-Shirt', 1, 100, 'CHINA')];

  const comparable = api.comparablePeriodRows(current, previous, ['mag', 'productDescription']);
  assert.equal(comparable.currentRows.length, 0);
  assert.equal(comparable.referenceRows.length, 0);
  assert.equal(api.comparableMetricBetweenRows(current, previous, ['mag', 'productDescription'], 'change'), null);
});

test('missing LFL percentage is blank instead of being formatted as 0%', () => {
  const api = loadApi();
  assert.equal(api.pct(null), '—');
  assert.equal(api.comparablePct(null), '');
  assert.equal(api.comparablePct(undefined), '');
  assert.equal(api.comparablePct(0), '0,0%');
});


test('independent scenario uses the same comparable breakdown logic as the main LFL report', () => {
  const api = loadApi();
  const currentMatch = row('current-match', 'T-Shirt', 2, 100);
  const currentOnly = { ...row('current-only', 'Sweat', 100, 900), mag: 'ONLY-CURRENT' };
  const previousMatch = { ...row('previous-match', 'T-Shirt', 1, 100), season: 'S6' };
  const previousOnly = { ...row('previous-only', 'Hırka', 50, 500), season: 'S6', mag: 'ONLY-PREVIOUS' };

  const result = api.scenarioComparisonResult(
    [currentMatch, currentOnly, previousMatch, previousOnly],
    {
      name: 'Scenario',
      currentSeason: 'S7',
      compareSeason: 'S6',
      currentDateField: 'inStore',
      compareDateField: 'inStore',
      currentMonths: ['2026-09'],
      compareMonths: ['2026-09'],
      filters: {},
      inheritGlobal: false,
    },
  );

  assert.notEqual(api.metricBetween(result.current, result.previous, 'change'), 100);
  assert.equal(result.priceChange, 100);
  assert.deepEqual(result.comparableCurrentRows.map(item => item.id), ['current-match']);
  assert.deepEqual(result.comparablePreviousRows.map(item => item.id), ['previous-match']);
});

test('independent scenario returns no percentage when no comparable breakdown exists', () => {
  const api = loadApi();
  const current = { ...row('current-only', 'T-Shirt', 2, 100), mag: 'CURRENT-ONLY' };
  const previous = { ...row('previous-only', 'T-Shirt', 1, 100), season: 'S6', mag: 'PREVIOUS-ONLY' };

  const result = api.scenarioComparisonResult(
    [current, previous],
    {
      name: 'No pair',
      currentSeason: 'S7',
      compareSeason: 'S6',
      currentDateField: 'inStore',
      compareDateField: 'inStore',
      currentMonths: ['2026-09'],
      compareMonths: ['2026-09'],
      filters: {},
      inheritGlobal: false,
    },
  );

  assert.equal(result.priceChange, null);
  assert.equal(api.comparablePct(result.priceChange), '');
});
