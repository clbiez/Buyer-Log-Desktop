'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const recovery = require('../server/lib/prewipe-master-recovery');

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
