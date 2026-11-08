'use strict';

// Exercise actual parser/scoping and the opt-in schema callback without replacing implementations.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), crypto = require('node:crypto');
const APP = path.resolve(__dirname, '..');
const actualRequire = Module.createRequire(path.join(APP, 'server/lib/compute-tasks.js'));
const actualParse = actualRequire('./parse'), actualHorizon = actualRequire('./horizon-fields');
const canonical = actualRequire('./canonical-fields');
const rawSchema = require('../public/module-projection-schema');
function compile(file, resolver) {
  const target = new Module(file, module); target.filename = file;
  target.paths = Module._nodeModulePaths(path.dirname(file)); target.require = resolver;
  target._compile(fs.readFileSync(file, 'utf8'), file);
  return target.exports;
}
function harness() {
  const calls = { cp: 0, orders: 0, shared: 0, dates: 0, horizons: 0, helper: 0, schemas: 0 };
  const parse = { ...actualParse };
  for (const [name, counter] of Object.entries({ buildCPRowsFromASAS: 'cp', buildOrdersRowsFromASAS: 'orders', buildSharedOrderProjectionRowsFromASAS: 'shared', applyDateOverrides: 'dates' })) {
    parse[name] = (...args) => { calls[counter]++; return actualParse[name](...args); };
  }
  const horizon = { ...actualHorizon, filterRows: (...args) => { calls.horizons++; return actualHorizon.filterRows(...args); } };
  let helper;
  const resolve = name => {
    if (name === './parse') return parse;
    if (name === './horizon-fields') return horizon;
    if (name === './compute-module-schemas') {
      calls.helper++;
      if (!helper) helper = compile(path.join(APP, 'server/lib/compute-module-schemas.js'), dependency => dependency === '../../public/module-projection-schema'
        ? { ...rawSchema, build: input => { calls.schemas++; return rawSchema.build(input); } }
        : require(dependency));
      return helper;
    }
    return actualRequire(name);
  };
  return {
    calls,
    tasks: compile(path.join(APP, 'server/lib/compute-tasks.js'), resolve),
    original: compile(path.join(__dirname, 'fixtures/compute-module-schema/compute-tasks-f076.js'), resolve),
  };
}
function definitions() {
  return [
    JSON.parse('{"id":"zero","header":"__CPX_ZERO","label":"Raw zero","group":"","role":"asas","dataType":null,"sourceMetadata":{"zero":0,"flag":false,"nil":null},"percentageScale":0,"__proto__":{"own":true},"constructor":"raw"}'),
    { label: 'Raw false', header: '__CPX_FALSE', id: 'false', role: 'antrepo', scale: false, data_type: '', customFuture: { empty: '', nil: null } },
    { header: '__CPX_NULL', label: 'Raw null', group: false },
    { header: '__CPX_ZERO', label: 'Duplicate retained', role: 'asas', percentageScale: 0 },
  ];
}
function fixture() {
  const rows = [0, 1].map(index => ({
    ocode: 100 + index, model: 'Synthetic ' + index, ccode: 'R', colour: 'Red', buyer: 'Synthetic Buyer',
    merch: 'M', ageGroup: 'A', buyerGrup: 'G', license: '', manufacturer: 'Synthetic', season: index ? 'S6' : 'W7',
    countryRaw: 'TURKIYE', qty: index ? 0 : 10, kalan: index ? 0 : 5, fob: 0,
    opd: new Date(2026, 0, 1), ex: new Date(2026, 6, 1), retail: new Date(2026, 7, 1), mb: new Date(2026, 8, 1),
    _cpExtra: { __CPX_ZERO: 0, __CPX_FALSE: false, __CPX_NULL: null, ...(index ? { __CPX_LAST_ONLY: '' } : {}) },
  }));
  return { loadedAt: 'synthetic-f076', asasOrders: rows, asasOrdersByTarget: { cp: rows, orders: rows }, antrepoMap: {}, lflRows: [] };
}
function data(extra = {}) {
  return {
    modules: ['cp', 'orders'], overrides: {}, horizons: {}, cpAllowed: true, summaryAllowed: true, cpModelColumns: definitions(),
    moduleSchemaExposureCp: true, moduleSchemaTargetKnownCp: true, moduleSchemaBindingsKnownCp: true,
    moduleSchemaExposureOrders: true, moduleSchemaTargetKnownOrders: true, moduleSchemaBindingsKnownOrders: true,
    ...extra,
  };
}
function capture(tasks, source, input) {
  let schemas, count = 0;
  const output = tasks.buildProjections(source, input, { onSchemas: value => { schemas = value; count++; } });
  assert.equal(count, 1);
  return { output, schemas };
}
function legacyRegistration(defs) {
  const reviewed = require('./fixtures/orders-ready-integration/source.cjs');
  const source = reviewed.base('public/app-main.js');
  const extract = require('./helpers/app-main-functions.js').extractFunction;
  const guarded = extract(reviewed.current('public/app-main.js'), 'syncCpModelColumns');
  assert.equal(guarded.replace('\n  _ordersRequireFullSynchronousRead();', ''), extract(source, 'syncCpModelColumns'), 'only reviewed first-statement guard precedes exact legacy registration');
  const match = source.match(/function syncCpModelColumns\(defs\)\{\s*const clean=([^;\n]+);/);
  assert.ok(match, 'actual legacy registration expression must remain identifiable');
  return Function('defs', 'return (' + match[1] + ');')(defs);
}

test('runtime sources and original frozen schema lineage match the declared pins', () => {
  const pins = require('./fixtures/compute-module-schema/source-pins.json');
  for (const [relative, expected] of Object.entries(pins.runtimeBlobs)) {
    const content = fs.readFileSync(path.join(APP, relative));
    const actual = crypto.createHash('sha1').update('blob ' + content.length + '\0').update(content).digest('hex');
    assert.equal(actual, expected, relative + ' changed since preparation');
  }
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, 'public/module-projection-schema.js'))).digest('hex');
  assert.equal(digest, pins.runtimeSchemaSha256);
  const before=fs.readFileSync(path.join(APP,pins.frozenSchemaFixture));
  assert.equal(crypto.createHash('sha256').update(before).digest('hex'),pins.frozenSchemaSha256);
});

