'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../public/business-rules');
const engine = require('../public/lfl-calculation-engine');
const { createTableSearch } = require('./helpers/bl-table-search');

const ROOT = path.join(__dirname, '..');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'ui-components.css'), 'utf8');
const MOTION = fs.readFileSync(path.join(ROOT, 'public', 'motion-plus.js'), 'utf8');

function loadApi() {
  const context = {
    BLTableSearch: createTableSearch(),
    BLBusinessRules: rules,
    window: { classifyDtrByManufacturer() { return 'DTR'; }, isNonDtrManufacturer() { return false; }, BLLflCalculationEngine: engine },
    document: { getElementById() { return null; }, querySelectorAll() { return []; }, addEventListener() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    console, setTimeout, clearTimeout,
  };
  vm.runInNewContext(LFL, context, { filename: 'public/lfl.js' });
  return context.window.__lflTest;
}

function row(id, classification, fob, quantity, season, country = 'CHINA') {
  return { id, orderCode: id, modelName: `M-${id}`, mag: 'CK4E', mmyg: 'MMYG1', classification, productDescription: classification,
    manufacturer: 'MFR', country, buyingGroup: 'ORME', buyer: 'BUYER', season, inStoreMonth: season === 'W7' ? '2027-07' : '2026-07', fob, quantity };
}

// Her kalemde fiyat %10 artar; güncel dönemde adet ucuz kaleme kayar.
const current = [row('c1', 'BODY', 1.1, 300, 'W7'), row('c2', 'SWEAT', 4.4, 100, 'W7'), row('c3', 'ONLY-W7', 9, 50, 'W7')];
const previous = [row('p1', 'BODY', 1, 100, 'W6'), row('p2', 'SWEAT', 4, 100, 'W6'), row('p3', 'ONLY-W6', 9, 50, 'W6')];
const DIMS = ['mag', 'mmyg', 'classification'];

test('weighted LFL keeps mix effect while Fisher LFL isolates the like-for-like price change', () => {
  const api = loadApi();
  const weighted = api.comparableMetricBetweenRows(current, previous, DIMS, 'change');
  assert.ok(Math.abs(weighted - ((1.925 / 2.5 - 1) * 100)) < 1e-9, `weighted ${weighted}`);
  const fisher = api.fisherChangeRows(api.comparablePeriodRows(current, previous, DIMS).currentRows, api.comparablePeriodRows(current, previous, DIMS).referenceRows, DIMS, 'change');
  assert.ok(Math.abs(fisher - 10) < 1e-9, `fisher ${fisher}`);
  assert.ok(Math.abs(api.fisherChangeRows(current, previous, DIMS, 'improvement') + 10) < 1e-9);
});

test('Fisher LFL ignores breakdowns that exist on only one side', () => {
  const api = loadApi();
  const onlyOneSide = [...current, row('c4', 'NEW', 50, 10000, 'W7')];
  assert.ok(Math.abs(api.fisherChangeRows(onlyOneSide, previous, DIMS, 'change') - 10) < 1e-9);
  assert.equal(api.fisherChangeRows([row('x', 'A', 1, 1, 'W7')], [row('y', 'B', 1, 1, 'W6')], DIMS, 'change'), null);
});

test('Fisher detail reports Paasche and Laspeyres and never mixes currencies', () => {
  const helpers = { rowMeta: r => ({ valid: r.fob > 0 && r.quantity > 0, fob: r.fob, quantity: r.quantity, currency: engine.currencyForRow(r) }), groupValue: (r, dims) => dims.map(d => r[d]).join('|') };
  const cur = [row('a', 'BODY', 2, 100, 'W7'), row('b', 'SWEAT', 3, 300, 'W7'), row('t', 'BODY', 22, 100, 'W7', 'TURKIYE')];
  const ref = [row('c', 'BODY', 1, 300, 'W6'), row('d', 'SWEAT', 3, 100, 'W6'), row('u', 'BODY', 20, 100, 'W6', 'TURKIYE')];
  const detail = engine.fisherDetail(cur, ref, ['classification'], helpers);
  const paasche = (2 * 100 + 3 * 300) / (1 * 100 + 3 * 300), laspeyres = (2 * 300 + 3 * 100) / (1 * 300 + 3 * 100);
  assert.ok(Math.abs(detail.byCurrency.USD.paasche - (paasche - 1) * 100) < 1e-9);
  assert.ok(Math.abs(detail.byCurrency.USD.laspeyres - (laspeyres - 1) * 100) < 1e-9);
  assert.ok(Math.abs(detail.byCurrency.USD.change - (Math.sqrt(paasche * laspeyres) - 1) * 100) < 1e-9);
  assert.ok(Math.abs(detail.byCurrency.TRY.change - 10) < 1e-9);
  const expected = (detail.byCurrency.USD.change * 400 + 10 * 100) / 500;
  assert.ok(Math.abs(detail.change - expected) < 1e-9);
});

test('KPI shows the selected method and the alternative value; default is Fisher LFL', () => {
  const api = loadApi();
  assert.equal(api.normalizeLflMethod(undefined), 'fisher');
  assert.equal(api.normalizeLflMethod('weighted'), 'weighted');
  assert.equal(api.normalizeLflMethod('bogus'), 'fisher');
  const a = { lflMethod: 'weighted', priceChange: -23, weightedPriceChange: -23, fisherPriceChange: 10 };
  const html = api.fobChangeKpi(a);
  assert.match(html, /data-lfl-method="weighted" aria-pressed="true"/);
  assert.match(html, /data-lfl-method="fisher" aria-pressed="false"/);
  assert.match(html, /Fisher LFL: \+?%?10/);
  const fisherHtml = api.fobChangeKpi({ ...a, lflMethod: 'fisher', priceChange: 10 });
  assert.match(fisherHtml, /data-lfl-method="fisher" aria-pressed="true"/);
  assert.match(fisherHtml, /Ağırlıklı ort\.: /);
});

test('method preference is persisted, part of the scenario cache key and registered as a shared segment', () => {
  assert.match(LFL, /lflMethod:normalizeLflMethod\(state\.lflMethod\)\};/);
  assert.match(LFL, /state\.lflMethod=normalizeLflMethod\(saved\.lflMethod\);/);
  assert.match(LFL, /lflMethod:normalizeLflMethod\(state\.lflMethod\),\n\s*\}\);/);
  // Regresyon: ana analiz önbelleği yöntemi anahtara katmazsa seçim değişince eski sonuç döner.
  const api = loadApi(), period = { season: 'W7', dateField: 'inStore', selectedPeriods: new Set() };
  const fisherKey = api.lflAnalysisCacheKey(period, period, {});
  api.setLflMethodForTest('weighted');
  assert.notEqual(api.lflAnalysisCacheKey(period, period, {}), fisherKey);
  assert.match(CSS, /\.lflMethodSeg,\.cpaSeg\) > button:is\(/);
  assert.match(MOTION, /\.lflMethodSeg'/);
});

