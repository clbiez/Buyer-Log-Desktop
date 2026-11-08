'use strict';

// Native JSON/zlib plus the actual production canonical/schema implementations.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const crypto = require('node:crypto'), zlib = require('node:zlib');
const builder = require('../server/lib/projection-ready-json'), schemaApi = require('../public/module-projection-schema');
const canonical = require('../server/lib/canonical-fields');
const A = '__CPX_SYNTH_A', B = '__CPX_SYNTH_B';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function definitions() {
  return [
    JSON.parse('{"id":"cpx_synth_a","header":"__CPX_SYNTH_A","label":"Raw zero","role":"asas","group":"","sourceMetadata":{"zero":0,"false":false,"nil":null},"percentageScale":0,"__proto__":{"own":true},"constructor":"raw"}'),
    { header: B, label: 'Raw false', role: 'antrepo', dataType: null, scale: false },
  ];
}
function schema(full, defs = definitions()) {
  const value = schemaApi.build({ module: 'orders', rows: full.rows, modelColumns: defs, modelSchemaKnown: true, canExpose: true, scopePolicy: { schemaSource: 'target', targetKnown: true, bindingsKnown: true, cpSchemaAllowed: true } });
  assert.ok(value, 'synthetic authoritative schema must be valid for the case');
  return value;
}
function fixture() {
  const full = JSON.parse('{"loadedAt":"synthetic-only","rows":[{"Order Code":"duplicate","Season":"W7","__CPX_SYNTH_A":0,"nativeBefore":false,"nested":{"__CPX_SYNTH_A":"keep nested","nil":null},"__CPX_SYNTH_B":false,"nativeAfter":null,"__CPX_UNKNOWN":"keep unknown","__proto__":{"own":"row data"},"constructor":"raw data","tail":[0,false,null]},{"Order Code":"duplicate","nativeAfter":null,"__CPX_SYNTH_A":null,"__CPX_SYNTH_B":0,"tail":"second","onlyAtEnd":true},{"Order Code":"duplicate","__CPX_SYNTH_B":null,"tail":"third"}],"unknownEnvelope":{"flag":false,"nil":null}}');
  const fullJson = JSON.stringify(full);
  const viewInfo = { ownerId: 'synthetic-owner', actorId: 'synthetic-actor', sourceKey: 'source-key', sourceGeneration: 'generation-1', accessHash: 'access-hash', planEpoch: 0, fullJsonSha256: sha(fullJson), fullJsonBytes: Buffer.byteLength(fullJson) };
  return { full, fullJson, options: { schema: schema(full), omittedKeys: [A, B], viewInfo } };
}
function unpack(result) { assert.equal(result.kind, 'ready', result.reason); return JSON.parse(zlib.gunzipSync(result.buffer)); }
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
async function fullFallback(full, options, api = builder) {
  const result = await api.prepareReadyJson(full, options);
  assert.equal(result.kind, 'full'); assert.strictEqual(result.fullWire, full); assert.equal(Object.hasOwn(result, 'buffer'), false);
  return result;
}
function compile(file, resolver) {
  const instance = new Module(file, module); instance.filename = file; instance.paths = Module._nodeModulePaths(path.dirname(file)); instance.require = resolver;
  instance._compile(fs.readFileSync(file, 'utf8'), file); return instance.exports;
}
function isolatedCanonicalBuilder() {
  const registryFile = path.join(__dirname, '../public/canonical-fields.js');
  const registry = compile(registryFile, require);
  require('../public/canonical-module-bindings')(registry);
  const file = path.join(__dirname, '../server/lib/projection-ready-json.js'), normalRequire = Module.createRequire(file);
  return { canonical: registry, builder: compile(file, name => name === './canonical-fields' ? registry : normalRequire(name)) };
}

test('native f4a, reviewed wire-presence schema and actual canonical source copies match frozen pins', () => {
  const pins = require('./fixtures/projection-ready-json-pins.json');
  for (const [file, expected] of Object.entries(pins.sha256)) assert.equal(sha(fs.readFileSync(path.join(__dirname, file))), expected, file);
  assert.equal(sha(fs.readFileSync(path.join(__dirname, pins.schemaCompatibility.originalSource))), pins.schemaCompatibility.originalSha256,
    'original source-mode schema remains frozen independently of the reviewed opt-in JSON presence mode');
  for (const [file, expected] of Object.entries(pins.canonicalBlobs)) {
    const bytes = fs.readFileSync(path.join(__dirname, file));
    assert.equal(crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), expected, file);
  }
});

