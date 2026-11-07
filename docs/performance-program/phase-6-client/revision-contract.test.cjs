'use strict';

// Explicit preparation regression, intentionally outside the app's normal suite
// until its two RED hydration cases can be fixed by the authorized integrator.
// No production source rewriting, network, credentials, or persistent data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixtures} = require('./revision-fixtures.cjs');

const sourcePath = path.resolve(__dirname, '../../../resources/app/public/app-main.js');
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
  });
}
