'use strict';

// Native test taslağı; hazırlık aşamasında çalıştırılmadı.
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('./collection-field-command.cjs');
const present = value => ({ present: true, value });
const missing = () => ({ present: false });
const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const error = code => err => err.code === code;
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value); } return value; }
function fixture(overrides = {}) {
  return api.createState({
    ownerId: 'buyer-a', clientGeneration: 7, workspaceRevision: 10, nextId: 3,
    customColumns: [{ k: 'cx_value', label: 'Synthetic custom field', custom: true }],
    rows: [
      { id: 1, _rev: 4, quantity: '10', modelGroupId: 'mg_single_1', modelGroupRole: 'single', variantId: 'variant_1', variantOverrides: {}, modelSharedValues: {}, unknownPersisted: { nested: ['preserved'] } },
      { id: 2, _rev: 3, quantity: '40', unknownPersisted: { untouched: true } },
    ], ...overrides,
  });
}
function command(state, id, key = 'quantity', after = present('20'), rowId = 1) {
  return api.prepareFieldCommand(state, { kind: api.UNIT, operationId: id, rowId, writes: [{ key, after }] });
}
function request(state, ids, options = {}) { return api.materializeLegacyRequest(state, ids, { requestId: 'request-1', ...options }); }
function ack(state, sent, applied = [{ id: '1', kind: 'changed', rev: 5 }], conflicts = [], revision = 11) {
  return api.acknowledgeLegacyResponse(state, sent, { ok: true, revision, applied, conflicts });
}

test('own-property slots distinguish absence, explicit null, zero, false and blank', () => {
  assert.deepEqual(api.readSlot(Object.create({ cx_value: 'inherited' }), 'cx_value'), missing());
  for (const value of [null, 0, false, '']) {
    const before = fixture(), edit = command(before, 'slot-' + String(value), 'cx_value', present(value));
    assert.deepEqual(edit.slots[0].before, missing());
    const after = api.applyFieldCommand(before, edit);
    assert.equal(has(after.rows[0], 'cx_value'), true); assert.equal(after.rows[0].cx_value, value);
    assert.equal(has(before.rows[0], 'cx_value'), false);
    const accepted = ack(after, request(after, [edit.operationId]));
    const inverse = api.prepareInverseCommand(accepted, edit, 'undo-' + edit.operationId);
    const undone = api.applyFieldCommand(accepted, inverse);
    assert.equal(has(undone.rows[0], 'cx_value'), false);
  }
});

test('deleting an explicit null restores null presence on inverse, not inherited absence', () => {
  const rows = fixture().rows.map(row => row.id === 1 ? { ...row, cx_value: null } : row);
  const before = fixture({ rows }), edit = command(before, 'delete-null', 'cx_value', missing());
  const applied = api.applyFieldCommand(before, edit), accepted = ack(applied, request(applied, [edit.operationId]));
  assert.equal(has(applied.rows[0], 'cx_value'), false);
  const inverse = api.prepareInverseCommand(accepted, edit, 'restore-null');
  assert.deepEqual(inverse.slots[0].after, present(null));
  assert.equal(api.applyFieldCommand(accepted, inverse).rows[0].cx_value, null);
});

test('forward/inverse copy touched row only; untouched rows and nested fields retain identity', () => {
  const before = fixture(), edit = command(before, 'copy'); frozen(before.rows); frozen(before.customColumns);
  const after = api.applyFieldCommand(before, edit);
  assert.notStrictEqual(after.rows, before.rows); assert.notStrictEqual(after.rows[0], before.rows[0]);
  assert.strictEqual(after.rows[1], before.rows[1]);
  assert.strictEqual(after.rows[0].unknownPersisted, before.rows[0].unknownPersisted);
  assert.strictEqual(after.rows[0].variantOverrides, before.rows[0].variantOverrides);
  assert.equal(before.operations.size, 0); assert.equal(before.rows[0].quantity, '10');
  const accepted = ack(after, request(after, ['copy'])), inverse = api.prepareInverseCommand(accepted, edit, 'undo-copy');
  const undone = api.applyFieldCommand(accepted, inverse);
  assert.equal(undone.rows[0].quantity, '10'); assert.equal(undone.rows[0]._rev, 5);
  assert.notStrictEqual(undone.rows[0], accepted.rows[0]); assert.strictEqual(undone.rows[1], accepted.rows[1]);
  assert.strictEqual(undone.rows[0].unknownPersisted, accepted.rows[0].unknownPersisted);
});

