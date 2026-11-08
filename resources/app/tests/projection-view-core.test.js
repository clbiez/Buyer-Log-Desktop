'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { gzipSync, gunzipSync } = require('node:zlib');
const api = require('../server/lib/projection-view-core'), { serialize } = require('../server/lib/compute-tasks');
const secret = Buffer.alloc(32, 88), clone = value => JSON.parse(JSON.stringify(value));
function base(overrides = {}) { return { ownerId: 'source-owner', actorId: 'buyer', module: 'cp', sourceGeneration: 'source-g1', sourceRevision: 'source-r1', moduleInputKey: 'cp-input', sourceProjectionKey: 'cp-projection', accessHash: 'access-r1', contextHash: 'ctx-r1', planRevision: 'readers-r1', requestGeneration: 'request-r1', ...overrides }; }
function raw() {
  const a = JSON.parse('{"2":"numeric-first","Order Code":"000123","zero":0,"flag":false,"nil":null,"nested":{"a":false,"b":0},"__proto__":{"safe":true},"constructor":"own","fullOnly":{"value":"A"},"tail":""}');
  const b = JSON.parse('{"Order Code":"000123","zero":2,"flag":false,"nil":null,"nested":{"a":false,"b":0},"fullOnly":{"value":"B"},"tail":""}');
  a.fullOnly.value = 'İğüş🌍\n"\\\ud800';
  a.OPD = new Date(2026, 1, 2); b.OPD = new Date(2026, 1, 3);
  for (const row of [a, b]) { row['Ex-factory'] = new Date(2026, 8, 1); row['Buying Son Onay Tarihi'] = null; row._logisticSegments = [{ kind: 'partial', status: 'Depoda', quantity: 5, delType: 'Gemi', arrival: new Date(2026, 8, 3), handover: new Date(2026, 8, 2) }]; row._logisticTotalQty = 0; }
  return { loadedAt: 'SYNTHETIC-ONLY', cpModelColumns: [], rows: [a, b] };
}
function fixture(options = {}, selectedModule = 'cp') {
  const core = api.createProjectionCore(options), source = raw(), fullText = serialize(source, 'projection'), gzip = gzipSync(fullText, { level: 4 });
  const full = JSON.parse(gunzipSync(gzip).toString('utf8')), originalBase = base(selectedModule === 'orders' ? { module: 'orders', moduleInputKey: 'orders-input', sourceProjectionKey: 'orders-projection' } : {});
  const pin = { schemaVersion: 1, cacheGeneration: 'cache-g1', sourceLoadedAt: 'SYNTHETIC-ONLY', sourceRevisionKey: 'source-r1', module: originalBase.module, moduleInputKey: originalBase.moduleInputKey, sourceProjectionKey: originalBase.sourceProjectionKey, contextHash: originalBase.contextHash, checksum: crypto.createHash('sha256').update(gzip).digest('hex'), uncompressedBytes: Buffer.byteLength(fullText) };
  const token = core.bindProjectionPin(originalBase, pin), catalog = { revision: token.planRevision, readers: new Map([
    ['identity', { mode: 'finite', fields: ['Order Code'] }],
    ['cells', { mode: 'finite', dependsOn: ['identity'], fields: ['nil', 'flag', 'zero', 'nested', 'missing', '__proto__', 'constructor', 'OPD', '2'] }],
  ]) };
  const plan = core.compileFinitePlan({ token, viewId: selectedModule + '-synthetic-view', readers: ['cells'] }, catalog);
  const view = core.buildView(full, token, plan, secret);
  return { core, source, full, fullText, gzip, originalBase, pin, token, catalog, plan, view };
}
const pairs = view => view.completeness.map(({ ordinal, handle }) => ({ ordinal, handle }));
const resolved = (f, records = pairs(f.view), overrides = {}) => f.core.resolveDetails(f.full, { token: f.token, records, ...overrides }, f.token, secret);
const is409 = e => e.statusCode === 409;