test('default path has byte-identical full output and does not load or scan schema metadata', () => {
  const h = harness(), source = fixture(), input = data();
  let reads = 0;
  Object.defineProperty(input, 'moduleSchemaExposureCp', { enumerable: true, get() { reads++; throw Error('default path touched metadata exposure'); } });
  const actual = h.tasks.buildProjections(source, input), expected = h.original.buildProjections(source, input);
  assert.equal(h.tasks.serialize(actual, 'projection'), h.original.serialize(expected, 'projection'));
  assert.equal(h.tasks.serialize(actual, 'api'), h.original.serialize(expected, 'api'));
  assert.equal(reads, 0); assert.equal(h.calls.helper, 0); assert.equal(h.calls.schemas, 0);
  assert.deepEqual(Object.keys(actual.cp), ['rows', 'cpModelColumns']); assert.deepEqual(Object.keys(actual.orders), ['rows']);
});

test('nonfunction/absent internal hooks and data.onSchemas cannot activate schema work', () => {
  const h = harness(), source = fixture(), input = data();
  let calls = 0; input.onSchemas = () => { calls++; };
  for (const options of [undefined, null, {}, { onSchemas: true }, { onSchemas: 'client text' }]) h.tasks.buildProjections(source, input, options);
  assert.equal(calls, 0); assert.equal(h.calls.helper, 0); assert.equal(h.calls.schemas, 0);
});

test('explicit hook sees schemas without changing return JSON, canonical values or source identities', () => {
  const h = harness(), source = fixture(), input = data(), refs = source.asasOrders.map(row => row._cpExtra);
  const expected = h.original.buildProjections(source, input);
  const { output, schemas } = capture(h.tasks, source, input);
  assert.equal(h.tasks.serialize(output, 'projection'), h.original.serialize(expected, 'projection'));
  assert.equal(h.tasks.serialize(output, 'api'), h.original.serialize(expected, 'api'));
  assert.equal(canonical.value(output.orders.rows[0], 'cp', 'orderCode'), 100);
  assert.equal(output.orders.rows[1]['Order Quantity'], 0);
  for (const module of ['cp', 'orders']) {
    assert.equal(schemas[module].module, module); assert.equal(schemas[module].status, 'known');
    const wire=JSON.parse(h.tasks.serialize(output[module],'projection'));
    assert.deepEqual(schemas[module].rowKeys, [...new Set(wire.rows.flatMap(Object.keys))]);
    assert.equal(output[module].rows[0].__CPX_ZERO, 0); assert.equal(output[module].rows[0].__CPX_FALSE, false); assert.equal(output[module].rows[0].__CPX_NULL, null);
    assert.ok(output[module].rows[0].OPD instanceof Date);
    assert.equal(schemas[module].rowKeys.includes('__sourceOrder'), false);
  }
  assert.strictEqual(source.asasOrders[0]._cpExtra, refs[0]); assert.strictEqual(source.asasOrders[1]._cpExtra, refs[1]);
});

