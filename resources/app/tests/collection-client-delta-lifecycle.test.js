'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const delta = require('../public/collection-delta-commands.js');
const group = require('../public/collection-group-delta.js');
const groups = require('../public/collection-model-groups.js');
const groupApi = group.createGroupCommandApi(groups);
const has = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
const error = code => err => err.code === code;
const columns = [{ k: 'cx_design', custom: true, dataType: 'text' }];
function rows() {
  return [1, 2, 3, 4].map(id => ({ id, _rev: 4, quantity: '10', cx_design: 'old',
    modelGroupId: id < 4 ? 'group' : 'single', modelGroupRole: id === 1 ? 'parent' : id < 4 ? 'variant' : 'single',
    variantId: 'v' + id, modelSharedValues: id === 1 ? { cx_design: 'old' } : {},
    variantOverrides: id === 3 ? { cx_design: false } : {}, unknown: { keep: id } }));
}
function state(api = delta, extra = {}) {
  return api.createState({ ownerId: 'demo-owner', clientGeneration: 7, rows: api === delta ? [rows()[3]] : rows(), customColumns: columns, nextId: 5, ...extra });
}
function edit(api, before, id = 'edit', value = 'new') {
  return api === delta
    ? api.prepareFieldCommand(before, { kind: delta.UNIT, operationId: id, rowId: 4, writes: [{ key: 'quantity', after: { present: true, value } }] })
    : api.prepareGroupUnit(before, { kind: group.KIND, operationId: id, action: 'shared-value', rowId: 1, key: 'cx_design', value });
}
const apply = (api, before, command) => api === delta ? api.applyFieldCommand(before, command) : api.applyGroupUnit(before, command);
const send = (api, before, ids, options = {}) => api.materializeLegacyRequest(before, ids, { requestId: 'request', atomic: api !== delta, ...options });
const receipt = request => ({ ok: true, revision: 12, conflicts: [], applied: request.payload.upserts.map(row => ({ id: String(row.id), kind: 'changed', rev: row._rev + 1 })) });
const ack = (api, before, request, response = receipt(request)) => api.acknowledgeLegacyResponse(before, request, response);

