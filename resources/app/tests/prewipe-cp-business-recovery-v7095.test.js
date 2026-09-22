'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const recovery = require('../server/lib/prewipe-master-recovery');
const cpSharedStore = require('../server/lib/cp-shared-store');

async function tempBackup(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-prewipe-cp-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const server = path.join(root, 'system', 'server-data');
  const localData = path.join(root, 'system', 'local-data');
  await fsp.mkdir(server, { recursive:true });
  await fsp.mkdir(path.join(localData, 'data'), { recursive:true });
  return { root, server, localData };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

test('verified backup recovery converts legacy CP override maps into Shared Business records', async t => {
  const box = await tempBackup(t);

  // Older generation contains a real note that a later old-version save replaced
  // with an empty placeholder. Recovery must retain the real user value.
  writeJson(path.join(box.localData, 'data', 'overrides.json'), {
    _revision:3300,
    _updatedAt:'2026-08-28T21:02:10.929Z',
    notesmap:{ '1001|MODEL A|BLK':{ Notes:'ESKI GERCEK NOT' } },
    submap:{ '1001|MODEL A|BLK':'ALT URETICI ESKI' },
    datemap:{ '1001|MODEL A|BLK':{ ex:'2026-09-01' } },
  });

  writeJson(path.join(box.server, 'overrides.json.bak'), {
    _revision:3356,
    _updatedAt:'2026-09-20T21:32:12.787Z',
    notesmap:{ '1001|MODEL A|BLK':{ Notes:'' }, '2002|MODEL B|RED':{ Notes:'YENI NOT' } },
    submap:{ '1001|MODEL A|BLK':'ALT URETICI YENI', '2002|MODEL B|RED':'FABRIKA B' },
    datemap:{ '1001|MODEL A|BLK':{ ex:'2026-09-15' }, '2002|MODEL B|RED':{ ex:'2026-10-02' } },
  });

  // Current legacy file is newer but emptied by migration/clean-install flow.
  writeJson(path.join(box.server, 'overrides.json'), {
    _revision:3357,
    _updatedAt:'2026-09-21T08:18:53.945Z',
    notesmap:{}, submap:{}, datemap:{},
  });

  const records = recovery.loadBusinessRecordsFromExtractedBackup(box.root, { records:{}, tombstones:{} });
  assert.equal(records['cp-order:1001|MODEL A|BLK'].notes.Notes, 'ESKI GERCEK NOT');
  assert.equal(records['cp-order:1001|MODEL A|BLK'].subManufacturer, 'ALT URETICI YENI');
  assert.deepEqual(records['cp-order:1001|MODEL A|BLK'].dates, { ex:'2026-09-15' });
  assert.equal(records['cp-order:2002|MODEL B|RED'].notes.Notes, 'YENI NOT');
  assert.equal(records['cp-order:2002|MODEL B|RED'].subManufacturer, 'FABRIKA B');
  assert.deepEqual(records['cp-order:2002|MODEL B|RED'].dates, { ex:'2026-10-02' });

  const coverage = recovery.businessCoverage(records);
  assert.equal(coverage.cpOrderRecords, 2);
  assert.equal(coverage.notes, 2);
  assert.equal(coverage.subManufacturers, 2);
  assert.equal(coverage.revisedDates, 2);
});

test('recovery fills missing CP fields without overwriting current Shared Hub values', () => {
  const current = {
    'cp-order:1001|MODEL A|BLK': {
      notes:{ Notes:'GUNCEL NOT' },
      subManufacturer:'',
    },
  };
  const old = {
    'cp-order:1001|MODEL A|BLK': {
      notes:{ Notes:'BACKUP NOT' },
      subManufacturer:'BACKUP ALT URETICI',
      dates:{ ex:'2026-09-15' },
    },
  };

  const result = recovery.mergeRecoveredBusinessRecords(current, old, {});
  assert.equal(result.changed['cp-order:1001|MODEL A|BLK'].notes.Notes, 'GUNCEL NOT');
  assert.equal(result.changed['cp-order:1001|MODEL A|BLK'].subManufacturer, 'BACKUP ALT URETICI');
  assert.deepEqual(result.changed['cp-order:1001|MODEL A|BLK'].dates, { ex:'2026-09-15' });
  assert.equal(result.fieldsAdded, 2);
});

test('explicit field and record tombstones are respected during recovery', () => {
  const current = {
    'cp-order:1001|MODEL A|BLK': { notes:null },
  };
  const recovered = {
    'cp-order:1001|MODEL A|BLK': { notes:{ Notes:'DIRILMEMELI' }, subManufacturer:'GERI GELSIN' },
    'cp-order:2002|MODEL B|RED': { notes:{ Notes:'KAYIT SILINMIS' } },
  };
  const tombstones = {
    'cp-order:2002|MODEL B|RED': { deletedAt:'2026-09-22T00:00:00.000Z' },
  };

  const result = recovery.mergeRecoveredBusinessRecords(current, recovered, tombstones);
  assert.equal(result.changed['cp-order:1001|MODEL A|BLK'].notes, null);
  assert.equal(result.changed['cp-order:1001|MODEL A|BLK'].subManufacturer, 'GERI GELSIN');
  assert.equal(result.changed['cp-order:2002|MODEL B|RED'], undefined);
});



test('clearing the last CP note produces an explicit shared tombstone', () => {
  const id = '1001|MODEL A|BLK';
  const cleared = {
    notesmap:{
      [id]:{ Notes:'', EkNot:'', NotesAt:'', EkNotAt:'' },
    },
  };
  const patch = cpSharedStore.patchFromOrderPatch(cleared, id, { notes:{ Notes:'', EkNot:'' } });
  assert.equal(patch.notes, null, 'blank note object must become an explicit tombstone');

  const stillHasAdditionalNote = {
    notesmap:{
      [id]:{ Notes:'', EkNot:'Takip devam ediyor', NotesAt:'', EkNotAt:'2026-09-22T10:00:00.000Z' },
    },
  };
  const partial = cpSharedStore.patchFromOrderPatch(stillHasAdditionalNote, id, { notes:{ Notes:'' } });
  assert.equal(partial.notes.EkNot, 'Takip devam ediyor', 'one remaining note must keep the shared note record alive');
});

test('shared note tombstone shadows the legacy order-code fallback in renderer projection', () => {
  const id = '1001|MODEL A|BLK';
  cpSharedStore.attachDeltaStore({
    isAuthoritative:true,
    readAllSync(collection) {
      assert.equal(collection, 'cp-order');
      return { [id]:{ notes:null } };
    },
  });
  try {
    const overrides = {
      notesmap:{ '1001':{ Notes:'ESKI SIPARIS BAZLI NOT' } },
      noteColumnValues:{}, submap:{}, licensormap:{}, suppfobmap:{}, suppfobmetamap:{}, delmap:{}, datemap:{},
    };
    const projected = cpSharedStore.overlay(overrides);
    assert.deepEqual(projected.notesmap[id], { Notes:'', EkNot:'', NotesAt:'', EkNotAt:'' });
    assert.equal(projected.notesmap['1001'].Notes, 'ESKI SIPARIS BAZLI NOT', 'legacy evidence stays intact but must be shadowed by the line tombstone');
  } finally {
    cpSharedStore.attachDeltaStore(null);
  }
});

test('pre-fix blank note objects are also treated as intentional deletion during recovery', () => {
  const id = 'cp-order:1001|MODEL A|BLK';
  const current = {
    [id]:{ notes:{ Notes:'', EkNot:'', NotesAt:'', EkNotAt:'' } },
  };
  const old = {
    [id]:{ notes:{ Notes:'BACKUPTAN DIRILMEMELI', NotesAt:'2026-09-01T00:00:00.000Z' } },
  };
  const result = recovery.mergeRecoveredBusinessRecords(current, old, {});
  assert.equal(result.changed[id], undefined, 'legacy blank-object deletion must beat a backup note');
  assert.equal(result.records[id].notes.Notes, '');
  assert.equal(recovery.explicitBlankNoteRecord(current[id].notes), true);
});

test('verified same-Hub recovery can pass the first-sync pending guard without discarding local changes', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const bootstrapStart = server.indexOf('async function bootstrapSharedHub');
  const bootstrapEnd = server.indexOf('// Local auth starts first.', bootstrapStart);
  const bootstrap = server.slice(bootstrapStart, bootstrapEnd);

  assert.match(bootstrap, /const pendingBeforeBootstrap = await localDb\.pendingCount\(\)/);
  assert.match(bootstrap, /const recoveryCandidate = await findVerifiedPrewipeRecovery\(checked\.root, checked\.manifest\)/);
  assert.match(bootstrap, /if \(!recoveryCandidate\)[\s\S]{0,300}SHARED_HUB_PENDING_CHANGES/);
  assert.match(bootstrap, /SHARED_HUB_PENDING_CHANGES_RECOVERY_CONTINUE/);
  assert.match(bootstrap, /pending:pendingBeforeBootstrap/);
  assert.doesNotMatch(bootstrap, /pendingBeforeBootstrap > 0\)[\s\S]{0,120}localDb\.(?:clear|reset|delete)/);
});