test('ready result is one ordinary gzip JSON with exact bytes/checksum and immutable source', async () => {
  const f = fixture(), before = JSON.stringify(f.full), rows = f.full.rows, nested = f.full.rows[0].nested;
  deepFreeze(f.full); deepFreeze(f.options);
  const result = await builder.prepareReadyJson(f.full, f.options), ready = unpack(result), raw = zlib.gunzipSync(result.buffer);
  assert.equal(result.uncompressedBytes, raw.length); assert.equal(result.checksum, sha(result.buffer));
  assert.equal(ready.profile, builder.PROFILE); assert.equal(ready.projection.module, 'orders');
  assert.equal(Object.hasOwn(ready.rows[0], A), false); assert.equal(Object.hasOwn(ready.rows[0], B), false);
  assert.deepEqual(result.registryKeys, f.options.schema.rowKeys); assert.deepEqual(ready.projection.schema, f.options.schema);
  assert.deepEqual(ready.unknownEnvelope, f.full.unknownEnvelope); assert.equal(JSON.stringify(f.full), before);
  assert.strictEqual(f.full.rows, rows); assert.strictEqual(f.full.rows[0].nested, nested);
  assert.equal(result.buffer.length <= builder.MAX_GZIP, true);
  assert.equal(result.uncompressedBytes <= builder.MAX_FULL + builder.MAX_METADATA, true);
});

test('own 0/false/null/absence, kept-key order, row order and duplicate IDs survive', async () => {
  const f = fixture(), ready = unpack(await builder.prepareReadyJson(f.full, f.options));
  assert.deepEqual(ready.rows.map(row => row['Order Code']), ['duplicate', 'duplicate', 'duplicate']);
  for (let index = 0; index < ready.rows.length; index++) {
    assert.deepEqual(Object.keys(ready.rows[index]), Object.keys(f.full.rows[index]).filter(key => ![A, B].includes(key)));
    for (const key of Object.keys(ready.rows[index])) assert.deepEqual(ready.rows[index][key], f.full.rows[index][key]);
  }
  assert.equal(ready.rows[0].nativeBefore, false); assert.equal(ready.rows[0].nativeAfter, null);
  assert.equal(ready.rows[0].__CPX_UNKNOWN, 'keep unknown'); assert.equal(ready.rows[0].nested[A], 'keep nested');
  assert.equal(Object.hasOwn(ready.rows[0], '__proto__'), true); assert.deepEqual(ready.rows[0].__proto__, { own: 'row data' });
  assert.equal(Object.hasOwn(f.full.rows[2], A), false);
});

test('full-model restoration against retained full source exactly reproduces legacy ordered row JSON', async () => {
  const f = fixture(), ready = unpack(await builder.prepareReadyJson(f.full, f.options));
  // Oracle only: ordinal and original own-key order come from the retained full
  // source, never duplicate business IDs or a shipped hidden column component.
  const restored = ready.rows.map((row, index) => Object.fromEntries(Object.keys(f.full.rows[index]).map(key => [key, [A, B].includes(key) ? f.full.rows[index][key] : row[key]])));
  assert.equal(JSON.stringify(restored), JSON.stringify(f.full.rows));
  assert.equal(sha(JSON.stringify(restored)), sha(JSON.stringify(f.full.rows)));
  assert.equal(Object.hasOwn(ready, 'columns'), false); assert.equal(Object.hasOwn(ready, 'components'), false);
});

test('raw schema definitions preserve actual keys/order and metadata 0/false/null', async () => {
  const f = fixture(), result = await builder.prepareReadyJson(f.full, f.options), ready = unpack(result);
  assert.equal(JSON.stringify(ready.projection.schema.modelColumns), JSON.stringify(definitions()));
  assert.equal(ready.projection.schema.modelColumns[0].percentageScale, 0);
  assert.equal(ready.projection.schema.modelColumns[1].scale, false); assert.equal(ready.projection.schema.modelColumns[1].dataType, null);
  assert.equal(Object.hasOwn(ready.projection.schema.modelColumns[0], '__proto__'), true);
});

test('missing/null/wrong-module/version schema falls back to exact original references', async () => {
  for (const make of [() => undefined, () => null, value => ({ ...value, module: 'cp' }), value => ({ ...value, schemaVersion: 2 }), value => ({ ...value, status: 'unknown' })]) {
    const f = fixture(); f.options.schema = make(f.options.schema); await fullFallback(f.full, f.options);
  }
});

test('rowCount and exact whole row-key universe/order must match, including last-row-only fields', async () => {
  for (const mutate of [value => { value.rowCount--; }, value => { value.rowKeys.pop(); }, value => { value.rowKeys = value.rowKeys.slice(0, 3); }, value => { value.rowKeys.reverse(); }]) {
    const f = fixture(); mutate(f.options.schema); await fullFallback(f.full, f.options);
  }
});

