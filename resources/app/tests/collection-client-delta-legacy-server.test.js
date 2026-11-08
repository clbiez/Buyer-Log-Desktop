'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-client-delta-synthetic-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});
const store = require('../server/lib/collection-workspaces.js');
const delta = require('../public/collection-delta-commands.js');
const group = require('../public/collection-group-delta.js');
const groups = require('../public/collection-model-groups.js');
const api = group.createGroupCommandApi(groups);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const receipt = result => ({ ok: true, revision: result.saved._revision, conflicts: result.conflicts,
  applied: result.applied.map(item => ({ id: item.id, kind: item.kind, rev: item.row?._rev })) });
const state = rows => delta.createState({ ownerId: 'demo', clientGeneration: 1, rows });
const change = (before, id, rowId, value) => delta.prepareFieldCommand(before, { kind: delta.UNIT, operationId: id, rowId, writes: [{ key: 'quantity', after: { present: true, value } }] });
function workspace(rows) { return { ownerId: 'demo', _revision: 10, rows, nextId: 5, customColumns: [], manufacturers: [] }; }

test('actual legacy reducer: partial 200 maps only applied rows; lost ACK retry conflict keeps intent', () => {
  const rows = [{ id: 1, _rev: 4, quantity: '10' }, { id: 2, _rev: 3, quantity: '20' }];
  const before = state(rows), one = delta.applyFieldCommand(before, change(before, 'one', 1, '11'));
  const two = delta.applyFieldCommand(one, change(one, 'two', 2, '21'));
  const request = delta.materializeLegacyRequest(two, ['one', 'two'], { requestId: 'partial' });
  const current = workspace([rows[0], { ...rows[1], _rev: 4, quantity: 'peer' }]);
  const result = store.applyRowChanges(current, request.payload);
  assert.deepEqual(result.applied.map(item => item.id), ['1']);
  const accepted = delta.acknowledgeLegacyResponse(two, request, receipt(result));
  assert.equal(accepted.operations.get('one').status, 'acknowledged'); assert.equal(accepted.operations.get('two').status, 'pending');
  assert.deepEqual(accepted.history.undo, ['one']); assert.equal(accepted.rows[1].quantity, '21');
  // Simulate the original receipt being lost: the client still has two pending
  // commands and a replay of the captured payload now conflicts on both rows.
  const replay = store.applyRowChanges(result.saved, request.payload);
  assert.equal(replay.applied.length, 0);
  assert.strictEqual(delta.acknowledgeLegacyResponse(two, request, receipt(replay)), two);
  assert.deepEqual(two.history.undo, []);
});

test('actual legacy reducer: explicit existence blocks resurrection of old absent/zero _rev rows', () => {
  for (const rev of [{}, { _rev: 0 }]) {
    const before = state([{ id: 1, quantity: '10', ...rev }]);
    const applied = delta.applyFieldCommand(before, change(before, 'existing', 1, '11'));
    const request = delta.materializeLegacyRequest(applied, ['existing'], { requestId: 'zero' });
    const result = store.applyRowChanges(workspace([]), request.payload);
    assert.equal(result.applied.length, 0); assert.equal(result.conflicts[0].reason, 'row-missing');
    assert.equal(result.saved.rows.length, 0);
    assert.strictEqual(delta.acknowledgeLegacyResponse(applied, request, receipt(result)), applied);
  }
});

test('actual legacy reducer: typed group request is atomic and inverse preserves unrelated accepted data', () => {
  const rows = [1, 2, 3].map(id => ({ id, _rev: 4, modelGroupId: 'g', modelGroupRole: id === 1 ? 'parent' : 'variant',
    variantId: 'v' + id, modelSharedValues: id === 1 ? { cx_design: 'old' } : {}, variantOverrides: {}, cx_design: 'old', unknown: { keep: id } }));
  const before = api.createState({ ownerId: 'demo', clientGeneration: 1, rows, customColumns: [{ k: 'cx_design', custom: true }] });
  const unit = api.prepareGroupUnit(before, { kind: group.KIND, operationId: 'group', rowId: 1, key: 'cx_design', action: 'shared-value', value: 'new' });
  const applied = api.applyGroupUnit(before, unit), request = api.materializeLegacyRequest(applied, ['group'], { requestId: 'group', atomic: true });
  const conflictRows = rows.map(row => row.id === 2 ? { ...row, _rev: 5 } : row);
  assert.throws(() => store.applyRowChanges(workspace(conflictRows), request.payload), err => err.code === 'COLLECTION_ATOMIC_CONFLICT');
  assert.deepEqual(applied.history.undo, []); assert.equal(applied.operations.get('group').status, 'pending');
  const result = store.applyRowChanges(workspace(rows), request.payload);
  const accepted = api.acknowledgeLegacyResponse(applied, request, receipt(result));
  assert.deepEqual(accepted.history.undo, ['group']);
  const inverse = api.prepareUndo(accepted, 'undo'), undone = api.applyGroupUnit(accepted, inverse);
  const undoRequest = api.materializeLegacyRequest(undone, ['undo'], { requestId: 'undo', atomic: true });
  const undoResult = store.applyRowChanges(result.saved, undoRequest.payload);
  const undoAccepted = api.acknowledgeLegacyResponse(undone, undoRequest, receipt(undoResult));
  assert.deepEqual(undoAccepted.rows.map(row => row.cx_design), ['old', 'old', 'old']);
  assert.deepEqual(undoAccepted.history.undo, []); assert.deepEqual(undoAccepted.history.redo, ['undo']);
  assert.strictEqual(undoAccepted.rows[0].unknown, before.rows[0].unknown);
});
