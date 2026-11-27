'use strict';
// DTR contracts have no royalty, commission or hologram: blank = none (not 0).
// Every rule validator (client editor, card save, pricing-rule store, client
// read model) must accept them; otherwise one save path silently drops the
// DTR contract written by another.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const B = require('../public/business-rules');
const E = require('../public/license-cards-engine');
const cards = require('../server/lib/license-cards');
const P = require('../server/lib/resource-rule-service');

const serverSource = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
const helperSource = serverSource.slice(serverSource.indexOf('function normalizePricingRuleDate('), serverSource.indexOf("app.get('/api/landed-multipliers'"));
const validators = vm.runInNewContext(helperSource + '\n({normalizePricingRuleDate,normalizePricingRuleSeasons,pricingRuleSeasonSetsOverlap,pricingRuleDateRangesOverlap})', { require: require('node:module').createRequire(path.join(__dirname, '../server/server.js')), BLBusinessRules: B });
const blank = { royalty: null, trCommission: null, ydCommission: null, hologramCost: null, opdStart: '2026-03-13', opdEnd: '' };
const fixture = licensor => cards.appendDiscovered({ _revision: 9, _revisions: { pricingRules: 3 }, pricingRules: [] }, [{ license: 'Demo Hero', licensor }], '2026-01-01T00:00:00.000Z').overrides;

test('DTR is the only licensor whose rates are optional', () => {
  assert.equal(B.pricingRuleRatesOptional({ licensor: 'DTR' }), true);
  assert.equal(B.pricingRuleRatesOptional({ licensor: ' dtr ' }), true);
  assert.equal(B.pricingRuleRatesOptional({ manufacturer: 'DTR' }), true);
  assert.equal(B.pricingRuleRatesOptional({ licensor: 'ERMODA' }), false);
  assert.equal(B.pricingRuleRatesOptional(null), false);
});

test('editor: blank DTR rates are valid; non-DTR still requires them; entered values are checked', () => {
  assert.equal(E.rateError(blank, 'DTR'), '');
  assert.equal(E.rateError({ ...blank, licensor: 'DTR' }), '', 'licensor may come from the rule');
  assert.equal(E.rateError(blank, 'ERMODA'), 'royalty');
  assert.equal(E.rateError({ ...blank, royalty: 10 }, 'ERMODA'), 'commission-missing');
  assert.equal(E.rateError({ ...blank, royalty: 10, trCommission: 2 }, 'ERMODA'), 'hologram');
  assert.equal(E.rateError({ ...blank, royalty: 101 }, 'DTR'), 'royalty');
  assert.equal(E.rateError({ ...blank, trCommission: -1 }, 'DTR'), 'commission');
  assert.equal(E.rateError({ ...blank, hologramCost: -1 }, 'DTR'), 'hologram');
  assert.equal(E.rateError({ ...blank, opdEnd: '2026-01-01' }, 'DTR'), 'date');
});

test('card save stores blank DTR rates as null; non-DTR blank rates are refused', () => {
  const current = fixture('DTR'), id = current.licenseCards.items[0].id;
  const updated = cards.updateCard(current, id, { revision: 1, pricingRevision: 3, rules: [{ id: 'dtr-1', ...blank }] }, validators);
  const saved = updated.overrides.pricingRules.find(rule => rule.id === 'dtr-1');
  assert.equal(saved.royalty, null);
  assert.equal(saved.trCommission, null);
  assert.equal(saved.ydCommission, null);
  assert.equal(saved.hologramCost, null);
  const other = fixture('ERMODA');
  assert.throws(() => cards.updateCard(other, other.licenseCards.items[0].id, { revision: 1, pricingRevision: 3, rules: [{ id: 'x', ...blank }] }, validators), { code: 'LICENSE_RULES_INVALID' });
  assert.throws(() => cards.updateCard(fixture('DTR'), id, { revision: 1, pricingRevision: 3, rules: [{ id: 'y', ...blank, royalty: 'abc' }] }, validators), { code: 'LICENSE_RULES_INVALID' });
});

test('pricing-rule store keeps a blank DTR contract as null and never coerces it to 0', () => {
  const rule = { id: 'dtr-1', license: 'Demo Hero', licensor: 'DTR', ...blank };
  const out = P.normalizePricingRules([rule, { ...rule, id: 'nd', licensor: 'ERMODA' }], { existing: [], categorySchemaVersion: 1 });
  assert.deepEqual(out.map(r => r.id), ['dtr-1'], 'non-DTR blank rule is still rejected');
  assert.equal(out[0].royalty, null);
  assert.equal(out[0].hologramCost, null);
  assert.equal(out[0].trCommission, null);
  assert.equal(out[0].ydCommission, null);
  const priced = P.normalizePricingRules([{ ...rule, royalty: '5', hologramCost: '0.1' }], { existing: [], categorySchemaVersion: 1 });
  assert.equal(priced[0].royalty, 5);
  assert.equal(priced[0].hologramCost, 0.1);
});

test('a blank DTR contract applies no price to any country', () => {
  const rule = { id: 'dtr-1', license: 'Demo Hero', licensor: 'DTR', ...blank };
  assert.equal(B.pricingRuleEffectiveRoyalty(rule, 'TR'), null);
  assert.equal(B.pricingRuleEffectiveRoyalty(rule, 'YD'), null);
  assert.equal(B.calculateFinalFobWithRule(10, rule, 'TR'), null);
});

test('client read model and quick FOB share the DTR rule', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/license-royalty-commissions.js'), 'utf8');
  assert.match(ui, /optional=api\.pricingRuleRatesOptional\(\{licensor\}\)/);
  assert.match(ui, /if\(trCommission==null&&ydCommission==null&&!optional\)return;/);
  const lc = fs.readFileSync(path.join(__dirname, '../public/license-cards.js'), 'utf8');
  assert.match(lc, /E\.rateError\(r,c\.licensor\)/);
  assert.match(lc, /quickRules\(\)\.filter\(r=>r\.royalty!=null&&r\.royalty!==''\)/);
});
