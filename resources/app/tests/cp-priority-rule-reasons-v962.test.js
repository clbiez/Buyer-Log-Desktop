'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const Rules = require('../public/cp-rules-engine.js');
const VIEW = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'cp-overview-assistant.css'), 'utf8');

test('v9.62 priority rule reasonTr/reasonEn normalize edilir ve built-in nedenleri kaybolmaz', () => {
  const custom = Rules.normalizeRule({
    id: 'retail_wait',
    kind: 'priority',
    target: 'ACTION_THIS_WEEK',
    name: 'Retaile Aktarım Bekliyor',
    reasonTr: 'Sipariş retail aktarımı bekliyor',
    reasonEn: 'Order is awaiting retail transfer',
    conditions: [{ field: 'Status', operator: 'eq', value: 'Retaile Aktarım Bekleniyor' }],
  });
  assert.equal(custom.reasonTr, 'Sipariş retail aktarımı bekliyor');
  assert.equal(custom.reasonEn, 'Order is awaiting retail transfer');

  for (const rule of Rules.DEFAULT_RULES.filter(item => item.kind === 'priority')) {
    assert.ok(rule.reasonTr, `${rule.id} reasonTr eksik`);
    assert.ok(rule.reasonEn, `${rule.id} reasonEn eksik`);
  }
});

test('v9.62 Rules UI Priority Rule editöründe iki dilli reason alanlarını ve yeni kural doğrulamasını içerir', () => {
  assert.ok(VIEW.includes('data-cpa-rule-reason-tr'), 'Reason TR input eksik');
  assert.ok(VIEW.includes('data-cpa-rule-reason-en'), 'Reason EN input eksik');
  assert.ok(VIEW.includes('Türkçe sebep zorunludur.'), 'TR validation mesajı eksik');
  assert.ok(VIEW.includes('English reason is required.'), 'EN validation mesajı eksik');
  assert.match(VIEW, /const newPriorityRuleIds = new Set\(\)/);
  assert.match(VIEW, /function validateNewPriorityReasons\(\)/);
  assert.match(VIEW, /if \(!validateNewPriorityReasons\(\)\) return;/);
  assert.match(CSS, /\.cpaRuleReasons\{[^}]*grid-template-columns:/);
  assert.match(CSS, /\.cpaRuleReasonField input\.is-invalid\{/);
});

test('v9.62 matched custom priority rule stabil CUSTOM_RULE:<id> identity ve TR/EN metadata taşır', () => {
  assert.match(VIEW, /function customRuleReasonCode\(ruleId\)/);
  assert.ok(VIEW.includes('`CUSTOM_RULE:${id}`'), 'stabil custom rule reason code eksik');
  // v7.0.290: öncelik yalnız kurallardan gelir; yerleşik kural da kendi gerekçesini taşır.
  assert.match(VIEW, /reasonCode: customRuleReasonCode\(rule\.id\)/);
  assert.match(VIEW, /reasonTr: String\(rule\.reasonTr \|\| ''\)/);
  assert.match(VIEW, /reasonEn: String\(rule\.reasonEn \|\| ''\)/);
  assert.match(VIEW, /custom: rule\.builtIn !== true/);
});

test('v9.62 Attention Reason eşleşen kuralların nedenlerini tek final listede toplar', () => {
  assert.match(VIEW, /function attentionReasonEntries\(item\)/);
  // v7.0.290: motorun bilgi amaçlı risk sebepleri artık öncelik gerekçesi değildir.
  assert.doesNotMatch(VIEW.slice(VIEW.indexOf('function attentionReasonEntries(item)'), VIEW.indexOf('function ruleReasonCounts(model)')), /item\.riskReasons/);
  assert.match(VIEW, /Array\.isArray\(item && item\.matchedRules\)/);
  assert.match(VIEW, /attentionReasonEntries\(item\)\.slice\(0, 2\)\.map\(entry => entry\.text\)/);
  assert.match(VIEW, /const reasons = attentionReasonEntries\(item\)\.map\(entry => entry\.code\)/);
  assert.match(VIEW, /key\.startsWith\('CUSTOM_RULE:'\)/);
});

test('v9.62 eski custom rule reason olmadan çalışmaya devam eder ve normalize boş string üretir', () => {
  const legacy = Rules.normalizeRule({
    id: 'legacy',
    kind: 'priority',
    target: 'ACTION_THIS_WEEK',
    name: 'Eski Kural',
    conditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }],
  });
  assert.equal(legacy.reasonTr, '');
  assert.equal(legacy.reasonEn, '');
  assert.ok(VIEW.includes("return primary || secondary || String(ruleLike.name || '').trim();"),
    'eski rule için rule name fallback bulunmalı');
});
