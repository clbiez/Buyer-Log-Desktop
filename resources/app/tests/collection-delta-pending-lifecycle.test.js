'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, edit, receipt } = require('./fixtures/collection-delta-pending/harness.cjs');

test('lost ACK, reopen, retry use identical operation/request identity and original payload', () => {
  const f = fixture(); f.adapter.record(edit(f)); const sent = f.adapter.prepareRequest(['edit'], { requestId: 'req' });
  const restored = f.reopen(), retry = restored.retry('req');
  assert.deepEqual(retry.request, sent.request); assert.deepEqual(restored.getState().history.undo, []);
  restored.noteReplication(retry, { ok: true }); assert.deepEqual(restored.getState().history.undo, []);
  restored.acknowledgePrimary(retry, receipt(retry));
  assert.deepEqual(restored.getState().history.undo, ['edit']);
  assert.deepEqual(f.reopen().getState().history.undo, ['edit']);
});

test('primary ACK storage failure does not advance state/history; same receipt can be recorded after reopen', () => {
  const f = fixture(); f.adapter.record(edit(f)); const sent = f.adapter.prepareRequest(['edit'], { requestId: 'req' });
  f.storage.fail = key => key.endsWith('/head');
  assert.throws(() => f.adapter.acknowledgePrimary(sent, receipt(sent)), error => error.primaryAcknowledged === true && error.localRecorded === false);
  assert.deepEqual(f.adapter.getState().history.undo, []);
  const restored = f.reopen(), retry = restored.retry('req');
  assert.deepEqual(restored.getState().history.undo, []);
  f.storage.fail = null; restored.acknowledgePrimary(retry, receipt(sent));
  assert.deepEqual(restored.getState().history.undo, ['edit']);
});

test('source change immediately after committed ACK reports local record accurately and suppresses current-view success', () => {
  const f = fixture(); f.adapter.record(edit(f)); const sent = f.adapter.prepareRequest(['edit'], { requestId: 'req' });
  const original = f.storage.setItem.bind(f.storage);
  f.storage.setItem = (key, value) => { original(key, value); if (key.endsWith('/head')) f.live.clientGeneration = 8; };
  assert.throws(() => f.adapter.acknowledgePrimary(sent, receipt(sent)), error => error.code === 'CURRENT_BINDING_CHANGED' && error.primaryAcknowledged === true && error.localRecorded === true);
  f.storage.setItem = original;
  assert.deepEqual(f.reopen().getState().history.undo, ['edit']);
});

test('same operation in overlapping requests rejects a different receipt instead of double history', () => {
  const f = fixture(); f.adapter.record(edit(f));
  const first = f.adapter.prepareRequest(['edit'], { requestId: 'first' }), second = f.adapter.prepareRequest(['edit'], { requestId: 'second' });
  f.adapter.acknowledgePrimary(second, receipt(second));
  assert.throws(() => f.adapter.acknowledgePrimary(first, receipt(first)), /RECEIPT_MISMATCH/);
  assert.deepEqual(f.reopen().getState().history.undo, ['edit']);
});

test('duplicate/reordered ACK and replication status keep intent history order', () => {
  const f = fixture(); f.adapter.record(edit(f, 'first')); f.adapter.record(edit(f, 'second', 2));
  const first = f.adapter.prepareRequest(['first'], { requestId: 'r1' }), second = f.adapter.prepareRequest(['second'], { requestId: 'r2' });
  f.adapter.acknowledgePrimary(second, { ...receipt(second), replication: { ok: false } });
  assert.deepEqual(f.adapter.getState().history.undo, ['second']);
  f.adapter.acknowledgePrimary(first, receipt(first));
  assert.deepEqual(f.adapter.getState().history.undo, ['first','second']);
  const count = f.storage.writes.length; f.adapter.acknowledgePrimary(first, receipt(first));
  assert.equal(f.storage.writes.length, count);
  assert.deepEqual(f.reopen().getState().history.undo, ['first','second']);
});

test('old owner/generation/source delivery and prior runtime delivery are rejected', () => {
  for (const [key, value] of [['ownerId','other'],['clientGeneration',8],['sourceId','new']]) {
    const f = fixture(); f.adapter.record(edit(f)); const sent = f.adapter.prepareRequest(['edit'], { requestId: 'req' });
    f.live[key] = value;
    assert.throws(() => f.adapter.acknowledgePrimary(sent, receipt(sent)), /CURRENT_BINDING_CHANGED/);
  }
  const f = fixture(); f.adapter.record(edit(f)); const sent = f.adapter.prepareRequest(['edit'], { requestId: 'req' });
  assert.throws(() => f.reopen().acknowledgePrimary(sent, receipt(sent)), /DELIVERY_CAPTURE_REQUIRED/);
});

test('partial primary ACK advances only accepted independent operations; older base remains for later edits', () => {
  const f = fixture(); f.adapter.record(edit(f, 'one')); f.adapter.record(edit(f, 'two', 2));
  const request = f.adapter.prepareRequest(['one','two'], { requestId: 'partial' });
  f.adapter.acknowledgePrimary(request, { ...receipt(request), applied: receipt(request).applied.slice(0, 1), conflicts: [{ id: '2', reason: 'row-revision' }] });
  assert.deepEqual(f.reopen().getState().history.undo, ['one']);
  assert.equal(f.reopen().getState().operations.get('two').status, 'pending');
  const g = fixture(); g.adapter.record(edit(g, 'early')); const early = g.adapter.prepareRequest(['early'], { requestId: 'early-r' });
  g.adapter.record(edit(g, 'late', 1, '30')); g.adapter.acknowledgePrimary(early, receipt(early));
  const reopened = g.reopen();
  assert.equal(reopened.getState().operations.get('late').command.baseRowRevision, 4);
  assert.throws(() => reopened.prepareRequest(['late'], { requestId: 'late-r' }), /ROW_BASE_CHANGED/);
  const exported = reopened.exportLegacy();
  assert.equal(exported.rows[0]._rev, 4); assert.equal(exported.baseRows[0]._rev, 4);
});

test('atomic group ACK closure, checkpoint and inverse survive reopening', () => {
  const f = fixture({ group: true });
  const command = f.api.prepareGroupUnit(f.adapter.getState(), { kind: 'collection.group-field-semantic-unit', operationId: 'group', action: 'shared-value', rowId: 1, key: 'cx_text', value: 'new' });
  f.adapter.record(command);
  assert.throws(() => f.adapter.prepareRequest(['group'], { requestId: 'bad', atomic: false }), /ATOMIC_GROUP_REQUIRED/);
  const sent = f.adapter.prepareRequest(['group'], { requestId: 'group-r', atomic: true });
  assert.throws(() => f.adapter.acknowledgePrimary(sent, { ...receipt(sent), applied: receipt(sent).applied.slice(0, 1) }), /INVALID_ATOMIC_ACK/);
  f.adapter.acknowledgePrimary(sent, receipt(sent)); f.adapter.compact();
  const restored = f.reopen(), undo = f.api.prepareUndo(restored.getState(), 'undo');
  assert.equal(undo.inverseOf, 'group'); restored.record(undo);
  const undoSent = restored.prepareRequest(['undo'], { requestId: 'undo-r', atomic: true });
  restored.acknowledgePrimary(undoSent, receipt(undoSent));
  assert.deepEqual(f.reopen().getState().history.redo, ['undo']);
  assert.equal(f.reopen().getState().rows[0].cx_text, 'old');
  assert.deepEqual(f.reopen().getState().rows[2].variantOverrides, { cx_text: false });
});
