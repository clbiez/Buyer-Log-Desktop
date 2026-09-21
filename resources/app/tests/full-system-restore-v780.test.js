'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createBackupArchive, inspectBackupArchive, readZipIndex, manifestLimitForIndex } = require('../server/lib/backup-archive');
const { createFullRestoreService, recoverInterruptedRestoresSync, mergePortableConfig } = require('../server/lib/full-restore-service');
const { createLocalDb } = require('../server/lib/local-db');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function dbState(revision, label) {
  return { schemaVersion: 3, revision, deviceId: `${label}-device`, localSequence: 0, records: { [`${label}-record`]: { value: label } }, tombstones: {}, events: {}, appliedEvents: {}, appliedPackages: {}, conflicts: [], journal: [], syncCheckpoints: {}, syncLedger: {}, assets: {}, migrations: {} };
}
async function makeRoots(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-full-restore-test-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const roots = {
    serverDataRoot: path.join(root, 'server-data'), appDataRoot: path.join(root, 'app-data'), localDataRoot: path.join(root, 'local-data'),
    localDbFile: path.join(root, 'local-data', 'BuyerLogLocal.db'), modelFilesRoot: path.join(root, 'local-data', 'model-files'),
    collectionImagesRoot: path.join(root, 'local-data', 'collection-images'), qtxFilesRoot: path.join(root, 'local-data', 'qtx-files'), configPath: path.join(root, 'config.json'),
  };
  for (const folder of [roots.serverDataRoot, roots.appDataRoot, roots.localDataRoot, roots.modelFilesRoot, roots.collectionImagesRoot, roots.qtxFilesRoot]) await fsp.mkdir(folder, { recursive: true });
  return { root, roots };
}
async function makeFullArchive(root, options = {}) {
  const sourceRoot = path.join(root, 'archive-source'); await fsp.mkdir(sourceRoot, { recursive: true });
  const dbFile = path.join(sourceRoot, 'BuyerLogLocal.db'); await fsp.writeFile(dbFile, JSON.stringify(dbState(options.revision || 42, 'restored')));
  const entries = [
    { name: 'system/server-data/new-server.json', buffer: Buffer.from('{"restored":true}'), stage: 'data' },
    { name: 'system/server-data/settings.json', buffer: Buffer.from(JSON.stringify({
      modelConnections: [
        { id: 'asas-1', role: 'asas', server: 'asas-sql', catalog: 'ASAS', query: 'EVALUATE ASAS', mapping: { orderCode: 'Sipariş Kod' }, scopes: [{ targets: ['cp'], horizon: { seasons: ['S7'] } }] },
        { id: 'ias-1', role: 'ias', server: 'ias-sql', catalog: 'IAS', query: 'EVALUATE IAS', mapping: { orderCode: 'Order Code' }, scopes: [{ targets: ['orders'], horizon: { dateStart: '2026-01-01' } }] },
        { id: 'intake-1', role: 'intake', server: 'intake-sql', catalog: 'INTAKE', query: 'EVALUATE INTAKE', mapping: { season: 'SezonKod' }, scopes: [{ targets: ['intake'], horizon: { seasons: ['S7'] } }] },
      ],
    })), stage: 'settings' },
    { name: 'system/app-data/new-app.json', buffer: Buffer.from('{"restored":true}'), stage: 'data' },
    { name: 'system/local-data/BuyerLogLocal.db', sourcePath: dbFile, stage: 'data' },
    { name: 'system/model-files/model.bin', buffer: Buffer.from('model'), stage: 'data' },
    { name: 'system/collection-images/image.bin', buffer: Buffer.from('image'), stage: 'data' },
    { name: 'system/qtx-files/Q1.qtx', buffer: Buffer.from('qtx'), stage: 'data' },
    { name: 'system/config/config.json', buffer: Buffer.from(JSON.stringify({ port: 7000, auth: { sessionHours: 24 }, localCachePath: 'C:\\Users\\OldPc\\cache' })), stage: 'settings' },
    { name: 'system/security/users-roles-permissions.json', buffer: Buffer.from(JSON.stringify({ moderator: { id: 'moderator', username: 'Gökberk', role: 'moderator', enabled: true }, users: [{ id: 'u1', username: 'Buyer 1', role: 'buyer', enabled: true }], iam: { roles: { moderator: { permissions: ['*'] }, buyer: { permissions: ['COLLECTION.VIEW'] } } } })), stage: 'settings' },
    { name: 'system/sync/metadata.json', buffer: Buffer.from(JSON.stringify({ localDbPath: 'C:\\Users\\OldPc\\BuyerLogLocal.db', sharedSyncRoot: '\\\\server\\buyerlog', syncPeriodMinutes: 10, packageRetentionDays: 60 })), stage: 'settings' },
  ];
  if (options.includeNestedManifest) {
    entries.push({ name: 'system/server-data/cache/manifest.json', buffer: Buffer.from(JSON.stringify({ cacheVersion: 3, entries: ['a', 'b'] })), stage: 'data' });
    entries.push({ name: 'system/app-data/projection/manifest.json', buffer: Buffer.from(JSON.stringify({ generation: 12 })), stage: 'data' });
  }
  if (options.includeLegacyMaster) {
    entries.push({ name: 'system/server-data/overrides.json', buffer: Buffer.from(JSON.stringify({ pricingRules: [], transitRules: [], _revision: 20 })), stage: 'data' });
    entries.push({ name: 'system/server-data/email-groups.json', buffer: Buffer.from(JSON.stringify({ countries: [], types: [], records: [], _revision: 20 })), stage: 'data' });
    entries.push({ name: 'system/local-data/application-data/overrides.json', buffer: Buffer.from(JSON.stringify({
      pricingRules: Array.from({ length: 24 }, (_, i) => ({ id: `royalty-${i}` })),
      transitRules: Array.from({ length: 6 }, (_, i) => ({ id: `transit-${i}` })),
      _revision: 3,
    })), stage: 'data' });
    entries.push({ name: 'system/local-data/application-data/email-groups.json', buffer: Buffer.from(JSON.stringify({
      countries: [{ id: 'tr', name: 'Türkiye' }], types: [], records: [{ id: 'mail-1', email: 'buyer@example.com' }], _revision: 3,
    })), stage: 'data' });
  }
  if (options.includeUnknownContent) entries.push({ name: 'system/unknown/secret.json', buffer: Buffer.from('{"unexpected":true}'), stage: 'data' });
  return createBackupArchive({ entries, manifest: { app_version: options.appVersion || '7.0.79', created_at: '2026-09-14T16:00:00.000Z', backup_type: 'full', user: { id: 'moderator' }, device: { hostname: 'OLD-PC', platform: 'win32', arch: 'x64' } }, filename: options.filename || 'BuyerLog_FullBackup_test.zip' });
}
function makeDependencies({ roots, securityFile, syncFile, failSecurity = false }) {
  let paused = false;
  const syncSettings = {
    file: syncFile,
    pause() { paused = true; }, resume() { paused = false; }, isPaused() { return paused; }, async waitForIdle() {},
    async restoreMetadata(snapshot) {
      const current = JSON.parse(await fsp.readFile(syncFile, 'utf8'));
      const portable = { localDbPath: current.localDbPath, deviceId: current.deviceId, sharedSyncRoot: String(snapshot.sharedSyncRoot || '').startsWith('\\\\') ? snapshot.sharedSyncRoot : '', syncPeriodMinutes: snapshot.syncPeriodMinutes, packageRetentionDays: snapshot.packageRetentionDays };
      await fsp.writeFile(syncFile, JSON.stringify(portable));
      return { settings: portable, requiresSharedSyncSetup: false, previousSharedSyncRoot: snapshot.sharedSyncRoot };
    },
  };
  const userAccess = {
    restoreBackupSnapshot(snapshot) {
      if (failSecurity) throw Object.assign(new Error('Injected security restore failure'), { code: 'SECURITY_RESTORE_FAILED', statusCode: 500 });
      const current = JSON.parse(fs.readFileSync(securityFile, 'utf8'));
      const restored = JSON.parse(JSON.stringify(snapshot));
      restored.moderator.passwordHash = current.moderator.passwordHash;
      fs.writeFileSync(securityFile, JSON.stringify(restored));
      return { applied: true, source: 'local', restoredUsers: 2, credentialsPreserved: 1, credentialsRequired: 1 };
    },
    allPublicProfiles() {
      const store = JSON.parse(fs.readFileSync(securityFile, 'utf8'));
      return [store.moderator, ...(Array.isArray(store.users) ? store.users : [])].filter(Boolean);
    },
  };
  const safety = path.join(path.dirname(roots.configPath), `safety-${Date.now()}-${Math.random()}.zip`); fs.writeFileSync(safety, 'safety');
  const backupService = { async create() { return { path: safety, filename: 'BuyerLog_PreRestore_test.zip', size: 6, cleanup: () => { try { fs.rmSync(safety, { force: true }); } catch (_) {} } }; } };
  return { syncSettings, userAccess, backupService };
}

