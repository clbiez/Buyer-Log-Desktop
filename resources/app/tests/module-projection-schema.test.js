'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const api = require('../public/module-projection-schema.js'), F = require('./fixtures/module-projection-schema-legacy.cjs');
const clone = value => JSON.parse(JSON.stringify(value));

test('Orders own-target schema needs no CP object and preserves complete actual legacy-shaped raw definitions', () => {
  const source = F.input(), defsJson = JSON.stringify(source.modelColumns), keys = source.modelColumns.map(Object.keys), schema = api.build(source);
  assert.equal(schema.schemaVersion, 1); assert.equal(schema.module, 'orders'); assert.equal(schema.status, 'known'); assert.equal(schema.rowCount, 2);
  assert.equal(JSON.stringify(schema.modelColumns), defsJson); assert.deepEqual(schema.modelColumns.map(Object.keys), keys);
  for (const name of ['header', 'id', 'role', 'group', 'dataType', 'sourceMetadata', 'percentageScale']) assert.deepEqual(schema.modelColumns[0][name], source.modelColumns[0][name]);
  assert.equal(schema.modelColumns[0].group, ''); assert.equal(schema.modelColumns[0].percentageScale, 0); assert.equal(schema.modelColumns[1].scale, false);
  assert.equal(Object.hasOwn(schema.modelColumns[1], 'dataType'), true); assert.equal(Object.hasOwn(schema.modelColumns[1], 'data_type'), true);
  assert.equal(Object.getPrototypeOf(schema.modelColumns[0]), Object.prototype); assert.equal(Object.hasOwn(schema.modelColumns[0], '__proto__'), true); assert.equal(schema.modelColumns[0].constructor, 'raw-value');
  assert.deepEqual(api.read(schema, 'orders'), schema);
});

test('raw definitions retain duplicates, missing optional legacy ID and unknown custom fields without normalization', () => {
  const defs = F.definitions(); defs.push({ ...defs[0], role: 'antrepo', connectionId: 'another' }, { header: '__LEGACY_HEADER', label: 'Legacy without id', group: false, percentageScale: '' });
  const schema = api.build(F.input({ modelColumns: defs })); assert.equal(schema.modelColumns.length, 4); assert.equal(JSON.stringify(schema.modelColumns), JSON.stringify(defs));
  assert.equal(Object.hasOwn(schema.modelColumns[3], 'id'), false); assert.equal(schema.modelColumns[3].group, false);
});

test('metadata snapshot copies only bounded definitions and cannot be changed by later definition mutation', () => {
  const source = F.input(), schema = api.build(source); source.modelColumns[0].sourceMetadata.rawZero = 99; source.modelColumns[0].header = '__CHANGED';
  assert.equal(schema.modelColumns[0].sourceMetadata.rawZero, 0); assert.equal(schema.modelColumns[0].header, '__CPX_cpx_demo_rate');
  const accepted = api.read(schema, 'orders'); accepted.modelColumns[0].sourceMetadata.rawZero = 77; assert.equal(schema.modelColumns[0].sourceMetadata.rawZero, 0);
});

test('row-key universe scans the entire same snapshot, retains exact first-seen order and duplicate business rows', () => {
  const rows = Array.from({ length: 5001 }, () => ({ common: 0 })); rows[0] = JSON.parse('{"2":0,"first":false,"common":null,"__proto__":"own"}'); rows[5000] = { common: 1, onlyAtEnd: false };
  const schema = api.build(F.input({ rows, modelColumns: [] })); assert.equal(schema.rowCount, 5001);
  assert.deepEqual(schema.rowKeys, ['2', 'first', 'common', '__proto__', 'onlyAtEnd']); assert.deepEqual(schema.modelColumns, []);
});

test('row scan reads no cell graph, preserves Date data values, and ignores nonenumerable source linkage', () => {
  const value = new Date(2026, 1, 2), row = { OPD: value, zero: 0, false: false, null: null }; let called = 0;
  const opaque = {}; Object.defineProperty(opaque, 'neverWalk', { enumerable: true, get() { called++; throw Error('cell graph is not schema metadata'); } });
  Object.defineProperty(row, '__sourceOrder', { value: opaque, enumerable: false });
  const schema = api.build(F.input({ rows: [row], modelColumns: [] })); assert.deepEqual(schema.rowKeys, ['OPD', 'zero', 'false', 'null']); assert.equal(called, 0); assert.strictEqual(row.OPD, value);
});

