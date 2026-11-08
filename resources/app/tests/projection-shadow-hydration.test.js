'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createShadowCoordinator, VIEW, DETAIL, TOKEN_KEYS } = require('../public/projection-shadow-hydration.js');
const clone = value => JSON.parse(JSON.stringify(value));
const nextTurn = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function token() { return { ownerId: 'source-owner', actorId: 'buyer', module: 'cp', sourceGeneration: 'g1', sourceRevision: 'r1',
  moduleInputKey: 'cp-input-1', sourceProjectionKey: 'cp-source-1', accessHash: 'access-1', contextHash: 'context-1', planRevision: 'plan-1', requestGeneration: 'request-1' }; }
function fullRows() {
  const first = JSON.parse('{"Order Code":"000123","Probe":0,"__proto__":{"tag":"custom"},"constructor":"own","Order Quantity":100,"OPD":"2026-01-01","Ex-factory":"2026-02-01","Buying Son Onay Tarihi":null,"_logisticSegments":[{"kind":"partial","quantity":5,"status":"Depoda","delType":"Gemi","arrival":"2026-03-01","handover":"2026-02-15"}],"_logisticTotalQty":0,"empty":"","nested":{"presentNull":null,"flag":false,"zero":0},"tail":false}');
  const second = clone(first); second.Probe = false; second['Order Quantity'] = 0; second._logisticTotalQty = false;
  return [first, second]; // Deliberately duplicate business identities; ordinals/handles differ.
}
function viewEnvelope(value = token()) {
  return { profile: VIEW, mode: 'shadow', token: value,
    rows: [{ tail: false, Probe: 0 }, { tail: false, Probe: false }],
    completeness: [{ ordinal: 0, handle: 'source-row:0', absentKeys: ['realMissing'] }, { ordinal: 1, handle: 'source-row:1', absentKeys: [] }] };
}
function response(request, rows = fullRows()) {
  return { profile: DETAIL, complete: true, token: request.token,
    records: request.records.map(record => ({ ...record, row: rows[record.ordinal] })) };
}
function harness(overrides = {}) {
  const state = { current: true, dirty: new Map(), calls: [], preparations: 0 };
  const coordinator = createShadowCoordinator({
    fetchDetails: async request => { state.calls.push(request); return response(request); },
    prepareFull: async () => { state.preparations++; }, isCurrent: () => state.current,
    getDirty: ({ ordinal }) => state.dirty.get(ordinal) || { dirty: false, revision: 0 }, ...overrides,
  });
  return { state, coordinator, session: coordinator.accept(viewEnvelope()) };
}
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
function fingerprint(value) {
  if (value instanceof Date) return ['Date', value.getTime(), Reflect.ownKeys(value).map(key => [key, fingerprint(value[key])])];
  if (value === null || typeof value !== 'object') return [value === null ? 'null' : typeof value, value];
  return [Array.isArray(value) ? 'array' : 'object', Reflect.ownKeys(value).map(key => [key, fingerprint(value[key])])];
}

test('legacy full envelopes pass through with exact envelope/row identity and no callbacks', () => {
  const { coordinator, state } = harness();
  for (const envelope of [{ rows: fullRows() }, { profile: 'full', rows: fullRows(), custom: false }]) {
    const accepted = coordinator.accept(envelope); assert.equal(accepted, envelope); assert.equal(accepted.rows[0], envelope.rows[0]);
  }
  assert.equal(state.calls.length, 0); assert.equal(state.preparations, 0);
});

test('explicit unknown profile, non-shadow view and missing context fail before admission', () => {
  const { coordinator, state } = harness();
  assert.throws(() => coordinator.accept({ profile: 'future-profile' }), { code: 'UNSUPPORTED_PROFILE' });
  assert.throws(() => coordinator.accept({ ...viewEnvelope(), mode: 'default' }), { code: 'UNSUPPORTED_PROFILE' });
  const envelope = viewEnvelope(); delete envelope.token.accessHash;
  assert.throws(() => coordinator.accept(envelope), { code: 'INVALID_TOKEN' }); assert.equal(state.calls.length, 0);
});

test('private sidecar distinguishes loaded values, real absence and unrequested fields without row metadata', () => {
  const { session } = harness();
  assert.equal(session.mode, 'shadow'); assert.deepEqual(Object.keys(session.viewRows[0]), ['tail', 'Probe']);
  assert.deepEqual(session.completeness(0), { state: 'view', presentKeys: ['tail', 'Probe'], absentKeys: ['realMissing'] });
  assert.equal(Object.hasOwn(session.viewRows[0], 'realMissing'), false);
  assert.equal(Object.hasOwn(session.viewRows[0], 'Order Quantity'), false);
  assert.equal(session.viewRows[0].Probe, 0); assert.equal(session.viewRows[1].Probe, false);
});