for (const [name, api] of [['field', delta], ['group', groupApi]]) {
  test(name + ': history advances only after primary ACK, including undo and redo', () => {
    const before = state(api), command = edit(api, before), applied = apply(api, before, command);
    assert.deepEqual(applied.history.undo, []);
    assert.throws(() => api.prepareUndo(applied, 'too-early'), error('PRIMARY_ACK_REQUIRED'));
    const request = send(api, applied, ['edit']);
    assert.strictEqual(ack(api, applied, request, { ...receipt(request), applied: [], replication: { ok: true } }), applied);
    const accepted = ack(api, applied, request);
    assert.deepEqual(accepted.history.undo, ['edit']);
    const undo = api.prepareUndo(accepted, 'undo'), undone = apply(api, accepted, undo);
    assert.deepEqual(undone.history.undo, ['edit']); assert.deepEqual(undone.history.redo, []);
    const undoRequest = send(api, undone, ['undo'], { requestId: 'undo-request' });
    const undoAccepted = ack(api, undone, undoRequest);
    assert.deepEqual(undoAccepted.history.undo, []); assert.deepEqual(undoAccepted.history.redo, ['undo']);
    assert.strictEqual(ack(api, undoAccepted, undoRequest), undoAccepted);
    const redo = api.prepareRedo(undoAccepted, 'redo'), redone = apply(api, undoAccepted, redo);
    assert.deepEqual(redone.history.redo, ['undo']);
    const redoAccepted = ack(api, redone, send(api, redone, ['redo'], { requestId: 'redo-request' }));
    assert.deepEqual(redoAccepted.history.undo, ['redo']); assert.deepEqual(redoAccepted.history.redo, []);
    assert.equal(api === delta ? redoAccepted.rows[0].quantity : redoAccepted.rows[0].modelSharedValues.cx_design, 'new');
  });
  test(name + ': lost ACK retains intent; duplicate ACK and replay are idempotent', () => {
    const before = state(api), command = edit(api, before), applied = apply(api, before, command), request = send(api, applied, ['edit']);
    assert.equal(applied.operations.get('edit').status, 'pending');
    assert.strictEqual(apply(api, applied, command), applied);
    const conflict = { ok: true, revision: 12, applied: [], conflicts: [{ id: String(request.payload.upserts[0].id), reason: 'row-revision' }] };
    assert.strictEqual(ack(api, applied, request, conflict), applied);
    const accepted = ack(api, applied, request);
    assert.strictEqual(ack(api, accepted, request), accepted);
    assert.strictEqual(apply(api, accepted, command), accepted);
    assert.throws(() => apply(api, applied, edit(api, before, 'edit', 'different')), error('OPERATION_ID_REUSED'));
  });
  test(name + ': older ACK keeps newer intent and its original base; immutable transport excludes it', () => {
    const before = state(api), first = edit(api, before), one = apply(api, before, first), request = send(api, one, ['edit']);
    const second = edit(api, one, 'later', 'latest'), two = apply(api, one, second), accepted = ack(api, two, request);
    assert.equal(api === delta ? accepted.rows[0].quantity : accepted.rows[0].modelSharedValues.cx_design, 'latest');
    assert.equal(accepted.operations.get('later').status, 'pending');
    assert.equal(api === delta ? second.baseRowRevision : second.rowBases[0].revision, 4);
    assert.throws(() => send(api, accepted, ['later'], { requestId: 'later' }), error('ROW_BASE_CHANGED'));
    assert.equal(api === delta ? request.payload.upserts[0].quantity : request.payload.upserts[0].modelSharedValues.cx_design, 'new');
    assert.throws(() => api.prepareUndo(accepted, 'unsafe'), /CONFLICT/);
  });
  test(name + ': malformed atomic subset with omitted rows fails before any acknowledgement', () => {
    const before = state(api), command = edit(api, before), applied = apply(api, before, command);
    const request = send(api, applied, ['edit'], { atomic: true });
    const response = receipt(request);
    if (response.applied.length > 1) {
      response.applied.pop();
      assert.throws(() => ack(api, applied, request, response), error('INVALID_ATOMIC_ACK'));
    }
    assert.deepEqual(applied.history.undo, []);
  });
}

test('group: legacy transport requires atomic closure, excludes override peers and unrelated rows', () => {
  const before = state(groupApi), command = edit(groupApi, before), applied = apply(groupApi, before, command);
  assert.throws(() => send(groupApi, applied, ['edit'], { atomic: false }), error('ATOMIC_GROUP_REQUIRED'));
  const request = send(groupApi, applied, ['edit']);
  assert.deepEqual(request.payload.upserts.map(row => row.id), [1, 2]);
  assert.deepEqual(request.payload.expectedExistingIds, ['1', '2']);
  assert.equal(request.payload.atomic, true); assert.equal(has(request.payload, 'structure'), false);
  const accepted = ack(groupApi, applied, request);
  assert.strictEqual(accepted.rows[2], before.rows[2]); assert.strictEqual(accepted.rows[3], before.rows[3]);
  assert.equal(accepted.rows[0]._rev, 5); assert.equal(accepted.rows[1]._rev, 5);
});