async function seedCurrent(roots, securityFile, syncFile) {
  await fsp.writeFile(path.join(roots.serverDataRoot, 'old-server.json'), '{"old":true}');
  await fsp.writeFile(path.join(roots.appDataRoot, 'old-app.json'), '{"old":true}');
  await fsp.writeFile(roots.localDbFile, JSON.stringify(dbState(7, 'old')));
  await fsp.writeFile(path.join(roots.modelFilesRoot, 'old-model.bin'), 'old-model');
  await fsp.writeFile(path.join(roots.collectionImagesRoot, 'old-image.bin'), 'old-image');
  await fsp.writeFile(path.join(roots.qtxFilesRoot, 'old.qtx'), 'old-qtx');
  await fsp.writeFile(roots.configPath, JSON.stringify({ port: 6194, auth: { sessionSecret: 'keep-secret', passwordHash: 'keep-hash', sessionHours: 12 }, localCachePath: path.join(roots.localDataRoot, 'cache') }));
  await fsp.mkdir(path.dirname(securityFile), { recursive: true });
  await fsp.writeFile(securityFile, JSON.stringify({ moderator: { id: 'moderator', username: 'Gökberk', role: 'moderator', passwordHash: 'scrypt$keep$credential' }, users: [] }));
  await fsp.writeFile(syncFile, JSON.stringify({ localDbPath: roots.localDbFile, deviceId: 'new-pc-device', sharedSyncRoot: '', syncPeriodMinutes: 5 }));
}

