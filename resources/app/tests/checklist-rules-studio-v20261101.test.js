'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-studio-v20261101-'));
for (const key of ['BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT', 'BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_AUTH_DATA_ROOT']) {
  process.env[key] = root;
}
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const APP_ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');

const OD = require('../public/order-decision-engine.js');
const Checklist = require('../public/cp-checklist-engine.js');
const Rules = require('../public/cp-rules-engine.js');
const Engine = require('../public/cp-readiness-engine.js');
const OverviewPremium = require('../public/overview-premium.js');
const { mergeValue } = require('../server/lib/preset-share.js');
const { evaluateCpAutomations } = require('../server/lib/cp-automation.js');
const db = require('../server/db.js');

test('Priority Catalog: custom priority tags support custom rank, tone, risk flag and TR/EN fallback', () => {
  assert.equal(typeof OD.normalizePriorityCatalog, 'function');
  assert.equal(typeof OD.makePriorityId, 'function');

  const fabricId = OD.makePriorityId('Kumaş Krizi');
  const waitId = OD.makePriorityId('Üretici Teyidi Bekliyor');
  assert.match(fabricId, /^prio:[a-z0-9-]+$/);
  assert.ok(fabricId.length <= 40);

  const catalog = OD.normalizePriorityCatalog([
    { id: fabricId, tr: 'Kumaş Krizi', tone: 'copper', isRisk: true },
    { id: 'CRITICAL', tr: 'Kritik', en: 'Critical', tone: 'red', isRisk: true, builtIn: true },
    { id: 'ACTION_TODAY', tr: 'Bugün Aksiyon', en: 'Action Today', tone: 'orange', isRisk: true, builtIn: true },
    { id: waitId, tr: 'Üretici Teyidi Bekliyor', en: 'Awaiting Supplier Confirmation', tone: 'teal', isRisk: false },
    { id: 'ACTION_THIS_WEEK', tr: 'Bu Hafta Aksiyon', en: 'Action This Week', tone: 'yellow', isRisk: true, builtIn: true },
    { id: 'WATCH', tr: 'İzlemede', en: 'Watch', tone: 'blue', isRisk: false, builtIn: true },
    { id: 'ON_TRACK', tr: 'Yolunda', en: 'On Track', tone: 'green', isRisk: false, builtIn: true },
  ]);

  // ON_TRACK is always anchored at the bottom; custom tags keep exact user rank order.
  assert.equal(catalog.at(-1).id, 'ON_TRACK');
  assert.equal(catalog[0].id, fabricId);
  assert.equal(catalog[0].en, 'Kumaş Krizi', 'single-input label automatically fills EN fallback');
  assert.equal(catalog[3].id, waitId);
  assert.equal(catalog[3].en, 'Awaiting Supplier Confirmation');

  try {
    OD.setPriorityCatalog(catalog);
    assert.equal(OD.normalizePriority(fabricId), fabricId);
    assert.equal(OD.priorityRank(fabricId), 0);
    assert.equal(OD.priorityRank('CRITICAL'), 1);
    assert.equal(OD.maxPriority('CRITICAL', fabricId), fabricId, 'higher-ranked custom tag beats CRITICAL when placed first');
    assert.equal(OD.maxPriority(waitId, 'ACTION_THIS_WEEK'), waitId);
    assert.equal(OD.priorityLabel(waitId, 'en'), 'Awaiting Supplier Confirmation');
    assert.equal(OD.priorityTone(fabricId), 'copper');
    assert.equal(OD.isRiskPriority(fabricId), true);
    assert.equal(OD.isRiskPriority(waitId), false);
  } finally {
    OD.setPriorityCatalog(null);
  }
});