test('ambiguous exact or normalized model-header registrations fail closed', async () => {
  for (const header of [A, A + '_']) {
    const f = fixture(); f.options.schema = schema(f.full, [...definitions(), { header, label: 'ambiguous actual token' }]);
    const result = await fullFallback(f.full, f.options); assert.equal(result.reason, 'AMBIGUOUS_REGISTRATION');
  }
});

test('empty, duplicate, unregistered, unknown native and over64 omission plans do not thin', async () => {
  for (const omittedKeys of [[], [A, A], ['nativeBefore'], ['__CPX_UNKNOWN'], ['__CPX_ABSENT'], Array.from({ length: 65 }, (_, index) => '__CPX_' + index)]) {
    const f = fixture(); f.options.omittedKeys = omittedKeys; await fullFallback(f.full, f.options);
  }
});

test('all actual canonical field IDs are protected even if schema falsely calls them model custom', async () => {
  for (const id of Object.keys(canonical.fields)) {
    const full = { rows: [{ [id]: 0 }] }, f = fixture();
    f.options.schema = schema(full, [{ header: id, label: 'attempted canonical omission' }]); f.options.omittedKeys = [id];
    const result = await fullFallback(full, f.options); assert.equal(result.reason, 'CANONICAL_REGISTRATION', id);
  }
});

test('actual canonical normalizer protects CPX token matches across every module, not just Orders', async () => {
  const isolated = isolatedCanonicalBuilder(), protectedKey = '__CPX_AUTHORITY_TOKEN', variant = '__CPX__AUTHORITY-TOKEN';
  isolated.canonical.registerModule('fixture-module-not-orders', { fob: { keys: [protectedKey], semantic: 'fixture-only' } });
  assert.equal(isolated.canonical.token(protectedKey), isolated.canonical.token(variant));
  assert.equal(isolated.canonical.canonicalId('orders', variant), null, 'Orders-only lookup would miss this registered binding');
  const full = { rows: [{ [variant]: false }] }, f = fixture();
  f.options.schema = schema(full, [{ header: variant, label: 'protected binding' }]); f.options.omittedKeys = [variant];
  assert.equal((await fullFallback(full, f.options, isolated.builder)).reason, 'CANONICAL_REGISTRATION');
});

test('actual canonicalId CPX registrations also remain protected', async () => {
  const isolated = isolatedCanonicalBuilder();
  isolated.canonical.registerModule('orders', { fob: { keys: [A], semantic: 'fixture-only' } });
  assert.equal(isolated.canonical.canonicalId('orders', A), 'fob');
  const f = fixture(); assert.equal((await fullFallback(f.full, f.options, isolated.builder)).reason, 'CANONICAL_REGISTRATION');
});

test('every actual native canonical field and unknown/native field stays present while only selected model keys drop', async () => {
  const f = fixture();
  for (const [id, field] of Object.entries(canonical.fields)) {
    const binding = field.modules.orders || field.modules.cp || Object.values(field.modules)[0];
    if (binding?.keys?.length) Object.defineProperty(f.full.rows[0], binding.keys[0], { value: id, enumerable: true, configurable: true, writable: true });
  }
  f.options.schema = schema(f.full);
  const raw = JSON.stringify(f.full); f.options.viewInfo.fullJsonSha256 = sha(raw); f.options.viewInfo.fullJsonBytes = Buffer.byteLength(raw);
  const ready = unpack(await builder.prepareReadyJson(f.full, f.options));
  for (const key of Object.keys(f.full.rows[0])) if (![A, B].includes(key)) assert.deepEqual(ready.rows[0][key], f.full.rows[0][key], key);
});

test('top-level profile/projection unknown keys cause exact full fallback, never overwriting user data', async () => {
  for (const key of ['profile', 'projection']) {
    const f = fixture(); f.full[key] = { unknown: false };
    assert.equal((await fullFallback(f.full, f.options)).reason, 'ENVELOPE_METADATA_COLLISION');
    assert.deepEqual(f.full[key], { unknown: false });
  }
});

test('request nonce is excluded from stable cached JSON and returned info', async () => {
  const f = fixture(); f.options.viewInfo.requestNonce = 'request-one';
  const first = await builder.prepareReadyJson(f.full, f.options);
  f.options.viewInfo.requestNonce = 'request-two';
  const second = await builder.prepareReadyJson(f.full, f.options);
  assert.equal(first.kind, 'ready'); assert.equal(second.kind, 'ready');
  assert.equal(zlib.gunzipSync(first.buffer).toString(), zlib.gunzipSync(second.buffer).toString());
  assert.equal(Object.hasOwn(first.info.viewInfo, 'requestNonce'), false); assert.equal(first.checksum, second.checksum);
});

test('an already request-scoped full envelope is not converted into a ready cache body', async () => {
  const f = fixture(); f.full.requestNonce = 'not-a-stable-source-field';
  assert.equal((await fullFallback(f.full, f.options)).reason, 'REQUEST_SCOPED_BODY');
});