test('v7.80 · Full System Restore ZIP preflight manifest, checksum ve türü gerçekten doğrular', async t => {
  const { root } = await makeRoots(t); const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const info = await inspectBackupArchive(archive.path, { requireType: 'full' });
  assert.equal(info.manifest.backup_type, 'full'); assert.equal(info.manifest.app_version, '7.0.79'); assert.ok(info.fileCount >= 9); assert.match(info.archiveSha256, /^[a-f0-9]{64}$/);
});

test('v7.80 · preflight kullanıcı/rol ve ASAS-IAS-INTAKE bağlantı sözleşmesini canlı veriye dokunmadan raporlar', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile });
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  const plan = await service.inspect(archive.path);
  assert.equal(plan.inventory.users, 2); assert.equal(plan.inventory.roles, 2);
  assert.equal(plan.inventory.localDb, true); assert.equal(plan.inventory.modelConnections, 3);
  assert.deepEqual(plan.inventory.connections, { asas: true, ias: true, intake: true });
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'old-server.json'), 'utf8'), '{"old":true}');
});

test('v7.80 · preflight disk hesabı optional safety backup kapalıyken gereksiz ikinci sistem kopyasını istemez', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile });
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  const withSafety = await service.inspect(archive.path, { createSafetyBackup: true });
  const withoutSafety = await service.inspect(archive.path, { createSafetyBackup: false });
  assert.ok(withSafety.estimatedRequiredBytes > withoutSafety.estimatedRequiredBytes);
});

test('v7.80 · modelConnections ASAS-IAS-INTAKE ve Horizon alanları byte-kopyaya güvenmeden deep-compare edilir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile });
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false });
  assert.equal(result.verification.connections.configurationRestored, true);
  assert.deepEqual(result.verification.connections.roles, { asas: true, ias: true, intake: true });
  const settings = JSON.parse(await fsp.readFile(path.join(roots.serverDataRoot, 'settings.json'), 'utf8'));
  assert.deepEqual(settings.modelConnections, result.verification.connections.modelConnections);
});

test('v7.80 · post-restore bağlantı health hatası rollback yapmaz, yapılandırma ile erişilebilirliği ayırır', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile });
  const healthCalls = [];
  const service = createFullRestoreService({
    appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps,
    connectionHealthCheck: async connection => { healthCalls.push(connection.role); if (connection.role === 'ias') throw new Error('Domain unavailable'); return { connected: true }; },
  });
  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false });
  assert.deepEqual(healthCalls.sort(), ['asas', 'ias', 'intake']);
  assert.equal(result.verification.connections.health.ias.connected, false);
  assert.equal(result.verification.connections.configurationRestored, true);
  assert.ok(result.warnings.some(item => /IAS.*Domain unavailable/i.test(item)));
});