test('Rules, Readiness, Overview Pulse and Automations evaluate custom priority tags end-to-end', () => {
  const customId = 'prio:kumas-krizi';
  const catalog = OD.normalizePriorityCatalog([
    { id: 'CRITICAL', tr: 'Kritik', en: 'Critical', tone: 'red', isRisk: true, builtIn: true },
    { id: customId, tr: 'Kumaş Krizi', en: 'Fabric Crisis', tone: 'copper', isRisk: true },
    { id: 'ACTION_TODAY', tr: 'Bugün Aksiyon', en: 'Action Today', tone: 'orange', isRisk: true, builtIn: true },
    { id: 'ACTION_THIS_WEEK', tr: 'Bu Hafta Aksiyon', en: 'Action This Week', tone: 'yellow', isRisk: true, builtIn: true },
    { id: 'WATCH', tr: 'İzlemede', en: 'Watch', tone: 'blue', isRisk: false, builtIn: true },
    { id: 'ON_TRACK', tr: 'Yolunda', en: 'On Track', tone: 'green', isRisk: false, builtIn: true },
  ]);

  const rule = Rules.normalizeRule({
    id: 'rule-fabric-crisis',
    kind: 'priority',
    target: customId,
    name: 'Kumaş gecikmesi',
    conditions: [{ field: '@qty', operator: 'gte', value: 50 }],
  }, { priorityCatalog: catalog });

  assert.equal(rule.target, customId, 'normalizeRule must preserve custom prio:* targets');

  const F = Engine.FIELDS;
  const today = Engine.defaultOrdinal('2026-09-15');
  const demoRow = {
    [F.orderCode]: 'PO-900', [F.model]: 'DEMO KNIT', [F.colourCode]: '01', [F.status]: 'Üretimde',
    [F.orderDate]: '2026-08-01', [F.exFactory]: '2026-10-10', [F.retail]: '2026-12-01', [F.inStore]: '2026-12-15',
    [F.delType]: 'Gemi', [F.qty]: 120, [F.season]: '26W', [F.country]: 'TR',
  };

  try {
    OD.setPriorityCatalog(catalog);
    const analysis = Engine.analyzeOrder(demoRow, { today, transitRules: [] });
    const evaluated = Rules.evaluateOrder(analysis, { rules: [rule], answers: {}, priorityCatalog: catalog });
    assert.equal(evaluated.priority, customId);

    const applied = Rules.applyPriorityRules(analysis, [rule], { evaluated, priorityCatalog: catalog });
    analysis.priority = applied.priority;
    analysis.matchedRules = applied.matched.map(r => ({ id: r.id, name: r.name, target: r.target }));

    const model = Engine.recount([analysis], 'retail', { priorityCatalog: catalog });
    assert.equal(model.priorityCounts[customId], 1);
    assert.equal(model.priorityGroups[customId].length, 1);
    assert.equal(Engine.needsAttention(model, { priorityCatalog: catalog }).length, 1);

    const scopes = OverviewPremium.pulseScopes(model, { start: today, priorityCatalog: catalog });
    assert.ok(scopes.some(s => s.key === customId && s.orders.length === 1), 'Overview Pulse includes active custom risk priorities');
    assert.equal(OverviewPremium.priorityBand(customId, catalog), 'warning');

    const autoOut = evaluateCpAutomations({
      automations: [{ id: 'a1', enabled: true, trigger: 'cp_priority', triggerConfig: { priorities: [customId], targetType: 'retail' } }],
      rows: [demoRow],
      rules: [rule],
      priorityCatalog: catalog,
      today,
    });
    assert.equal(autoOut[0].matches.length, 1);
    assert.equal(autoOut[0].matches[0].priorityLabel, 'Kumaş Krizi');
    assert.equal(autoOut[0].matches[0].stageLabel, 'Üretimde');
  } finally {
    OD.setPriorityCatalog(null);
  }
});

test('Moderator Managed Rules & Preset Share carry Priority Catalog and Checklist Custom Statuses', () => {
  const saved = db.replaceCpManagedRules({
    rules: [{ id: 'm1', kind: 'priority', target: 'prio:vip-onay', name: 'VIP Onay', conditions: [{ field: '@qty', operator: 'gt', value: 0 }] }],
    deletedRuleIds: [],
    priorityCatalog: [{ id: 'prio:vip-onay', tr: 'VIP Onayı', en: 'VIP Approval', tone: 'teal', isRisk: true }],
    checklistStatuses: [{ id: 'custom:lab-queue', tr: 'Lab Sırasında', en: 'In Lab Queue', tone: 'blue', resolved: false }],
  }, 0, { id: 'mod', displayName: 'Moderator' });

  assert.equal(saved.priorityCatalog.some(p => p.id === 'prio:vip-onay'), true);
  assert.equal(saved.checklistStatuses.some(s => s.id === 'custom:lab-queue'), true);

  const personal = [{ id: 'prio:benim-etiketim', tr: 'Benim Etiketim', tone: 'copper', isRisk: true }];
  const effective = OD.effectivePriorityCatalog(personal, saved.priorityCatalog);
  assert.ok(effective.some(p => p.id === 'prio:vip-onay' && p.managed === true));
  assert.ok(effective.some(p => p.id === 'prio:benim-etiketim' && !p.managed));

  const targetStore = JSON.stringify({
    version: 2,
    rules: [{ id: 'own-r', kind: 'priority', target: 'prio:own', name: 'Own' }],
    deletedRuleIds: [],
    priorityCatalog: [{ id: 'prio:own', tr: 'Kendi Etiketim', tone: 'blue', isRisk: false }],
  });
  const sourceStore = JSON.stringify({
    version: 2,
    rules: [{ id: 'shared-r', kind: 'priority', target: 'prio:shared', name: 'Shared' }],
    deletedRuleIds: [],
    priorityCatalog: [{ id: 'prio:shared', tr: 'Paylaşılan Etiket', tone: 'red', isRisk: true }],
  });
  const merged = JSON.parse(mergeValue('lcw.cp.rules.priority.v1', targetStore, sourceStore));
  assert.ok(merged.priorityCatalog.some(p => p.id === 'prio:shared'));
  assert.ok(merged.priorityCatalog.some(p => p.id === 'prio:own'));
});

