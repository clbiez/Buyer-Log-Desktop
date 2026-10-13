'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Checklist = require('../public/cp-checklist-engine.js');
const Rules = require('../public/cp-rules-engine.js');
const Sync = require('../public/checklist-supplier-sync.js');

function order(overrides = {}) {
  return {
    orderKey: 'PO-100', orderCode: 'PO-100', plmId: 'PLM-1',
    modelName: 'Model A', colourCode: 'C1', plannedLoadDate: 20400,
    stage: 'LOADING', daysToLoad: 12, orderAgeDays: 80,
    sourceRow: { License: 'F1' }, qty: 20,
    priority: 'ON_TRACK', deliveryOutcome: 'ON_TRACK', ...overrides,
  };
}
function rule(options = {}) {
  return Rules.normalizeRule({
    id: 'custom_check', kind: 'checklist', name: 'Example', enabled: true,
    approvalScope: 'order', mode: 'basic', expressionVersion: Rules.EXPRESSION_VERSION,
    conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }],
    autoStatus: 'approved', autoFormula: '=[@stage]="LOADING"', ...options,
  });
}
function evaluate(analysis, answers = {}, currentRule = rule(), plmEvidence) {
  return Rules.evaluateOrder(analysis, { rules: [currentRule], answers, plmEvidence });
}

test('checklist automatic status follows its independent formula while manual states remain authoritative', () => {
  const a = order();
  const matching = evaluate(a);
  assert.equal(matching.checklistState.custom_check, 'approved');
  assert.deepEqual(matching.autoDecisions, [{ itemId: 'custom_check', state: 'approved' }]);
  assert.equal(evaluate(order({ stage: 'PRODUCTION' })).checklistState.custom_check, 'open');
  assert.deepEqual(evaluate(order({ daysToLoad: 90 })).autoDecisions, [{ itemId: 'custom_check', state: 'approved' }], 'The native automatic formula remains independent of the question applicability condition');
  assert.equal(evaluate(a, {}, rule({ autoStatus: '' })).checklistState.custom_check, 'open');
});

test('production-only checklist is auto-approved once loading begins, even outside the question condition', () => {
  const productionOnly = rule({
    conditions: [
      { field: '@stage', operator: 'eq', value: 'PRODUCTION' },
      { field: '@daysToLoad', operator: 'lte', value: 60 },
    ],
  });
  const production = evaluate(order({ stage: 'PRODUCTION' }), {}, productionOnly);
  assert.equal(production.checklistState.custom_check, 'open');
  const loading = evaluate(order({ stage: 'LOADING' }), {}, productionOnly);
  assert.equal(loading.checklistState.custom_check, 'approved');
  assert.deepEqual(loading.autoDecisions, [{ itemId: 'custom_check', state: 'approved' }]);
  assert.ok(loading.customItems.some(item => item.id === 'custom_check'));
});

test('manual Pending/Rejected and PLM/other-PO approvals take precedence over automation', () => {
  const a = order();
  for (const state of ['open', 'rejected', 'notRequired']) {
    const direct = Checklist.makeAnswer(state, a, { source: 'buyer_log' });
    const got = evaluate(a, { [Checklist.answerKey(a.orderKey, 'custom_check')]: direct });
    assert.equal(got.checklistState.custom_check, state);
    assert.deepEqual(got.autoDecisions, []);
  }
  const sharedRule = rule({ approvalScope: 'option' });
  const option = Checklist.optionAnswerKey(a, 'custom_check');
  assert.ok(option);
  const shared = evaluate(a, { [option]: Checklist.makeAnswer('approved', a, { source: 'buyer_log' }) }, sharedRule);
  assert.equal(shared.checklistState.custom_check, 'approved');
  assert.deepEqual(shared.autoDecisions, [], 'a shared manual approval cannot be overwritten by automation');
  const plm = evaluate(a, {}, rule(), () => ({ state: 'approved' }));
  assert.equal(plm.checklistState.custom_check, 'approved');
  assert.deepEqual(plm.autoDecisions, []);
});

test('invalid auto status formula is rejected, never executed', () => {
  const broken = rule({ autoFormula: '=[@stage] + (' });
  assert.equal(Rules.validateRule(broken).valid, false);
  assert.deepEqual(evaluate(order(), {}, broken).autoDecisions, []);
});

test('user-defined statuses survive local preference reload and sync normalization', () => {
  const beforeStorage = globalThis.BLStorage;
  const beforeContext = globalThis.BL_USER_CONTEXT;
  const data = new Map();
  globalThis.BL_USER_CONTEXT = { id: 'checklist-regression-test' };
  globalThis.BLStorage = {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => { data.set(key, value); },
  };
  try {
    const active = Checklist.addCustomStatus('Waiting Supplier', false);
    const done = Checklist.addCustomStatus('Confirmed', true);
    assert.equal(Checklist.statusLabel(active, 'en'), 'Waiting Supplier');
    assert.equal(Checklist.isResolved(active), false);
    assert.equal(Checklist.isResolved(done), true);
    assert.ok(Checklist.statusIds().includes(active));
    assert.equal(Sync.normalizeState(active), active);
    assert.equal(Sync.normalizeState('Waiting Supplier'), active);
    assert.equal(Checklist.makeAnswer(done, order()).state, done);
    assert.equal(Checklist.deleteCustomStatus(active), true);
    assert.equal(Checklist.normalizeStatus(active), active, 'historic answer survives deleted definition');
  } finally {
    globalThis.BLStorage = beforeStorage;
    globalThis.BL_USER_CONTEXT = beforeContext;
  }
});