test('pending schemas 1/2 are owned captures; old base/existence and absent revision survive fresh source', () => {
  for (const schemaVersion of [1, 2]) {
    const pending = { schemaVersion, ownerId: 'demo-owner', baseRevision: 2, rows: [{ id: 4, quantity: 'draft' }],
      expectedExistingIds: [], expectedNewIds: [], ...(schemaVersion === 2 ? { baseRows: [{ id: 4, quantity: 'original' }], baseStructure: '{"order":["4"]}' } : {}) };
    const captured = delta.capturePendingIntent(pending, { ownerId: 'demo-owner', clientGeneration: 7 });
    pending.rows[0].quantity = 'caller-mutated';
    const fresh = state(delta, { rows: [{ id: 4, _rev: 90, quantity: 'fresh' }] });
    assert.throws(() => delta.createState({ ...fresh, rows: fresh.rows, pendingIntent: captured }), error('LEGACY_PENDING_REQUIRES_ADAPTER'));
    assert.equal(captured.rows[0].quantity, 'draft'); assert.equal(captured.baseRevision, 2);
    assert.deepEqual(captured.expectedExistingIds, ['4']); assert.deepEqual(captured.expectedNewIds, []);
    assert.equal(has(captured.rows[0], '_rev'), false);
    if (schemaVersion === 2) { assert.equal(captured.baseRows[0].quantity, 'original'); assert.equal(captured.baseStructure, '{"order":["4"]}'); }
    else assert.equal(has(captured, 'baseRows'), false);
    assert.throws(() => delta.capturePendingIntent(pending, { ownerId: 'other', clientGeneration: 7 }), error('OWNER_CHANGED'));
  }
});

test('pending keeps proved new intent, deletion bases, structure, unknown fields and ambiguous legacy existence', () => {
  const pending = { schemaVersion: 2, ownerId: 'demo-owner', baseRevision: 3, baseRows: [{ id: 1, _rev: 2 }],
    rows: [{ id: 2, quantity: null }], expectedExistingIds: ['1'], expectedNewIds: ['2'], baseStructure: '{"order":["1"]}', extension: { keep: false } };
  const capture = delta.capturePendingIntent(pending, { ownerId: 'demo-owner', clientGeneration: 7 });
  assert.deepEqual(capture.baseRows, pending.baseRows); assert.deepEqual(capture.expectedNewIds, ['2']);
  assert.deepEqual(capture.extension, { keep: false }); assert.notStrictEqual(capture.extension, pending.extension);
  const legacy = delta.capturePendingIntent({ schemaVersion: 1, ownerId: 'demo-owner', rows: [{ id: 3 }] }, { ownerId: 'demo-owner', clientGeneration: 7 });
  assert.deepEqual(legacy.expectedExistingIds, ['3']); assert.deepEqual(legacy.expectedNewIds, []);
  assert.throws(() => delta.capturePendingIntent({ ...pending, expectedNewIds: ['1'] }, { ownerId: 'demo-owner', clientGeneration: 7 }), error('AMBIGUOUS_EXISTENCE_INTENT'));
});

test('independent scalar gate rejects special custom schema and JSON values changed by serialization', () => {
  for (const special of [{ checklist: true }, { dataType: 'money' }, { money: true }, { formulaReadonly: true }, { date: true }, { inStorePeriod: 'month' }]) {
    const before = state(delta, { customColumns: [{ ...columns[0], ...special }] });
    assert.throws(() => delta.prepareFieldCommand(before, { kind: delta.UNIT, operationId: 'special', rowId: 4, writes: [{ key: 'cx_design', after: { present: true, value: '1' } }] }), error('FIELD_NOT_APPROVED'));
  }
  const before = state(delta);
  for (const value of [-0, Object.defineProperty({}, 'hidden', { value: true })]) {
    assert.throws(() => delta.prepareFieldCommand(before, { kind: delta.UNIT, operationId: 'json', rowId: 4, writes: [{ key: 'cx_design', after: { present: true, value } }] }), error('INVALID_JSON_VALUE'));
  }
});

