'use strict';

/* 2026-11-21 — Kullanıcı talebi:
   "Built In Checklist / Priority olmasın, kaldıralım hepsini. Ancak expected
   late, already late gibi ön tanımlı hesaplamalar kalsın."
   Yerleşik öncelik kuralları ve yerleşik checklist soruları artık yoktur;
   daha önce kayda geçmiş yerleşik kopyalar da (builtIn:true) geri gelmez.
   Motorun türettiği alanlar (@deliveryOutcome, @basePriority, @daysToLoad…)
   kullanıcı kurallarında kullanılmaya devam eder. */

const test = require('node:test');
const assert = require('node:assert/strict');

const CP = require('../public/cp-readiness-engine.js');
const Rules = require('../public/cp-rules-engine.js');

const F = CP.FIELDS;
const TODAY = CP.defaultOrdinal(new Date('2026-09-15T12:00:00Z'));
const overdueRow = {
  [F.orderCode]: 'RO-1', [F.model]: 'DEMO MODEL', [F.colourCode]: 'C1', [F.status]: 'Üretimde', // i18n-ignore
  [F.orderDate]: '2026-06-01', [F.exFactory]: '2026-09-01', [F.retail]: '2026-10-01', [F.inStore]: '2026-10-20',
  [F.delType]: 'Gemi', [F.qty]: 100, [F.season]: '26W', [F.country]: 'India', // i18n-ignore
};

test('no built-in priority or checklist rules are defined', () => {
  assert.equal(Rules.DEFAULT_RULES.length, 0);
  assert.equal(Rules.DEFAULT_PRIORITY_RULES.length, 0);
  assert.equal(Rules.DEFAULT_CHECKLIST_RULES.length, 0);
  assert.deepEqual(Rules.mergeWithDefaults(null), []);
  assert.deepEqual(Rules.effectiveRules([], [], null), []);
});

test('previously saved built-in copies are dropped; user rules stay', () => {
  const own = { id: 'user-own', kind: 'priority', target: 'WATCH', name: 'Mine', conditions: [{ field: '@qty', operator: 'gt', value: 0 }] };
  const legacyPriority = { id: 'builtin_critical_late', builtIn: true, kind: 'priority', target: 'CRITICAL', name: 'Old',
    conditions: [{ field: '@deliveryOutcome', operator: 'in', value: ['EXPECTED_LATE', 'ALREADY_LATE'] }] };
  const legacyChecklist = { id: 'pps', builtIn: true, kind: 'checklist', name: 'PPS onayı', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 42 }] }; // i18n-ignore
  const ids = Rules.effectiveRules([own, legacyPriority, legacyChecklist], [], null).map(rule => rule.id);
  assert.deepEqual(ids, ['user-own']);
  const managed = Rules.normalizeManagedRules({ rules: [{ ...legacyPriority }, { id: 'mod-1', kind: 'priority', target: 'WATCH', name: 'Mod', conditions: [{ field: '@qty', operator: 'gt', value: 0 }] }] });
  assert.deepEqual(managed.rules.map(rule => rule.id), ['mod-1'], 'published built-in copies are dropped too');
});

test('built-in checklist questions are not asked any more', () => {
  const analysis = CP.analyzeOrder(overdueRow, { today: TODAY, transitRules: [] });
  const evaluated = Rules.evaluateOrder(analysis, { rules: Rules.effectiveRules([], [], null), answers: {} });
  assert.deepEqual(evaluated.customItems, []);
  for (const id of Rules.DEFAULT_CHECKLIST_RULE_IDS) assert.equal(evaluated.checklistState[id], 'notApplicable');
  assert.equal(evaluated.priority, 'ON_TRACK');
});

test('predefined calculations (expected late / already late) stay usable in user rules', () => {
  assert.ok(Rules.OUTCOME_VALUES.includes('EXPECTED_LATE'));
  assert.ok(Rules.OUTCOME_VALUES.includes('ALREADY_LATE'));
  const derived = Rules.DERIVED_FIELDS.map(item => item.id);
  for (const id of ['@deliveryOutcome', '@basePriority', '@daysToLoad', '@scheduleBufferDays']) assert.ok(derived.includes(id), id);
  const analysis = CP.analyzeOrder(overdueRow, { today: TODAY, transitRules: [] });
  analysis.deliveryOutcome = 'EXPECTED_LATE';
  const rule = Rules.normalizeRule({ id: 'my-late', kind: 'priority', target: 'CRITICAL', name: 'Late', reasonTr: 'Gecikiyor', reasonEn: 'Late',
    conditions: [{ field: '@deliveryOutcome', operator: 'in', value: ['EXPECTED_LATE', 'ALREADY_LATE'] }] });
  assert.equal(Rules.evaluateOrder(analysis, { rules: [rule], answers: {} }).priority, 'CRITICAL');
});
