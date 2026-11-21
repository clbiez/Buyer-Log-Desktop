'use strict';
/* LFL detay tablolarında Tür (Trial/Gerçek) etiketi yalnız Trial LFL açıkken
   gösterilir; kapalıyken her satır gerçek olduğundan "Real" rozeti gürültüdür. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createTableSearch } = require('./helpers/bl-table-search');

const ROOT = path.join(__dirname, '..');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');

function loadApi() {
  const context = {
    BLTableSearch: createTableSearch(),
    BLBusinessRules: require('../public/business-rules'),
    window: { classifyDtrByManufacturer() { return 'DTR'; }, isNonDtrManufacturer() { return false; } },
    document: { getElementById() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    console, setTimeout, clearTimeout,
  };
  context.window.BLLflCalculationEngine = require('../public/lfl-calculation-engine');
  vm.runInNewContext(LFL, context, { filename: 'public/lfl.js' });
  return context.window.__lflTest;
}

test('Trial kapalıyken LFL detay sütunlarında Tür (Real) yok, PLM Kumaş var', () => {
  const api = loadApi();
  assert.equal(api.trialActiveCount(), 0);
  const keys = api.detailColumns().map(col => col.key);
  assert.ok(!keys.includes('rowType'), 'Trial kapalıyken rowType sütunu olmamalı');
  assert.ok(keys.includes('plmFabric'), 'PLM SYNC kumaş sütunu korunmalı');
  assert.ok(!keys.includes('fabricInfoSource'), 'eski Kumaş Detayları sütunları kaldırıldı');
});

test('Tür sütunu yalnız aktif Trial satırı varken eklenir', () => {
  const start = LFL.indexOf('function detailColumns()');
  const body = LFL.slice(start, LFL.indexOf('function render()', start));
  assert.match(body, /\.\.\.\(trialActiveCount\(\)\?\[\{key:'rowType'/);
});