test('authoritative zero rows/empty definitions is known; missing/null/false flags never become []', () => {
  const empty = api.build(F.input({ rows: [], modelColumns: [] })); assert.equal(empty.status, 'known'); assert.equal(empty.rowCount, 0); assert.deepEqual(empty.rowKeys, []); assert.deepEqual(empty.modelColumns, []);
  for (const field of ['modelSchemaKnown', 'canExpose']) for (const value of [undefined, null, false, 0, 'true']) {
    assert.equal(api.build(F.input({ rows: [], modelColumns: [], [field]: value })), null);
  }
  for (const modelColumns of [undefined, null, false, '[]']) assert.equal(api.build(F.input({ rows: [], modelColumns })), null);
  for (const value of [undefined, null]) { const read = api.read(value, 'orders'); assert.equal(read.status, 'unknown'); assert.equal(read.modelColumns, null); assert.equal(read.rowKeys, null); assert.equal(read.rowCount, null); }
});

test('shared CP schema for Orders requires explicit sameRows and sameAntrepo plus independent target/binding/exposure knowledge', () => {
  const shared = F.policy({ schemaSource: 'shared-cp', sameRows: true, sameAntrepo: true }); assert.equal(api.build(F.input({ scopePolicy: shared })).status, 'known');
  for (const flag of ['sameRows', 'sameAntrepo', 'targetKnown', 'bindingsKnown', 'cpSchemaAllowed']) for (const value of [undefined, false, null]) assert.equal(api.build(F.input({ scopePolicy: { ...shared, [flag]: value } })), null);
  assert.equal(api.build(F.input({ module: 'cp', scopePolicy: shared })), null);
});

test('CP and Orders use their own schemas; v1 CP-schema denied and target-unknown fail closed', () => {
  const orders = api.build(F.input()), cp = api.build(F.input({ module: 'cp', rows: [{ cpOnly: 0 }], modelColumns: [{ id: 'cp', header: '__CP_ONLY', label: 'CP only' }] }));
  assert.equal(cp.module, 'cp'); assert.deepEqual(cp.rowKeys, ['cpOnly']); assert.equal(orders.modelColumns.some(x => x.header === '__CP_ONLY'), false);
  for (const module of ['cp', 'orders']) assert.equal(api.build(F.input({ module, scopePolicy: F.policy({ cpSchemaAllowed: false }) })), null);
  assert.equal(api.read(cp, 'orders').status, 'unknown'); assert.equal(api.read(cp, 'orders').modelColumns, null);
});

test('undefined/nonboolean policy is unknown and the broader compute data.cpAllowed is not a schema exposure substitute', () => {
  assert.equal(api.build(F.input({ scopePolicy: F.policy({ targetKnown: undefined }) })), null);
  const policy = { schemaSource: 'target', targetKnown: true, bindingsKnown: true, cpAllowed: true };
  assert.equal(api.build(F.input({ scopePolicy: policy })), null);
  assert.equal(api.build(F.input({ scopePolicy: F.policy({ schemaSource: 'legacy-global' }) })), null);
});

test('unknown policy and direct row/metadata getters are never invoked', () => {
  let calls = 0; const source = F.input({ canExpose: false }); Object.defineProperty(source, 'rows', { enumerable: true, get() { calls++; throw Error('no'); } }); assert.equal(api.build(source), null);
  const row = {}; Object.defineProperty(row, 'value', { enumerable: true, get() { calls++; return 1; } }); assert.equal(api.build(F.input({ rows: [row] })), null);
  const defs = F.definitions(); Object.defineProperty(defs[0].sourceMetadata, 'getter', { enumerable: true, get() { calls++; return 'no'; } }); assert.equal(api.build(F.input({ modelColumns: defs })), null);
  const candidate = { schemaVersion: 1, module: 'orders', status: 'known', rowCount: 0, rowKeys: [] }; Object.defineProperty(candidate, 'modelColumns', { enumerable: true, get() { calls++; return []; } }); assert.equal(api.read(candidate, 'orders').status, 'unknown');
  assert.equal(calls, 0);
});

