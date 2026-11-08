'use strict';

// Promoted from phase-6-client preparation; original assertions are preserved.
// No production source rewriting, network, credentials, or persistent data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixtures} = require('./fixtures/cp-orders-revision.cjs');

const sourcePath = path.resolve(__dirname, '../public/app-main.js');
const source = fs.readFileSync(sourcePath, 'utf8');

function between(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'real source anchors must remain discoverable: ' + start);
  return source.slice(a, b);
}

function load() {
  const fixture = fixtures(), events = [], renders = [], listeners = new Map();
  const cpCache = {fixture: 'cp-cache'}, ordersCache = {fixture: 'orders-cache'};
  const context = {
    state: fixture.state, appLang: 'en', sourceName: 'Synthetic demo',
    force: false, leanReload: true, keepOrdersForPartialRefresh: false,
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    window: {
      dispatchEvent: event => events.push(event),
      addEventListener: (name, listener) => listeners.set(name, listener),
    },
    _unifiedPriorityDataRevision: 1,
    _unifiedPriorityCache: {cp: cpCache, orders: ordersCache},
    currentActiveTab: () => 'cp',
    renderCP: () => renders.push('cp'),
    renderOrders: () => renders.push('orders'),
    scheduleOverviewRender: reason => renders.push(reason),
    reviveServerDates() {}, applyPricingRulesToLoadedRows() {},
    buildOrdersFilters() {}, applyCoreAutoFilterState() {},
    setOrdersLoadingState() {},
    showToast(message) {assert.fail('unexpected error path: ' + message);},
    ensureCollectionCatalogLoaded: async () => assert.fail('fixture already supplies catalogs'),
    fetchOrdersProjection: async () => ({payload: fixture.projection}),
    ordersLoadPromise: null,
  };
  vm.createContext(context);
  vm.runInContext(between('const _unifiedPriorityTableRevision=', 'function unifiedPriorityRowActive(')
    + '\nthis.tableRevision=()=>({..._unifiedPriorityTableRevision});', context, {filename: sourcePath});
  return {
    fixture, context, events, renders, listeners, cpCache, ordersCache,
    revision: () => context.window.BL_CP_DECISION_DATA_REVISION(),
    run: code => vm.runInContext(code, context, {filename: sourcePath}),
    hydrate(data) {
      context.data = data;
      // Execute the actual Orders branch in loadFromServer, including fallback.
      this.run(between('    if(Array.isArray(data.orders)){\n      state.orders =',
        '    if(Array.isArray(data.orderSummary)){'));
    },
    hydrateCpAndOrders(data) {
      context.data = data;
      context.userVisibleRefresh = false;
      context.targets = null;
      context.cpClientWorkInProgress = () => context.state.cpDirty.size > 0;
      context.state.cpLogisticExpanded = new Set();
      context._deferredTabRenders = new Set();
      this.run('(function(){' + between('    const partialRefreshTargets=userVisibleRefresh',
        '    if(Array.isArray(data.orderSummary)){') + '})()');
    },
  };
}

test('real personal-context listener preserves CP input revision and invalidates priority consumers', () => {
  const s = load(), before = s.revision(), table = s.context.tableRevision();
  s.run(between("window.addEventListener('bl:cp-decision-context-changed',", '// ---------- FILE HANDLING ----------'));
  s.listeners.get('bl:cp-decision-context-changed')();
  assert.equal(s.revision(), before);
  assert.equal(s.context.tableRevision().cp, table.cp + 1);
  assert.equal(s.context.tableRevision().orders, table.orders);
  assert.equal(s.context._unifiedPriorityCache.cp, null);
  assert.equal(s.context._unifiedPriorityCache.orders, s.ordersCache);
  assert.equal(s.events.length, 1);
  assert.equal(s.events[0].type, 'bl:global-flow-data-changed');
  assert.equal(s.events[0].detail.reason, 'personal-decision-context');
  assert.deepEqual(Array.from(s.events[0].detail.tables), ['cp']);
  assert.deepEqual(s.renders, ['cp', 'personal-decision-context']);
});

test('actual on-demand Orders loader preserves CP revision, cache and local state', async () => {
  const s = load(), before = s.revision(), cp = s.context.state.cp;
  const selected = s.context.state.cpSelected, dirty = s.context.state.cpDirty;
  s.run(between('async function ensureOrdersLoaded(', 'window.BLEnsureOrdersLoaded='));
  assert.equal(await s.context.ensureOrdersLoaded({force: true}), true);
  assert.equal(s.revision(), before);
  assert.equal(s.context.tableRevision().cp, 1);
  assert.equal(s.context.tableRevision().orders, 2);
  assert.equal(s.context._unifiedPriorityCache.cp, s.cpCache);
  assert.equal(s.context._unifiedPriorityCache.orders, null);
  assert.equal(s.context.state.cp, cp);
  assert.equal(s.context.state.cpSelected, selected);
  assert.equal(s.context.state.cpDirty, dirty);
  assert.equal(s.context.state.orders.rows[0]._canEdit, false);
  assert.equal(s.context.state.orders.rows[0]['Order Quantity'], 0);
  assert.deepEqual(Array.from(s.events[0].detail.tables), ['orders']);
});

