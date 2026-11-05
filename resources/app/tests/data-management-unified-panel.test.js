'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/data-management.js'), 'utf8');

function harness(language = 'tr', canManage = true) {
  const sources = ['asas', 'ias', 'intake'].map(id => ({ id, name: id.toUpperCase(), revision: id + '-revision' }));
  const modules = ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis', 'intake'].map(id => ({
    id, label: id.toUpperCase(), feeds: (id === 'intake' ? ['intake'] : ['asas', 'ias']).map(sourceId => ({
      sourceId, sourceName: sourceId.toUpperCase(), sourceRole: sourceId === 'ias' ? 'antrepo' : sourceId,
      enabled: true, locked: !(sourceId === 'ias' && id === 'orders'), filterBounded: true,
      filterName: id === 'cp' ? 'CP demo' : id === 'intake' ? 'Intake demo' : 'Shared demo', layer: 'source',
      linked: !['cp', 'intake'].includes(id), definition: {},
    })),
  }));
  const model = { canManage, sources, modules, mergedFilters: [], matrix: { cells: {} } };
  for (const module of modules) for (const source of sources) model.matrix.cells[`${source.id}:${module.id}`] = 'unavailable';
  const slots = Object.fromEntries(['cp', 'linked', 'intake'].map(id => [`[data-horizon-mount="${id}"]`, { id }]));
  const root = {
    querySelector: selector => slots[selector] || null,
    querySelectorAll: () => Object.values(slots),
  };
  const calls = [];
  const window = {
    localStorage: { getItem: () => null },
    BLDataFilterEditor: { open: (slot, context) => calls.push({ slot, context }) },
    loadFromServer: (...args) => { calls.push(args); return new Promise(() => {}); },
  };
  const context = vm.createContext({ window, appLang: language, CSS: { escape: value => value } });
  const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.testPanel = { horizonPanel, openFilterEditor, refreshHorizon, drawerGroup, horizonFeeds,
      setup: (payload, host) => { model = payload; root = host; } };
  })();`);
  vm.runInContext(instrumented, context);
  window.testPanel.setup(model, root);
  return { api: window.testPanel, window, model, root, calls };
}

test('one panel renders CP, shared modules and independent INTAKE with one source chip each', () => {
  for (const language of ['tr', 'en']) {
    const { api } = harness(language);
    const html = api.horizonPanel();
    assert.deepEqual([...html.matchAll(/data-horizon-row="([^"]+)"/g)].map(match => match[1]), ['cp', 'linked', 'intake']);
    assert.equal((html.match(/data-open-filter=/g) || []).length, 5);
    assert.match(html, language === 'en' ? /Other modules/ : /Diğer modüller/);
    assert.doesNotMatch(html, /data-refresh-horizon="intake"/);
  }
  assert.doesNotMatch(source, /data-dm-panel="modules"|data-view="|function matrixTable\(/);
});

test('INTAKE filter opens its own drawer tab even though it is sixth in the read model', () => {
  const { api, calls, root } = harness();
  // v2026-11-04 — Çekmece sekmesi INTAKE ufkunu ve onun tek kaynağını seçer.
  assert.equal(api.drawerGroup('intake').id, 'intake');
  assert.deepEqual(JSON.parse(JSON.stringify(api.horizonFeeds(api.drawerGroup('intake')).map(entry => entry.feed.sourceId))), ['intake']);
  assert.equal(api.drawerGroup('orders').id, 'linked');
  api.openFilterEditor('intake', 'intake', root.querySelector('[data-horizon-mount="intake"]'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].slot.id, 'intake');
  assert.equal(calls[0].context.moduleId, 'intake');
  assert.equal(calls[0].context.pair, null);
});

test('shared row retains optional IAS Orders connection without unlocking required feeds', () => {
  const { api, model } = harness();
  let html = api.horizonPanel();
  assert.match(html, /data-toggle="ias:orders" data-next="off"/);
  assert.doesNotMatch(html, /data-toggle="(?:asas:|ias:backlog|intake:)/);
  model.modules.find(module => module.id === 'orders').feeds.pop();
  model.matrix.cells['ias:orders'] = 'off';
  html = api.horizonPanel();
  assert.match(html, /data-toggle="ias:orders" data-next="on"/);
  assert.match(html, /data-open-filter="backlog:ias"/);
});

test('viewers can edit personal filters and see disconnected state without connection writes', () => {
  const { api, model } = harness('en', false);
  model.modules.find(module => module.id === 'intake').feeds = [];
  const html = api.horizonPanel();
  assert.match(html, /Not connected to any source/);
  assert.match(html, /data-open-filter="cp:asas"/);
  assert.doesNotMatch(html, /data-toggle=/);
});

test('CP, shared modules and standalone LFL keep their refresh targets; INTAKE stays independent', () => {
  const { api, calls, window } = harness();
  for (const id of ['cp', 'linked', 'lfl', 'intake']) api.refreshHorizon(id);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    [true, ['cp']], [true, ['orders', 'backlog', 'lfl', 'priceanalysis']], [true, ['lfl']],
  ]);
  window.BL_REFRESH_BUSY = true;
  api.refreshHorizon('cp');
  assert.equal(calls.length, 3);
  assert.match(api.horizonPanel(), /data-refresh-horizon="cp" disabled/);
});