test('model definitions exactly match actual legacy registration and preserve key/order/zero/false/null metadata', () => {
  const h = harness(), raw = definitions(); raw.push(null, {}, { header: '', label: 'not registered' });
  const { schemas } = capture(h.tasks, fixture(), data({ cpModelColumns: raw })), expected = legacyRegistration(raw);
  for (const module of ['cp', 'orders']) {
    assert.equal(JSON.stringify(schemas[module].modelColumns), JSON.stringify(expected));
    assert.deepEqual(schemas[module].modelColumns.map(Object.keys), expected.map(Object.keys));
    assert.equal(schemas[module].modelColumns[0].percentageScale, 0);
    assert.equal(schemas[module].modelColumns[1].scale, false);
    assert.equal(schemas[module].modelColumns[0].dataType, null);
    assert.equal(Object.hasOwn(schemas[module].modelColumns[0], '__proto__'), true);
  }
});

test('known metadata copies are isolated from callback and later definition changes', () => {
  const h = harness(), source = fixture(), input = data();
  const { output, schemas } = capture(h.tasks, source, input);
  schemas.orders.modelColumns[0].sourceMetadata.zero = 99; schemas.orders.rowKeys.push('callback-only');
  assert.equal(input.cpModelColumns[0].sourceMetadata.zero, 0);
  assert.equal(schemas.cp.modelColumns[0].sourceMetadata.zero, 0);
  assert.equal(Object.hasOwn(output.orders.rows[0], 'callback-only'), false);
  input.cpModelColumns[0].header = 'later-change'; assert.equal(schemas.cp.modelColumns[0].header, '__CPX_ZERO');
});

test('Orders-only shared scope produces its schema from Orders rows without any CP/shared row builder', () => {
  const h = harness(), source = fixture();
  const { output, schemas } = capture(h.tasks, source, data({ modules: ['orders'] }));
  assert.equal(Object.hasOwn(output, 'cp'), false); assert.equal(schemas.cp, null); assert.equal(schemas.orders.status, 'known');
  assert.equal(schemas.orders.rowCount, output.orders.rows.length);
  assert.equal(h.calls.cp, 0); assert.equal(h.calls.shared, 0); assert.equal(h.calls.orders, 1);
  assert.equal(h.calls.dates, 2); assert.equal(h.calls.schemas, 1);
});

test('callback adds no date, horizon or parser work beyond the original Orders-only path', () => {
  const source = fixture(), input = data({ modules: ['orders'], horizons: { cp: {}, orders: {} } });
  const original = harness(); original.original.buildProjections(source, input);
  const candidate = harness(); capture(candidate.tasks, source, input);
  for (const counter of ['cp', 'shared', 'orders', 'dates', 'horizons']) assert.equal(candidate.calls[counter], original.calls[counter], counter);
});

test('CP schema denial keeps Orders schema null despite broad cpAllowed and Orders exposure flags', () => {
  for (const denied of [false, null, undefined, 0, 'true']) {
    const h = harness();
    const { output, schemas } = capture(h.tasks, fixture(), data({ modules: ['orders'], cpAllowed: true, moduleSchemaExposureCp: denied }));
    assert.ok(output.orders.rows.length > 0); assert.deepEqual(schemas, { cp: null, orders: null }); assert.equal(h.calls.schemas, 0);
  }
});

test('unknown CP target or binding never becomes a grant; Orders has independent required true flags', () => {
  for (const field of ['moduleSchemaTargetKnownCp', 'moduleSchemaBindingsKnownCp']) for (const value of [false, null, undefined]) {
    const h = harness(), result = capture(h.tasks, fixture(), data({ [field]: value }));
    assert.deepEqual(result.schemas, { cp: null, orders: null }); assert.equal(h.calls.schemas, 0);
  }
  for (const field of ['moduleSchemaExposureOrders', 'moduleSchemaTargetKnownOrders', 'moduleSchemaBindingsKnownOrders']) for (const value of [false, null, undefined]) {
    const result = capture(harness().tasks, fixture(), data({ [field]: value }));
    assert.equal(result.schemas.cp.status, 'known'); assert.equal(result.schemas.orders, null);
  }
});

