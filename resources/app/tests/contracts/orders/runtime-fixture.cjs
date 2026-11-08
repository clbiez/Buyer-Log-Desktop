'use strict';
// Actual source evaluation is deferred until root executes these native tests.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const actual = require('../actual-source.cjs'), {pins,pinned,APP} = actual;
const api = require('../../../public/orders-finite-closure'), dependencyPlan = require('../../../public/projection-dependency-plan');
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function inventory() {
  return actual.inventory;
}
function normalizer() {
  const app = pinned('app-main.js'), tasks = pinned('compute-tasks.js');
  pinned('function-extractor.cjs'); pinned('business-rules.js'); pinned('json-dates.cjs');
  const { extractFunction } = require('../../helpers/app-main-functions');
  const scope = vm.createContext({ Date, Map, Set, window:{},
    stringifyWithDates:require('../../../server/lib/json-dates').stringifyWithDates,
    BLBusinessRules:require('../../../public/business-rules') });
  const constants = [/const CP_BASELINE_DATE_KEYS = .*;/, /const CP_DATE_KEYS = .*;/, /const ISO_DAY_CACHE_MAX = .*;/, /const _isoDayCache = .*;/]
    .map(pattern => { const m = app.match(pattern); assert.ok(m, String(pattern)); return m[0]; });
  const functions = ['norm','toNum','dateOrdinal','normalizeTransitDelType','turknorm','makeDateOnly','dateOnlyFromDateObject',
    'excelSerialToDateOnly','coerceDateLoose','normalizeCPDates','applyCpApprovalDate','cpLogisticSegments','cpLogisticHasDetails','rebuildCpLogisticCaches'];
  vm.runInContext([...constants, ...functions.map(name => extractFunction(app, name)),
    ...['apiDate','projectionDate','serialize'].map(name => extractFunction(tasks, name)),
    'globalThis.actual={normalize:normalizeCPDates,serialize};'].join('\n'), scope, {filename:'actual approved product normalizer + serializer'});
  return scope.actual;
}
const modelDef = (id, label = id) => ({id, header:'__CPX_' + id, label, role:'asas', group:'Database',
  dataType:'Double', sourceMetadata:{rawZero:0,rawFalse:false,rawNull:null}, percentageScale:0});
