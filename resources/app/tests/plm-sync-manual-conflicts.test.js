'use strict';

/* PLM SYNC, kullanıcının elle değiştirdiği alanı onaysız ezmez.
   _plmValues: satırın her PLM alanı için SON GÖRÜLEN PLM değeri.
   - mevcut boş                      → PLM değeri yazılır
   - mevcut = son PLM (PLM'e ait)     → sessizce güncellenir
   - manuel, PLM değişmedi            → sessizce korunur (her sync'te sorulmaz)
   - manuel ve PLM değişti / izsiz    → kullanıcıya sorulur */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Groups = require('../public/collection-model-groups.js');
const { mergeCollectionWorkspaces } = require('../server/lib/collection-replication');

const norm = value => String(value == null ? '' : value).trim();
const turknorm = value => norm(value).toLocaleUpperCase('tr-TR');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

function plan(rows, parsed, touched = ['fabric', 'season']) {
  return Groups.kolBuildPlmImportPlan(rows, parsed, {
    norm, turknorm,
    kolImportMatchKey: (plmId, modelKod) => `${norm(plmId)}|${turknorm(modelKod)}`,
    kolPlmNormalizeId: norm,
    kolPlmImportColourKey: row => turknorm(row && row.colourCode),
    kolImportReadField: (row, key) => Groups.kolImportReadField(row, key, { norm, turknorm }),
    kolImportFieldLabel: key => key,
    knownByKey: {},
    touched,
  });
}
const keys = list => list.map(change => change.key).sort();

test('plan records every PLM-supplied value; apply stores it as the last seen PLM value', () => {
  const rows = [{ id: 1, plmId: 'P1', modelKod: 'M', fabric: 'Old', season: 'W7' }];
  const item = plan(rows, [{ plmId: 'P1', modelKod: 'M', fabric: 'New', season: 'W7' }]).existing[0];
  assert.deepEqual({ ...item.plmValues }, { fabric: 'New', season: 'W7' });
  Groups.kolApplyApprovedPlmUpdate(item, (row, key, value) => { row[key] = value; });
  assert.deepEqual({ ...rows[0]._plmValues }, { fabric: 'New', season: 'W7' });
});

test('classification: empty and PLM-owned values update, unchanged PLM keeps manual, changed PLM asks', () => {
  const rows = [
    { id: 1, plmId: 'P1', modelKod: 'M', fabric: '', season: 'W6', _plmValues: { season: 'W6' } },          // boş + PLM'e ait
    { id: 2, plmId: 'P2', modelKod: 'M', fabric: 'Manual F', season: 'W7', _plmValues: { fabric: 'PLM F', season: 'W7' } }, // manuel, PLM aynı
    { id: 3, plmId: 'P3', modelKod: 'M', fabric: 'Manual F', season: 'W7', _plmValues: { fabric: 'PLM F' } },  // manuel, PLM değişti
    { id: 4, plmId: 'P4', modelKod: 'M', fabric: 'Typed F', season: 'W7' },                                   // izsiz eski satır
  ];
  const parsed = [
    { plmId: 'P1', modelKod: 'M', fabric: 'PLM F', season: 'W7' },
    { plmId: 'P2', modelKod: 'M', fabric: 'PLM F', season: 'W7' },
    { plmId: 'P3', modelKod: 'M', fabric: 'PLM F2', season: 'W7' },
    { plmId: 'P4', modelKod: 'M', fabric: 'PLM F', season: 'W7' },
  ];
  const result = plan(rows, parsed).existing.map(item => Groups.kolPlmClassifyChanges(item));
  assert.deepEqual(result.map(r => [keys(r.apply), keys(r.keep), keys(r.conflicts)]), [
    [['fabric', 'season'], [], []],
    [[], ['fabric'], []],
    [[], [], ['fabric']],
    [[], [], ['fabric']],
  ]);
});

