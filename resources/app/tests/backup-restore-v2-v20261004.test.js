'use strict';

/*
 * Backup & Restore v2 regresyonları:
 *  - model dosyaları/görseller yedeğe girmez, restore onları silmez,
 *  - tam restore veri alanı bazında seçmelidir; seçilmeyen alanlar korunur,
 *  - günlük otomatik yedek iki hedefe yazar ve en fazla 3 gün saklar,
 *  - kapsam denylist'tir: yeni özellik verisi otomatik yedeklenir/seçilebilir.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBackupArchive } = require('../server/lib/backup-archive');
const { createFullRestoreService, recoverInterruptedRestoresSync, scopeDefinitions } = require('../server/lib/full-restore-service');
const { createLocalDb } = require('../server/lib/local-db');
const scope = require('../server/lib/backup-scope');
const { isSensitiveBackupPath } = require('../server/lib/backup-sensitivity');
const { createAutoBackupService, listFolder, dayKey } = require('../server/lib/auto-backup');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function tempDir(t, name) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `buyerlog-${name}-`));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}
function dbState(revision, label) {
  return { schemaVersion: 3, revision, deviceId: `${label}-device`, localSequence: 0, records: { [`${label}-record`]: { value: label } }, tombstones: {}, events: {}, appliedEvents: {}, appliedPackages: {}, conflicts: [], journal: [], syncCheckpoints: {}, syncLedger: {}, assets: {}, migrations: {} };
}
async function makeRoots(t) {
  const root = await tempDir(t, 'restore-v2');
  const roots = {
    serverDataRoot: path.join(root, 'server-data'), appDataRoot: path.join(root, 'app-data'), localDataRoot: path.join(root, 'local-data'),
    localDbFile: path.join(root, 'local-data', 'BuyerLogLocal.db'), modelFilesRoot: path.join(root, 'local-data', 'model-files'),
    collectionImagesRoot: path.join(root, 'local-data', 'collection-images'), qtxFilesRoot: path.join(root, 'local-data', 'qtx-files'), configPath: path.join(root, 'config.json'),
  };
  for (const folder of [roots.serverDataRoot, roots.appDataRoot, roots.localDataRoot, roots.modelFilesRoot, roots.collectionImagesRoot, roots.qtxFilesRoot]) await fsp.mkdir(folder, { recursive: true });
  return { root, roots };
}
function deps(roots) {
  const syncFile = path.join(roots.localDataRoot, 'sync-settings.json');
  fs.writeFileSync(syncFile, JSON.stringify({ deviceId: 'pc' }));
  return {
    syncSettings: { file: syncFile, pause() {}, resume() {}, async waitForIdle() {}, async restoreMetadata() { return { requiresSharedSyncSetup: false }; } },
    userAccess: { restoreBackupSnapshot() { return { applied: true }; }, allPublicProfiles() { return []; } },
    backupService: { async create() { throw new Error('safety backup not expected'); } },
  };
}
async function newFormatArchive(root) {
  const dbFile = path.join(root, 'archive-db.json');
  await fsp.writeFile(dbFile, JSON.stringify(dbState(42, 'restored')));
  return createBackupArchive({
    entries: [
      { name: 'system/server-data/quotations.json', buffer: Buffer.from('{"restored":"quotations"}'), stage: 'data' },
      { name: 'system/server-data/open-costing.json', buffer: Buffer.from('{"restored":"costing"}'), stage: 'data' },
      { name: 'system/server-data/new-feature-store.json', buffer: Buffer.from('{"restored":"feature"}'), stage: 'data' },
      { name: 'system/server-data/settings.json', buffer: Buffer.from('{"modelConnections":[]}'), stage: 'settings' },
      { name: 'system/local-data/BuyerLogLocal.db', sourcePath: dbFile, stage: 'data' },
      { name: 'system/config/config.json', buffer: Buffer.from('{"port":7000}'), stage: 'settings' },
    ],
    manifest: { app_version: '7.0.227', created_at: '2026-10-04T08:00:00.000Z', backup_type: 'full', user: { id: 'moderator' }, device: {}, heavy_assets_excluded: true, excluded_assets: { count: 2, bytes: 1024 } },
    filename: 'BuyerLog_FullBackup_v2.zip',
  });
}

test('v2 · model dosyaları, görseller ve ağır varlıklar yedek kapsamı dışında; iş verisi içeride', () => {
  for (const rel of ['model-files/M1/front.png', 'collection-images/a.jpg', 'checklist-attachments/x/photo.JPEG', 'plm/3d/model.glb', 'tech/pack.pdf', 'video/demo.mp4', 'archive.zip', 'model-snapshots/s.json']) {
    assert.equal(scope.isHeavyBackupPath(rel), true, rel);
  }
  for (const rel of ['quotations.json', 'user-source-data/u1/orders.xlsx', 'endeksmatik-snapshot.json.gz', 'BuyerLogLocal.db', 'collection-workspaces/u1.json']) {
    assert.equal(scope.isHeavyBackupPath(rel), false, rel);
    assert.equal(scope.skipBackupFile(rel, new Set(scope.BACKUP_EXCLUDED_TOP)), false, rel);
  }
  const excluded = new Set(scope.BACKUP_EXCLUDED_TOP);
  for (const rel of ['model-files/index.json', 'collection-images/x.json', 'page-cache/a.json', 'logs/x.log', 'auth/user-access.json', 'sync-settings.json', 'agent-browser/Default/Cookies']) {
    assert.equal(scope.skipBackupFile(rel, excluded), true, rel);
  }
  // Parola hash'i taşıyan hesap deposu türevleri ve IAM audit yedeğe girmez.
  for (const rel of ['user-access.pre-iam-migration.json', 'user-access.json.pre-migration.bak', 'user-access.meta.json', 'iam-audit.json']) {
    assert.equal(scope.skipBackupFile(rel, excluded), true, rel);
  }
  const service = read('server/lib/backup-service.js');
  assert.doesNotMatch(service, /MODEL_FILES_ROOT|COLLECTION_IMAGES_ROOT/);
  assert.match(service, /heavy_assets_excluded: true/);
});

test('v2 · yeni özellik verisi otomatik algılanır ve seçilebilir restore bileşeni olur', () => {
  const scopes = scopeDefinitions({ serverDataRoot: 's', appDataRoot: 'a', localDataRoot: 'l', modelFilesRoot: 'm', collectionImagesRoot: 'c', qtxFilesRoot: 'q' });
  const components = scope.componentsFromManifest({ contents: [
    { path: 'system/server-data/quotations.json', size: 10 },
    { path: 'system/server-data/collection-workspaces/u1.json', size: 5 },
    { path: 'system/server-data/collection-workspaces/u2.json', size: 7 },
    { path: 'system/server-data/brand-new-module.json', size: 3 },
    { path: 'system/local/BuyerLogLocal.db', size: 100 },
    { path: 'system/security/users-roles-permissions.json', size: 1 },
  ] }, scopes);
  const byId = Object.fromEntries(components.map(item => [item.id, item]));
  assert.equal(byId['serverData/collection-workspaces'].fileCount, 2);
  assert.equal(byId['serverData/collection-workspaces'].bytes, 12);
  assert.equal(byId['serverData/quotations.json'].category, 'pricing');
  assert.equal(byId['localData/BuyerLogLocal.db'].category, 'core');
  assert.equal(byId.security.category, 'system');
  assert.equal(byId['serverData/brand-new-module.json'].auto, true);
  assert.equal(byId['serverData/brand-new-module.json'].category, 'other');
  for (const item of components) assert.ok(item.labelTr && item.labelEn, item.id);
});

test('v2 · kapsam bekçisi: veri köklerine yazan her sabit ad etiketli veya bilinçli olarak hariç', () => {
  // Kapsam denylist olduğu için yeni veri zaten yedeklenir; bu test yeni bir
  // veri dosyasının katalogda okunabilir etiket almasını ya da bilinçli olarak
  // (önbellek/ağır varlık/sır) hariç tutulmasını zorunlu kılar.
  const files = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!['node_modules', 'data'].includes(entry.name)) walk(full); }
      else if (entry.name.endsWith('.js')) files.push(full);
    }
  })(path.join(ROOT, 'server'));
  const pattern = /path\.join\(\s*(?:[\w.]*\.)?(?:SERVER_DATA_ROOT|APP_DATA_ROOT|LOCAL_DATA_ROOT|serverDataRoot|appDataRoot|localDataRoot)\s*,\s*'([^']+)'/g;
  const missing = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(pattern)) {
      const name = match[1];
      if (scope.catalogEntry(name) || scope.BACKUP_EXCLUDED_TOP.includes(name) || isSensitiveBackupPath(name) || scope.isHeavyBackupPath(name)) continue;
      missing.push(`${path.relative(ROOT, file)} → ${name}`);
    }
  }
  assert.deepEqual(missing, [], 'Yeni veri alanını server/lib/backup-scope.js BACKUP_COMPONENT_CATALOG (TR/EN etiket) veya hariç listesine ekleyin.');
});

test('v2 · seçmeli tam restore yalnız seçilen alanı yazar; diğer veriler, DB ve görseller korunur', async t => {
  const { root, roots } = await makeRoots(t);
  await fsp.writeFile(path.join(roots.serverDataRoot, 'quotations.json'), '{"old":"quotations"}');
  await fsp.writeFile(path.join(roots.serverDataRoot, 'open-costing.json'), '{"old":"costing"}');
  await fsp.writeFile(path.join(roots.serverDataRoot, 'local-only.json'), '{"keep":true}');
  await fsp.writeFile(path.join(roots.serverDataRoot, 'logo.png'), 'png');
  await fsp.writeFile(roots.localDbFile, JSON.stringify(dbState(7, 'old')));
  await fsp.writeFile(path.join(roots.modelFilesRoot, 'tech.xlsx'), 'model-file');
  await fsp.writeFile(roots.configPath, '{"port":6194}');
  const archive = await newFormatArchive(root); t.after(() => archive.cleanup());
  const service = createFullRestoreService({ appVersion: '7.0.227', roots, localDb: createLocalDb(roots.localDbFile), ...deps(roots) });
  const plan = await service.inspect(archive.path);
  assert.ok(plan.components.some(item => item.id === 'serverData/quotations.json'));
  assert.ok(plan.components.some(item => item.id === 'serverData/new-feature-store.json' && item.auto));
  assert.equal(plan.heavyAssetsExcluded, true);
  assert.ok(Array.isArray(plan.componentCategories) && plan.componentCategories.length);

  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false, preflight: plan, components: ['serverData/quotations.json'] });
  assert.equal(result.applied.mode, 'selective');
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'quotations.json'), 'utf8'), '{"restored":"quotations"}');
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'open-costing.json'), 'utf8'), '{"old":"costing"}');
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'local-only.json')), true);
  assert.equal(fs.existsSync(path.join(roots.serverDataRoot, 'new-feature-store.json')), false);
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'logo.png'), 'utf8'), 'png');
  assert.equal(JSON.parse(await fsp.readFile(roots.localDbFile, 'utf8')).revision, 7);
  assert.equal(await fsp.readFile(roots.configPath, 'utf8'), '{"port":6194}');
  assert.equal(await fsp.readFile(path.join(roots.modelFilesRoot, 'tech.xlsx'), 'utf8'), 'model-file');
});

test('v2 · seçmeli restore arşivde olmayan alanı reddeder; ayna restore model dosyalarını silmez', async t => {
  const { root, roots } = await makeRoots(t);
  await fsp.writeFile(roots.localDbFile, JSON.stringify(dbState(7, 'old')));
  await fsp.writeFile(path.join(roots.modelFilesRoot, 'tech.xlsx'), 'model-file');
  await fsp.writeFile(path.join(roots.collectionImagesRoot, 'index.json'), '{"img":1}');
  await fsp.writeFile(roots.configPath, '{"port":6194}');
  const archive = await newFormatArchive(root); t.after(() => archive.cleanup());
  const service = createFullRestoreService({ appVersion: '7.0.227', roots, localDb: createLocalDb(roots.localDbFile), ...deps(roots) });
  await assert.rejects(service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false, components: ['serverData/missing.json'] }), error => error.code === 'RESTORE_SCOPE_UNAVAILABLE');
  await assert.rejects(service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false, components: [] }), error => error.code === 'RESTORE_SCOPE_EMPTY');
  const result = await service.restore(archive.path, { actor: { id: 'moderator', systemRole: 'moderator' }, createSafetyBackup: false });
  assert.equal(result.applied.mode, 'mirror');
  assert.equal(JSON.parse(await fsp.readFile(roots.localDbFile, 'utf8')).revision, 42);
  assert.equal(await fsp.readFile(path.join(roots.modelFilesRoot, 'tech.xlsx'), 'utf8'), 'model-file');
  assert.equal(await fsp.readFile(path.join(roots.collectionImagesRoot, 'index.json'), 'utf8'), '{"img":1}');
});

test('v2 · kesintiye uğrayan seçmeli restore kurtarması yalnız snapshot alınan alanı geri yazar', async t => {
  const { roots } = await makeRoots(t);
  await fsp.writeFile(path.join(roots.serverDataRoot, 'quotations.json'), '{"half":"written"}');
  await fsp.writeFile(path.join(roots.serverDataRoot, 'untouched.json'), '{"keep":true}');
  const tx = path.join(roots.localDataRoot, 'restore-recovery', 'tx-selective'), rollback = path.join(tx, 'rollback');
  await fsp.mkdir(path.join(rollback, 'scopes', 'serverData~quotations.json'), { recursive: true });
  await fsp.writeFile(path.join(rollback, 'scopes', 'serverData~quotations.json', 'quotations.json'), '{"before":"restore"}');
  await fsp.writeFile(path.join(rollback, 'manifest.json'), JSON.stringify({ scopes: { 'serverData~quotations.json': ['quotations.json'] }, specials: {}, touched: [{ id: 'serverData~quotations.json', baseId: 'serverData', onlyTop: 'quotations.json' }] }));
  await fsp.writeFile(path.join(tx, 'journal.json'), JSON.stringify({ journalVersion: 1, status: 'committing' }));
  const recovered = recoverInterruptedRestoresSync({ roots });
  assert.equal(recovered.recovered, 1);
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'quotations.json'), 'utf8'), '{"before":"restore"}');
  assert.equal(await fsp.readFile(path.join(roots.serverDataRoot, 'untouched.json'), 'utf8'), '{"keep":true}');
});

function fakeBackupService(root) {
  let counter = 0;
  return {
    calls: [],
    async create(options) {
      this.calls.push(options);
      const dir = path.join(root, `archive-${counter++}`); await fsp.mkdir(dir, { recursive: true });
      const file = path.join(dir, options.filename); await fsp.writeFile(file, `zip-${counter}`);
      return { path: file, filename: options.filename, size: 5, fileCount: 3, excludedAssets: { count: 1, bytes: 10 }, cleanup: () => fsp.rm(dir, { recursive: true, force: true }) };
    },
  };
}

test('v2 · günlük otomatik yedek kişisel klasör + Sync klasörüne yazar ve yalnız son 3 günü tutar', async t => {
  const root = await tempDir(t, 'auto-backup');
  const home = path.join(root, 'home'), hub = path.join(root, 'hub'), dataRoot = path.join(root, 'data');
  await fsp.mkdir(path.join(home, 'Documents'), { recursive: true }); await fsp.mkdir(hub, { recursive: true });
  let current = new Date(2026, 9, 1, 9, 0);
  const backupService = fakeBackupService(root);
  const service = createAutoBackupService({
    backupService, stateFile: path.join(dataRoot, 'auto-backup.json'), homeDir: home, forbiddenRoots: [dataRoot], appVersion: '7.0.227',
    syncSettings: { async read() { return { sharedSyncRoot: hub, deviceId: 'abcdef123456' }; } },
    sharedHub: { async validate(selected) { return { root: selected, manifest: {} }; } },
    now: () => current,
  });
  assert.equal(await service.isDue(), true);
  for (let day = 1; day <= 5; day++) {
    current = new Date(2026, 9, day, 9, 0);
    const run = await service.runNow({ reason: 'schedule' });
    assert.equal(run.results.local.ok, true); assert.equal(run.results.sync.ok, true);
  }
  assert.equal(backupService.calls.every(call => call.mode === 'full' && call.trusted === true && call.auto === true), true);
  const status = await service.status();
  const localFolder = path.join(home, 'Documents', 'Buyer Log Backups');
  assert.equal(status.localFolder, localFolder);
  assert.deepEqual((await listFolder(localFolder)).map(item => item.day), ['20261005', '20261004', '20261003']);
  const syncFolder = status.targets.sync.folder;
  assert.ok(syncFolder.startsWith(path.join(hub, 'auto-backups')));
  assert.deepEqual((await listFolder(syncFolder)).map(item => item.day), ['20261005', '20261004', '20261003']);
  assert.equal(fs.existsSync(path.join(localFolder, 'BuyerLog_AutoBackup_20261001.json')), false);
  // Aynı gün ikinci çalışma yeni dosya eklemez, günün yedeğini yeniler.
  await service.runNow({ reason: 'manual' });
  assert.equal((await listFolder(localFolder)).length, 3);
  assert.equal(await service.isDue(), false);
  current = new Date(2026, 9, 6, 0, 5);
  assert.equal(await service.isDue(), true);
  assert.equal(dayKey(current), '20261006');
});

test('v2 · otomatik yedek klasörü Buyer Log veri klasörlerinin dışında olmalı; Sync yoksa yerel hedef çalışır', async t => {
  const root = await tempDir(t, 'auto-backup-folder');
  const dataRoot = path.join(root, 'data'), outside = path.join(root, 'outside');
  const service = createAutoBackupService({ backupService: fakeBackupService(root), stateFile: path.join(dataRoot, 'auto-backup.json'), homeDir: root, forbiddenRoots: [dataRoot] });
  await assert.rejects(service.updateSettings({ localFolder: path.join(dataRoot, 'backups') }), error => error.code === 'AUTO_BACKUP_FOLDER_INSIDE_APP');
  await assert.rejects(service.updateSettings({ localFolder: 'relative/folder' }), error => error.code === 'AUTO_BACKUP_FOLDER_INVALID');
  const status = await service.updateSettings({ localFolder: outside });
  assert.equal(status.localFolder, outside);
  const run = await service.runNow();
  assert.equal(run.results.local.ok, true);
  assert.equal(run.results.sync.skipped, true);
  await assert.rejects(service.resolveBackupFile('local', '../evil.zip'), error => error.code === 'AUTO_BACKUP_FILE_INVALID');
  assert.ok(await service.resolveBackupFile('local', (await listFolder(outside))[0].filename));
  await service.updateSettings({ enabled: false });
  assert.equal(await service.isDue(), false);
});

test('v2 · sunucu ve arayüz otomatik yedek, listeden restore ve seçmeli tam restore sözleşmesini taşır', () => {
  const server = read('server/server.js'), ui = read('public/backup-manager.js');
  for (const route of ['/api/backups/auto/status', '/api/backups/auto/settings', '/api/backups/auto/run', '/api/backups/auto/download', '/api/backups/auto/restore/inspect']) assert.ok(server.includes(route), route);
  assert.match(server, /components: Array\.isArray\(req\.body && req\.body\.components\)/);
  assert.match(server, /autoBackupService\.start\(\)/);
  assert.match(ui, /data-full-restore-scope-id/);
  assert.match(ui, /JSON\.stringify\(\{ uploadId, createSafetyBackup: f\.safety, components \}\)/);
  assert.match(ui, /\/api\/backups\/auto\/restore\/inspect/);
  assert.match(ui, /bl:language-changed/);
  assert.match(read('server/lib/shared-personal-backup.js'), /MAX_AGE_MS = 3 \* 24 \* 60 \* 60 \* 1000/);
});