test('cancelled on-demand Orders load publishes no revision or data', async () => {
  const s = load(), before = s.revision(), orders = s.context.state.orders;
  s.context.fetchOrdersProjection = async () => ({cancelled: true});
  s.run(between('async function ensureOrdersLoaded(', 'window.BLEnsureOrdersLoaded='));
  assert.equal(await s.context.ensureOrdersLoaded({force: true}), false);
  assert.equal(s.revision(), before);
  assert.equal(s.context.state.orders, orders);
  assert.equal(s.context._unifiedPriorityCache.cp, s.cpCache);
  assert.equal(s.context._unifiedPriorityCache.orders, s.ordersCache);
  assert.equal(s.events.length, 0);
});

for (const [name, payload] of [['hydrated', 'loaded'], ['deferred', 'deferred']]) {
  test('loadFromServer Orders-only ' + name + ' branch must preserve the CP decision input revision', () => {
    const s = load(), before = s.revision(), cp = s.context.state.cp;
    s.hydrate(s.fixture[payload]);
    assert.equal(s.context.state.cp, cp, 'the CP dataset did not change');
    assert.equal(s.events.length, 1, 'Orders consumers must still be notified');
    assert.equal(s.events[0].detail.reason, 'server-orders-' + name);
    assert.equal(s.revision(), before, 'Orders-only ' + name + ' must not invalidate CP decision inputs');
    assert.equal(s.context.tableRevision().cp, 1);
    assert.equal(s.context.tableRevision().orders, 2);
    assert.equal(s.context._unifiedPriorityCache.cp, s.cpCache);
    assert.equal(s.context._unifiedPriorityCache.orders, null);
    assert.deepEqual(Array.from(s.events[0].detail.tables), ['orders']);
    assert.deepEqual(Array.from(s.context.state.cpSelected), [1]);
    assert.deepEqual(Array.from(s.context.state.cpDirty), [1]);
    assert.equal(s.context.state.cp.rows, cp.rows);
  });
}

test('real CP hydration replaces the dataset and advances CP input revision', () => {
  const s = load(), before = s.revision(), previous = s.context.state.cp;
  s.context.state.cpDirty.clear();
  const rows = [{...previous.rows[0], 'Ex-factory': '2026-12-01'}];
  s.hydrateCpAndOrders({cp: rows});
  assert.equal(s.context.state.cp.rows, rows);
  assert.notEqual(s.context.state.cp, previous);
  assert.equal(s.revision(), before + 1);
  assert.equal(s.context._unifiedPriorityCache.cp, null);
  assert.equal(s.events[0].detail.reason, 'server-cp-hydrated');
});

test('combined CP and Orders hydration retains CP invalidation without a second CP input increment', () => {
  const s = load(), before = s.revision();
  s.context.state.cpDirty.clear();
  const rows = [{...s.context.state.cp.rows[0], 'Order Quantity': 17}];
  s.hydrateCpAndOrders({cp: rows, orders: s.fixture.loaded.orders});
  assert.equal(s.context.state.cp.rows, rows);
  assert.equal(s.revision(), before + 1);
  assert.equal(s.context._unifiedPriorityCache.cp, null);
  assert.equal(s.context._unifiedPriorityCache.orders, null);
  assert.equal(s.events.length, 2);
  assert.equal(s.events[0].detail.reason, 'server-cp-hydrated');
  assert.deepEqual(Array.from(s.events[0].detail.tables), ['cp', 'orders']);
  assert.equal(s.events[1].detail.reason, 'server-orders-hydrated');
  assert.deepEqual(Array.from(s.events[1].detail.tables), ['orders']);
});

