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
