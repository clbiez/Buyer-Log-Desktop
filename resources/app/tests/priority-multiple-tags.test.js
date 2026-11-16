'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const OD = require('../public/order-decision-engine');
const Rules = require('../public/cp-rules-engine');
const Orders = require('../public/orders-priority-engine');
const flow = require('../public/overview-global-flow');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');
const ids = ['prio:a', 'prio:b', 'prio:c'];
const catalog = (hides = ['prio:c']) => OD.normalizePriorityCatalog(ids.map(id => ({ id, tr: id, en: id, ...(id === 'prio:b' ? { hides } : {}) })));
const rules = ids.map((target, i) => Rules.normalizeRule({ id: `rule-${i}`, kind: 'priority', target, conditions: [{ field: 'Quantity', operator: 'gte', value: i + 1 }] }));
test.after(() => OD.setPriorityCatalog(null));

test('all matched priority labels survive evaluation, duplicate targets are deduplicated and urgency stays independent', () => {
  const cat = catalog();
  const analysis = { priority: 'ON_TRACK', sourceRow: { Quantity: 10 } };
  const result = Rules.applyPriorityRules(analysis, [...rules, { ...rules[1], id: 'duplicate' }], { priorityCatalog: cat });
  assert.equal(result.priority, ids[0]);
  assert.deepEqual(result.priorityTags, ids);
  assert.equal(result.matched.length, 4);
  assert.equal(result.signals.length, 4, 'hidden matches retain their reasons');
  const prepared = Rules.applyPriorityRules(analysis, rules, { evaluated: result, priorityCatalog: cat });
  assert.deepEqual(prepared.priorityTags, ids);
  assert.deepEqual(OD.resolvePriorityTags(result.priority, result.priorityTags, [], cat), { visible: ids.slice(0, 2), hidden: [ids[2]] });
});

test('suppression only affects matching labels; unrelated labels remain; duplicates and dangling references are cleaned', () => {
  const cat = catalog(['prio:c', 'prio:c', 'prio:b', 'prio:deleted']);
  assert.deepEqual(cat.find(e => e.id === ids[1]).hides, [ids[2]]);
  assert.deepEqual(OD.resolvePriorityTags(ids[0], ids.slice(0, 2), [], cat).visible, ids.slice(0, 2));
  assert.deepEqual(OD.resolvePriorityTags(ids[1], ids.slice(1), [], cat), { visible: [ids[1]], hidden: [ids[2]] });
  assert.deepEqual(OD.resolvePriorityTags(ids[2], [ids[2]], [], cat).visible, [ids[2]]);
  assert.deepEqual(OD.resolvePriorityTags(ids[0], ids, [], catalog([])).visible, ids);
});

test('chains and imported cycles never hide every tag; hidden primary does not change urgency', () => {
  const cat = OD.normalizePriorityCatalog([
    { id: ids[0], tr: 'A', hides: [ids[1]] }, { id: ids[1], tr: 'B', hides: [ids[2]] }, { id: ids[2], tr: 'C' },
  ]);
  assert.deepEqual(OD.resolvePriorityTags(ids[0], ids, [], cat), { visible: [ids[0]], hidden: ids.slice(1) });
  assert.deepEqual(OD.resolvePriorityTags(ids[0], [ids[0], ids[2]], [], cat).visible, [ids[0], ids[2]], 'unmatched intermediate tags cannot suppress another match');
  const cycle = OD.normalizePriorityCatalog([{ id: ids[0], tr: 'A', hides: [ids[1]] }, { id: ids[1], tr: 'B', hides: [ids[0]] }]);
  assert.deepEqual(OD.resolvePriorityTags(ids[0], ids.slice(0, 2), [], cycle).visible, [ids[0]]);
  assert.deepEqual(OD.resolvePriorityTags(ids[2], ids, [], catalog([ids[0], ids[2]])).visible, [ids[1]]);
});

