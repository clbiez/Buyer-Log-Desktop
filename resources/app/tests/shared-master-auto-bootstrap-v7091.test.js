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

test('full backup loader promotes rich legacy settings when canonical Master snapshot is empty', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-full-backup-legacy-master-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const canonical = path.join(root, 'system', 'server-data');
  const legacy = path.join(root, 'system', 'local-data', 'application-data');
  await fsp.mkdir(canonical, { recursive:true });
  await fsp.mkdir(legacy, { recursive:true });
  await fsp.writeFile(path.join(canonical, 'overrides.json'), JSON.stringify({ pricingRules:[], transitRules:[], _revision:12 }));
  await fsp.writeFile(path.join(canonical, 'email-groups.json'), JSON.stringify({ countries:[], types:[], records:[], _revision:12 }));
  await fsp.writeFile(path.join(legacy, 'overrides.json'), JSON.stringify({
    pricingRules:Array.from({ length:24 }, (_,i) => ({ id:`royalty-${i}` })),
    transitRules:Array.from({ length:6 }, (_,i) => ({ id:`transit-${i}` })),
    _revision:3,
  }));
  await fsp.writeFile(path.join(legacy, 'email-groups.json'), JSON.stringify({
    countries:[{ id:'tr', name:'Türkiye' }], types:[], records:[{ id:'mail-1', email:'buyer@example.com' }], _revision:3,
  }));

  const records = recovery.loadMasterRecordsFromExtractedBackup(root, { records:{} });
  const coverage = recovery.masterCoverage(records);
  assert.equal(coverage.royaltyRules, 24);
  assert.equal(coverage.transitRules, 6);
  assert.equal(coverage.emailGroups, 1);
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


test('legacy portable backup scans server plus local/application-data and local/data layouts', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-deep-legacy-master-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));

  const serverRoot = path.join(root, 'server');
  const appDataRoot = path.join(root, 'local', 'application-data');
  const localDataRoot = path.join(root, 'local', 'data');
  await fsp.mkdir(serverRoot, { recursive:true });
  await fsp.mkdir(appDataRoot, { recursive:true });
  await fsp.mkdir(localDataRoot, { recursive:true });

  await fsp.writeFile(path.join(serverRoot, 'overrides.json'), JSON.stringify({
    pricingRules:[{ id:'server-rule' }],
    transitRules:[{ id:'server-transit' }],
    nonDtrManufacturers:['A'],
    landedMultipliers:{ tr:1.05, overseas:1.11 },
    freightRates:{ routes:[{ id:'server-route' }] },
    _revision:10,
  }));
  await fsp.writeFile(path.join(serverRoot, 'fx-rates.json'), JSON.stringify({
    base:'USD', months:{ '2026-09':{ TRY:42 } }, _revision:10,
  }));
  await fsp.writeFile(path.join(appDataRoot, 'settings.json'), JSON.stringify({
    modelConnections:[{ id:'asas' }, { id:'ias' }], _revision:809,
  }));
  await fsp.writeFile(path.join(appDataRoot, 'overrides.json'), JSON.stringify({
    pricingRules:Array.from({ length:24 }, (_,i) => ({ id:'rule-'+i })),
    transitRules:Array.from({ length:6 }, (_,i) => ({ id:'tr-'+i })),
    nonDtrManufacturers:['A','B','C','D'],
    landedMultipliers:{ tr:1.05, overseas:1.11 },
    freightRates:{ routes:[{ id:'x' }] },
    _revision:3042,
  }));
  await fsp.writeFile(path.join(appDataRoot, 'email-groups.json'), JSON.stringify({
    countries:[], types:[{ id:'dokuma', name:'Dokuma' }], records:[], _revision:1,
  }));
  const endek = {
    schemaVersion:1, generatedAt:'2026-08-14T13:36:22.280Z',
    months:Array.from({ length:28 }, (_,i) => String(i)),
    records:Array.from({ length:4589 }, () => ['A','B','C','D','E','','','','','','','','']),
  };
  await fsp.writeFile(path.join(appDataRoot, 'endeksmatik-snapshot.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(endek))));
  await fsp.writeFile(path.join(localDataRoot, 'settings.json'), JSON.stringify({ modelConnections:[{ id:'old' }], _revision:803 }));

  const records = recovery.loadMasterRecordsFromLegacyDataRoot(root, {});
  const coverage = recovery.masterCoverage(records);
  assert.equal(coverage.modelConnections, 2);
  assert.equal(coverage.royaltyRules, 24);
  assert.equal(coverage.transitRules, 6);
  assert.equal(coverage.nonDtrManufacturers, 4);
  assert.equal(coverage.fxKeys, 1);
  assert.equal(coverage.endeksmatikRecords, 4589);
});