test('changed mutable values are owned; command capture and applying do not alias caller values', () => {
  const state = fixture(), value = { list: [{ approved: false }] }, edit = command(state, 'owned', 'cx_value', present(value));
  value.list[0].approved = true;
  assert.equal(edit.slots[0].after.value.list[0].approved, false);
  assert.throws(() => { edit.slots[0].after.value.list.push(1); }, TypeError);
  const applied = api.applyFieldCommand(state, edit);
  assert.notStrictEqual(applied.rows[0].cx_value, edit.slots[0].after.value);
  applied.rows[0].cx_value.list[0].approved = true;
  assert.equal(edit.slots[0].after.value.list[0].approved, false);
  assert.equal(has(state.rows[0], 'cx_value'), false);
});

test('stale owner/generation, read-only and Multi-Buyer bindings reject before effects', () => {
  const state = fixture(), edit = command(state, 'binding');
  assert.throws(() => api.applyFieldCommand({ ...state, ownerId: 'buyer-b' }, edit), error('OWNER_CHANGED'));
  assert.throws(() => api.applyFieldCommand({ ...state, clientGeneration: 8 }, edit), error('GENERATION_CHANGED'));
  for (const patch of [{ view: 'multi' }, { canEdit: false }, { ownerId: '__multi__' }]) {
    assert.throws(() => api.applyFieldCommand({ ...state, ...patch }, edit), error('EDITABLE_SINGLE_OWNER_REQUIRED'));
  }
  assert.equal(state.operations.size, 0); assert.equal(state.rows[0].quantity, '10');
});

test('row CAS rejects unrelated remote row edits; workspace revision is not a row base', () => {
  const state = fixture(), edit = command(state, 'cas');
  const remote = { ...state.rows[0], _rev: 5, remoteField: 'unrelated' };
  const changed = { ...state, rows: [remote, state.rows[1]], baseline: new Map(state.baseline).set('1', remote) };
  assert.throws(() => api.applyFieldCommand(changed, edit), error('ROW_BASE_CHANGED'));
  const unrelatedWorkspaceRevision = api.applyFieldCommand({ ...state, workspaceRevision: 90 }, edit);
  assert.equal(unrelatedWorkspaceRevision.rows[0].quantity, '20');
  assert.equal(request(unrelatedWorkspaceRevision, ['cas']).payload.upserts[0]._rev, 4);
});

test('same-field local conflict and missing row do not overwrite or resurrect intent', () => {
  const state = fixture(), edit = command(state, 'conflict');
  assert.throws(() => api.applyFieldCommand({ ...state, rows: [{ ...state.rows[0], quantity: 'newer' }, state.rows[1]] }, edit), error('FIELD_CONFLICT'));
  assert.throws(() => api.applyFieldCommand({ ...state, rows: [state.rows[1]] }, edit), error('ROW_MISSING'));
  assert.throws(() => command(fixture({ baselineRows: [] }), 'create'), error('EXPECTED_EXISTING_ROW_REQUIRED'));
});

test('inverse checks current after-state and preserves unrelated accepted remote fields', () => {
  const before = fixture(), edit = command(before, 'undo-remote'), applied = api.applyFieldCommand(before, edit);
  assert.throws(() => api.prepareInverseCommand(applied, edit, 'too-early'), error('PRIMARY_ACK_REQUIRED'));
  const accepted = ack(applied, request(applied, ['undo-remote']));
  const remote = { ...accepted.rows[0], _rev: 6, externalBag: { remote: true } };
  const current = { ...accepted, rows: [remote, accepted.rows[1]], baseline: new Map(accepted.baseline).set('1', remote) };
  const inverse = api.prepareInverseCommand(current, edit, 'inverse'), undone = api.applyFieldCommand(current, inverse);
  assert.equal(inverse.baseRowRevision, 6); assert.equal(undone.rows[0]._rev, 6);
  assert.strictEqual(undone.rows[0].externalBag, remote.externalBag); assert.equal(undone.rows[0].quantity, '10');
  assert.throws(() => api.prepareInverseCommand({ ...current, rows: [{ ...remote, quantity: 'remote-same-field' }, current.rows[1]] }, edit, 'unsafe-undo'), error('FIELD_CONFLICT'));
});