test('field: pending history cannot be jumped or forged; history caps account UTF-8 command bytes', () => {
  let current = state(delta, { historyLimits: { maxEntries: 1, maxBytes: 100000 } });
  for (let i = 0; i < 2; i++) {
    current = apply(delta, current, edit(delta, current, 'edit-' + i, 'value-' + i));
    current = ack(delta, current, send(delta, current, ['edit-' + i], { requestId: 'request-' + i }));
  }
  assert.deepEqual(current.history.undo, ['edit-1']);
  assert.equal(current.history.bytes, Buffer.byteLength(JSON.stringify(current.operations.get('edit-1').command)));
  const undo = delta.prepareUndo(current, 'undo');
  assert.throws(() => apply(delta, current, { ...undo, historyTarget: 'edit-0' }), error('INVALID_HISTORY_COMMAND'));
  const pending = apply(delta, current, undo);
  assert.throws(() => delta.prepareUndo(pending, 'second-undo'), error('HISTORY_IN_FLIGHT'));
  const tiny = state(delta, { historyLimits: { maxEntries: 50, maxBytes: 1 } });
  const changed = apply(delta, tiny, edit(delta, tiny));
  const accepted = ack(delta, changed, send(delta, changed, ['edit']));
  assert.deepEqual(accepted.history.undo, []); assert.equal(accepted.history.bytes, 0);
  assert.equal(accepted.operations.get('edit').status, 'acknowledged');
});

test('group: captured request rejects late owner/generation, unknown receipts and out-of-order prerequisites', () => {
  const before = state(groupApi), command = edit(groupApi, before), first = apply(groupApi, before, command), request = send(groupApi, first, ['edit']);
  const second = apply(groupApi, first, edit(groupApi, first, 'later', 'latest'));
  assert.throws(() => send(groupApi, second, ['later']), error('GROUP_FIELD_CONFLICT'));
  const combined = send(groupApi, second, ['edit', 'later']);
  assert.equal(combined.payload.upserts[0].cx_design, 'latest');
  assert.throws(() => send(groupApi, second, ['later', 'edit']), error('GROUP_FIELD_CONFLICT'));
  assert.throws(() => ack(groupApi, state(groupApi, { ownerId: 'other' }), request), error('OWNER_CHANGED'));
  assert.throws(() => ack(groupApi, state(groupApi, { clientGeneration: 8 }), request), error('GENERATION_CHANGED'));
  assert.throws(() => ack(groupApi, first, request, { ...receipt(request), applied: [{ id: '404', kind: 'changed', rev: 5 }] }), error('ACK_UNKNOWN_ROW'));
  assert.throws(() => ack(groupApi, first, request, { ok: false }), error('PRIMARY_NOT_ACKNOWLEDGED'));
  const accepted = ack(groupApi, second, combined);
  assert.deepEqual(accepted.history.undo, ['edit', 'later']);
  assert.equal(accepted.operations.get('later').status, 'acknowledged');
});

test('field: atomic omission across two independent rows cannot advance one row', () => {
  const before = state(delta, { rows: [{ id: 4, quantity: '10', _rev: 4 }, { id: 5, quantity: '10', _rev: 4 }] });
  const one = apply(delta, before, edit(delta, before));
  const other = delta.prepareFieldCommand(one, { kind: delta.UNIT, operationId: 'other', rowId: 5, writes: [{ key: 'quantity', after: { present: true, value: '20' } }] });
  const two = apply(delta, one, other), request = send(delta, two, ['edit', 'other'], { atomic: true });
  assert.throws(() => ack(delta, two, request, { ...receipt(request), applied: receipt(request).applied.slice(0, 1) }), error('INVALID_ATOMIC_ACK'));
  assert.equal(two.operations.get('edit').status, 'pending'); assert.deepEqual(two.history.undo, []);
});