test('bounded batches preserve duplicate ordinal identity, requested order and exact complete key order', async () => {
  const calls = [], source = fullRows(), before = JSON.stringify(source);
  const { session } = harness({ maxBatchRows: 1, maxBatchBytes: 8192,
    fetchDetails: async request => { calls.push(request); return response(request, source); } });
  const result = await session.requireFull([1, 0, 1]);
  assert.equal(calls.length, 2); assert.ok(calls.every(call => call.records.length === 1 && call.maxBytes === 8192));
  assert.deepEqual(result.ordinals, [1, 0, 1]); assert.equal(result.rows[0], result.rows[2]); assert.notEqual(result.rows[0], result.rows[1]);
  assert.deepEqual(Object.keys(result.rows[1]), Object.keys(source[0])); assert.equal(Object.getPrototypeOf(result.rows[1]), Object.prototype);
  assert.equal(Object.hasOwn(result.rows[1], '__proto__'), true); assert.deepEqual(result.rows[1].__proto__, { tag: 'custom' });
  assert.equal(result.rows[1].constructor, 'own'); assert.equal(result.rows[0]['Order Quantity'], 0); assert.equal(result.rows[0]._logisticTotalQty, false);
  assert.equal(JSON.stringify(source), before); assert.deepEqual(Object.keys(session.viewRows[0]), ['tail', 'Probe']);
  assert.equal((await session.requireFull([0])).rows[0], result.rows[1]); assert.equal(calls.length, 2);
});

test('overlapping subscribers share fetches; aborting one does not abort the other subscriber', async () => {
  const gate = deferred(), calls = [], a = new AbortController(), b = new AbortController();
  const { session } = harness({ fetchDetails: request => { calls.push(request); return gate.promise.then(() => response(request)); } });
  const first = session.requireFull([0, 1], { signal: a.signal }), firstRejected = rejects(first, 'ABORTED');
  const second = session.requireFull([1], { signal: b.signal }); await nextTurn();
  assert.equal(calls.length, 1); a.abort(); await firstRejected; assert.equal(calls[0].signal.aborted, false);
  assert.equal(session.completeness(0).state, 'view'); gate.resolve();
  const result = await second; assert.equal(result.rows[0].Probe, false); assert.equal(session.completeness(0).state, 'view');
  assert.equal(session.completeness(1).state, 'full');
});

test('permuted detail responses cannot swap rows that share the same business identity', async () => {
  const { session } = harness({ fetchDetails: async request => { const value = response(request); value.records.reverse(); return value; } });
  const result = await session.requireFull([1, 0]);
  assert.equal(result.rows[0].Probe, false); assert.equal(result.rows[1].Probe, 0);
  assert.deepEqual(result.rows.map(row => row['Order Code']), ['000123', '000123']);
});

test('last subscriber abort signals backend once; late non-cooperative completion publishes nothing', async () => {
  const gate = deferred(), calls = [], a = new AbortController(), b = new AbortController(); let aborts = 0;
  const { session } = harness({ fetchDetails: request => { calls.push(request); request.signal.addEventListener('abort', () => aborts++); return gate.promise.then(() => response(request)); } });
  const one = rejects(session.requireFull([0], { signal: a.signal }), 'ABORTED');
  const two = rejects(session.requireFull([0], { signal: b.signal }), 'ABORTED'); await nextTurn();
  a.abort(); await one; assert.equal(aborts, 0); b.abort(); await two; assert.equal(aborts, 1); assert.equal(calls[0].signal.aborted, true);
  gate.resolve(); await nextTurn(); assert.equal(session.completeness(0).state, 'view');
});

test('already aborted requests and stale contexts admit no backend work', async () => {
  const { session, state } = harness(), controller = new AbortController(); controller.abort();
  await rejects(session.requireFull([0], { signal: controller.signal }), 'ABORTED');
  state.current = false; await rejects(session.requireFull([0]), 'STALE_CONTEXT'); assert.equal(state.calls.length, 0);
});

