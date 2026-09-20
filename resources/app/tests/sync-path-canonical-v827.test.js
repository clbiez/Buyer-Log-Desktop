'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

test('canonical sync pathleri legacy ayarlardan migrate edilir ve dosyaya canonical yazılır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-path-v827-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'local', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await fsp.mkdir(path.dirname(sync.file), { recursive: true });
  await fsp.writeFile(sync.file, JSON.stringify({ localDbFolder: path.join(root, 'legacy-local'), sharedSyncFolder: path.join(root, 'shared') }));

  const migrated = await sync.read();
  assert.equal(migrated.localDbPath, path.join(root, 'legacy-local', 'BuyerLogLocal.db'));
  assert.equal(migrated.sharedSyncRoot, path.resolve(root, 'shared'));
  const persisted = JSON.parse(await fsp.readFile(sync.file, 'utf8'));
  assert.equal(persisted.localDbPath, path.join(root, 'legacy-local', 'BuyerLogLocal.db'));
  assert.equal(persisted.sharedSyncRoot, path.resolve(root, 'shared'));
  assert.equal(Object.hasOwn(persisted, 'localDbFolder'), false);
  assert.equal(Object.hasOwn(persisted, 'sharedSyncFolder'), false);
});

test('Sync Status gerçek Local DB dosyasını ve Shared Sync Rootu salt okunur gösterir', () => {
  assert.match(APP, /q\.localDbPath/);
  assert.match(APP, /q\.sharedSyncRoot/);
  assert.doesNotMatch(APP, /void addEditableSyncDbFolder\(\)/);
  assert.match(SERVER, /localDbPath: localDb\.getFile\(\)/);
  assert.match(SERVER, /sharedSyncRoot/);
  assert.match(SERVER, /markStartup\('LOCAL_DB_CONFIG_PATH'/);
  assert.match(SERVER, /markStartup\('LOCAL_DB_ACTIVE_CONNECTION'/);
  assert.match(SERVER, /markStartup\('SHARED_SYNC_ROOT'/);
});

test('canonical Local DB yolu seçilen dosya adından bağımsız olarak BuyerLogLocal.db kalır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-sync-path-file-v827-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'default', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  const settings = await sync.save(path.join(root, 'shared'), path.join(root, 'chosen', 'different-name.db'));
  assert.equal(settings.localDbPath, path.join(root, 'chosen', 'BuyerLogLocal.db'));
  assert.equal(settings.sharedSyncRoot, path.join(root, 'shared'));
});