test('raw missing/null definitions stay unknown despite the legacy CP envelope [] fallback', () => {
  for (const cpModelColumns of [undefined, null, false]) {
    const result = capture(harness().tasks, fixture(), data({ cpModelColumns }));
    assert.deepEqual(result.output.cp.cpModelColumns, []);
    assert.deepEqual(result.schemas, { cp: null, orders: null });
  }
});

test('explicit known empty definitions and empty target rows are distinct from unknown', () => {
  const source = fixture(); source.asasOrders = []; source.asasOrdersByTarget = { cp: source.asasOrders, orders: source.asasOrders };
  const { schemas } = capture(harness().tasks, source, data({ cpModelColumns: [] }));
  for (const module of ['cp', 'orders']) {
    assert.equal(schemas[module].status, 'known'); assert.equal(schemas[module].rowCount, 0);
    assert.deepEqual(schemas[module].rowKeys, []); assert.deepEqual(schemas[module].modelColumns, []);
  }
});

test('same row references in distinct arrays are eligible; JSON-equal copied rows are not', () => {
  const source = fixture(); source.asasOrdersByTarget = { cp: [...source.asasOrders], orders: [...source.asasOrders] };
  assert.equal(capture(harness().tasks, source, data({ modules: ['orders'] })).schemas.orders.status, 'known');
  source.asasOrdersByTarget.orders = source.asasOrders.map(row => ({ ...row }));
  assert.equal(capture(harness().tasks, source, data({ modules: ['orders'] })).schemas.orders, null);
});

test('different target row membership or order rejects Orders shared-CP metadata', () => {
  for (const select of [rows => rows.slice(0, 1), rows => [...rows].reverse()]) {
    const source = fixture(); source.asasOrdersByTarget.cp = select(source.asasOrders);
    const { schemas } = capture(harness().tasks, source, data());
    assert.equal(schemas.cp.status, 'known'); assert.equal(schemas.orders, null);
  }
});

test('actual different effective horizons reject shared metadata without comparing labels', () => {
  const source = fixture(), h = harness();
  const result = capture(h.tasks, source, data({ horizons: { cp: { seasons: ['W7'] }, orders: {} } }));
  assert.equal(result.schemas.orders, null); assert.equal(h.calls.horizons, 2);
});

test('Antrepo must be the exact same object, not equal content or a target label', () => {
  const source = fixture(), common = {};
  source.antrepoMapByTarget = { cp: common, orders: common };
  assert.equal(capture(harness().tasks, source, data({ modules: ['orders'] })).schemas.orders.status, 'known');
  source.antrepoMapByTarget.orders = {};
  assert.equal(capture(harness().tasks, source, data({ modules: ['orders'] })).schemas.orders, null);
});

test('schema collection reads no raw cell graph and overview-only work adds no CP/Orders row builder', () => {
  const source = fixture(); let reads = 0;
  const opaque = {}; Object.defineProperty(opaque, 'mustNotWalk', { enumerable: true, get() { reads++; throw Error('raw graph walked'); } });
  source.asasOrders[0]._cpExtra.__CPX_OPAQUE = opaque;
  const { output, schemas } = capture(harness().tasks, source, data({ modules: ['orders'] }));
  assert.equal(schemas.orders.status, 'known'); assert.strictEqual(output.orders.rows[0].__CPX_OPAQUE, opaque); assert.equal(reads, 0);
  const h = harness(), result = capture(h.tasks, fixture(), data({ modules: ['overview'] }));
  assert.deepEqual(result.schemas, { cp: null, orders: null }); assert.equal(h.calls.cp, 0); assert.equal(h.calls.orders, 0); assert.equal(h.calls.shared, 0); assert.equal(h.calls.schemas, 0);
});

test('malformed/accessor definitions fail closed without invoking hooks or changing legacy output', () => {
  let reads = 0; const definition = { header: '__CPX_SAFE', label: 'Safe' };
  Object.defineProperty(definition, 'extra', { enumerable: true, get() { reads++; throw Error('metadata hook'); } });
  const result = capture(harness().tasks, fixture(), data({ cpModelColumns: [definition] }));
  assert.deepEqual(result.schemas, { cp: null, orders: null }); assert.equal(reads, 0);
  assert.strictEqual(result.output.cp.cpModelColumns[0], definition);
});
