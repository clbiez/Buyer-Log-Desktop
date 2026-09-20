'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fakeElement(id) {
  const listeners = new Map();
  return {
    id,
    dataset: {},
    style: {},
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    hidden: true,
    disabled: false,
    value: '',
    innerHTML: '',
    textContent: '',
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest() { return null; },
    listenerCount(type) { return (listeners.get(type) || []).length; },
  };
}

test('v4.53 Open Costing lazy-loaded after DOMContentLoaded still binds every main control', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'open-costing.js'), 'utf8');
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, fakeElement(id));
    return elements.get(id);
  };
  const documentListeners = new Map();
  const document = {
    readyState: 'complete',
    body: { dataset: { activeTab: 'overview' } },
    getElementById: get,
    querySelectorAll() { return []; },
    addEventListener(type, handler) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(handler);
    },
  };
  const windowListeners = new Map();
  const context = {
    console,
    document,
    fetch: async () => ({ ok: true, json: async () => ({ items: [], _revision: 0 }) }),
    queueMicrotask,
    setTimeout,
    clearTimeout,
    structuredClone: global.structuredClone,
  };
  context.window = context;
  context.window.addEventListener = (type, handler) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(handler);
  };
  context.window.BLBusinessRules = { roundHalfUp(value, decimals = 2) {
    const factor = 10 ** decimals;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
  } };
  context.window.BLFX = { monthKey: () => '2026-08' };

  vm.runInNewContext(source, context, { filename: 'open-costing.js' });
  await new Promise(resolve => setImmediate(resolve));

  for (const id of ['ocNewBtn', 'ocDuplicateBtn', 'ocDeleteBtn', 'ocCompareBtn', 'ocFxBtn', 'ocImportBtn', 'ocExportBtn', 'ocSaveBtn']) {
    assert.equal(get(id).listenerCount('click'), 1, `${id} click handler must be bound exactly once`);
  }
  assert.equal(get('ocRecordList').listenerCount('mousedown'), 1, 'saved costing selection must be bound');
  assert.equal(get('ocEditor').listenerCount('input'), 1, 'costing editor input must be bound');
  assert.equal(typeof context.window.initOpenCosting, 'function');
});
