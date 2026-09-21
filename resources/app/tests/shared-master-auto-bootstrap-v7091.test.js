'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const recovery = require('../server/lib/prewipe-master-recovery');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

test('verified pre-wipe legacy server-data reconstructs every central Master category', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-master-recovery-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const serverData = path.join(root, 'system', 'server-data');
  await fsp.mkdir(serverData, { recursive:true });

  await fsp.writeFile(path.join(serverData, 'settings.json'), JSON.stringify({
    modelConnections:[{ id:'asas', role:'asas', server:'srv', catalog:'ASAS' }, { id:'ias', role:'ias', server:'srv2', catalog:'IAS' }],
    _revision:4,
  }));
  await fsp.writeFile(path.join(serverData, 'overrides.json'), JSON.stringify({
    pricingRules:[{ id:'r1', licensor:'Disney', royalty:0.1 }],
    transitRules:[{ id:'t1', days:14 }],
    nonDtrManufacturers:['SUP1'],
    landedMultipliers:{ tr:1.05, overseas:1.11 },
    freightRates:{ routes:[{ id:'x' }] },
    _revision:9,
    _revisions:{ pricingRules:3, transitRules:2 },
  }));
  await fsp.writeFile(path.join(serverData, 'fx-rates.json'), JSON.stringify({
    base:'USD', currencies:['TRY'], months:{ '202609':{ TRY:41.5 } }, _revision:5,
  }));
  await fsp.writeFile(path.join(serverData, 'email-groups.json'), JSON.stringify({
    countries:[{ id:'tr', name:'Türkiye', order:0 }],
    types:[{ id:'dokuma', name:'Dokuma', order:0 }],
    records:[{ id:'e1', manufacturer:'SUP1', email:'buyer@example.com', countryId:'tr', typeId:'dokuma' }],
    _revision:6,
  }));
  const snapshot = {
    schemaVersion:1, generatedAt:'2026-09-19T08:00:00.000Z',
    months:['202609'], fx:{ '202609':41.5 },
    records:[['A','B','C','D','E','','','','','','','','']],
  };
  await fsp.writeFile(path.join(serverData, 'endeksmatik-snapshot.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(snapshot))));

  const records = recovery.loadMasterRecordsFromExtractedBackup(root, { records:{} });
  assert.ok(records['store:settings.json']);
  assert.equal(records['store:settings.json'].modelConnections.length, 2);
  assert.equal(records['store:overrides.json'].pricingRules.length, 1);
  assert.equal(records['store:email-groups.json'].records.length, 1);
  assert.equal(Object.keys(records['store:fx-rates.json'].months).length, 1);
  assert.equal(records['endeksmatik:snapshot'].snapshot.records.length, 1);

  const coverage = recovery.masterCoverage(records);
  assert.equal(coverage.modelConnections, 2);
  assert.equal(coverage.royaltyRules, 1);
  assert.equal(coverage.emailGroups, 1);
  assert.equal(coverage.fxKeys, 1);
  assert.equal(coverage.endeksmatikRecords, 1);
});

test('verified non-empty Master data replaces later-created empty/default cache records', () => {
  const recovered = {
    'store:overrides.json': { pricingRules:[{ id:'r1' }], storeRevisionMeta:{ revision:0 } },
    'store:email-groups.json': { records:[{ id:'e1' }], countries:[], storeRevisionMeta:{ revision:0 } },
    'store:fx-rates.json': { months:{ '202609':{ TRY:41 } }, storeRevisionMeta:{ revision:0 } },
    'store:settings.json': { modelConnections:[{ id:'asas' }], storeRevisionMeta:{ revision:0 } },
  };
  const emptyNewer = {
    'store:overrides.json': { pricingRules:[], storeRevisionMeta:{ revision:5 } },
    'store:email-groups.json': { records:[], countries:[], storeRevisionMeta:{ revision:5 } },
    'store:fx-rates.json': { months:{}, storeRevisionMeta:{ revision:5 } },
    'store:settings.json': { modelConnections:[], storeRevisionMeta:{ revision:5 } },
  };
  assert.deepEqual(recovery.masterRecoveryIds(recovered, emptyNewer).sort(), Object.keys(recovered).sort());
});

test('first-open bootstrap verifies Master payload before Buyer Log becomes ready', () => {
  assert.match(SERVER, /async function verifySharedMasterBootstrap\(root\)/);
  assert.match(SERVER, /SHARED_HUB_MASTER_INCOMPLETE/);
  assert.match(SERVER, /const masterVerification = await verifySharedMasterBootstrap\(checked\.root\)/);
  assert.match(SERVER, /inventory:prewipeMasterRecovery\.masterCoverage\(records\)/);
  assert.match(SERVER, /masterCoverage:masterVerification\.inventory/);
  assert.match(SERVER, /SHARED_BOOTSTRAP_INTEGRITY_ERRORS/);
  assert.match(SERVER, /completed && localLoginAllowed && !integrityFailure/);
});

test('pre-wipe recovery reads legacy settings, royalty, email, FX and Endeksmatik from Full System Backup', () => {
  assert.match(SERVER, /prewipeMasterRecovery\.loadMasterRecordsFromExtractedBackup\(tempRoot, recoveredState\)/);
  assert.match(SERVER, /prewipeMasterRecovery\.masterRecoveryIds\(recovered\.masterRecords, currentMaster\)/);
  assert.match(SERVER, /expectedMaster > 0 && currentMasterCount < expectedMaster/);
  assert.match(SERVER, /checkpointUnaccountedIds\(recovered\.businessRecords, currentBusiness/);
  assert.match(SERVER, /filter\(id => !\/shared-collection\//);
  assert.match(SERVER, /inventory:finalCoverage/);
});


test('legacy data-BACKUP server root can rebuild Master without a Full System Backup archive', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-data-backup-root-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const serverData = path.join(root, 'server');
  await fsp.mkdir(serverData, { recursive:true });
  await fsp.writeFile(path.join(serverData, 'overrides.json'), JSON.stringify({
    pricingRules:[{ id:'r1', licensor:'Disney', royalty:0.12 }],
    transitRules:[{ id:'t1', days:10 }],
    _revision:7,
  }));
  await fsp.writeFile(path.join(serverData, 'email-groups.json'), JSON.stringify({
    records:[{ id:'e1', manufacturer:'SUP1', email:'a@b.com' }],
    countries:[], types:[], _revision:3,
  }));
  await fsp.writeFile(path.join(serverData, 'fx-rates.json'), JSON.stringify({
    base:'USD', months:{ '202609':{ TRY:42 } }, _revision:2,
  }));
  const snapshot = {
    schemaVersion:1, generatedAt:'2026-09-19T09:00:00.000Z',
    months:['202609'], fx:{}, records:[['A','B','C','D','E','','','','','','','','']],
  };
  await fsp.writeFile(path.join(serverData, 'endeksmatik-snapshot.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(snapshot))));

  const records = recovery.loadMasterRecordsFromServerDataRoot(serverData, {});
  assert.equal(records['store:overrides.json'].pricingRules.length, 1);
  assert.equal(records['store:email-groups.json'].records.length, 1);
  assert.equal(Object.keys(records['store:fx-rates.json'].months).length, 1);
  assert.equal(records['endeksmatik:snapshot'].snapshot.records.length, 1);
});

test('bootstrap can repair catastrophic empty Master from preserved data-BACKUP folder and publish it once for all users', () => {
  assert.match(SERVER, /function portableDataRootForRecovery\(\)/);
  assert.match(SERVER, /\^data\[-_ \]\?backup/);
  assert.match(SERVER, /async function recoverSharedMasterFromLocalDataBackup\(root\)/);
  assert.match(SERVER, /masterCoverageIsCatastrophicallySparse\(currentCoverage\)/);
  assert.match(SERVER, /loadMasterRecordsFromLegacyDataRoot\(candidate\.root, recoveredState\)/);
  assert.match(SERVER, /actorId:'local-data-backup-auto-recovery'/);
  assert.match(SERVER, /SHARED_LOCAL_DATA_BACKUP_RECOVERED/);
  assert.match(SERVER, /const localDataRecovery = await recoverSharedMasterFromLocalDataBackup\(checked\.root\)/);
  assert.match(SERVER, /localDataBackupRecovered:Boolean\(localDataRecovery\.recovered\)/);
});


test('legacy data-BACKUP can promote pre-shared user FX into central FX when server fx-rates is absent', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-data-backup-fx-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const serverData = path.join(root, 'server');
  const userFxDir = path.join(root, 'app', 'user-source-data', 'moderator');
  await fsp.mkdir(serverData, { recursive:true });
  await fsp.mkdir(userFxDir, { recursive:true });
  await fsp.writeFile(path.join(userFxDir, 'fx-rates.json'), JSON.stringify({
    base:'USD', currencies:['TRY'], months:{ '202609':{ TRY:42.25 } }, updatedAt:'2026-09-19T10:00:00.000Z', _revision:4,
  }));
  const records = recovery.loadMasterRecordsFromLegacyDataRoot(root, {});
  assert.equal(records['store:fx-rates.json'].months['202609'].TRY, 42.25);
});