test('independent scenarios follow the selected LFL method', () => {
  const api = loadApi();
  const scenario = { name: 'S', currentSeason: 'W7', compareSeason: 'W6', currentMonths: [], compareMonths: [], filters: {}, inheritGlobal: false };
  const rows = [...current, ...previous];
  const fisher = api.scenarioComparisonResult(rows, scenario, {});
  assert.equal(fisher.lflMethod, 'fisher');
  assert.ok(Math.abs(fisher.priceChange - 10) < 1e-9, `fisher ${fisher.priceChange}`);
  assert.ok(Math.abs(fisher.improvement + 10) < 1e-9);
  api.setLflMethodForTest('weighted');
  const weighted = api.scenarioComparisonResult(rows, scenario, {});
  assert.equal(weighted.lflMethod, 'weighted');
  assert.ok(Math.abs(weighted.priceChange - ((1.925 / 2.5 - 1) * 100)) < 1e-9);
  assert.ok(Math.abs(weighted.fisherPriceChange - 10) < 1e-9);
});

test('group-summary Fisher (main report path) equals the row-based Fisher', () => {
  const helpers = { rowMeta: r => ({ valid: r.fob > 0 && r.quantity > 0, fob: r.fob, quantity: r.quantity, currency: engine.currencyForRow(r), order: r.orderCode, model: r.modelName }), groupValue: (r, dims) => dims.map(d => r[d]).join('|'), dtrTypeForRow: () => 'DTR' };
  const cur = [...current, row('t1', 'BODY', 22, 100, 'W7', 'TURKIYE'), row('t2', 'ONLY-TR', 5, 10, 'W7', 'TURKIYE')];
  const ref = [...previous, row('t3', 'BODY', 20, 300, 'W6', 'TURKIYE')];
  const dims = ['classification'], keys = [...new Set([...cur, ...ref].map(r => r.classification))];
  const pairs = keys.map(k => ({ current: engine.summary(cur.filter(r => r.classification === k), helpers), reference: engine.summary(ref.filter(r => r.classification === k), helpers) }));
  const fromRows = engine.fisherDetail(cur, ref, dims, helpers), fromSummaries = engine.fisherDetailFromSummaries(pairs);
  assert.ok(Math.abs(fromRows.change - fromSummaries.change) < 1e-12);
  assert.deepEqual(Object.keys(fromSummaries.byCurrency).sort(), ['TRY', 'USD']);
});