test('business checkpoint hydration never rolls newer local CP state back to an older snapshot', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const start = server.indexOf('async function hydrateBusinessCheckpointIfNeeded');
  const end = server.indexOf('async function applyMasterCheckpoint', start);
  const block = server.slice(start, end);

  assert.match(block, /applyMissingCheckpointRecords\('business'/,
    'checkpoint hydration must use the clock-aware recovery path');
  assert.doesNotMatch(block, /for\(const id of Object\.keys\(current\)\)delete next\.records\[id\]/,
    'a checkpoint must never wholesale-delete newer local business records');
  assert.doesNotMatch(block, /for\(const \[id,record\] of Object\.entries\(records\)\)next\.records\[id\]=/,
    'a checkpoint must not blindly replace every local business record');
  assert.match(block, /removed:0/,
    'checkpoint hydration should report no absence-based local record deletion');
});

test('server recovery wiring performs a business-aware v3 deep scan and republishes Shared Business', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');

  assert.match(server, /loadBusinessRecordsFromExtractedBackup\(tempRoot, recoveredState\)/);
  assert.match(server, /businessCoverage:prewipeMasterRecovery\.businessCoverage\(businessRecords\)/);
  assert.match(server, /Number\(recovery\.schemaVersion \|\| 0\) >= 3/);
  assert.match(server, /mergeRecoveredBusinessRecords\(/);
  assert.match(server, /businessRecovery\.changed\[id\]/);
  assert.match(server, /schemaVersion:3/);
  assert.match(server, /businessCoverage:finalBusinessCoverage/);
  assert.match(server, /sharedHub\.publishBusiness\(/);
});
