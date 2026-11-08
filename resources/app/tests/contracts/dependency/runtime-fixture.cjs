'use strict';
// Test-only actual browser runtimes; no source evaluation occurs until root runs a test.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {pinned,authoritative,inventory}=require('../actual-source.cjs');
const contracts = authoritative('reviewed-contracts.json', '2cbd162fdd5061c92c43f727e8d7f86698ff873e');
const matrix = authoritative('shadow-matrix.json', '5fd28eed219f5521799617e63506eaff2c4bf03f');
const clone = value => JSON.parse(JSON.stringify(value));
function actualRuntime() {
  const values = new Map(); let rows = [];
  const cols = [{ k: 'Order Code', label: 'Order Code' }, { k: 'Order Quantity', label: 'Order Quantity' },
    { k: 'Other', label: 'Other' }, { k: '__CPX_6A_PROBE', label: 'Probe', modelCustom: true, role: 'asas', modelColumnId: '6A_PROBE' }];
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
  const context = { Date, Map, Set, WeakMap, BLStorage: storage, localStorage: storage,
    document: { readyState: 'loading', addEventListener() {} }, COLS_BY_TABLE: { cp: cols, orders: cols },
    colmgr: { cp: { order: cols.map(c => c.k), hidden: new Set(['__CPX_6A_PROBE']) }, orders: { order: cols.map(c => c.k), hidden: new Set(['__CPX_6A_PROBE']) } },
    BLFormulaRows: { cp: () => rows, orders: () => rows }, tableColumnLabel: (_table, column) => column.label || column.k };
  context.window = context; context.globalThis = context; vm.createContext(context);
  for (const file of ['canonical-fields.js','canonical-module-bindings.js','formula-engine.js','formula-columns.js']) {
    vm.runInContext(pinned(file), context, { filename: file + ' (actual approved public source)' });
  }
  return { canonical: context.BLCanonicalFields, engine: context.BLFormulaEngine, formula: context.BLFormulaColumns,
    context, setRows(value) { rows = value; } };
}
function tokenRequest(runtime, module = 'orders') {
  const rawKeys = new Set(['Probe','__CPX_6A_PROBE','Order Code','Order Quantity','Other','Synthetic extra']);
  for (const field of inventory.fields) for (const key of runtime.canonical.bindingFor(module, field.canonicalId)?.keys || []) rawKeys.add(key);
  return { module, contextKey: 'synthetic-context', planRevision: 'synthetic-plan', requestGeneration: 'synthetic-request',
    coverage: { kind: 'reviewed-adapter-closure', manifestRevision: 'synthetic-closure-v1', contextKey: 'synthetic-context',
      consumerIds: ['columns','filters','sorting','formulas','readiness','rules','full-consumers'] },
    producer: { kind: 'producer-contract', wholeContext: true, traceDerived: false, revision: 'synthetic-parser-contract',
      contextKey: 'synthetic-context', rawKeys: [...rawKeys], canonicalModes: {} },
    state: { columnKeys: ['Order Code'], filterKeys: ['Other'], sortKeys: ['Order Quantity'], canonicalIds: [], formulas: [] } };
}
const mapping = { columns: ['C01','C02','C03'], filters: ['C04'], sorting: ['C05'], formulas: ['C06'],
  readiness: ['C07','C11','C12','C13'], rules: ['C10'], 'full-consumers': ['C08','C09','C14','C15'] };
function declarations(runtime) {
  return Object.entries(mapping).map(([id, contractIds]) => ({ id, revision: '1', contractIds,
    guaranteesFullBeforeUse: id === 'full-consumers',
    declare(request) {
      if (id === 'full-consumers') return { contextKey: request.contextKey, revision: '1', mode: 'full-before-use' };
      return { contextKey: request.contextKey, revision: '1', mode: 'finite', enumeration: false, tokenFallback: false,
        rawKeys: id === 'columns' ? request.state.columnKeys : id === 'filters' ? request.state.filterKeys : id === 'sorting' ? request.state.sortKeys : [],
        canonicalIds: id === 'readiness' ? request.state.canonicalIds : [], formulas: id === 'formulas' ? request.state.formulas : null };
    },
    resolveFormulaReference(name, { request, definitions }) {
      // Actual formula-column alias/source APIs, including hidden model columns.
      const normalized = String(name).trim().toLocaleLowerCase('tr-TR');
      const alias = runtime.formula.aliasMap(definitions).get(normalized);
      const formula = alias && definitions.find(def => runtime.formula.columnKey(def) === alias);
      const modelKey = runtime.formula.columnIndex(request.module).model.get(normalized);
      const rawKeys = modelKey ? [modelKey] : [];
      const formulaIds = formula ? [formula.id] : [];
      return { mode: request.producer.rawKeys.includes(name) || rawKeys.length || formulaIds.length ? 'finite' : 'unresolved',
        contextKey: request.contextKey, lookup: 'own-formula-model-v1', rawKeys, formulaIds };
    },
  }));
}
function fixture(api, module = 'orders') {
  const runtime = actualRuntime(), request = tokenRequest(runtime, module), adapters = declarations(runtime);
  const manifest = { version: 1, module, revision: 'synthetic-closure-v1', consumers: adapters.map(adapter => ({ id: adapter.id, revision: adapter.revision, contractIds: [...adapter.contractIds] })) };
  const compiler = api.createCompiler({ canonical: runtime.canonical, formulaEngine: runtime.engine, inventory,
    inventoryRef: { pr: 891, head: '5736f3370fb55bbd62414585956ca8c53d37ce82' }, manifest, adapters });
  return { runtime, request, adapters, manifest, compiler, full: { rows: [{ 'Order Code': 'DEMO-1' }] } };
}
module.exports = { fixture, actualRuntime, inventory, contracts, matrix, clone, declarations, tokenRequest };