test('v7.80 · temiz/yeni PC benzetiminde full restore data + DB + config + security + sync taşır, machine-specific local path taşınmaz', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile }); const localDb = createLocalDb(roots.localDbFile);
  const writeLockStates = [], commitStates = [];
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb, securityFile, ...deps, onWriteLockState: locked => writeLockStates.push(locked), onCommitState: committing => commitStates.push(committing) });
  const plan = await service.inspect(archive.path); assert.equal(plan.compatible, true); assert.equal(plan.contents.localData, true);
  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' } });
  t.after(() => result.safetyArchive && result.safetyArchive.cleanup());
  assert.equal(result.ok, true); assert.equal(result.verification.checks.localDb, true);
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'old-server.json')), false); assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'new-server.json')), true);
  assert.equal(fs.existsSync(path.join(roots.modelFilesRoot, 'model.bin')), true); assert.equal(fs.existsSync(path.join(roots.collectionImagesRoot, 'image.bin')), true); assert.equal(fs.existsSync(path.join(roots.qtxFilesRoot, 'Q1.qtx')), true);
  const restoredDb = await localDb.read(); assert.equal(restoredDb.revision, 42); assert.ok(restoredDb.records['restored-record']);
  const config = JSON.parse(await fsp.readFile(roots.configPath, 'utf8')); assert.equal(config.port, 6194); assert.equal(config.auth.sessionSecret, 'keep-secret'); assert.equal(config.auth.passwordHash, 'keep-hash'); assert.equal(config.localCachePath, path.join(roots.localDataRoot, 'cache'));
  const security = JSON.parse(await fsp.readFile(securityFile, 'utf8')); assert.equal(security.moderator.passwordHash, 'scrypt$keep$credential'); assert.equal(security.users[0].username, 'Buyer 1');
  const sync = JSON.parse(await fsp.readFile(syncFile, 'utf8')); assert.equal(sync.localDbPath, roots.localDbFile); assert.equal(sync.deviceId, 'new-pc-device'); assert.equal(sync.sharedSyncRoot, '\\\\server\\buyerlog');
  assert.ok(result.warnings.some(item => /şifre|credential|Parolalar/i.test(item)));
  assert.deepEqual(writeLockStates, [true, false]); assert.deepEqual(commitStates, [true, false]);
});

test('v7.80 · full restore boş canonical Master yerine legacy royalty, yol süresi ve e-posta kayıtlarını yükseltir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root, { includeLegacyMaster: true }); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile }); const localDb = createLocalDb(roots.localDbFile);
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb, securityFile, ...deps });
  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false });
  const state = await localDb.read();
  assert.ok(result.applied.masterRecovery.promoted >= 2);
  assert.ok(result.applied.masterRecovery.ids.includes('store:overrides.json'));
  assert.ok(result.applied.masterRecovery.ids.includes('store:email-groups.json'));
  assert.equal(state.records['store:overrides.json'].pricingRules.length, 24);
  assert.equal(state.records['store:overrides.json'].transitRules.length, 6);
  assert.equal(state.records['store:email-groups.json'].records.length, 1);
});

test('v7.80 · restore öncesi indirilebilir Tam Sistem güvenlik yedeği kullanıcı tercihiyle atlanabilir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile });
  let safetyBackupCalls = 0;
  deps.backupService = { async create() { safetyBackupCalls += 1; throw new Error('Safety backup must not be called when disabled'); } };
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false });
  assert.equal(result.ok, true);
  assert.equal(result.safetyArchive, null);
  assert.equal(safetyBackupCalls, 0);
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'new-server.json')), true);
  assert.equal(result.verification.checks.localDb, true);
});

test('v7.80 · güvenlik yedeği kapalı olsa da commit hatasında geçici rollback snapshot sistemi geri getirir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const before = { db: await fsp.readFile(roots.localDbFile, 'utf8'), config: await fsp.readFile(roots.configPath, 'utf8'), security: await fsp.readFile(securityFile, 'utf8'), sync: await fsp.readFile(syncFile, 'utf8') };
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile, failSecurity: true });
  deps.backupService = { async create() { throw new Error('Safety backup should be skipped'); } };
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  let failure;
  try { await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false }); } catch (error) { failure = error; }
  assert.ok(failure); assert.equal(failure.code, 'SECURITY_RESTORE_FAILED'); assert.deepEqual(failure.rollback, { ok: true });
  assert.equal(failure.safetyArchive, undefined);
  assert.equal(await fsp.readFile(roots.localDbFile, 'utf8'), before.db);
  assert.equal(await fsp.readFile(roots.configPath, 'utf8'), before.config);
  assert.equal(await fsp.readFile(securityFile, 'utf8'), before.security);
  assert.equal(await fsp.readFile(syncFile, 'utf8'), before.sync);
});

