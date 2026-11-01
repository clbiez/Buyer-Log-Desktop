'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const OD = require('../public/order-decision-engine');
const Rules = require('../public/cp-rules-engine');
const order = { orderKey: 'DEMO-1', orderCode: 'DEMO-1', priority: 'ON_TRACK', basePriority: 'ON_TRACK', qty: 100, daysToLoad: 5, stage: 'PRODUCTION', sourceRow: {} };
const rule = (id, target, value = 10) => Rules.normalizeRule({ id, kind: 'priority', name: id, target, conditions: [{ field: '@daysToLoad', operator: 'lte', value }] });
test('preview separates matching orders from effective changes and detects disabling a rule', () => {
 const critical = rule('critical', 'CRITICAL'), watch = rule('watch', 'WATCH');
 const preview = Rules.previewRuleImpact([order], watch, { rules: [critical] });
 assert.equal(preview.count, 1);
 assert.equal(preview.changed, 0, 'a stronger existing rule keeps the effective priority');
 const changed = Rules.previewRuleImpact([{ ...order, priority: 'CRITICAL' }], { ...critical, enabled: false }, { rules: [critical] });
 assert.equal(changed.changed, 1, 'preview recalculates from base priority rather than the already escalated result');
});
test('explicit tracking tags coexist with critical urgency and preserve legacy non-risk priorities', () => {
 const catalog = OD.normalizePriorityCatalog([{ id: 'prio:waiting', tr: 'Demo', en: 'Demo', usage: 'tracking', isRisk: true, tone: 'teal' }, ...OD.DEFAULT_PRIORITY_CATALOG]);
 const tracking = rule('waiting', 'prio:waiting'), critical = rule('critical', 'CRITICAL');
 const result = Rules.evaluateOrder(order, { rules: [tracking, critical], answers: {}, priorityCatalog: catalog });
 assert.equal(result.priority, 'CRITICAL');
 assert.deepEqual(result.trackingTags, ['prio:waiting']);
 assert.equal(catalog[0].isRisk, false);
 const legacyCatalog = OD.normalizePriorityCatalog([{ id: 'prio:legacy', tr: 'Legacy', isRisk: false }, ...OD.DEFAULT_PRIORITY_CATALOG]);
 assert.equal(Rules.evaluateOrder(order, { rules: [rule('legacy', 'prio:legacy')], priorityCatalog: legacyCatalog }).priority, 'prio:legacy');
});

test('tracking metadata reaches server automation filters without replacing the urgency code', () => {
 const Engine = require('../public/cp-readiness-engine');
 const { evaluateCpAutomations, FIELDS } = require('../server/lib/cp-automation');
 const catalog = OD.normalizePriorityCatalog([{ id: 'prio:documents', tr: 'Demo', usage: 'tracking', tone: 'teal' }, ...OD.DEFAULT_PRIORITY_CATALOG]);
 const F = Engine.FIELDS;
 const rows = [{ [F.orderCode]: 'DEMO-1', [F.model]: 'DEMO', [F.colourCode]: '01', [F.status]: 'Üretimde', [F.qty]: 100,
  [F.orderDate]: '2026-08-01', [F.exFactory]: '2026-09-20', [F.retail]: '2026-12-01', [F.inStore]: '2026-12-15', [F.delType]: 'Gemi' }];
 const output = evaluateCpAutomations({ rows, today: Engine.defaultOrdinal('2026-09-15'), priorityCatalog: catalog,
  rules: [rule('documents', 'prio:documents'), rule('critical', 'CRITICAL')],
  automations: [{ id: 'tracking', enabled: true, triggerConfig: { priorities: ['prio:documents'] } }] });
 assert.equal(output[0].matches.length, 1);
 assert.equal(output[0].matches[0].row[FIELDS.priorityCode], 'CRITICAL');
});

test('the compact widget defaults to four rows and preserves custom saved heights', () => {
 const Layout = require('../public/overview-layout');
 assert.equal(Layout.locate(Layout.defaults(), 'checklistRules').item.h, 4);
 const saved = Layout.normalize({ version: Layout.VERSION, known: Layout.widgets, pages: [{ items: [{ key: 'checklistRules', x: 0, y: 0, w: 8, h: 9 }] }] });
 assert.equal(Layout.locate(saved, 'checklistRules').item.h, 9);
});

test('Overview shows the full attention total beyond the displayed list limit', () => {
 const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
 const { extractFunction } = require('./helpers/app-main-functions');
 const source = fs.readFileSync(path.join(__dirname, '../public/cp-overview-assistant.js'), 'utf8');
 const render = vm.runInNewContext(`(${extractFunction(source.slice(source.indexOf('function overviewWidgetHtml')), 'overviewWidgetHtml')})`, {
  state: { model: { orders: Array.from({ length: 6001 }, () => ({ priority: 'CRITICAL', qty: 1 })) } },
  Engine: require('../public/cp-readiness-engine'), L: (tr, en) => en, esc: String, int: String,
  openQueueCount: () => 0, prioritiesOverviewBlock: () => '', checklistCard: () => '',
 });
 assert.match(render(), /data-cpa-summary-attention><b>6001<\/b>/);
});

test('preview ignores checklist key order when a draft keeps the same effective states', () => {
 const a = Rules.normalizeRule({ id: 'first', kind: 'checklist', name: 'First', conditions: [{ field: '@qty', operator: 'gt', value: 0 }] });
 const b = Rules.normalizeRule({ id: 'second', kind: 'checklist', name: 'Second', conditions: [{ field: '@qty', operator: 'gt', value: 0 }] });
 const preview = Rules.previewRuleImpact([order], { ...a, name: 'Renamed only' }, { rules: [a, b] });
 assert.equal(preview.count, 1);
 assert.equal(preview.changed, 0);
});

test('preview reports automatic answer writes without changing any stored answer', () => {
 const answers = {};
 const auto = Rules.normalizeRule({ id: 'auto-demo', kind: 'checklist', name: 'Demo auto', conditions: [{ field: '@qty', operator: 'gt', value: 0 }],
  autoStatus: 'approved', autoMode: 'basic', autoConditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }] });
 const preview = Rules.previewRuleImpact([order], auto, { rules: [], answers });
 assert.equal(preview.automaticAnswers, 1);
 assert.deepEqual(answers, {});
 const key = require('../public/cp-checklist-engine').answerKey(order.orderKey, auto.id);
 const manual = { [key]: { state: 'rejected', source: 'manual' } };
 assert.equal(Rules.previewRuleImpact([order], auto, { rules: [], answers: manual }).automaticAnswers, 0);
});
