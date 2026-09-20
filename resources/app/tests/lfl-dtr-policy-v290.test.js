'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../public/business-rules');
const { createTableSearch } = require('./helpers/bl-table-search');

function loadLflTestApi(nonDtrManufacturers) {
  const code = fs.readFileSync(path.join(__dirname, '../public/lfl.js'), 'utf8');
  const list = rules.normalizeManufacturerList(nonDtrManufacturers);
  const context = {
    // lfl.js ortak tablo aramasını globalThis üzerinden okur; vm bağlamında
    // globalThis bu nesnedir. Gerçek uygulama kaynağından besleniyor.
    BLTableSearch: createTableSearch(),
    window: {
      isNonDtrManufacturer(manufacturer) {
        return rules.isNonDtrManufacturer(manufacturer, list);
      },
      classifyDtrByManufacturer(manufacturer) {
        return rules.classifyDtrByManufacturer(manufacturer, list);
      },
    },
    document: {
      getElementById() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    localStorage: { getItem() { return null; }, setItem() {} },
    console,
    BLBusinessRules: rules,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(code, context, { filename: 'public/lfl.js' });
  return context.window.__lflTest;
}

function row(orderCode, manufacturer, overrides = {}) {
  return {
    id: orderCode,
    orderCode,
    modelName: `M-${orderCode}`,
    manufacturer,
    country: 'TURKIYE',
    quantity: 10,
    fob: 5,
    ...overrides,
  };
}

test('LFL DTR classification uses only the Non-DTR manufacturer list', () => {
  const api = loadLflTestApi(['Factory Non']);
  assert.equal(api.dtrTypeForRow(row('1', 'Factory Non', { dtrType: 'DTR', licensor: 'DTR', license: 'Disney' })), 'NON-DTR');
  assert.equal(api.dtrTypeForRow(row('2', 'Factory DTR', { dtrType: 'NON-DTR', licensor: 'Other', license: 'Unknown' })), 'DTR');
});

test('every LFL order is classified and a mixed order is NON-DTR when any listed manufacturer is present', () => {
  const api = loadLflTestApi(['Factory Non']);
  const result = api.summary([
    row('1', 'Factory DTR'),
    row('2', 'Factory Non'),
    row('3', 'Factory DTR'),
    row('3', 'Factory Non', { id: '3b' }),
  ]);
  assert.equal(result.orders, 3);
  assert.deepEqual({ ...result.dtrOrders }, { dtr: 1, nonDtr: 2, unknown: 0 });
  assert.equal(result.hasDtrBreakdown, true);
  assert.doesNotMatch(api.dtrScopeText(result), /bilgisi yok/i);
});

test('shared business rule classifies every non-listed manufacturer as DTR', () => {
  assert.equal(rules.classifyDtrByManufacturer('Factory Non', ['factory non']), 'NON-DTR');
  assert.equal(rules.classifyDtrByManufacturer('Factory Other', ['factory non']), 'DTR');
  assert.equal(rules.classifyDtrByManufacturer('', ['factory non']), 'DTR');
});