test('deep legacy Master scan includes local-first legacy-server-data fallbacks', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'prewipe-master-recovery.js'), 'utf8');
  assert.match(source, /path\.join\(localDataRoot, 'application-data'\)/);
  assert.match(source, /path\.join\(localDataRoot, 'data'\)/);
  assert.match(source, /path\.join\(localDataRoot, 'local-first', 'backups'\)/);
  assert.match(source, /legacy-server-data/);
});


test('verified Full System Backup prefers rich overrides .bak over one-revision-newer empty current file', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-rich-bak-master-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true }));
  const serverData = path.join(root, 'system', 'server-data');
  const legacy = path.join(root, 'system', 'local-data', 'application-data');
  await fsp.mkdir(serverData, { recursive:true });
  await fsp.mkdir(legacy, { recursive:true });

  await fsp.writeFile(path.join(serverData, 'overrides.json'), JSON.stringify({
    pricingRules:[], transitRules:[], nonDtrManufacturers:[],
    _revision:3357,
    _revisions:{ pricingRules:91, transitRules:6, nonDtrManufacturers:1 },
  }));
  await fsp.writeFile(path.join(serverData, 'overrides.json.bak'), JSON.stringify({
    pricingRules:Array.from({ length:35 }, (_,i) => ({ id:'rule-'+i })),
    transitRules:Array.from({ length:6 }, (_,i) => ({ id:'transit-'+i })),
    nonDtrManufacturers:['A','B','C','D'],
    _revision:3356,
    _revisions:{ pricingRules:91, transitRules:6, nonDtrManufacturers:1 },
  }));
  const endek = {
    schemaVersion:1,
    generatedAt:'2026-08-14T13:36:22.280Z',
    months:Array.from({ length:28 }, (_,i) => String(i)),
    records:Array.from({ length:4589 }, () => ['A','B','C','D','E','','','','','','','','']),
  };
  await fsp.writeFile(path.join(legacy, 'endeksmatik-snapshot.json.gz'), zlib.gzipSync(Buffer.from(JSON.stringify(endek))));

  const records = recovery.loadMasterRecordsFromExtractedBackup(root, { records:{} });
  const coverage = recovery.masterCoverage(records);
  assert.equal(coverage.royaltyRules, 35);
  assert.equal(coverage.transitRules, 6);
  assert.equal(coverage.nonDtrManufacturers, 4);
  assert.equal(coverage.endeksmatikRecords, 4589);
});

test('verified pre-wipe deep scan is keyed by backup sha, not Master record count', () => {
  assert.match(SERVER, /function prewipeRecoveryAlreadyDeepScanned\(snapshot, candidate\)/);
  assert.match(SERVER, /Number\(recovery\.schemaVersion \|\| 0\) >= 2/);
  assert.match(SERVER, /String\(recovery\.backupSha256 \|\| ''\)\.toLowerCase\(\) === expectedSha/);
  assert.doesNotMatch(SERVER, /reason:'checkpoint-inventory-complete'/);
  assert.match(SERVER, /Record count alone is NOT enough/);
  assert.match(SERVER, /schemaVersion:2,/);
  assert.match(SERVER, /backupSha256:String\(candidate\.report/);
});

test('ordinary partial overrides save cannot silently zero critical Master sections without advancing section revisions', () => {
  const dbSource = fs.readFileSync(path.join(ROOT, 'server', 'db.js'), 'utf8');
  assert.match(dbSource, /function protectCriticalOverrideSections\(current, incoming\)/);
  assert.match(dbSource, /\['pricingRules','transitRules','nonDtrManufacturers'\]/);
  assert.match(dbSource, /before\.length > 0 && after\.length === 0 && afterRev <= beforeRev/);
  assert.match(dbSource, /protectCriticalOverrideSections\(loadOverrides\(\), overrides\)/);
});


test('clean-install verification cannot certify two equally-empty Master copies when overrides .bak is richer', () => {
  const cleanup = fs.readFileSync(path.join(ROOT, 'scripts', 'BuyerLog-Uninstall-Temiz-Kurulum.cmd'), 'utf8');
  assert.match(cleanup, /const legacyOverridesBak = readJson\(path\.join\(SERVER, 'overrides\.json\.bak'\), null\)/);
  assert.match(cleanup, /if \(backupList\.length > currentList\.length\) expectedOverrides\[field\] = backupList/);
  assert.match(cleanup, /coverage\[field\] = same\(expectedOverrides\[field\], remoteOverrides\[field\]\)/);
});