test('finite dependency plan resolves known readers in order and has no production omission catalog', () => {
  const f = fixture(); assert.deepEqual(f.plan.readers, ['identity', 'cells']); assert.equal(f.plan.fields[0], 'Order Code');
  assert.ok(Object.isFrozen(f.plan)); assert.ok(Object.isFrozen(f.plan.fields));
  assert.equal(f.core.compileFinitePlan({ token: f.token, viewId: 'unknown', readers: ['not-approved'] }, { revision: f.token.planRevision, readers: new Map() }), null);
});

test('unknown/dynamic/enumerating/unresolved/cyclic readers return exact full fallback without touching full rows', () => {
  const f = fixture(); let reads = 0; const unread = {}; Object.defineProperty(unread, 'rows', { enumerable: true, get() { reads++; throw Error('must not inspect full fallback'); } });
  for (const mode of ['dynamic', 'enumeration', 'unresolved', 'full']) {
    const catalog = { revision: f.token.planRevision, readers: new Map([['reader', { mode, fields: ['zero'] }]]) };
    const p = f.core.compileFinitePlan({ token: f.token, viewId: 'v', readers: ['reader'] }, catalog);
    assert.equal(p, null); assert.strictEqual(f.core.buildView(unread, {}, p, null), unread);
  }
  const cyclic = { revision: f.token.planRevision, readers: new Map([['a', { mode: 'finite', fields: [], dependsOn: ['b'] }], ['b', { mode: 'finite', fields: [], dependsOn: ['a'] }]]) };
  assert.equal(f.core.compileFinitePlan({ token: f.token, viewId: 'v', readers: ['a'] }, cyclic), null); assert.equal(reads, 0);
});

test('catalog revision, unresolved dependency and malformed field/selector keep full fallback', () => {
  const f = fixture();
  for (const catalog of [{ ...f.catalog, revision: 'other' }, { revision: f.token.planRevision, readers: new Map([['bad', { mode: 'finite', fields: ['zero'], dependsOn: ['missing'] }]]) }, { revision: f.token.planRevision, readers: new Map([['bad', { mode: 'finite', fields: ['zero', 'zero'] }]]) }]) {
    const p = f.core.compileFinitePlan({ token: f.token, viewId: 'v', readers: ['bad'] }, catalog); assert.equal(p, null); assert.strictEqual(f.core.buildView(f.full, f.token, p, secret), f.full);
  }
  assert.equal(f.core.compileFinitePlan({ token: f.token, viewId: 'v', rowKey: 'orders', readers: ['cells'] }, f.catalog), null);
});

test('actual current projection serializer full/full first, then selected keys/presence/order match wire', () => {
  const f = fixture(); assert.equal(serialize(f.source, 'projection'), f.fullText); assert.equal(JSON.stringify(f.full), f.fullText);
  assert.equal(f.view.profile, api.VIEW); assert.equal(f.view.mode, 'shadow');
  assert.deepEqual(Object.keys(f.view.rows[0]), ['2', 'Order Code', 'zero', 'flag', 'nil', 'nested', '__proto__', 'constructor', 'OPD']);
  assert.equal(f.view.rows[0].zero, 0); assert.equal(f.view.rows[0].flag, false); assert.equal(f.view.rows[0].nil, null);
  assert.equal(Object.hasOwn(f.view.rows[1], '__proto__'), false); assert.deepEqual(f.view.completeness[0].absentKeys, ['missing']);
  assert.deepEqual(f.view.completeness[1].absentKeys, ['missing', '__proto__', 'constructor', '2']);
  assert.equal(Object.getPrototypeOf(f.view.rows[0]), Object.prototype); assert.equal(Object.hasOwn(f.view.rows[0], '__proto__'), true);
  assert.equal(f.view.rows[0].OPD, f.full.rows[0].OPD); assert.equal(typeof f.view.rows[0].OPD, 'string');
});