test('tracking labels remain independent and default ON_TRACK is retained for tracking-only orders', () => {
  const cat = OD.normalizePriorityCatalog([{ id: 'prio:tracking', tr: 'Tracking', usage: 'tracking' }]);
  assert.deepEqual(OD.resolvePriorityTags('ON_TRACK', [], ['prio:tracking'], cat).visible, ['ON_TRACK', 'prio:tracking']);
});

test('personal hiding relationships survive managed catalog merging and JSON round trips', () => {
  const managed = [{ id: ids[2], tr: 'C', en: 'C' }];
  const personal = OD.normalizePriorityCatalog([{ id: ids[1], tr: 'B', hides: [ids[2]] }], managed);
  assert.deepEqual(personal.find(e => e.id === ids[1]).hides, [ids[2]]);
  const effective = OD.effectivePriorityCatalog(JSON.parse(JSON.stringify(personal)), managed);
  assert.deepEqual(OD.resolvePriorityTags(ids[1], ids.slice(1), [], effective), { visible: [ids[1]], hidden: [ids[2]] });
});

test('Orders batches and cooperative runner transport all matched priority labels', async () => {
  const cat = catalog();
  const row = { 'Order Code': 'DEMO-1', 'Model Name': 'DEMO', 'C.Code': '01', Quantity: 10 };
  const spec = { rules, priorityCatalog: cat };
  const session = Orders.createSession(spec);
  assert.deepEqual(session.evaluateRow(row).priorityTags, ids);
  assert.deepEqual(session.evaluateBatch([row]).priorityTags, [ids]);
  globalThis.BLOrdersPriorityEngine = Orders;
  try {
    const runner = require('../public/orders-priority');
    const out = await runner.run([row], spec, { forceFallback: true });
    assert.deepEqual(out.priorityTags, [ids]);
  } finally { delete globalThis.BLOrdersPriorityEngine; }
});

test('table filters retain every match while clipboard and Global Flow show the reduced labels', () => {
  const cat = catalog();
  OD.setPriorityCatalog(cat);
  const row = { Priority: ids[0], _priorityTags: ids, 'Order Code': 'DEMO-1', 'Model Name': 'DEMO', 'C.Code': '01', Country: 'Turkey', STATUS: 'Production' };
  const api = loadAppMainFunctions(['priorityHas', 'actionPriorityCode', 'priorityDisplay', 'norm', 'cellPlainText'], {
    window: { BLOrderDecisionEngine: OD }, appLang: 'en', cpLogisticHasDetails: () => false,
  });
  assert.equal(api.priorityHas(row.Priority, ids[1], row), true);
  assert.equal(api.priorityHas(row.Priority, ids[2], row), true, 'hidden matching labels remain filterable');
  assert.equal(api.cellPlainText({ k: 'Priority', type: 'priority' }, row, {}), ids.slice(0, 2).join(' · '));
  const previous = globalThis.BLOrderDecisionEngine;
  globalThis.BLOrderDecisionEngine = OD;
  try {
    const [record] = flow.shipmentPartialsFromRows([row], 'cp');
    assert.deepEqual(record.priorityTags, ids.slice(0, 2));
    assert.equal(record.actionPriority, ids[0]);
  } finally { globalThis.BLOrderDecisionEngine = previous; }
});

test('Priority defaults fit multiple badges while explicit column widths stay unchanged', () => {
  const api = loadAppMainFunctions(['colWidthPx'], { colmgr: { cp: { widthPx: {} } }, defaultMinPx: () => 100 });
  assert.equal(api.colWidthPx('cp', { k: 'Priority', type: 'priority' }), 300);
  api.context.colmgr.cp.widthPx.Priority = 180;
  assert.equal(api.colWidthPx('cp', { k: 'Priority', type: 'priority' }), 180);
  assert.equal(api.colWidthPx('cp', { k: 'Other', type: 'text' }), 135);
});