test('single-pass comparable totals match summary-based weighted and row-based Fisher', () => {
  const helpers = { rowMeta: r => ({ valid: r.fob > 0 && r.quantity > 0, fob: r.fob, quantity: r.quantity, currency: engine.currencyForRow(r), order: r.orderCode, model: r.modelName }), groupValue: (r, dims) => dims.map(d => r[d]).join('|'), dtrTypeForRow: () => 'DTR' };
  const cur = [...current, row('t1', 'BODY', 22, 100, 'W7', 'TURKIYE'), row('z', 'BODY', 0, 100, 'W7')];
  const ref = [...previous, row('t3', 'BODY', 20, 300, 'W6', 'TURKIYE')];
  const comparable = engine.comparablePeriodRows(cur, ref, DIMS, helpers);
  assert.deepEqual(comparable.currentRows.map(r => r.id), ['c1', 'c2', 't1']);
  const both = engine.comparableChanges(comparable);
  const weighted = engine.metricBetween(engine.summary(comparable.currentRows, helpers), engine.summary(comparable.referenceRows, helpers));
  assert.ok(Math.abs(both.weighted - weighted) < 1e-9);
  assert.ok(Math.abs(both.fisher - engine.fisherDetail(cur, ref, DIMS, helpers).change) < 1e-9);
});

test('manufacturer FOB change follows the LFL rule: shared breakdowns only, selected method, blank otherwise', () => {
  const api = loadApi();
  const mfr = (r, m) => ({ ...r, manufacturer: m });
  const cur = [mfr(current[0], 'MIX'), mfr(current[1], 'MIX'), mfr(row('n1', 'NEW', 1, 500, 'W7'), 'NO-SHARED')];
  const ref = [mfr(previous[0], 'MIX'), mfr(previous[1], 'MIX'), mfr(row('n2', 'OLD', 9, 500, 'W6'), 'NO-SHARED')];
  const byName = rows => Object.fromEntries(rows.map(r => [r.manufacturer, r]));
  const fisher = byName(api.manufacturerVolumes(cur, ref, DIMS));
  assert.ok(Math.abs(fisher.MIX.fobChange - 10) < 1e-9);
  assert.ok(Math.abs(fisher.MIX.weightedFobChange - ((1.925 / 2.5 - 1) * 100)) < 1e-9);
  assert.equal(fisher['NO-SHARED'].fobChange, null);
  api.setLflMethodForTest('weighted');
  const weighted = byName(api.manufacturerVolumes(cur, ref, DIMS));
  assert.ok(Math.abs(weighted.MIX.fobChange - ((1.925 / 2.5 - 1) * 100)) < 1e-9);
  assert.equal(weighted['NO-SHARED'].fobChange, null);
});

test('LCW AI LFL query reports Fisher LFL as overall change and keeps the weighted average', () => {
  const Q = require('../public/lcwai-data-query');
  const rec = (season, classification, quantity, fob) => ({ season, mag: 'CU4E', mmyg: 'KIDS', classification, country: 'CHINA', manufacturer: 'Alpha', quantity, fob });
  const data = Q.datasetFromRecords({ id: 'lfl', module: 'lfl', label: 'lfl', rows: [
    rec('S6', 'Body', 100, 1), rec('S6', 'Sweat', 100, 4), rec('S7', 'Body', 300, 1.1), rec('S7', 'Sweat', 100, 4.4),
  ] });
  const norm = Q.normalizeSpec({ dataset: 'lfl', comparison: { type: 'lfl' } }, [data], { request: 'LFL analizi' });
  assert.equal(norm.ok, true, norm.errors.join());
  const r = Q.execute(norm.spec, data, { reference: norm.reference });
  assert.ok(Math.abs(r.comparisonStats.change - 10) < 1e-9, `change ${r.comparisonStats.change}`);
  assert.ok(Math.abs(r.comparisonStats.weightedChange - ((1.925 / 2.5 - 1) * 100)) < 1e-9);
  assert.match(Q.describe(norm.spec, data, r).join('\n'), /Fisher LFL/);
});