test('coupled groups, semantic editors, server fields, unknown writes and structure fail closed', () => {
  const state = fixture();
  for (const key of ['not', 'notHtml', 'pricing', 'pricing:Maker', 'targetPrice', 'inStore', 'retail', 'modelSharedValues', 'variantOverrides', '_rev', 'id', '_sharedCollectionImageUrl', 'cx_unknown', '__proto__']) {
    assert.throws(() => command(state, 'forbidden-' + key, key, present('x')), error('FIELD_NOT_APPROVED'));
  }
  for (const kind of ['model-group-unit', 'row-create', 'row-delete', 'structure', 'rich-note-unit']) {
    assert.throws(() => api.prepareFieldCommand(state, { kind, operationId: kind, rowId: 1, writes: [] }), error('UNSUPPORTED_SEMANTIC_UNIT'));
  }
  const rows = state.rows.map((row, index) => ({ ...row, modelGroupId: 'mg_group', modelGroupRole: index ? 'variant' : 'parent' }));
  assert.throws(() => command(fixture({ rows }), 'group'), error('TYPED_GROUP_UNIT_REQUIRED'));
  assert.throws(() => command(fixture({ rows: [{ ...state.rows[0], variantOverrides: { quantity: null } }, state.rows[1]] }), 'override'), error('TYPED_GROUP_UNIT_REQUIRED'));
});

test('group membership/metadata and custom schema changes invalidate prepared commands', () => {
  const state = fixture(), edit = command(state, 'membership');
  const detached = { ...state.rows[0], modelGroupId: 'mg_detached' };
  assert.throws(() => api.applyFieldCommand({ ...state, rows: [detached, state.rows[1]] }, edit), error('GROUP_CHANGED'));
  const addedPeer = { ...state.rows[1], modelGroupId: state.rows[0].modelGroupId };
  assert.throws(() => api.applyFieldCommand({ ...state, rows: [state.rows[0], addedPeer] }, edit), error('TYPED_GROUP_UNIT_REQUIRED'));
  const customEdit = command(state, 'schema', 'cx_value', present(false));
  assert.throws(() => api.applyFieldCommand({ ...state, customColumns: [{ ...state.customColumns[0], label: 'Changed schema' }] }, customEdit), error('SCHEMA_CHANGED'));
  assert.throws(() => command({ ...state, customColumns: [{ ...state.customColumns[0], checklist: true }] }, 'checklist', 'cx_value', present(false)), error('FIELD_NOT_APPROVED'));
});

test('legacy adapter sends touched rows with explicit existence and legacy zero CAS, no structure fence', () => {
  for (const explicitZero of [false, true]) {
    const rows = [{ id: 1, quantity: '10', ...(explicitZero ? { _rev: 0 } : {}) }, { id: 2, _rev: 8, quantity: 'other' }];
    const state = fixture({ rows }), edit = command(state, 'legacy-' + explicitZero), applied = api.applyFieldCommand(state, edit);
    const payload = request(applied, [edit.operationId]).payload;
    assert.equal(payload.upserts.length, 1); assert.equal(payload.upserts[0].id, 1); assert.equal(payload.upserts[0]._rev, 0);
    assert.deepEqual(payload.expectedExistingIds, ['1']); assert.deepEqual(payload.expectedNewIds, []); assert.deepEqual(payload.deletes, []);
    assert.equal(has(payload, 'baseRevision'), false); assert.equal(has(payload, 'expectedRevision'), false); assert.equal(has(payload, 'structure'), false);
    assert.strictEqual(applied.rows[1], state.rows[1]);
  }
});

