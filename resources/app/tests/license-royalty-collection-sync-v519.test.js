'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function between(start, end) {
  const a = APP.indexOf(start);
  const b = APP.indexOf(end, a + start.length);
  assert.ok(a >= 0, `${start} bulunmalı`);
  assert.ok(b > a, `${end} bulunmalı`);
  return APP.slice(a, b);
}

test('v5.19 License Royalty Rules changes synchronize CP and Collection together', () => {
  const helper = between('function syncPricingRulesToAllLoadedViews', 'async function persistPricingRules');
  assert.match(helper, /applyPricingRulesToLoadedRows\(\)/);
  assert.match(helper, /kolSyncRulePricing\(\{save:saveCollection\}\)/);
  assert.match(helper, /activeTab==='koleksiyon'[\s\S]*renderKol\(\)/);
});

test('v5.19 pricing rule persistence applies Collection immediately and again after server normalization', () => {
  const fn = between('async function persistPricingRules', 'function pricingRuleMatchCount');
  const firstSync = fn.indexOf('syncPricingRulesToAllLoadedViews({saveCollection:true,renderCollection:true})');
  const fetchPos = fn.indexOf("fetch('/api/pricing-rules'");
  assert.ok(firstSync >= 0 && firstSync < fetchPos, 'Koleksiyon senkronu ağ isteğinden önce çalışmalı');
  assert.ok(fn.indexOf('syncPricingRulesToAllLoadedViews({saveCollection:true,renderCollection:true})', firstSync + 1) > fetchPos,
    'Sunucudan dönen normalize kural seti Koleksiyon üzerine tekrar uygulanmalı');
  assert.match(fn, /state\.overrides\.pricingRules=previous[\s\S]*syncPricingRulesToAllLoadedViews/);
});

test('v5.19 single-rule Apply saves the edited rule set before applying order Supp FOB values', () => {
  const modal = between('function openSuppFobRulesModal', "document.querySelectorAll('[data-license-royalty]')");
  const applyHandler = betweenWithin(modal, "body.querySelectorAll('.applyRule')", "body.querySelectorAll('.editRule')");
  assert.match(applyHandler, /await persistPricingRules\(working\)/);
  assert.match(applyHandler, /await applySuppFobRuleToMatchingOrders\(current\)/);
  assert.ok(applyHandler.indexOf('persistPricingRules(working)') < applyHandler.indexOf('applySuppFobRuleToMatchingOrders(current)'));
});

function betweenWithin(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a);
  return source.slice(a, b);
}