test('client-like grant flags cannot replace stable view metadata or validate ambiguous model IDs', async () => {
  let f = fixture(); f.options.viewInfo.canExpose = true; f.options.viewInfo.cpAllowed = true;
  assert.equal((await fullFallback(f.full, f.options)).reason, 'INVALID_VIEW_INFO');
  f = fixture(); f.options.schema = schema(f.full, [definitions()[0], { ...definitions()[1], id: definitions()[0].id }]);
  assert.equal((await fullFallback(f.full, f.options)).reason, 'AMBIGUOUS_REGISTRATION');
});

test('metadata/full-byte/gzip limits fail closed using actual JSON and native gzip at lower-only test limits', async () => {
  let f = fixture(); f.options.viewInfo.fullJsonBytes = builder.MAX_FULL + 1;
  assert.equal((await fullFallback(f.full, f.options)).reason, 'FULL_JSON_BUDGET');
  f = fixture(); f.options.viewInfo.sourceKey = 'x'.repeat(builder.MAX_METADATA);
  await fullFallback(f.full, f.options);
  f = fixture(); await fullFallback(f.full, f.options, builder.create({ maxMetadataBytes: 128 }));
  f = fixture(); assert.equal((await fullFallback(f.full, f.options, builder.create({ maxGzipBytes: 1 }))).reason, 'READY_GZIP_BUDGET');
  assert.throws(() => builder.create({ maxFullBytes: builder.MAX_FULL + 1 }));
  assert.throws(() => builder.create({ maxGzipBytes: builder.MAX_GZIP + 1 }));
  assert.throws(() => builder.create({ maxMetadataBytes: builder.MAX_METADATA + 1 }));
});

test('native private 50000-row and512-registration limits remain intact', async () => {
  let f = fixture(); f.full.rows = Array.from({ length: 50001 }, () => ({ [A]: 0 })); f.options.schema = schema(f.full, [{ header: A, label: 'A' }]);
  assert.equal((await fullFallback(f.full, f.options)).reason, 'UNSUPPORTED_PARSED_ROWS');
  f = fixture(); const defs = Array.from({ length: 513 }, (_, index) => ({ header: '__CPX_COLUMN_' + index, label: 'C' }));
  f.options.schema = schema(f.full, defs);
  assert.equal((await fullFallback(f.full, f.options)).reason, 'UNKNOWN_REGISTRATION');
});

test('proxy/getter/toJSON inputs are rejected before any hook or trap runs', async () => {
  let hits = 0;
  const proxy = value => new Proxy(value, { ownKeys() { hits++; throw Error('proxy trap'); }, getPrototypeOf() { hits++; throw Error('proxy trap'); }, get() { hits++; throw Error('proxy trap'); } });
  const cases = [
    f => ({ full: proxy(f.full), options: f.options }),
    f => ({ full: f.full, options: proxy(f.options) }),
    f => { f.full.rows[0] = proxy(f.full.rows[0]); return { full: f.full, options: f.options }; },
    f => { f.full.rows[0].nested = proxy({ own: true }); return { full: f.full, options: f.options }; },
    f => { Object.defineProperty(f.full.rows[0].nested, 'hook', { enumerable: true, get() { hits++; throw Error('getter'); } }); return { full: f.full, options: f.options }; },
    f => { f.full.toJSON = () => { hits++; throw Error('toJSON'); }; return { full: f.full, options: f.options }; },
    f => { Object.defineProperty(f.options.viewInfo, 'actorId', { enumerable: true, get() { hits++; throw Error('getter'); } }); return { full: f.full, options: f.options }; },
    f => { Object.defineProperty(f.options, 'schema', { enumerable: true, get() { hits++; throw Error('getter'); } }); return { full: f.full, options: f.options }; },
    f => { Object.defineProperty(f.options.schema.modelColumns[0].sourceMetadata, 'hook', { enumerable: true, get() { hits++; throw Error('getter'); } }); return { full: f.full, options: f.options }; },
  ];
  for (const make of cases) { const f = fixture(), input = make(f); await fullFallback(input.full, input.options); }
  assert.equal(hits, 0);
});

test('non-date-safe, cyclic, sparse and unsupported JSON shapes fall back without mutation', async () => {
  const cases = [
    f => { f.full.rows[0].nested.date = new Date(0); },
    f => { f.full.rows[0].nested.self = f.full.rows[0].nested; },
    f => { f.full.rows[0].nested.otherRowAlias = f.full.rows[1]; },
    f => { f.full.rows[0].nested.unsupported = undefined; },
    f => { f.full.rows[0].nested.unsupported = NaN; },
    f => { delete f.full.rows[1]; },
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); await fullFallback(f.full, f.options); }
});