test('adapter preserves unknown persisted keys and strips both actual transient image projections', () => {
  const special = JSON.parse('{"__proto__":{"polluted":"data"},"constructor":"legacy-data"}');
  const rows = fixture().rows.map(row => row.id === 1 ? { ...row, ...special, _sharedCollectionImageUrl: '/shared', _serverPlmImageUrl: '/server' } : row);
  const state = fixture({ rows }), edit = command(state, 'unknown'), applied = api.applyFieldCommand(state, edit), sent = request(applied, ['unknown']);
  const row = sent.payload.upserts[0];
  assert.deepEqual(row.unknownPersisted, rows[0].unknownPersisted); assert.notStrictEqual(row.unknownPersisted, rows[0].unknownPersisted);
  assert.equal(has(row, '__proto__'), true); assert.equal(row.__proto__.polluted, 'data'); assert.equal(row.constructor, 'legacy-data');
  assert.equal({}.polluted, undefined); assert.equal(has(row, '_sharedCollectionImageUrl'), false); assert.equal(has(row, '_serverPlmImageUrl'), false);
  assert.equal(rows[0]._sharedCollectionImageUrl, '/shared'); assert.equal(rows[0]._serverPlmImageUrl, '/server');
});

test('one legacy row can compose ordered commands; omitted prerequisites reject', () => {
  const initial = fixture(), a = command(initial, 'first'), first = api.applyFieldCommand(initial, a);
  const b = command(first, 'second', 'quantity', present('30')), second = api.applyFieldCommand(first, b);
  assert.throws(() => request(second, ['second']), error('FIELD_CONFLICT'));
  const payload = request(second, ['first', 'second']).payload;
  assert.equal(payload.upserts.length, 1); assert.equal(payload.upserts[0].quantity, '30'); assert.equal(payload.upserts[0]._rev, 4);
  assert.throws(() => request(second, ['second', 'first']), error('FIELD_CONFLICT'));
});

test('operation replay is idempotent before/after ACK; ID collision and cross-owner replay reject', () => {
  const state = fixture(), edit = command(state, 'stable-id'), applied = api.applyFieldCommand(state, edit);
  assert.strictEqual(api.applyFieldCommand(applied, edit), applied);
  const different = command(state, 'stable-id', 'quantity', present('different'));
  assert.throws(() => api.applyFieldCommand(applied, different), error('OPERATION_ID_REUSED'));
  const sent = request(applied, ['stable-id']), accepted = ack(applied, sent);
  assert.strictEqual(ack(accepted, sent), accepted); assert.strictEqual(api.applyFieldCommand(accepted, edit), accepted);
  assert.throws(() => api.applyFieldCommand({ ...accepted, ownerId: 'buyer-b' }, edit), error('OWNER_CHANGED'));
  assert.throws(() => ack(accepted, sent, [{ id: '1', kind: 'changed', rev: 5 }], [], 12), error('RECEIPT_MISMATCH'));
});

test('captured old request/ACK does not send or clear newer local same-field intent', () => {
  const initial = fixture(), a = command(initial, 'old'), first = api.applyFieldCommand(initial, a), sent = request(first, ['old']);
  const b = command(first, 'new', 'quantity', present('30')), second = api.applyFieldCommand(first, b);
  const accepted = ack(second, sent);
  assert.equal(sent.payload.upserts[0].quantity, '20'); assert.equal(accepted.baseline.get('1').quantity, '20');
  assert.equal(accepted.rows[0].quantity, '30'); assert.equal(accepted.rows[0]._rev, 5);
  assert.equal(accepted.operations.get('old').status, 'acknowledged'); assert.equal(accepted.operations.get('new').status, 'pending');
  assert.equal(accepted.operations.get('new').command.baseRowRevision, 4);
  assert.throws(() => request(accepted, ['new']), error('ROW_BASE_CHANGED')); // no silent base adoption
  assert.strictEqual(ack(accepted, sent), accepted);
});

test('adapter excludes an unrelated unsubmitted local field even on the same touched row', () => {
  const initial = fixture(), a = command(initial, 'submitted'), first = api.applyFieldCommand(initial, a);
  const b = command(first, 'not-submitted', 'cx_value', present(false)), second = api.applyFieldCommand(first, b);
  const sent = request(second, ['submitted']);
  assert.equal(has(sent.payload.upserts[0], 'cx_value'), false); assert.equal(second.rows[0].cx_value, false);
  const accepted = ack(second, sent);
  assert.equal(accepted.rows[0].cx_value, false); assert.equal(accepted.operations.get('not-submitted').status, 'pending');
});

