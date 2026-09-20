'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../public/business-rules');

test('production status normalization preserves current accepted forms', () => {
  for (const value of ['Üretimde', 'üretimde', 'Üretimde - Kesimde', 'Üretimde/Planlama']) {
    assert.equal(rules.isProductionStatus(value), true, value);
  }
  for (const value of ['', 'Depoda', 'Retaile Aktarım Bekleniyor', 'Yol Operasyonları']) {
    assert.equal(rules.isProductionStatus(value), false, value);
  }
});

test('delivery types are normalized to the four canonical values', () => {
  const cases = new Map([
    ['Gemi', 'Gemi'],
    ['SEA', 'Gemi'],
    ['ship', 'Gemi'],
    ['Uçak', 'Uçak'],
    ['AIR', 'Uçak'],
    ['Gemi + Uçak', 'Gemi+Uçak'],
    ['Sea+Air', 'Gemi+Uçak'],
    ['Gemi + Tır', 'Gemi+Tır'],
    ['ship truck', 'Gemi+Tır'],
    ['Karayolu', ''],
  ]);
  for (const [input, expected] of cases) assert.equal(rules.normalizeTransitDelType(input), expected, input);
});

test('transit rule matching is inclusive and selects the most specific rule', () => {
  const ruleList = [
    { id: 'generic', delType: 'Gemi', days: 70, countries: [], seasons: [] },
    { id: 'country', delType: 'Sea', days: 60, countries: ['Türkiye'], seasons: [] },
    { id: 'season-country-wide', delType: 'Gemi', days: 55, countries: ['Turkey'], seasons: ['W5'], exfStart: '2026-01-01', exfEnd: '2026-12-31' },
    { id: 'season-country-narrow', delType: 'Gemi', days: 48, countries: ['TR'], seasons: ['W5'], exfStart: '2026-07-01', exfEnd: '2026-07-31' },
  ];
  const onStart = rules.findTransitRule(ruleList, '2026-07-01', 'W5', 'Türkiye', 'Gemi');
  const onEnd = rules.findTransitRule(ruleList, '2026-07-31', 'W5', 'Turkey', 'Sea');
  assert.equal(onStart.id, 'season-country-narrow');
  assert.equal(onEnd.id, 'season-country-narrow');
  assert.equal(rules.findTransitRule(ruleList, '2026-08-01', 'W5', 'Turkey', 'Gemi').id, 'season-country-wide');
  assert.equal(rules.findTransitRule(ruleList, '2026-08-01', 'S5', 'Turkey', 'Gemi').id, 'country');
  assert.equal(rules.findTransitRule(ruleList, '2026-08-01', 'S5', 'India', 'Gemi').id, 'generic');
});

test('non-production status keeps the default transit duration unless rules are forced', () => {
  const ruleList = [{ id: 'fast', delType: 'Gemi', days: 40, countries: [], seasons: [] }];
  assert.deepEqual(
    rules.resolveTransitDays({ delType: 'Gemi', status: 'Yolda', rules: ruleList }),
    { days: 70, rule: null, dynamic: false },
  );
  const forced = rules.resolveTransitDays({ delType: 'Gemi', status: 'Yolda', rules: ruleList, forceRules: true });
  assert.equal(forced.days, 40);
  assert.equal(forced.rule.id, 'fast');
  assert.equal(forced.dynamic, true);
});

test('half-up rounding handles positive and negative midpoint values consistently', () => {
  const cases = [
    [1.004, 2, 1],
    [1.005, 2, 1.01],
    [2.675, 2, 2.68],
    [-1.005, 2, -1.01],
    [12.55, 1, 12.6],
    [12.54, 1, 12.5],
  ];
  for (const [input, decimals, expected] of cases) {
    assert.equal(rules.roundHalfUp(input, decimals), expected, `${input}/${decimals}`);
  }
});

test('season policies remain explicit instead of silently changing LFL behavior', () => {
  const values = ['W5', 'S5', 'W4', 'S4'];
  assert.deepEqual([...values].sort(rules.compareSeasonNumberThenLetter), ['S4', 'W4', 'S5', 'W5']);
  assert.deepEqual([...values].sort(rules.compareSeasonPrefixThenNumber), ['S4', 'S5', 'W4', 'W5']);
  assert.equal(rules.previousSeasonByPrefix('W5', values), 'W4');
  assert.equal(rules.previousSeasonByPrefix('S5', values), 'S4');
});

test('shared operational engine exposes structured signals and no legacy CP Priority text', () => {
  const dateOrdinal = rules.defaultDateOrdinal;
  const base = {
    exFactory: '2026-07-15', retailDate: '', inStoreDate: '', antArrival: '', handoverDate: '', shipConfirmationDate: '',
    status: 'Üretimde', delType: 'Gemi', season: 'W5', country: 'Turkey', rules: [], today: '2026-07-25',
  };
  const discount = rules.computePriorityFlags(base, dateOrdinal);
  assert.equal(Object.prototype.hasOwnProperty.call(discount, 'priority'), false);
  assert.deepEqual(discount.signals.map(item => item.code), ['DISCOUNT_DELAY']);
  const transit = rules.computePriorityFlags({ ...base, status: 'Yolda', exFactory: '', antArrival: '2026-07-24', shipConfirmationDate: '2026-07-20' }, dateOrdinal);
  assert.deepEqual(transit.signals.map(item => item.code), ['ANTREPO_DELAY', 'HANDOVER_PENDING']);
  const mb = rules.computePriorityFlags({ ...base, status: 'Yolda', exFactory: '', antArrival: '2026-07-26', inStoreDate: '2026-08-08' }, dateOrdinal);
  assert.equal(mb.mbGap, 13);
  assert.deepEqual(mb.signals.map(item => item.code), ['MODEL_BUDGET_DELAY']);
});

test('Supp. FOB formula uses exact decimal half-up arithmetic', () => {
  assert.equal(rules.calculateSuppFobWithRule(10, { hologramCost: 0.1, royalty: 10 }), 8.91);
  assert.equal(rules.calculateSuppFobWithRule('12,50', { hologramCost: '0,25', royalty: '8' }), 11.27);
  assert.equal(rules.calculateSuppFobWithRule(10, { hologramCost: 0, royalty: 101 }), null);
  assert.equal(rules.calculateSuppFobWithRule('', { hologramCost: 0, royalty: 10 }), null);
});
