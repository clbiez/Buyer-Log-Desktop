'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const { fixture, edit } = require('./fixtures/collection-delta-pending/harness.cjs');
const source = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');
const comparison = require('../../../docs/performance-program/contrib-phase6c-client-pending-20261108/source-comparison.json');
function fn(name) {
  const start = source.indexOf('function ' + name + '(');
  const multiline = name !== 'kolReadPendingWorkspace';
  return source.slice(start, multiline ? source.indexOf('\n}', start) + 2 : source.indexOf('\n', start));
}
test('actual pending function bodies match reviewed fixed-base source, without modifying inherited pins', () => {
  for (const pin of comparison.pendingFunctions) assert.equal(crypto.createHash('sha256').update(fn(pin.name)).digest('hex'), pin.sha256);
  assert.equal(comparison.actualEditorFunctions.every(item => item.unchanged), true);
});

test('actual pending writer returns false after quota; actual saveKolRows ignores that false (root adapter demand)', () => {
  const feedback = [], ctx = vm.createContext({ kolWorkspaceCanEdit: true, kolWorkspaceOwnerId: 'owner', kolWorkspaceRevision: 4,
    kolBaseline: { ownerId: 'owner', rows: new Map() }, kolRows: [], kolManufacturers: [], kolCustomCols: [], kolLflCountryExclusions: [], kolNextId: 1,
    kolWorkspacePendingKey: () => 'old-pending', kolPersistableRow: row => row, kolStatusEntries: () => [], kolSetSaveFeedback: status => feedback.push(status),
    showToast() {}, appLang: 'en', localStorage: { setItem() { throw new Error('quota'); } } });
  vm.runInContext(fn('kolPersistPendingWorkspace'), ctx);
  assert.equal(ctx.kolPersistPendingWorkspace(), false); assert.deepEqual(feedback, ['failed']);
  Object.assign(ctx, { kolBulkPreparing: false, kolNormalizeModelGroups: rows => rows, BLStorage: { setItem() {} }, KOL_STORAGE_KEY: 'rows', kolWorkspaceLocalKey: () => 'local',
    kolManufacturersForPersistence: () => [], kolWorkspaceSaving: false, kolQueueWorkspaceSave() {}, scheduleOverviewCollectionSummaryRender() {} });
  vm.runInContext(fn('saveKolRows'), ctx);
  assert.equal(ctx.saveKolRows(), true);
});

test('schema2 export preserves old CAS when real legacy merger sees a newer remote; schema1 remains conservative', () => {
  const f = fixture(); f.adapter.record(edit(f));
  for (const schemaVersion of [1, 2]) {
    const pending = f.adapter.exportLegacy({ schemaVersion });
    const freshRows = pending.rows.map(row => ({ ...row, _rev: 90, quantity: 'remote', remoteOnly: true }));
    const ctx = vm.createContext({ kolBaseline: { ownerId: f.live.ownerId, rows: new Map(freshRows.map(row => [String(row.id), row])), structure: f.spec.baseStructure },
      kolRowKey: row => String(row.id), migrateKolRow: row => ({ ...row }), kolNormalizeModelGroups: rows => rows,
      kolNormalizeCustomCols: value => value, kolNormalizeStatusCatalog: value => value, kolNormalizeLflCountryExclusions: value => value,
      kolRows: [], kolManufacturers: [], kolCustomCols: [], kolStatusCatalog: [], kolLflCountryExclusions: [] });
    for (const name of ['kolValueEqual','kolRowChangedFromBase','kolCloneConflictValue','kolMergeLocalRowDelta','kolMergePendingWorkspace']) vm.runInContext(fn(name), ctx);
    ctx.kolMergePendingWorkspace(pending);
    assert.equal(ctx.kolRows[0].quantity, '20');
    if (schemaVersion === 2) {
      assert.equal(ctx.kolBaseline.rows.get('1')._rev, 4);
      assert.equal(ctx.kolBaseline.rows.get('1').quantity, '10');
      assert.equal(ctx.kolRows[0].remoteOnly, true);
    } else {
      assert.equal(ctx.kolBaseline.rows.has('1'), false);
      assert.equal(ctx.kolBaseline.expectedExistingIds.has('1'), true);
      assert.equal(ctx.kolRows[0]._rev, 4);
    }
  }
});
