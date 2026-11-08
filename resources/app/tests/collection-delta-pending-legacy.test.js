'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture } = require('./fixtures/collection-delta-pending/harness.cjs');

for (const schemaVersion of [1, 2]) test('schema ' + schemaVersion + ' archives and exports exact raw data; remains on explicit legacy route', () => {
  const f = fixture({ bind: false });
  const pending = { schemaVersion, ownerId: f.live.ownerId, rows: [{ id: 1, quantity: null, unknown: false }], baseRevision: 2, expectedExistingIds: ['1'], expectedNewIds: [], extra: { retain: true }, ...(schemaVersion === 2 ? { baseRows: [{ id: 1, quantity: false }], baseStructure: '{"order":["1"]}' } : {}) };
  const raw = JSON.stringify(pending, null, 2); f.storage.setItem('legacy.pending.owner', raw);
  assert.throws(() => f.adapter.bindAccepted(f.spec), /LEGACY_PENDING_REQUIRES_IMPORT/);
  const result = f.adapter.archiveLegacy(raw, { archiveId: 'legacy-1' });
  assert.equal(result.route, 'legacy-only'); assert.equal(result.capture.baseRevision, 2);
  assert.equal(Object.hasOwn(result.capture.rows[0], '_rev'), false);
  assert.equal(f.adapter.exportArchivedLegacy('legacy-1'), raw);
  assert.equal(f.storage.getItem('legacy.pending.owner'), raw);
  assert.throws(() => f.adapter.getState(), /NOT_OPEN/);
});

test('unknown new schema, corrupt legacy, owner mismatch never downgrade or overwrite old pending', () => {
  const f = fixture({ bind: false });
  for (const raw of ['{', JSON.stringify({ schemaVersion: 3, ownerId: f.live.ownerId, rows: [] }), JSON.stringify({ schemaVersion: 2, ownerId: 'other', rows: [] })]) {
    f.storage.setItem('legacy.pending.owner', raw); const saved = [...f.storage.map];
    assert.throws(() => f.adapter.archiveLegacy(raw, { archiveId: 'bad' }));
    assert.deepEqual([...f.storage.map], saved);
  }
});

test('an unknown embedded candidate version cannot be routed to legacy; archival slot cannot grow without bound', () => {
  const f = fixture({ bind: false });
  const pending = { schemaVersion: 2, ownerId: f.live.ownerId, rows: [], candidateJournal: { format: 'collection-pending-journal-candidate', version: 99 } };
  assert.throws(() => f.adapter.archiveLegacy(JSON.stringify(pending), { archiveId: 'unknown' }), /UNSUPPORTED_JOURNAL_VERSION/);
  delete pending.candidateJournal;
  f.adapter.archiveLegacy(JSON.stringify(pending), { archiveId: 'first' });
  assert.throws(() => f.adapter.archiveLegacy(JSON.stringify(pending), { archiveId: 'second' }), /ARCHIVE_EXISTS/);
});

test('native schema1/2 export carries operation/request/inverse evidence without activating legacy storage', () => {
  const { edit, receipt } = require('./fixtures/collection-delta-pending/harness.cjs');
  const f = fixture(); f.adapter.record(edit(f)); const delivery = f.adapter.prepareRequest(['edit'], { requestId: 'req' });
  f.adapter.acknowledgePrimary(delivery, receipt(delivery));
  f.adapter.record(f.api.prepareUndo(f.adapter.getState(), 'undo'));
  for (const schemaVersion of [1, 2]) {
    const exported = f.adapter.exportLegacy({ schemaVersion });
    assert.equal(exported.schemaVersion, schemaVersion);
    assert.equal(exported.candidateJournal.operations[1][1].command.inverseOf, 'edit');
    assert.equal(exported.candidateJournal.requests[0].request.requestId, 'req');
    assert.equal(exported.baseRevision, 4); assert.equal(exported.baseStructure, f.spec.baseStructure);
    assert.equal(f.storage.getItem('legacy.pending.owner'), null);
  }
});