test('v7.80 · commit ortasında hata olursa mevcut sistem dosya + config + auth + sync olarak rollback edilir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const before = {
    db: await fsp.readFile(roots.localDbFile, 'utf8'), config: await fsp.readFile(roots.configPath, 'utf8'), security: await fsp.readFile(securityFile, 'utf8'), sync: await fsp.readFile(syncFile, 'utf8'),
  };
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile, failSecurity: true }); const localDb = createLocalDb(roots.localDbFile);
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb, securityFile, ...deps });
  let failure; try { await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' } }); } catch (error) { failure = error; if (error.safetyArchive) error.safetyArchive.cleanup(); }
  assert.ok(failure); assert.equal(failure.code, 'SECURITY_RESTORE_FAILED'); assert.deepEqual(failure.rollback, { ok: true });
  assert.equal(await fsp.readFile(roots.localDbFile, 'utf8'), before.db); assert.equal(await fsp.readFile(roots.configPath, 'utf8'), before.config); assert.equal(await fsp.readFile(securityFile, 'utf8'), before.security); assert.equal(await fsp.readFile(syncFile, 'utf8'), before.sync);
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'old-server.json')), true); assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'new-server.json')), false);
});

test('v7.80 · yeni uygulamadan alınmış backup eski Buyer Log üzerine restore edilmez', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile); const archive = await makeFullArchive(root, { appVersion: '8.0.0' }); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile }); const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  await assert.rejects(service.inspect(archive.path), error => error && error.code === 'RESTORE_NEWER_APP_VERSION');
});

test('v7.80 · açılış recovery journal committing durumunu görürse önceki sistemi otomatik geri koyar', async t => {
  const { roots } = await makeRoots(t); const recovery = path.join(roots.localDataRoot, 'restore-recovery', 'interrupted'), rollback = path.join(recovery, 'rollback');
  await fsp.mkdir(path.join(rollback, 'scopes', 'serverData'), { recursive: true });
  await fsp.writeFile(path.join(roots.serverDataRoot, 'corrupt.json'), 'new'); await fsp.writeFile(path.join(rollback, 'scopes', 'serverData', 'old.json'), 'old');
  await fsp.writeFile(path.join(rollback, 'manifest.json'), JSON.stringify({ scopes: { serverData: ['old.json'], appData: [], localData: [], modelFiles: [], collectionImages: [], qtxFiles: [] }, specials: {} }));
  await fsp.writeFile(path.join(recovery, 'journal.json'), JSON.stringify({ journalVersion: 1, status: 'committing' }));
  const result = recoverInterruptedRestoresSync({ roots });
  assert.equal(result.recovered, 1); assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'corrupt.json')), false); assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'old.json'), 'utf8'), 'old'); assert.equal(fs.existsSync(recovery), false);
});

test('v7.80 · config restore hassas değerleri ve bu bilgisayarın yerel pathlerini korur', () => {
  const current = { auth: { sessionSecret: 'secret', passwordHash: 'hash' }, localDbPath: 'D:\\BuyerLog\\BuyerLogLocal.db', host: '127.0.0.1', port: 6194, sharedDataRoot: 'D:\\BuyerLog\\shared-data' };
  const restored = mergePortableConfig(current, { auth: { sessionHours: 24 }, localDbPath: 'C:\\Users\\Old\\BuyerLogLocal.db', host: '192.168.1.20', port: 7000, sharedDataRoot: '\\\\old-server\\buyer-log' });
  assert.equal(restored.auth.sessionSecret, 'secret'); assert.equal(restored.auth.passwordHash, 'hash'); assert.equal(restored.auth.sessionHours, 24); assert.equal(restored.localDbPath, 'D:\\BuyerLog\\BuyerLogLocal.db'); assert.equal(restored.host, '127.0.0.1'); assert.equal(restored.port, 6194); assert.equal(restored.sharedDataRoot, 'D:\\BuyerLog\\shared-data');
});


test('v7.80 · checksum bozulmuş Full System Backup canlı sisteme dokunmadan reddedilir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const corrupt = path.join(root, 'corrupt-full.zip'); await fsp.copyFile(archive.path, corrupt);
  const index = await readZipIndex(corrupt); const record = index.records.find(item => item.name === 'system/server-data/new-server.json');
  const handle = await fsp.open(corrupt, 'r+');
  try {
    const header = Buffer.alloc(30); await handle.read(header, 0, header.length, record.localOffset);
    const dataStart = record.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
    const byte = Buffer.alloc(1); await handle.read(byte, 0, 1, dataStart); byte[0] ^= 0xff; await handle.write(byte, 0, 1, dataStart);
  } finally { await handle.close(); }
  const deps = makeDependencies({ roots, securityFile, syncFile }); const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  await assert.rejects(service.inspect(corrupt), error => error && error.code === 'RESTORE_CHECKSUM_FAILED');
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'old-server.json'), 'utf8'), '{"old":true}');
});

