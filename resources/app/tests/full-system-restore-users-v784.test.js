'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const central = require('../server/lib/central-iam');
const iam = require('../server/lib/iam-core');

function profile(id, role = 'buyer', hash = '') {
  return { id, username: id, displayName: id, role, systemRole: role,
    orgLevel: role === 'moderator' ? 'manager' : 'job_title', status: 'ACTIVE', enabled: true,
    managerId: role === 'moderator' ? null : 'moderator', supervisorId: role === 'moderator' ? null : 'moderator',
    passwordHash: hash, pinHash: hash, directPermissions: [], temporaryPermissions: [], collectionAccess: [],
    permissions: {}, accessAreas: {}, mags: [], mmygs: [], buyingGroups: [] };
}
function store(count, hash) {
  return iam.migrateStore({ schemaVersion: 8, _revision: 10,
    moderator: profile('moderator', 'moderator', hash),
    users: Array.from({ length: count - 1 }, (_, i) => profile(`user-${i}`, 'buyer', hash)),
    orderAccess: {}, scopeCatalog: {} });
}

test('v7.84 · Central IAM .bak içindeki 47 kullanıcı restore edilen 441-kullanıcı seedini ezmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-restore-central-bak-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const serverRoot = path.join(root, 'server'), appRoot = path.join(root, 'app'), localRoot = path.join(root, 'local'), authRoot = path.join(root, 'auth'), sharedRoot = path.join(root, 'shared');
  for (const dir of [serverRoot, appRoot, localRoot, authRoot, sharedRoot]) await fsp.mkdir(dir, { recursive: true });
  const cacheFile = path.join(authRoot, 'user-access.json');
  const hash = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
  const centralWriter = central.createCentralIam({ sharedRoot, cacheFile });
  await centralWriter.initialize(store(47, hash), { id: 'moderator', displayName: 'moderator' });
  assert.equal(centralWriter.readLocal().users.length + 1, 47);
  assert.equal(fs.existsSync(cacheFile + '.bak'), true);
  // Restore sırasında merkezi share erişilemez olsun; eski 47'li cache/.bak diskte kalsın.
  await fsp.rename(sharedRoot, sharedRoot + '-offline');
  const configPath = path.join(root, 'config.json');
  await fsp.writeFile(configPath, JSON.stringify({ centralIamEnabled: true }));
  await fsp.writeFile(path.join(localRoot, 'sync-settings.json'), JSON.stringify({ sharedSyncRoot: sharedRoot, localDbPath: path.join(localRoot, 'BuyerLogLocal.db'), deviceId: 'new-pc' }));
  Object.assign(process.env, {
    BUYER_LOG_SERVER_DATA_ROOT: serverRoot,
    BUYER_LOG_DATA_ROOT: appRoot,
    BUYER_LOG_LOCAL_DATA_ROOT: localRoot,
    BUYER_LOG_AUTH_DATA_ROOT: authRoot,
    BUYER_LOG_CONFIG_PATH: configPath,
    BUYER_LOG_CENTRAL_IAM_ENABLED: '1',
  });
  const access = require('../server/lib/user-access');
  const snapshot = access.backupSafeStore(store(441, 'removed'));
  const userAccess = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const result = await userAccess.restoreBackupSnapshot(snapshot, { centralIamExpected: true });
  assert.equal(result.applied, true);
  assert.equal(result.recoverySeed, true);
  assert.equal(result.restoredUsers, 441);
  const profiles = userAccess.allPublicProfiles();
  assert.equal(profiles.length, 441);
  assert.equal(profiles.some(item => item.id === 'user-439'), true);
  const raw = JSON.parse(await fsp.readFile(cacheFile, 'utf8'));
  assert.equal(raw._restoreSeed.kind, 'full-system-backup');
  assert.equal(raw.users.length, 440);
});