test('nonplain objects, Node proxies, sparse rows, model toJSON and cyclic metadata are unknown without callbacks', () => {
  let calls = 0; const proxy = new Proxy({}, { ownKeys() { calls++; return []; }, getPrototypeOf() { calls++; return Object.prototype; } });
  assert.equal(api.build(F.input({ rows: [proxy] })), null); assert.equal(api.read(proxy, 'orders').status, 'unknown');
  for (const row of [new Date(), new Map(), Object.create({ inherited: true })]) assert.equal(api.build(F.input({ rows: [row] })), null);
  assert.equal(api.build(F.input({ rows: new Array(2) })), null);
  const defs = F.definitions(); defs[0].toJSON = () => { calls++; return {}; }; assert.equal(api.build(F.input({ modelColumns: defs })), null);
  const cycle = F.definitions(); cycle[0].sourceMetadata.self = cycle[0]; assert.equal(api.build(F.input({ modelColumns: cycle })), null);
  const dates = F.definitions(); dates[0].sourceMetadata = new Date(); assert.equal(api.build(F.input({ modelColumns: dates })), null); assert.equal(calls, 0);
});

test('version/missing/malformed/unknown status/different-module metadata yields unknown/null without layout-destructive []', () => {
  const valid = api.build(F.input());
  const values = [{}, { ...valid, schemaVersion: 999 }, { ...valid, schemaVersion: '1' }, { ...valid, module: 'cp' }, { ...valid, status: 'unknown' }, { ...valid, rowCount: -1 }, { ...valid, rowKeys: ['x', 'x'] }, { ...valid, modelColumns: null }, { ...valid, extra: 'future' }, { ...valid, rowCount: 0 }];
  for (const value of values) { const result = api.read(value, 'orders'); assert.equal(result.status, 'unknown'); assert.equal(result.modelColumns, null); assert.equal(result.rowKeys, null); }
  assert.equal(api.read(valid, 'other').status, 'unknown');
});

test('public metadata has exact UTF8 byte admission at64KiB hard cap and caller-only lower configuration', () => {
  const source = F.input(), schema = api.build(source), bytes = Buffer.byteLength(JSON.stringify(schema));
  assert.equal(api.create({ maxPublicBytes: bytes }).build(source).status, 'known'); assert.equal(api.create({ maxPublicBytes: bytes - 1 }).build(source), null);
  assert.equal(api.create({ maxPublicBytes: bytes - 1 }).read(schema, 'orders').status, 'unknown');
  const huge = F.definitions(); huge[0].sourceMetadata.large = 'x'.repeat(65536); assert.equal(api.build(F.input({ modelColumns: huge })), null);
  const tooLarge = { ...schema, modelColumns: huge }; assert.equal(api.read(tooLarge, 'orders').status, 'unknown');
  assert.throws(() => api.create({ maxPublicBytes: 65537 })); assert.throws(() => api.create({ maxRowKeys: 513 }));
});

test('source key universe512 is complete; key513 produces unknown rather than truncation or firstN sampling', () => {
  const rows = Array.from({ length: 512 }, (_, i) => ({ ['key' + i]: 0 })); const known = api.build(F.input({ rows, modelColumns: [] })); assert.equal(known.rowKeys.length, 512); assert.equal(known.rowCount, 512);
  rows.push({ onlyAfter512: false }); assert.equal(api.build(F.input({ rows, modelColumns: [] })), null);
  assert.equal(api.read({ ...known, rowKeys: [...known.rowKeys, 'extra'] }, 'orders').status, 'unknown');
  assert.equal(api.create({ maxRowKeys: 1 }).build(F.input({ modelColumns: [] })), null);
});

test('same UMD source validates JSON transport in a browser realm without Node imports', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/module-projection-schema.js'), 'utf8'), context = vm.createContext({}); vm.runInContext(source, context);
  context.inputJson = JSON.stringify(api.build(F.input())); const output = vm.runInContext("BLModuleProjectionSchema.read(JSON.parse(inputJson),'orders')", context);
  assert.equal(output.status, 'known'); assert.equal(output.module, 'orders'); assert.equal(output.modelColumns[0].header, '__CPX_cpx_demo_rate');
  assert.equal(JSON.stringify(output), context.inputJson);
  const invalid = vm.runInContext("globalThis.hits=0;const x={};Object.defineProperty(x,'schemaVersion',{enumerable:true,get(){hits++;return 1;}});BLModuleProjectionSchema.read(x,'orders')", context);
  assert.equal(invalid.status, 'unknown'); assert.equal(vm.runInContext('hits', context), 0);
});