test('v7.80 · commit öncesi iptal canlı veriyi değiştirmez ve write-lock almaz', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile }), locks = [];
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps, onWriteLockState: locked => locks.push(locked) });
  await assert.rejects(service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, shouldCancel: () => true }), error => error && error.code === 'RESTORE_CANCELLED');
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'old-server.json'), 'utf8'), '{"old":true}');
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'new-server.json')), false); assert.deepEqual(locks, []);
});

test('v7.80 · server ve Backup UI gerçek inspect/start/status/cancel/restart akışını bağlıyor', () => {
  const server = read('server/server.js'), ui = read('public/backup-manager.js');
  for (const endpoint of ['/api/backups/restore/inspect', '/api/backups/restore/start', '/api/backups/restore/:id/status', '/api/backups/restore/:id/cancel', '/api/backups/restore/:id/restart']) assert.ok(server.includes(endpoint), endpoint);
  assert.match(server, /SYSTEM_RESTORE_IN_PROGRESS/); assert.match(server, /systemRestoreState\.writeLocked/); assert.match(server, /recoverInterruptedRestoresSync/); assert.match(server, /createSafetyBackup/);
  assert.match(ui, /data-restore-confirm/); assert.match(ui, /data-restore-safety-backup/); assert.match(ui, /createSafetyBackup/); assert.match(ui, /commitStarted/);
  assert.match(server, /bytesDone/); assert.match(server, /bytesTotal/); assert.match(ui, /inventory\.users/); assert.match(ui, /ASAS/); assert.match(ui, /bytesDone/);
});

test('v7.80 · staging progress arşiv boyutundan bağımsız gerçek byte ve dosya sayaçları üretir', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile }), progress = [];
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false, onProgress: value => progress.push(value) });
  const byteEvents = progress.filter(value => value.phase === 'Açılıyor' && Number.isFinite(value.bytesDone));
  assert.ok(byteEvents.length > 0);
  assert.ok(byteEvents.every((value, index) => index === 0 || value.bytesDone >= byteEvents[index - 1].bytesDone));
  assert.equal(byteEvents.at(-1).bytesDone, byteEvents.at(-1).bytesTotal);
  assert.ok(byteEvents.at(-1).current > 0); assert.ok(byteEvents.at(-1).total > 0);
});

async function rewrapAsStandardDeflateZip(sourceZip, targetZip, wrapper = 'BuyerLog_FullBackup_20260914-1850') {
  const index = await readZipIndex(sourceZip);
  const source = await fsp.open(sourceZip, 'r');
  const chunks = [], central = []; let offset = 0;
  const push = buffer => { chunks.push(buffer); offset += buffer.length; };
  try {
    // Windows/7-Zip benzeri arşivlerde görülen explicit root directory kaydı.
    const dirName = Buffer.from(`${wrapper}/`, 'utf8'), dirLocalOffset = offset;
    const dirLocal = Buffer.alloc(30);
    dirLocal.writeUInt32LE(0x04034b50, 0); dirLocal.writeUInt16LE(20, 4); dirLocal.writeUInt16LE(0x0800, 6); dirLocal.writeUInt16LE(0, 8); dirLocal.writeUInt16LE(dirName.length, 26);
    push(dirLocal); push(dirName);
    central.push({ name: dirName, flags: 0x0800, method: 0, crc32: 0, compressedSize: 0, size: 0, localOffset: dirLocalOffset, externalAttributes: 0x10 });

    for (const record of index.records) {
      const local = Buffer.alloc(30); await source.read(local, 0, local.length, record.localOffset);
      const nameLength = local.readUInt16LE(26), extraLength = local.readUInt16LE(28);
      const data = Buffer.alloc(record.size); await source.read(data, 0, data.length, record.localOffset + 30 + nameLength + extraLength);
      const compressed = zlib.deflateRawSync(data), rawName = Buffer.from(`${wrapper}/${record.name}`, 'utf8'), localOffset = offset;
      const header = Buffer.alloc(30), flags = 0x0808;
      header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(8, 8); header.writeUInt16LE(rawName.length, 26);
      push(header); push(rawName); push(compressed);
      const descriptor = Buffer.alloc(16); descriptor.writeUInt32LE(0x08074b50, 0); descriptor.writeUInt32LE(record.crc32, 4); descriptor.writeUInt32LE(compressed.length, 8); descriptor.writeUInt32LE(record.size, 12); push(descriptor);
      central.push({ name: rawName, flags, method: 8, crc32: record.crc32, compressedSize: compressed.length, size: record.size, localOffset, externalAttributes: 0 });
    }
    const centralOffset = offset;
    for (const item of central) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(item.flags, 8); header.writeUInt16LE(item.method, 10);
      header.writeUInt32LE(item.crc32, 16); header.writeUInt32LE(item.compressedSize, 20); header.writeUInt32LE(item.size, 24); header.writeUInt16LE(item.name.length, 28); header.writeUInt32LE(item.externalAttributes, 38); header.writeUInt32LE(item.localOffset, 42);
      push(header); push(item.name);
    }
    const centralSize = offset - centralOffset, eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(central.length, 8); eocd.writeUInt16LE(central.length, 10); eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralOffset, 16); push(eocd);
    await fsp.writeFile(targetZip, Buffer.concat(chunks));
  } finally { await source.close(); }
}

