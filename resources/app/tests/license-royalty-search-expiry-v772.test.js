'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v7.72 License Royalty fiyat kontrolü kural aramasını destekler', () => {
  assert.match(APP, /id="_ruleCheckSearch"[^>]*type="search"/);
  assert.match(APP, /const checkRuleSearch=modal\.querySelector\('#_ruleCheckSearch'\)/);
  assert.match(APP, /const search=norm\(checkRuleSearch\?\.value\)/);
  assert.match(APP, /working\.filter\(rule=>/);
  assert.match(APP, /checkRuleSearch\?\.addEventListener\('input'/);
});

test('v7.72 geçerlilik tarihi geçmiş kurallar soft kırmızı satır olarak işaretlenir', () => {
  assert.match(APP, /function pricingRuleIsExpired\(rule/);
  assert.match(APP, /const expired=pricingRuleIsExpired\(r\)/);
  assert.match(APP, /pricingRuleExpired/);
  assert.match(CSS, /\.pricingRulesTable tbody tr\.pricingRuleExpired td/);
});

test('v7.72 bitiş tarihi bugünse geçerli, dünden önceyse süresi geçmiş sayılır', () => {
  const start = APP.indexOf('function pricingRuleIsExpired(');
  const end = APP.indexOf('function normalizePricingCountryGroup', start);
  const source = APP.slice(start, end);
  const expired = new Function('normalizePricingRuleDate', `${source}; return pricingRuleIsExpired;`)(value => String(value || '').slice(0, 10));
  assert.equal(expired({opdEnd:'2026-08-31'}, new Date(2026, 8, 1)), true);
  assert.equal(expired({opdEnd:'2026-09-01'}, new Date(2026, 8, 1)), false);
  assert.equal(expired({opdEnd:''}, new Date(2026, 8, 1)), false);
});