test('initial full-shadow plan keeps every row own key and accepts current server opaque token format', () => {
  const f = fixture(), token = { ...f.token, sourceRevision: 'current-server-opaque-cache-pin', planRevision: api.FULL_SHADOW_PLAN };
  const plan = f.core.fullShadowPlan(f.full, token), view = f.core.buildView(f.full, token, plan, secret);
  assert.equal(plan.status, 'full-shadow'); assert.equal(plan.revision, 'cp-orders-full-shadow-v1');
  assert.equal(JSON.stringify(view.rows), JSON.stringify(f.full.rows)); assert.equal(view.rows.length, 2);
  assert.ok(view.completeness.every(row => row.handle.length === 32));
  const details = api.createProjectionCore().resolveDetails(f.full, { token, records: pairs(view) }, token, Buffer.from(secret));
  assert.equal(JSON.stringify(details.records.map(x => x.row)), JSON.stringify(f.full.rows));
  const incomplete = { ...plan, fields: plan.fields.filter(key => key !== 'fullOnly') };
  assert.throws(() => f.core.buildView(f.full, token, incomplete, secret), { code: 'PROJECTION_VIEW_INVALID', reason: 'FULL_SHADOW_FIELDS_INCOMPLETE' });
});

test('trusted finite/full-shadow plans are synchronously snapshotted without mutable field-list aliases or getter calls', () => {
  const f = fixture(), input = clone(f.plan), before = JSON.stringify(f.view.rows), view = f.core.buildView(f.full, f.token, input, secret);
  input.fields.length = 0; input.readers.length = 0; input.token.accessHash = 'changed'; assert.equal(JSON.stringify(view.rows), before);
  let calls = 0; const invalid = clone(f.plan); Object.defineProperty(invalid.fields, '0', { enumerable: true, get() { calls++; return 'zero'; } });
  assert.strictEqual(f.core.buildView(f.full, f.token, invalid, secret), f.full); assert.equal(calls, 0);
  const token = { ...f.token, planRevision: api.FULL_SHADOW_PLAN }, fullPlan = clone(f.core.fullShadowPlan(f.full, token)), fullView = f.core.buildView(f.full, token, fullPlan, secret);
  fullPlan.fields.length = 0; assert.equal(JSON.stringify(fullView.rows), JSON.stringify(f.full.rows));
});