test('kept manual value is not asked again until PLM changes once more', () => {
  const rows = [{ id: 1, plmId: 'P1', modelKod: 'M', fabric: 'Manual F', _plmValues: { fabric: 'PLM F' } }];
  const first = plan(rows, [{ plmId: 'P1', modelKod: 'M', fabric: 'PLM F2' }], ['fabric']).existing[0];
  assert.equal(Groups.kolPlmClassifyChanges(first).conflicts.length, 1);
  // Kullanıcı "manueli koru" dedi: değişiklik yazılmaz, son PLM değeri kaydedilir.
  first.changes = [];
  Groups.kolApplyApprovedPlmUpdate(first, (row, key, value) => { row[key] = value; });
  assert.equal(rows[0].fabric, 'Manual F');
  assert.equal(rows[0]._plmValues.fabric, 'PLM F2');
  const again = plan(rows, [{ plmId: 'P1', modelKod: 'M', fabric: 'PLM F2' }], ['fabric']).existing[0];
  const second = Groups.kolPlmClassifyChanges(again);
  assert.deepEqual([second.conflicts.length, second.keep.length], [0, 1]);
  const changed = plan(rows, [{ plmId: 'P1', modelKod: 'M', fabric: 'PLM F3' }], ['fabric']).existing[0];
  assert.equal(Groups.kolPlmClassifyChanges(changed).conflicts.length, 1);
});

test('_plmValues merges per field between users (keyed row map)', () => {
  const ws = (revision, rows) => ({ schemaVersion: 1, ownerId: 'o', initialized: true, _revision: revision, rows, manufacturers: [], customColumns: [], statusCatalog: [], nextId: 10 });
  const base = ws(1, [{ id: 1, _rev: 1, _plmValues: { fabric: 'A', season: 'W7' } }]);
  const local = ws(1, [{ id: 1, _rev: 2, _plmValues: { fabric: 'B', season: 'W7' } }]);
  const remote = ws(2, [{ id: 1, _rev: 2, _plmValues: { fabric: 'A', season: 'W8' } }]);
  const { workspace, conflicts } = mergeCollectionWorkspaces(base, local, remote);
  assert.deepEqual({ ...workspace.rows[0]._plmValues }, { fabric: 'B', season: 'W8' });
  assert.deepEqual(conflicts, []);
});

test('both PLM import paths ask about manual conflicts before writing and record new-row PLM values', () => {
  const calls = APP.match(/const manual=await kolResolvePlmManualConflicts\(decisions\.approved\);\s*if\(manual\.cancelled\)return/g) || [];
  assert.equal(calls.length, 3, 'selected import, PLM ID list and Excel importer');
  assert.match(APP, /const manual=await kolResolvePlmManualConflicts\(summary\.changed\);/, 'direct PLM refresh');
  const created = APP.match(/row\._plmValues=kolPlmValuesOf\(row\);/g) || [];
  assert.equal(created.length, 4, 'rows created from PLM (3 importers + new colours) start tracked');
  const resolver = APP.slice(APP.indexOf('async function kolResolvePlmManualConflicts('), APP.indexOf('async function kolResolvePlmManualConflicts(') + 1600);
  assert.match(resolver, /kolPlmClassifyChanges\(item\)/);
  assert.match(resolver, /kolAskManualConflicts\(/);
});

test('conflict dialog: one at a time, keep / take PLM, apply to remaining, TR/EN', () => {
  const dialog = APP.slice(APP.indexOf('function kolAskManualConflicts('), APP.indexOf('async function kolResolvePlmManualConflicts('));
  assert.match(dialog, /'Keep manual':'Manueli koru'/);
  assert.match(dialog, /'Use PLM value':'PLM değerini al'/);
  assert.match(dialog, /data-conflict-all/);
  assert.match(dialog, /BLLayerSystem\?\.openDialog/);
  assert.match(dialog, /BLMotionPlus\?\.play\?\.\('overlay'/);
});