// Full loadFromServer execution, with synthetic GET transport and UI adapters.
// Pricing engines are covered by their own regression packages. Here their
// calls remain observable; the real shared-rule and CP/Orders invalidations run.
function fullLoader() {
  const s = load(), c = s.context, pricingCalls = [];
  // Preserve the real error formatter so a missing fixture dependency cannot
  // mask the loader's original error with a second ReferenceError.
  s.run(between('function refreshDiagnosisText(', 'function showSourceRefreshFailureModal('));
  // Execute the production full-data gate and its private controller map;
  // never substitute a no-op or an unconditional permission result.
  s.run(between('async function ensureOrdersLoaded(', 'window.BLEnsureOrdersLoaded='));
  s.run(between('const _ordersFullViewControllers=', '/* Global Flow Map veri kaynağı.'));
  c.state.overrides = {pricingRules: [], transitRules: []};
  c.state.storeRevisions = {};
  c.state.cpLogisticExpanded = new Set();
  const noop = () => {};
  for (const key of ['setServerStatus', 'updSourceHint', 'hideSourceFilterRequiredNotice',
    'syncModelImageRegistry', 'renderAntrepoSourceControl', 'renderAsasSourceControl',
    'renderLflSourceControl', 'applyLicensorMerges', 'applyIncomingPricingRules',
    'saveLocalTransitRules', 'saveLocalNonDtrManufacturers', 'renderHorizonBadges',
    'setWarnings', 'buildCPFilters', 'refreshSubmfrList', 'refreshLicenseList',
    'refreshLicensorList', 'applyCachedProfilesForCurrentPage', 'updateUndoRedoButtons']) c[key] = noop;
  Object.assign(c, {
    document: {getElementById: () => null},
    console: {warn: (...args) => assert.fail('unexpected loader error: ' + args.join(' '))},
    authHydrationPromise: Promise.resolve(null),
    normalizeTransitRules: rules => rules,
    normalizeNonDtrManufacturers: rules => rules,
    normalizeKolLandedMultipliers: value => value,
    cloneMatchConfig: value => value,
    applyPricingRulesToLoadedRows: options => pricingCalls.push(options),
    cpClientWorkInProgress: () => c.state.cpDirty.size > 0,
    CP_NOTE_COLUMN_DEFS: [], CP_NOTE_COLUMN_DEFS_REVISION: 0,
    _deferredTabRenders: new Set(),
    undoStack: [{fixture: 'local undo'}], redoStack: [{fixture: 'local redo'}],
    renderStartupActiveModule: () => 'cp',
    fetch: async (url, options) => {
      assert.equal(url, '/api/data?mode=initial');
      assert.equal(options.method, 'GET', 'this regression must never POST refresh');
      return {ok: true, json: async () => c.payload};
    },
  });
  s.run(between('async function loadFromServer(force, targets){', '\nlet sharedRevisionSnapshot='));
  return {...s, pricingCalls, async loadPayload(payload) {
    c.payload = payload;
    assert.equal(await c.loadFromServer(false), true);
  }};
}

for (const [name, payload] of [['hydrated', 'loaded'], ['deferred', 'deferred']]) {
  test('full loader retains shared-rule CP invalidation around Orders ' + name, async () => {
    const s = fullLoader(), c = s.context, cp = c.state.cp;
    const selected = c.state.cpSelected, dirty = c.state.cpDirty;
    const undo = c.undoStack, redo = c.redoStack;
    const rules = [{id: 'demo-transit', delType: 'Sea', days: 17, countries: [], seasons: []}];
    await s.loadPayload({...s.fixture[payload], transitRules: rules});
    assert.equal(c.state.cp, cp);
    assert.equal(c.state.cpSelected, selected);
    assert.equal(c.state.cpDirty, dirty);
    assert.equal(c.undoStack, undo);
    assert.equal(c.redoStack, redo);
    assert.equal(c.state.overrides.transitRules, rules);
    assert.equal(s.pricingCalls.length, 1, 'shared pricing preparation still runs');
    assert.equal(s.revision(), 2, 'shared rules still invalidate CP; Orders adds no extra CP input revision');
    assert.equal(c._unifiedPriorityCache.cp, null, 'shared-rule hydration retains its own CP invalidation');
    assert.equal(c.tableRevision().cp, 2);
    assert.equal(c.tableRevision().orders, 3);
    assert.equal(s.events[0].detail.reason, 'server-transit-rules-hydrated');
    assert.deepEqual(Array.from(s.events[0].detail.tables), ['cp', 'orders']);
    assert.equal(s.events[1].detail.reason, 'server-orders-' + name);
    assert.deepEqual(Array.from(s.events[1].detail.tables), ['orders']);
  });
}

for (const withOrders of [false, true]) {
  test('full loader advances CP input revision for real CP data' + (withOrders ? ' plus Orders' : ''), async () => {
    const s = fullLoader(), c = s.context;
    c.state.cpDirty.clear();
    const rows = [{...c.state.cp.rows[0], 'Ex-factory': '2026-12-09'}];
    await s.loadPayload({cp: rows, ...(withOrders ? s.fixture.loaded : {})});
    assert.equal(c.state.cp.rows, rows);
    assert.equal(s.revision(), 3, 'shared-rule and actual CP hydration each advance CP inputs');
    assert.equal(c._unifiedPriorityCache.cp, null);
    assert.equal(s.events[1].detail.reason, 'server-cp-hydrated');
    assert.deepEqual(Array.from(s.events[1].detail.tables), ['cp', 'orders']);
    assert.equal(s.events.length, withOrders ? 3 : 2);
    if (withOrders) assert.deepEqual(Array.from(s.events[2].detail.tables), ['orders']);
  });
}