test('initial128MiB view/input byte policy permits only caller-lowered caps', () => {
  assert.ok(api.createProjectionCore({ maxViewBytes: 128 * 1048576, maxFullRawBytes: 128 * 1048576 }));
  assert.ok(api.createProjectionCore({ maxViewBytes: 1024, maxFullRawBytes: 1024 }));
  assert.throws(() => api.createProjectionCore({ maxViewBytes: 128 * 1048576 + 1 }), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_OPTIONS' });
});

test('duplicate business identities use separate ordinals and deterministic cross-worker HMAC handles', () => {
  const f = fixture(), anotherWorker = api.createProjectionCore(); assert.notEqual(pairs(f.view)[0].handle, pairs(f.view)[1].handle);
  const result = anotherWorker.resolveDetails(f.full, { token: f.token, records: pairs(f.view).reverse() }, f.token, Buffer.from(secret));
  assert.deepEqual(result.records.map(x => x.ordinal), [1, 0]); assert.deepEqual(result.records.map(x => x.row['Order Code']), ['000123', '000123']);
  assert.deepEqual(result.records.map(x => JSON.stringify(x.row)), [JSON.stringify(f.full.rows[1]), JSON.stringify(f.full.rows[0])]);
  const otherView = anotherWorker.buildView(f.full, f.token, f.plan, Buffer.from(secret)); assert.deepEqual(pairs(otherView), pairs(f.view));
});

test('core is stateless and preserves read-only task-local aliases; wire roundtrip is the isolation boundary', () => {
  const f = fixture(), shared = f.full.rows[0], full = { rows: [shared, shared] }, view = f.core.buildView(full, f.token, f.plan, secret);
  assert.strictEqual(view.rows[0].nested, shared.nested); assert.strictEqual(view.rows[1].nested, shared.nested);
  const detail = f.core.resolveDetails(full, { token: f.token, records: pairs(view) }, f.token, secret);
  assert.strictEqual(detail.records[0].row, shared); assert.strictEqual(detail.records[1].row, shared);
  const client = clone(detail); client.records[0].row.nested.a = true; assert.equal(shared.nested.a, false);
  assert.notEqual(pairs(view)[0].handle, pairs(view)[1].handle);
  assert.deepEqual(Object.keys(f.core).sort(), ['bindProjectionPin', 'buildView', 'compileFinitePlan', 'fullShadowPlan', 'resolveDetails'].sort());
});

test('every token mismatch returns409 before touching current rows; it never substitutes new data', () => {
  const f = fixture(); let reads = 0; const unread = {}; Object.defineProperty(unread, 'rows', { enumerable: true, get() { reads++; throw Error('stale body must not be read'); } });
  for (const key of api.TOKEN_KEYS) {
    const value = key === 'module' ? 'orders' : key === 'sourceRevision' ? f.token[key].slice(0, -1) + (f.token[key].endsWith('0') ? '1' : '0') : f.token[key] + '-changed';
    assert.throws(() => f.core.resolveDetails(unread, { token: f.token, records: pairs(f.view) }, { ...f.token, [key]: value }, secret), is409);
  }
  assert.equal(reads, 0);
});

test('exact generation/manifest/moduleInput/context/checksum/raw-byte pin drift returns409', () => {
  const f = fixture();
  for (const key of api.PIN_KEYS) {
    const nextPin = { ...f.pin }, nextBase = { ...f.originalBase };
    if (key === 'schemaVersion' || key === 'uncompressedBytes') nextPin[key]++;
    else if (key === 'module') { nextPin.module = 'orders'; nextBase.module = 'orders'; }
    else if (key === 'checksum') nextPin.checksum = 'a'.repeat(64) === f.pin.checksum ? 'b'.repeat(64) : 'a'.repeat(64);
    else nextPin[key] += '-changed';
    if (['moduleInputKey', 'sourceProjectionKey', 'contextHash'].includes(key)) nextBase[key] = nextPin[key];
    const current = f.core.bindProjectionPin(nextBase, nextPin); assert.notEqual(current.sourceRevision, f.token.sourceRevision);
    assert.throws(() => f.core.resolveDetails({ rows: [{ 'Order Code': 'NEW-DATA' }] }, { token: f.token, records: pairs(f.view) }, current, secret), { code: 'PROJECTION_VIEW_STALE', statusCode: 409 });
  }
});

test('CP and Orders remain separate even with identical row values, source IDs and secret', () => {
  const cp = fixture(), orders = fixture({}, 'orders'); assert.notEqual(cp.token.sourceRevision, orders.token.sourceRevision); assert.notEqual(pairs(cp.view)[0].handle, pairs(orders.view)[0].handle);
  assert.equal(resolved(orders).token.module, 'orders');
  assert.throws(() => orders.core.resolveDetails(orders.full, { token: cp.token, records: pairs(cp.view) }, orders.token, secret), { code: 'PROJECTION_VIEW_STALE', statusCode: 409 });
});

test('HMAC binds exact token and ordinal; wrong secret/ordinal/handle cannot select another row', () => {
  const f = fixture(), pair = pairs(f.view)[0];
  assert.throws(() => f.core.resolveDetails(f.full, { token: f.token, records: [{ ...pair, ordinal: 1 }] }, f.token, secret), { code: 'PROJECTION_VIEW_INVALID', reason: 'DETAIL_HANDLE_MISMATCH' });
  assert.throws(() => f.core.resolveDetails(f.full, { token: f.token, records: [pair] }, f.token, Buffer.alloc(32, 1)), { code: 'PROJECTION_VIEW_INVALID', reason: 'DETAIL_HANDLE_MISMATCH' });
  assert.throws(() => resolved(f, [{ ...pair, handle: 'A'.repeat(32) }]), { code: 'PROJECTION_VIEW_INVALID', reason: 'DETAIL_HANDLE_MISMATCH' });
  assert.throws(() => f.core.buildView(f.full, f.token, f.plan, Buffer.alloc(1)), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_PROJECTION_SECRET' });
});

test('duplicate ordinal validation precedes JSON shape work, including the exact same request object alias', () => {
  const f = fixture(), pair = pairs(f.view)[0];
  assert.throws(() => resolved(f, [pair, pair]), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_DETAIL_RECORD' });
  assert.throws(() => resolved(f, [pair, { ...pair }]), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_DETAIL_RECORD' });
  assert.throws(() => resolved(f, [{ ...pair, ordinal: -1 }]), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_DETAIL_RECORD' });
  assert.throws(() => resolved(f, [pair], { rowKey: 'orders' }), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_DETAIL_REQUEST' });
});

test('detail row count and complete raw UTF8 response budget are strict and never truncate', () => {
  const f = fixture(), response = resolved(f), exact = Buffer.byteLength(JSON.stringify(response));
  assert.equal(Buffer.byteLength(JSON.stringify(resolved(f, pairs(f.view), { maxBytes: exact }))), exact);
  assert.throws(() => resolved(f, pairs(f.view), { maxBytes: exact - 1 }), e => e.statusCode === 413);
  assert.throws(() => resolved(f, Array.from({ length: 129 }, () => pairs(f.view)[0])), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_DETAIL_REQUEST' });
  assert.equal(resolved(f).records.length, 2);
});

test('view rows/bytes admission leaves exact full fallback and no source mutation', () => {
  for (const options of [{ maxRows: 1 }, { maxViewBytes: 256 }]) {
    const f = fixture(options), before = JSON.stringify(f.full); assert.strictEqual(f.view, f.full); assert.equal(JSON.stringify(f.full), before);
  }
  const f = fixture(), small = api.createProjectionCore({ maxFullRawBytes: 8 }); assert.throws(() => small.bindProjectionPin(f.originalBase, f.pin), { code: 'PROJECTION_VIEW_INVALID', reason: 'INVALID_PROJECTION_PIN' });
});

test('unsupported selected raw Date/getter/proxy/undefined/cycle falls back without pretending arbitrary graph equivalence', () => {
  const f = fixture(); let traps = 0;
  const values = [new Date(), undefined, new Proxy({}, { ownKeys() { traps++; throw Error('trap'); } })]; const cycle = {}; cycle.self = cycle; values.push(cycle);
  for (const value of values) { const full = clone(f.full); full.rows[0].nested = value; assert.strictEqual(f.core.buildView(full, f.token, f.plan, secret), full); }
  const full = clone(f.full); Object.defineProperty(full.rows[0], 'nested', { enumerable: true, get() { traps++; throw Error('getter'); } });
  assert.strictEqual(f.core.buildView(full, f.token, f.plan, secret), full); assert.equal(traps, 0);
});

test('wire metadata/full profile conflicts preserve full fallback; stale finite plan is409', () => {
  const f = fixture(); for (const extra of [{ profile: 'unknown' }, { mode: 'partial' }, { completeness: [] }]) { const full = { ...f.full, ...extra }; assert.strictEqual(f.core.buildView(full, f.token, f.plan, secret), full); }
  assert.throws(() => f.core.buildView(f.full, { ...f.token, requestGeneration: 'new' }, f.plan, secret), { code: 'PROJECTION_VIEW_STALE' });
});

test('actual coordinator receives transported full details before actual normalization and keeps duplicate requested identity', () => {
  const f = fixture();
  const reference = require('./helpers/projection-current-normalizer').loadReference(), fullA = clone(f.full.rows), fullB = clone(f.full.rows); reference.normalize(fullA); reference.normalize(fullB); assert.deepEqual(fullA, fullB);
  const helper = require('../public/projection-shadow-hydration');
  const coordinator = helper.createShadowCoordinator({ fetchDetails: async ({ token, records, maxBytes }) => clone(f.core.resolveDetails(f.full, { token, records, maxBytes }, f.token, secret)), prepareFull: rows => reference.normalize(rows), isCurrent: () => true, getDirty: () => ({ dirty: false, revision: 0 }) });
  return coordinator.accept(clone(f.view)).requireFull([1, 0, 1]).then(result => {
    assert.strictEqual(result.rows[0], result.rows[2]); assert.deepEqual(result.rows[0], fullA[1]); assert.deepEqual(result.rows[1], fullA[0]);
    assert.equal(JSON.stringify(f.full), f.fullText);
  });
});