async function writeRawEmptyZip(targetZip, entries) {
  const chunks = [], central = []; let offset = 0;
  const push = value => { chunks.push(value); offset += value.length; };
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), localOffset = offset, header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt16LE(name.length, 26);
    push(header); push(name); central.push({ name, localOffset, externalAttributes: Number(entry.externalAttributes) || 0 });
  }
  const centralOffset = offset;
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(0x0314, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(entry.name.length, 28); header.writeUInt32LE(entry.externalAttributes >>> 0, 38); header.writeUInt32LE(entry.localOffset, 42);
    push(header); push(entry.name);
  }
  const centralSize = offset - centralOffset, eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10); eocd.writeUInt32LE(centralSize, 12); eocd.writeUInt32LE(centralOffset, 16); push(eocd);
  await fsp.writeFile(targetZip, Buffer.concat(chunks));
}

test('v7.80 · ZIP traversal, absolute, UNC, symlink ve Windows reparse kayıtlarını preflight reddeder', async t => {
  const { root } = await makeRoots(t);
  const attacks = [
    { name: '../evil' }, { name: 'C:\\evil' }, { name: '\\\\server\\evil' },
    { name: 'system/link', externalAttributes: 0xa0000000 }, { name: 'system/junction', externalAttributes: 0x00000400 },
  ];
  for (let index = 0; index < attacks.length; index++) {
    const file = path.join(root, `unsafe-${index}.zip`); await writeRawEmptyZip(file, [attacks[index]]);
    await assert.rejects(readZipIndex(file), error => error && error.code === 'RESTORE_UNSAFE_PATH');
  }
});

test('v7.80 · farklı ZIP adları aynı normalize hedefe çözülüyorsa duplicate target reddedilir', async t => {
  const { root } = await makeRoots(t), file = path.join(root, 'duplicate-target.zip');
  await writeRawEmptyZip(file, [{ name: 'system/server-data/a.json' }, { name: 'system\\server-data\\a.json' }]);
  await assert.rejects(readZipIndex(file), error => error && error.code === 'RESTORE_ARCHIVE_INVALID');
});

test('v7.80 · wrapper klasörü + directory entry + deflate/data-descriptor içeren Full Backup güvenle normalize edilir', async t => {
  const { root } = await makeRoots(t), archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const wrapped = path.join(root, 'wrapped-standard.zip');
  await rewrapAsStandardDeflateZip(archive.path, wrapped);
  const info = await inspectBackupArchive(wrapped, { requireType: 'full' });
  assert.equal(info.manifest.backup_type, 'full');
  assert.equal(info.fileCount, archive.fileCount - 1);
  assert.ok(info.records.some(item => item.name === 'system/server-data/new-server.json'));
  const index = await readZipIndex(wrapped);
  assert.equal(index.wrapperPrefix, 'BuyerLog_FullBackup_20260914-1850');
  assert.equal(index.records.some(item => item.name.startsWith('BuyerLog_FullBackup_')), false);
});

test('v7.80 · wrapper klasörlü standart ZIP gerçek Full Restore akışında da çalışır', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root); t.after(() => archive.cleanup());
  const wrapped = path.join(root, 'wrapped-restore.zip'); await rewrapAsStandardDeflateZip(archive.path, wrapped);
  const deps = makeDependencies({ roots, securityFile, syncFile });
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  const result = await service.restore(wrapped, { actor: { id: 'moderator', systemRole: 'moderator' } });
  t.after(() => result.safetyArchive && result.safetyArchive.cleanup());
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'new-server.json')), true);
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'old-server.json')), false);
  assert.equal(result.verification.checks.localDb, true);
});


