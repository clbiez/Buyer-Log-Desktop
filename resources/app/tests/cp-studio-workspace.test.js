'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Rules = require('../public/cp-rules-engine.js');
const source = fs.readFileSync(path.join(__dirname, '../public/cp-overview-assistant.js'), 'utf8');

function summaries() {
  const context = vm.createContext({
    Rules, L: (tr, en) => en, fieldKind: () => 'number', enumValuesFor: () => [],
    fieldLabel: id => id, operatorLabel: id => id,
    ruleBadge: rule => rule.target, ruleTone: () => 'blue',
    questionOf: rule => rule.questionEn, ruleName: rule => rule.name,
    Checklist: { statusLabel: id => id }, lang: () => 'en',
    esc: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  });
  vm.runInContext(source.slice(source.indexOf('  function conditionSummary('), source.indexOf('  function ruleSummary('))
    + source.slice(source.indexOf('  function rulePlainSummary('), source.indexOf('  function ruleBlock(')), context);
  return context;
}

test('plain formula summary describes the evaluated formula, never a stale basic cache', () => {
  const view = summaries();
  const rule = { kind: 'priority', mode: 'formula', target: 'Critical', match: 'all',
    formula: '=OR([@daysToLoad]<7,[@qty]>100)',
    conditions: [{ field: 'STALE_FIELD', operator: 'eq', value: 'stale' }] };
  const html = view.rulePlainSummary(rule);
  assert.match(html, /@daysToLoad lt 7/);
  assert.match(html, /@qty gt 100/);
  assert.match(html, /Any one condition is enough/);
  assert.doesNotMatch(html, /STALE_FIELD|stale/);
  rule.formula = '=IF([@qty]>100,TRUE,FALSE)';
  const custom = view.rulePlainSummary(rule);
  assert.match(custom, /custom formula is in use/);
  assert.doesNotMatch(custom, /STALE_FIELD|stale/);
});

test('summary escapes user labels and explains empty rules and automatic answers', () => {
  const view = summaries();
  const html = view.rulePlainSummary({ kind: 'checklist', mode: 'basic', conditions: [],
    questionEn: '<img src=x onerror=alert(1)>', autoStatus: 'approved' });
  assert.match(html, /No conditions; no orders will match/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Automatic status assignment enabled/);
});

test('plain conditions retain both operand offsets and today/field comparisons', () => {
  const view = summaries();
  const label = view.conditionSummary({ field: 'Load', operator: 'lte',
    left: { type: 'field', field: 'Load', offset: { value: -2, unit: 'weeks' } },
    right: { type: 'today', offset: { value: 3, unit: 'days' }, offsetField: 'Buffer' } }, {});
  assert.match(label, /Load − 2 weeks/);
  assert.match(label, /today \+ 3 days \+ Buffer/);
});

test('derived stage and delivery values use the canonical translated labels', () => {
  const view = summaries();
  view.window = { BLBacklogDeliveryEngine: require('../public/backlog-delivery-engine.js') };
  view.fieldKind = () => 'enum';
  view.fieldMeta = id => Rules.DERIVED_FIELDS.find(field => field.id === id);
  vm.runInContext(source.slice(source.indexOf('  function enumValuesFor('), source.indexOf('  const ruleValueCache =')), view);
  for (const [field, value, label] of [['@stage', 'PRODUCTION', 'In Production'], ['@deliveryOutcome', 'EXPECTED_LATE', 'Expected Late']]) {
    const result = view.conditionSummary({ field, operator: 'eq', value }, {});
    assert.ok(result.endsWith(label), result);
    assert.ok(!result.includes(value), result);
  }
});