function fixture(options = {}) {
  const reference = normalizer(), defs = options.modelDefinitions || [modelDef('PROBE','Probe'),modelDef('UNUSED'),modelDef('ZERO'),
    modelDef('FALSE'),modelDef('NULL'),modelDef('VISIBLE'),modelDef('SHARED','Shared')];
  const first = JSON.parse('{"2":"numeric-first","Order Code":"000123","Order Quantity":100,"Probe":0,"__CPX_PROBE":999,"__CPX_UNUSED":0,"__CPX_ZERO":0,"__CPX_FALSE":false,"__CPX_NULL":null,"__CPX_VISIBLE":0,"__CPX_SHARED":7,"__CPX_UNREGISTERED":"keep","unknown":{"false":false,"zero":0,"nil":null},"__proto__":{"kept":true},"constructor":"own","empty":"","tail":false}');
  const second = clone(first); delete second.Probe; delete second.__CPX_ZERO;
  second.__CPX_PROBE = false; second.__CPX_UNUSED = false; second['Order Quantity'] = 0;
  for (const row of [first, second]) { row.OPD = new Date(2026,0,1); row['Ex-factory'] = new Date(2026,9,1);
    row['Buying Son Onay Tarihi'] = null; row._logisticSegments = [{kind:'partial',status:'Depoda',delType:'Gemi',quantity:5,
      arrival:'2026-11-07',handover:'2026-10-10'}]; row._logisticTotalQty = false; }
  const full = JSON.parse(reference.serialize({loadedAt:'SYNTHETIC-ONLY',rows:options.rows || [first,second]}, 'projection'));
  const columns = [{k:'Order Code',label:'Order Code'},{k:'Order Quantity',label:'Order Quantity'},
    ...defs.map(d => ({k:d.header,label:d.label,modelCustom:true,modelColumnId:d.id,role:d.role}))];
  let rows = full.rows; const storageValues = new Map(), storage = { getItem:k => storageValues.get(k) ?? null,
    setItem:(k,v) => storageValues.set(k,String(v)) };
  // JSON/Date/Map are host intrinsics only to keep VM fixtures in the caller's realm; production functions are unchanged.
  const scope = { Date, Map, Set, WeakMap, JSON, BLStorage:storage, localStorage:storage,
    document:{readyState:'loading',addEventListener(){}}, COLS_BY_TABLE:{cp:[],orders:columns,ship:[]},
    colmgr:{orders:{order:columns.map(c => c.k),hidden:new Set(defs.filter(d => d.id !== 'VISIBLE').map(d => d.header))}},
    BLFormulaRows:{orders:() => rows}, tableColumnLabel:(_module,c) => c.label || c.k };
  scope.window = scope; scope.globalThis = scope; vm.createContext(scope);
  for (const name of ['canonical-fields.js','canonical-module-bindings.js','formula-engine.js','formula-columns.js'])
    vm.runInContext(pinned(name), scope, {filename:name + ' (actual approved public source)'});
  scope.BLFormulaColumns.save('orders', options.formulas || []);
  const sourceInventory = inventory(), compiler = api.createOrdersFiniteClosure({ canonical:scope.BLCanonicalFields,
    formulaEngine:scope.BLFormulaEngine, formulaColumns:scope.BLFormulaColumns, dependencyPlan, inventory:sourceInventory,
    inventoryRef:{pr:891,head:pins.inventory.head} });
  const token = {ownerId:'owner',actorId:'actor',module:'orders',sourceGeneration:'g1',sourceRevision:'r1',moduleInputKey:'orders-in1',
    sourceProjectionKey:'orders-src1',accessHash:'a1',contextHash:'ctx1',planRevision:'orders-finite-test-v1',requestGeneration:'req1'};
  const context = {token,schema:{schemaVersion:1,module:'orders',status:'known',rowCount:full.rows.length,
    rowKeys:[...new Set(full.rows.flatMap(Object.keys))],modelColumns:clone(defs)}, columns:clone(columns),
    hiddenKeys:[...scope.colmgr.orders.hidden],filterKeys:[],sortKeys:[],ruleKeys:[],operationKeys:[],
    guards:{...api.GUARDS},fullBeforeUse:[...api.BARRIERS]};
  return { compiler, context, full, scope, reference, inventory:sourceInventory,
    formula:scope.BLFormulaColumns, canonical:scope.BLCanonicalFields, engine:scope.BLFormulaEngine,
    setRows(value) { rows = value; }, refreshSchema() { context.schema.rowCount = full.rows.length;
      context.schema.rowKeys = [...new Set(full.rows.flatMap(Object.keys))]; } };
}
function project(full, fields) {
  const wanted = new Set(fields);
  return full.rows.map(row => { const out = {}; for (const key of Object.keys(row)) if (wanted.has(key))
    Object.defineProperty(out,key,{value:row[key],writable:true,enumerable:true,configurable:true}); return out; });
}
function fingerprint(value) {
  if (value instanceof Date) return ['Date',value.getTime()];
  if (value === null || typeof value !== 'object') return [value === null ? 'null' : typeof value,value];
  return [Array.isArray(value)?'array':'object',Reflect.ownKeys(value).map(key => [key,fingerprint(value[key])])];
}
function compareActual(f, plan) {
  const original = JSON.stringify(f.full), complete = clone(f.full.rows), selected = project(clone(f.full),plan.fields);
  f.reference.normalize(complete); f.setRows(complete); const a = f.formula.refresh('orders',complete);
  f.reference.normalize(selected); f.setRows(selected); const b = f.formula.refresh('orders',selected);
  assert.deepEqual(clone(a),clone(b),'actual formula errors/applied');
  for (let i = 0; i < complete.length; i++) {
    for (const field of f.inventory.fields) assert.deepEqual(fingerprint(f.canonical.canonicalValue(selected[i],'orders',field.canonicalId)),
      fingerprint(f.canonical.canonicalValue(complete[i],'orders',field.canonicalId)),field.canonicalId);
    const retained = {}; for (const key of Object.keys(complete[i])) if (!plan.omittedKeys.includes(key))
      Object.defineProperty(retained,key,{value:complete[i][key],writable:true,enumerable:true,configurable:true});
    assert.deepEqual(fingerprint(selected[i]),fingerprint(retained),'exact retained own-key/type/value order');
    assert.equal(hash(f.reference.serialize(selected[i],'projection')),hash(f.reference.serialize(retained,'projection')));
  }
  assert.equal(JSON.stringify(f.full),original,'source untouched'); return selected;
}
module.exports = {api,fixture,project,compareActual,fingerprint,clone,hash,modelDef,pinned,pins};