test('v7.80 · backup verisi içindeki ek manifest.json dosyaları ana manifest ile karıştırılmaz', async t => {
  const { root } = await makeRoots(t);
  const archive = await makeFullArchive(root, { includeNestedManifest: true });
  t.after(() => archive.cleanup());
  const info = await inspectBackupArchive(archive.path, { requireType: 'full' });
  assert.equal(info.manifest.backup_type, 'full');
  assert.ok(info.records.some(item => item.name === 'system/server-data/cache/manifest.json'));
  assert.ok(info.records.some(item => item.name === 'system/app-data/projection/manifest.json'));
});

test('v7.80 · wrapper altında nested manifest.json dosyaları varken köke en yakın manifest ana backup manifesti seçilir', async t => {
  const { root } = await makeRoots(t);
  const archive = await makeFullArchive(root, { includeNestedManifest: true });
  t.after(() => archive.cleanup());
  const wrapped = path.join(root, 'wrapped-with-nested-manifests.zip');
  await rewrapAsStandardDeflateZip(archive.path, wrapped, 'BuyerLog_FullBackup_20260914-1850');
  const index = await readZipIndex(wrapped);
  assert.equal(index.wrapperPrefix, 'BuyerLog_FullBackup_20260914-1850');
  const info = await inspectBackupArchive(wrapped, { requireType: 'full' });
  assert.equal(info.manifest.backup_type, 'full');
  assert.ok(info.records.some(item => item.name === 'system/server-data/cache/manifest.json'));
  assert.ok(info.records.some(item => item.name === 'system/app-data/projection/manifest.json'));
});


test('v7.80 · çok dosyalı multi-GB backup için manifest limiti dosya sayısıyla ölçeklenir ve 64 MB güvenlik tavanında kalır', () => {
  assert.equal(manifestLimitForIndex({ records: new Array(2) }), 4 * 1024 * 1024);
  assert.ok(manifestLimitForIndex({ records: new Array(10001) }) >= 20 * 1024 * 1024);
  assert.equal(manifestLimitForIndex({ records: new Array(50001) }), 64 * 1024 * 1024);
});

test('v7.80 · 2 MB eski sınırını aşan geçerli Full Backup manifesti restore preflight tarafından kabul edilir', async t => {
  const { root } = await makeRoots(t);
  const archive = await createBackupArchive({
    entries: [{ name: 'system/server-data/tiny.json', buffer: Buffer.from('{"ok":true}'), stage: 'data' }],
    manifest: {
      app_version: '7.0.80',
      created_at: '2026-09-14T20:32:00.000Z',
      backup_type: 'full',
      user: { id: 'moderator' },
      device: { hostname: 'TEST-PC', platform: 'win32', arch: 'x64' },
      // Eski restore 2 MB sabit limit nedeniyle burada reddediyordu.
      compatibility_padding: 'x'.repeat(3 * 1024 * 1024),
    },
    filename: 'BuyerLog_FullBackup_large-manifest.zip',
  });
  t.after(() => archive.cleanup());
  const info = await inspectBackupArchive(archive.path, { requireType: 'full', validateData: true });
  assert.equal(info.manifest.backup_type, 'full');
  assert.ok(Buffer.byteLength(JSON.stringify(info.manifest), 'utf8') > 2 * 1024 * 1024);
});

test('v7.80 · Full Restore manifestinde tanımsız içerik sessizce atlanmaz', async t => {
  const { root, roots } = await makeRoots(t), securityFile = path.join(root, 'auth', 'user-access.json'), syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  await seedCurrent(roots, securityFile, syncFile);
  const archive = await makeFullArchive(root, { includeUnknownContent: true }); t.after(() => archive.cleanup());
  const deps = makeDependencies({ roots, securityFile, syncFile });
  const service = createFullRestoreService({ appVersion: '7.0.80', roots, localDb: createLocalDb(roots.localDbFile), securityFile, ...deps });
  await assert.rejects(service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false }), error => error && error.code === 'RESTORE_UNHANDLED_CONTENT');
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'old-server.json')), true);
});

test('v7.80 · canlı sunucu Full Restore servisine taşınabilir config hedefini verir', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(serverSource, /const fullRestoreRoots\s*=\s*\{[^}]*configPath:\s*CONFIG_PATH/s);
});