test('source/access/plan context changing during fetch rejects before preparation/publication', async () => {
  const gate = deferred(); let request;
  const { session, state } = harness({ fetchDetails: value => { request = value; return gate.promise; } });
  const result = rejects(session.requireFull([0]), 'STALE_CONTEXT'); await nextTurn(); state.current = false; gate.resolve(response(request));
  await result; assert.equal(state.preparations, 0); assert.equal(session.completeness(0).state, 'view');
});

test('context changes while async preparation is pending reject the entire private publication', async () => {
  const gate = deferred(), started = deferred();
  const { session, state } = harness({ prepareFull: async () => { started.resolve(); await gate.promise; } });
  const result = rejects(session.requireFull([0, 1]), 'STALE_CONTEXT'); await started.promise; state.current = false; gate.resolve(); await result;
  assert.equal(session.completeness(0).state, 'view'); assert.equal(session.completeness(1).state, 'view');
});

test('subscriber abort during an awaited hook rejects promptly and late private work cannot publish', async () => {
  const gate = deferred(), started = deferred(), controller = new AbortController();
  const { session } = harness({ prepareFull: async rows => { started.resolve(); await gate.promise; rows[0].latePrivate = true; } });
  const result = rejects(session.requireFull([0], { signal: controller.signal }), 'ABORTED'); await started.promise;
  controller.abort(); await result; assert.equal(session.completeness(0).state, 'view');
  gate.resolve(); await nextTurn(); assert.equal(session.completeness(0).state, 'view');
});

test('dirty input rejects before fetch; clean revision changes during fetch reject before preparation', async () => {
  const { session, state } = harness(); state.dirty.set(0, { dirty: true, revision: 1 });
  await rejects(session.requireFull([0]), 'DIRTY_ROW'); assert.equal(state.calls.length, 0);
  const gate = deferred(); let request;
  const other = harness({ fetchDetails: value => { request = value; return gate.promise; } });
  const result = rejects(other.session.requireFull([0]), 'DIRTY_REVISION_CHANGED'); await nextTurn();
  other.state.dirty.set(0, { dirty: false, revision: 1 }); gate.resolve(response(request)); await result;
  assert.equal(other.state.preparations, 0); assert.equal(other.session.completeness(0).state, 'view');
});

test('dirty changes during preparation reject without overwriting even another requested row', async () => {
  const gate = deferred(), started = deferred();
  const { session, state } = harness({ prepareFull: async () => { started.resolve(); await gate.promise; } });
  const result = rejects(session.requireFull([0, 1]), 'DIRTY_ROW'); await started.promise;
  state.dirty.set(1, { dirty: true, revision: 1 }); gate.resolve(); await result;
  assert.equal(session.completeness(0).state, 'view'); assert.equal(session.completeness(1).state, 'view');
});

test('every owner/module/source/moduleInput/access/plan/request token binding rejects a mismatched detail response', async () => {
  assert.equal(Object.isFrozen(TOKEN_KEYS), true);
  for (const key of TOKEN_KEYS) {
    const { session } = harness({ fetchDetails: async request => {
      const result = response(request); result.token = { ...request.token, [key]: key === 'module' ? 'orders' : request.token[key] + '-wrong' }; return result;
    } });
    await rejects(session.requireFull([0]), 'WRONG_DETAIL_CONTEXT'); assert.equal(session.completeness(0).state, 'view');
  }
});

test('wrong, missing, duplicate and incomplete detail handles fail closed', async () => {
  const mutations = [
    [value => { value.complete = false; }, 'INCOMPLETE_DETAILS'],
    [value => { value.profile = 'full'; }, 'INCOMPLETE_DETAILS'],
    [value => { value.records.pop(); }, 'INCOMPLETE_DETAILS'],
    [value => { value.records[0].ordinal = 99; }, 'WRONG_DETAIL_RECORD'],
    [value => { value.records[0].handle = 'another-source-row'; }, 'WRONG_DETAIL_RECORD'],
    [value => { value.records[1] = value.records[0]; }, 'WRONG_DETAIL_RECORD'],
  ];
  for (const [mutate, code] of mutations) {
    const { session, state } = harness({ fetchDetails: async request => { const value = response(request); mutate(value); return value; } });
    await rejects(session.requireFull([0, 1]), code); assert.equal(state.preparations, 0); assert.equal(session.completeness(0).state, 'view');
  }
});