test('partial HTTP 200 acknowledges only applied row operations and leaves conflicts pending', () => {
  const initial = fixture(), a = command(initial, 'row-one'), first = api.applyFieldCommand(initial, a);
  const b = command(first, 'row-two', 'quantity', present('50'), 2), second = api.applyFieldCommand(first, b), sent = request(second, ['row-one', 'row-two']);
  const conflicts = [{ id: '2', reason: 'row-revision', currentRev: 4 }];
  const accepted = ack(second, sent, [{ id: '1', kind: 'changed', rev: 5 }], conflicts);
  assert.equal(accepted.operations.get('row-one').status, 'acknowledged'); assert.equal(accepted.operations.get('row-two').status, 'pending');
  assert.strictEqual(accepted.rows[1], second.rows[1]); assert.strictEqual(accepted.baseline.get('2'), initial.baseline.get('2'));
  assert.strictEqual(ack(accepted, sent, [{ id: '1', kind: 'changed', rev: 5 }], conflicts), accepted);
  const atomic = request(second, ['row-one', 'row-two'], { atomic: true });
  assert.equal(atomic.payload.atomic, true);
  assert.throws(() => ack(second, atomic, [{ id: '1', kind: 'changed', rev: 5 }], conflicts), error('INVALID_ATOMIC_ACK'));
  assert.equal(second.operations.get('row-one').status, 'pending');
});

test('late/invalid ACK and replication-only success cannot advance operation status or row bases', () => {
  const initial = fixture(), edit = command(initial, 'ack-guards'), applied = api.applyFieldCommand(initial, edit), sent = request(applied, ['ack-guards']);
  assert.throws(() => ack({ ...applied, ownerId: 'buyer-b' }, sent), error('OWNER_CHANGED'));
  assert.throws(() => ack({ ...applied, clientGeneration: 8 }, sent), error('GENERATION_CHANGED'));
  assert.throws(() => api.acknowledgeLegacyResponse(applied, sent, { ok: false }), error('PRIMARY_NOT_ACKNOWLEDGED'));
  assert.throws(() => ack(applied, sent, [{ id: '999', kind: 'changed', rev: 5 }]), error('ACK_UNKNOWN_ROW'));
  assert.throws(() => ack(applied, sent, [{ id: '1', kind: 'changed' }]), error('INVALID_RECEIPT'));
  const remote = { ...applied.rows[0], _rev: 8 };
  assert.throws(() => ack({ ...applied, rows: [remote, applied.rows[1]], baseline: new Map(applied.baseline).set('1', remote) }, sent), error('ACK_BASE_CHANGED'));
  assert.strictEqual(api.acknowledgeLegacyResponse(applied, sent, frozen({ ok: true, revision: 11, applied: [], conflicts: [], replication: { ok: true } })), applied);
  assert.equal(applied.operations.get('ack-guards').status, 'pending'); assert.equal(initial.rows[0]._rev, 4);
});

test('invalid/nonpersistable slots, duplicate row identity and no-op commands reject', () => {
  const state = fixture();
  for (const slot of [present(undefined), present(NaN), present(Infinity), present(() => {}), present(new Date()), { present: false, value: null }, { present: true }]) {
    assert.throws(() => command(state, 'invalid', 'cx_value', slot));
  }
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => command(state, 'cyclic', 'cx_value', present(cycle)), error('INVALID_JSON_VALUE'));
  const sparseWithExtraKey = []; sparseWithExtraKey.length = 1; sparseWithExtraKey.extra = 'not an element';
  assert.throws(() => command(state, 'sparse', 'cx_value', present(sparseWithExtraKey)), error('INVALID_JSON_VALUE'));
  assert.throws(() => command(state, 'noop', 'quantity', present('10')), error('NO_CHANGES'));
  assert.throws(() => fixture({ rows: [{ id: 1 }, { id: '1' }] }), error('INVALID_ROW_ID'));
});