test('Checklist custom statuses support bilingual labels, tones, updates and managed merge without breaking legacy callers', () => {
  const beforeStorage = globalThis.BLStorage;
  const beforeContext = globalThis.BL_USER_CONTEXT;
  const store = new Map();
  globalThis.BL_USER_CONTEXT = { id: 'studio-status-test' };
  globalThis.BLStorage = { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  try {
    const id = Checklist.addCustomStatus({ tr: 'Tedarikçi Teyidi', en: 'Supplier Confirmation', tone: 'teal', resolved: false });
    assert.equal(Checklist.statusLabel(id, 'tr'), 'Tedarikçi Teyidi');
    assert.equal(Checklist.statusLabel(id, 'en'), 'Supplier Confirmation');
    assert.equal(Checklist.statusTone(id), 'teal');
    assert.equal(Checklist.isResolved(id), false);

    assert.equal(Checklist.updateCustomStatus(id, { tr: 'Teyit Alındı', en: 'Confirmed', tone: 'green', resolved: true }), true);
    assert.equal(Checklist.statusLabel(id, 'tr'), 'Teyit Alındı');
    assert.equal(Checklist.statusLabel(id, 'en'), 'Confirmed');
    assert.equal(Checklist.statusTone(id), 'green');
    assert.equal(Checklist.isResolved(id), true);

    Checklist.setManagedStatuses([{ id: 'custom:mod-hold', tr: 'Moderatör Bekletme', en: 'Moderator Hold', tone: 'orange', resolved: false }]);
    assert.equal(Checklist.statusLabel('custom:mod-hold', 'en'), 'Moderator Hold');
    assert.equal(Checklist.statusTone('custom:mod-hold'), 'orange');
  } finally {
    Checklist.setManagedStatuses([]);
    globalThis.BLStorage = beforeStorage;
    globalThis.BL_USER_CONTEXT = beforeContext;
  }
});

test('Checklist scope presets and basic auto-status conditions round-trip cleanly without forcing raw formulas', () => {
  assert.equal(typeof Rules.checklistScopePreset, 'function');
  assert.equal(typeof Rules.applyChecklistScopePreset, 'function');

  const item = Rules.normalizeRule({ id: 'chk_demo', kind: 'checklist', name: 'Demo Check' });
  Rules.applyChecklistScopePreset(item, { preset: 'window', maxDaysToLoad: 35, minOrderAgeDays: 15 });
  const detected = Rules.checklistScopePreset(item);
  assert.equal(detected.preset, 'window');
  assert.equal(detected.maxDaysToLoad, 35);
  assert.equal(detected.minOrderAgeDays, 15);

  const withBasicAuto = Rules.normalizeRule({
    id: 'chk_auto',
    kind: 'checklist',
    name: 'Auto Check',
    conditions: [{ field: '@qty', operator: 'gt', value: 0 }],
    autoStatus: 'approved',
    autoMode: 'basic',
    autoMatch: 'all',
    autoConditions: [{ field: '@stage', operator: 'eq', value: 'LOADING' }],
  });
  assert.equal(withBasicAuto.autoFormula, '=[@stage]="LOADING"');
  const evaluated = Rules.evaluateOrder({
    orderKey: 'PO-1', orderCode: 'PO-1', stage: 'LOADING', daysToLoad: 10, orderAgeDays: 20, qty: 50, sourceRow: {},
  }, { rules: [withBasicAuto], answers: {} });
  assert.equal(evaluated.checklistState.chk_auto, 'approved');
});

test('Web Worker and synchronous decision runtime match with custom Priority Catalog and managed statuses', async () => {
  const storage = new Map();
  let revision = 1;
  function makeHarness(useWorker) {
    const context = {
      console, Date, Intl, Set, Map, WeakMap, Promise, setTimeout, clearTimeout,
      performance: { now: () => 1 },
      BLOrderDecisionEngine: require('../public/order-decision-engine.js'),
      BLCpReadinessEngine: Engine,
      BLCpChecklistEngine: Checklist,
      BLCpRulesEngine: Rules,
      BLCpDecisionRuntime: require('../public/cp-decision-runtime.js'),
      BL_USER_CONTEXT: { id: 'worker-studio-user' },
      appLang: 'tr',
      state: { overrides: { transitRules: [] } },
      BL_CP_DECISION_DATA_REVISION: () => revision,
      localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
      document: { getElementById: () => null, querySelectorAll: () => [], addEventListener: () => {} },
      addEventListener: () => {}, dispatchEvent: () => {}, CustomEvent: class {},
    };
    if (useWorker) context.Worker = function () { return require('./helpers/cp-browser-worker')(); };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(read('public/cp-overview-assistant.js'), context);
    return context.BLCpAssistant;
  }

  const syncAssistant = makeHarness(false);
  const workerAssistant = makeHarness(true);
  const F = Engine.FIELDS;
  const rows = Array.from({ length: 260 }, (_, i) => ({
    [F.orderCode]: `W-${i}`, [F.qty]: i % 2 === 0 ? 200 : 10, [F.status]: 'Üretimde',
    [F.exFactory]: '2026-10-05', [F.model]: 'DEMO', [F.colourCode]: '01',
    [F.retail]: '2026-12-01', [F.inStore]: '2026-12-15',
  }));
  const customCatalog = OD.normalizePriorityCatalog([
    { id: 'prio:vip-acil', tr: 'VIP Acil', en: 'VIP Urgent', tone: 'red', isRisk: true },
    ...OD.DEFAULT_PRIORITY_CATALOG,
  ]);
  const rule = Rules.normalizeRule({
    id: 'vip-qty', kind: 'priority', target: 'prio:vip-acil', name: 'VIP Adet',
    conditions: [{ field: '@qty', operator: 'gte', value: 100 }],
  }, { priorityCatalog: customCatalog });

  for (const a of [syncAssistant, workerAssistant]) {
    a._state.priorityCatalog = customCatalog;
    a._state.rules = [rule];
  }
  revision++;
  const expected = syncAssistant.computeDecisionsForRows(rows);
  const actual = await workerAssistant.computeDecisionsForRowsAsync(rows);
  assert.equal(expected.model.priorityCounts['prio:vip-acil'], 130);
  assert.deepEqual(JSON.parse(JSON.stringify(actual.model)), JSON.parse(JSON.stringify(expected.model)));
  OD.setPriorityCatalog(null);
});

test('Rebuilt Studio UI exposes 3-tab hub, inline priority tags, bulk queue actions, optional reasons and CP shortcut', () => {
  const view = read('public/cp-overview-assistant.js');
  const html = read('public/index.html');
  assert.match(view, /data-cpa-studio-tab=/);
  assert.match(view, /data-cpa-priority-add/);
  assert.match(view, /data-cpa-bulk-status/);
  assert.doesNotMatch(view, /validateNewPriorityReasons/, 'mandatory dual-language reason lockout must be removed');
  assert.doesNotMatch(view, /data-cpa-ai-download/, 'obsolete manual .md AI download clutter must be removed in favor of BuyerLogAI');
  assert.match(html, /id="cpChecklistRulesBtn"/, 'CP toolbar exposes direct shortcut to Checklist & Rules Studio');
});

test('Priority tag IDs remain unique when labels collide after normalization', () => {
  const first = OD.makePriorityId('Supplier Confirmation');
  const second = OD.makePriorityId('Supplier Confirmation', [first]);
  assert.notEqual(second, first);
  assert.equal(OD.isCustomPriorityCode(second), true);
});

test('Full catalogs retain all built-ins and anchor On Track after custom tags', () => {
  const catalog = OD.normalizePriorityCatalog(Array.from({ length: 50 }, (_, i) => ({ id: `prio:demo-${i}`, tr: `Demo ${i}`, tone: 'copper' })));
  assert.equal(catalog.length, 40);
  for (const entry of OD.DEFAULT_PRIORITY_CATALOG) assert.ok(catalog.some(item => item.id === entry.id));
  assert.equal(catalog.at(-1).id, 'ON_TRACK');
});

test('Moderator browser channel carries both catalogs alongside rules without dropping metadata', async () => {
  let body;
  const context = { localStorage: { setItem() {} }, fetch: async (_url, options) => { body = JSON.parse(options.body); return { ok: true, json: async () => body }; } };
  context.window = context;
  vm.runInNewContext(read('public/cp-managed-rules.js'), context);
  const priorityCatalog = [{ id: 'prio:demo-published', tr: 'Demo', en: 'Demo', tone: 'copper', isRisk: true }];
  const checklistStatuses = [{ id: 'custom:demo-published', tr: 'Demo', en: 'Demo', tone: 'teal', resolved: false }];
  await context.BLCpManagedRules.save({ rules: [], deletedRuleIds: [], priorityCatalog, checklistStatuses }, 0);
  assert.deepEqual(body.priorityCatalog, priorityCatalog);
  assert.deepEqual(body.checklistStatuses, checklistStatuses);
});