test('field: out-of-order ACKs preserve local history order across independent rows', () => {
  const before = state(delta, { rows: [{ id: 4, quantity: '10', _rev: 4 }, { id: 5, quantity: '10', _rev: 4 }] });
  const first = apply(delta, before, edit(delta, before, 'first'));
  const secondCommand = delta.prepareFieldCommand(first, { kind: delta.UNIT, operationId: 'second', rowId: 5, writes: [{ key: 'quantity', after: { present: true, value: '20' } }] });
  const second = apply(delta, first, secondCommand);
  const oldRequest = send(delta, second, ['first'], { requestId: 'old' });
  const newRequest = send(delta, second, ['second'], { requestId: 'new' });
  const newAck = ack(delta, second, newRequest);
  assert.deepEqual(newAck.history.undo, ['second']);
  const oldAck = ack(delta, newAck, oldRequest);
  assert.deepEqual(oldAck.history.undo, ['first', 'second']);
  assert.equal(delta.prepareUndo(oldAck, 'undo-latest').inverseOf, 'second');
});

test('one certified Collection session composes independent and group intent with one ACK-gated history', () => {
  const before = state(groupApi), groupCommand = edit(groupApi, before);
  const one = groupApi.applyCommand(before, groupCommand);
  const fieldCommand = groupApi.prepareFieldCommand(one, { kind: delta.UNIT, operationId: 'field', rowId: 4, writes: [{ key: 'quantity', after: { present: true, value: '99' } }] });
  const two = groupApi.applyCommand(one, fieldCommand);
  assert.deepEqual(two.history.undo, []);
  const request = send(groupApi, two, ['edit', 'field']);
  assert.deepEqual(request.payload.upserts.map(row => row.id), [1, 2, 4]);
  const accepted = ack(groupApi, two, request);
  assert.deepEqual(accepted.history.undo, ['edit', 'field']);
  const inverse = groupApi.prepareUndo(accepted, 'undo-field');
  assert.equal(inverse.kind, delta.UNIT);
  const pending = groupApi.applyCommand(accepted, inverse);
  const pendingRequest = send(groupApi, pending, ['undo-field'], { requestId: 'undo-field', atomic: false });
  const undone = ack(groupApi, pending, pendingRequest);
  assert.deepEqual(undone.history.undo, ['edit']); assert.deepEqual(undone.history.redo, ['undo-field']);
  assert.equal(undone.rows[3].quantity, '10'); assert.equal(undone.rows[0].cx_design, 'new');
  assert.equal(groupApi.prepareUndo(undone, 'undo-group').kind, group.KIND);
});

test('independent source certification rejects lossy unknown JSON before command preparation without reading accessors', () => {
  let reads = 0;
  const accessor = Object.defineProperty({ id: 4, quantity: '10' }, 'unknown', { enumerable: true, get() { reads++; return 'lossy'; } });
  const hidden = Object.defineProperty({ id: 4, quantity: '10' }, 'unknown', { value: 'lossy' });
  for (const row of [accessor, hidden, { id: 4, quantity: '10', unknown: -0 }]) {
    assert.throws(() => state(delta, { rows: [row] }), error('INVALID_JSON_VALUE'));
  }
  assert.equal(reads, 0);
});

test('current and accepted baseline must agree on complete group membership before a typed edit', () => {
  const currentRows = rows(), baseRows = [...currentRows, { ...currentRows[1], id: 5, variantId: 'v5' }];
  const before = state(groupApi, { rows: currentRows, baselineRows: baseRows });
  const command = edit(groupApi, before);
  assert.throws(() => apply(groupApi, before, command), error('MEMBERSHIP_CHANGED'));
  assert.equal(before.operations.size, 0);
  const fieldRows = [{ id: 4, quantity: '10', modelGroupId: 'single', modelGroupRole: 'single' }];
  const fieldBase = [...fieldRows, { id: 5, quantity: '20', modelGroupId: 'single', modelGroupRole: 'single' }];
  const fieldState = state(delta, { rows: fieldRows, baselineRows: fieldBase });
  assert.throws(() => apply(delta, fieldState, edit(delta, fieldState)), error('TYPED_GROUP_UNIT_REQUIRED'));
  assert.equal(fieldState.operations.size, 0);
});