test('oversized and accessor-bearing detail values reject without invoking getters', async () => {
  const tooLarge = harness({ maxBatchBytes: 32 }); await rejects(tooLarge.session.requireFull([0]), 'DETAIL_TOO_LARGE');
  let getterCalls = 0;
  const other = harness({ fetchDetails: async request => { const value = response(request); Object.defineProperty(value.records[0].row, 'getMe', { enumerable: true, get() { getterCalls++; return 'bad'; } }); return value; } });
  await rejects(other.session.requireFull([0]), 'NON_JSON_VALUE'); assert.equal(getterCalls, 0);
  assert.equal(other.session.completeness(0).state, 'view');
});

test('one failed batch never publishes an earlier successful batch; existing retained records survive later failure', async () => {
  const { session } = harness({ maxBatchRows: 1, fetchDetails: async request => {
    const value = response(request); if (request.records[0].ordinal === 1) value.complete = false; return value;
  } });
  await rejects(session.requireFull([0, 1]), 'INCOMPLETE_DETAILS'); assert.equal(session.completeness(0).state, 'view');
  const first = await session.requireFull([0]); await rejects(session.requireFull([0, 1]), 'INCOMPLETE_DETAILS');
  assert.equal((await session.requireFull([0])).rows[0], first.rows[0]); assert.equal(session.completeness(1).state, 'view');
});

test('failed or reordered preparation publishes no full records', async () => {
  const failed = harness({ prepareFull: async () => { throw Object.assign(new Error('downstream failed'), { code: 'DOWNSTREAM_FAILED' }); } });
  await rejects(failed.session.requireFull([0]), 'DOWNSTREAM_FAILED'); assert.equal(failed.session.completeness(0).state, 'view');
  const reordered = harness({ prepareFull: async rows => { rows.reverse(); } });
  await rejects(reordered.session.requireFull([0, 1]), 'INVALID_PREPARATION'); assert.equal(reordered.session.completeness(0).state, 'view');
  for (const overrides of [{ prepareFull: () => Promise.reject(undefined) }, { fetchDetails: () => Promise.reject(null) }]) {
    const other = harness(overrides); let rejected = false;
    await other.session.requireFull([0], { signal: new AbortController().signal }).then(() => assert.fail('rejected callback must never publish'), () => { rejected = true; });
    assert.equal(rejected, true); assert.equal(other.session.completeness(0).state, 'view');
  }
});

test('returned publication guard and retained records reject subsequent dirty/context changes', async () => {
  const { session, state } = harness(); const result = await session.requireFull([0]); result.assertCurrent();
  state.dirty.set(0, { dirty: false, revision: 1 });
  assert.throws(() => result.assertCurrent(), { code: 'DIRTY_REVISION_CHANGED' }); await rejects(session.requireFull([0]), 'DIRTY_REVISION_CHANGED');
  state.current = false; assert.throws(() => result.assertCurrent(), { code: 'STALE_CONTEXT' });
});

test('actual current normalization and awaited downstream hook preserve full/full ordered types/Date/values on owned copies', async () => {
  const reference = require('./helpers/projection-current-normalizer').loadReference(), source = fullRows(), before = JSON.stringify(source);
  const controlA = clone(source), controlB = clone(source); reference.normalize(controlA); reference.normalize(controlB);
  assert.deepEqual(fingerprint(controlA), fingerprint(controlB)); // full/full first, no omission premise
  const gate = deferred(), started = deferred(); let normalizations = 0, downstreamFinished = false;
  const { session } = harness({ fetchDetails: async request => response(request, source), prepareFull: async rows => {
    reference.normalize(rows); normalizations++; started.resolve(); await gate.promise; downstreamFinished = true;
  } });
  const pending = session.requireFull([0, 1]); await started.promise;
  assert.equal(session.completeness(0).state, 'view'); assert.equal(session.completeness(1).state, 'view'); gate.resolve();
  const result = await pending; assert.equal(normalizations, 1); assert.equal(downstreamFinished, true);
  assert.deepEqual(fingerprint(result.rows), fingerprint(controlA)); assert.equal(JSON.stringify(source), before);
  assert.equal(result.rows[0].OPD instanceof Date, true); assert.deepEqual(Object.keys(result.rows[0]), Object.keys(controlA[0]));
  assert.equal(Object.hasOwn(result.rows[0], '__proto__'), true); assert.equal(Object.hasOwn(session.viewRows[0], 'OPD'), false);
  await session.requireFull([0, 1]); assert.equal(normalizations, 1);
});

// Preserve all seven behavioral follow-up assertions in the standard regression.
require('./helpers/projection-shadow-admission-cases.cjs');
require('./helpers/projection-shadow-view-cases.cjs');
require('./helpers/projection-shadow-identity-cases.cjs');
