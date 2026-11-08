'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, edit, journal } = require('./fixtures/collection-delta-pending/harness.cjs');
const code = expected => error => error.code === expected;

test('edit is secured only after record AND manifest writes; failed write preserves prior state and retry ID', () => {
  const f = fixture(), command = edit(f);
  const before = f.adapter.getState();
  f.storage.fail = key => key.endsWith('/head');
  assert.throws(() => f.adapter.record(command), /quota/);
  assert.strictEqual(f.adapter.getState(), before);
  assert.equal(f.reopen().getState().operations.size, 0);
  f.storage.fail = null;
  const result = f.adapter.record(command);
  assert.equal(result.localRecorded, true);
  assert.equal(result.storageGuarantee, 'storage-api-success');
  assert.equal(f.reopen().getState().operations.get('edit').command.operationId, 'edit');
  assert.deepEqual(f.reopen().getState().history.undo, []);
});

test('current owner, generation, source, editability and single view are checked on every mutation', () => {
  for (const [key, value] of Object.entries({ ownerId: 'other', clientGeneration: 8, sourceId: 'remote-90', canEdit: false, view: 'multi' })) {
    const f = fixture(), command = edit(f), count = f.storage.writes.length;
    f.live[key] = value;
    assert.throws(() => f.adapter.record(command), code('CURRENT_BINDING_CHANGED'));
    assert.equal(f.storage.writes.length, count);
  }
});

test('reopen retains original source and CAS across live generation change; no fresh remote is adopted', () => {
  const f = fixture(); f.adapter.record(edit(f));
  f.live.clientGeneration = 8; f.live.sourceId = 'fresh-remote-90';
  const restored = f.reopen(), state = restored.getState();
  assert.equal(state.baseline.get('1')._rev, 4); assert.equal(state.baseline.get('1').quantity, '10');
  assert.equal(state.rows[0].quantity, '20'); assert.equal(state.operations.get('edit').command.clientGeneration, 7);
  assert.equal(restored.status().origin.sourceId, 'accepted-4');
  assert.equal(restored.status().current.sourceId, 'fresh-remote-90');
});

test('bounded checkpoint contains overlays and identities, never serializes full rows on edit/compaction', () => {
  const f = fixture({ limits: { checkpointEvery: 2 } });
  f.adapter.record(edit(f, 'one')); f.adapter.record(edit(f, 'two', 2)); f.adapter.record(edit(f, 'three', 3));
  const bound = f.storage.writes.findIndex(item => item.key.endsWith('/head'));
  const afterBinding = f.storage.writes.slice(bound + 1);
  assert.ok(afterBinding.every(item => !item.key.includes('/base/')));
  const checkpoint = [...f.storage.map].find(([key]) => key.includes('/checkpoint/'));
  assert.ok(checkpoint);
  const data = JSON.parse(checkpoint[1]).data;
  assert.equal(Object.hasOwn(data, 'rows'), false);
  assert.ok(data.rowOverlay.length <= 3);
  assert.deepEqual([...f.reopen().getState().operations.keys()], ['one','two','three']);
});

test('missing or corrupt committed records fail closed and preserve every existing key', () => {
  for (const mode of ['missing','json','checksum','version']) {
    const f = fixture(); f.adapter.record(edit(f));
    const key = [...f.storage.map.keys()].find(item => item.includes('/event/'));
    if (mode === 'missing') f.storage.map.delete(key);
    else if (mode === 'json') f.storage.map.set(key, '{');
    else { const value = JSON.parse(f.storage.map.get(key)); if (mode === 'version') value.version = 99; else value.data.type = 'corrupted'; f.storage.map.set(key, JSON.stringify(value)); }
    const saved = [...f.storage.map];
    assert.throws(() => f.reopen());
    assert.deepEqual([...f.storage.map], saved);
  }
});

test('half compaction and quota preserve old head, base and prior edit; successful checkpoint reopens', () => {
  const f = fixture(); f.adapter.record(edit(f)); const prior = [...f.storage.map];
  for (const stage of ['/checkpoint/', '/head']) {
    f.storage.fail = key => key.includes(stage);
    assert.throws(() => f.adapter.compact(), /quota/);
    assert.equal(f.reopen().getState().rows[0].quantity, '20');
    for (const [key, value] of prior) assert.equal(f.storage.map.get(key), value);
  }
  f.storage.fail = null; f.adapter.compact();
  assert.equal(f.reopen().getState().rows[0].quantity, '20');
});

test('admission bounds fail without discarding unacknowledged/inverse evidence', () => {
  const f = fixture({ limits: { maxOperations: 1 } }); f.adapter.record(edit(f));
  const saved = [...f.storage.map];
  assert.throws(() => f.adapter.record(edit(f, 'second', 2)), code('RETENTION_LIMIT'));
  assert.deepEqual([...f.storage.map], saved);
  assert.equal(f.reopen().getState().operations.size, 1);
});

test('stale writer cannot overwrite a newer committed head', () => {
  const f = fixture(), stale = f.reopen(); f.adapter.record(edit(f));
  assert.throws(() => stale.record(edit({ ...f, adapter: stale }, 'stale', 2)), code('WRITER_CHANGED'));
});

test('standalone browser UMD loads without storage access or production activation', () => {
  const vm = require('node:vm'), fs = require('node:fs');
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../public/collection-delta-pending-journal.js'), 'utf8'), context);
  assert.equal(typeof context.BLCollectionDeltaPendingJournal.createPendingJournal, 'function');
  assert.equal(journal().FORMAT_VERSION, 1);
});
