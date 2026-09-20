'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function profile(id, role = 'buyer', hash = '') {
  return {
    id,
    username: id,
    displayName: id,
    role,
    systemRole: role,
    orgLevel: role === 'moderator' ? 'manager' : 'job_title',
    status: 'ACTIVE',
    enabled: true,
    managerId: role === 'moderator' ? null : 'moderator',
    supervisorId: role === 'moderator' ? null : 'moderator',
    passwordHash: hash,
    pinHash: hash,
    directPermissions: [],
    temporaryPermissions: [],
    collectionAccess: [],
    permissions: {},
    accessAreas: {},
    mags: [], mmygs: [], buyingGroups: [],
  };
}

test('v7.83 · 441 kullanıcı restore seed legacy 47-kullanıcı auth deposu tarafından küçültülmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-restore-441-47-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const serverRoot = path.join(root, 'server'), appRoot = path.join(root, 'app'), localRoot = path.join(root, 'local'), authRoot = path.join(root, 'auth');
  for (const dir of [serverRoot, appRoot, localRoot, authRoot]) await fsp.mkdir(dir, { recursive: true });
  const configPath = path.join(root, 'config.json');
  await fsp.writeFile(configPath, JSON.stringify({ centralIamEnabled: false }));
  await fsp.writeFile(path.join(localRoot, 'sync-settings.json'), JSON.stringify({ sharedSyncRoot: '', localDbPath: path.join(localRoot, 'BuyerLogLocal.db'), deviceId: 'new-pc' }));
  Object.assign(process.env, {
    BUYER_LOG_SERVER_DATA_ROOT: serverRoot,
    BUYER_LOG_DATA_ROOT: appRoot,
    BUYER_LOG_LOCAL_DATA_ROOT: localRoot,
    BUYER_LOG_AUTH_DATA_ROOT: authRoot,
    BUYER_LOG_CONFIG_PATH: configPath,
    BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
  });
  const access = require('../server/lib/user-access');
  const hash = access.hashPin('existing-password');
  const existing47 = access.iam.migrateStore({
    schemaVersion: 8,
    _revision: 999,
    moderator: profile('moderator', 'moderator', hash),
    users: Array.from({ length: 46 }, (_, i) => profile(`user-${i}`, 'buyer', hash)),
    orderAccess: {}, scopeCatalog: {},
  });
  await fsp.writeFile(access.ACCESS_FILE, JSON.stringify(existing47));
  // Legacy aday özellikle daha yüksek revision ve credential kalitesine sahip;
  // restore seed koruması olmasa loadStore bunu geri içeri alırdı.
  await fsp.writeFile(path.join(serverRoot, 'user-access.json'), JSON.stringify(existing47));

  const snapshot = access.backupSafeStore(access.iam.migrateStore({
    schemaVersion: 8,
    _revision: 12,
    moderator: profile('moderator', 'moderator', 'removed'),
    users: Array.from({ length: 440 }, (_, i) => profile(`user-${i}`, 'buyer', 'removed')),
    orderAccess: {}, scopeCatalog: {},
  }));
  const userAccess = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const result = await userAccess.restoreBackupSnapshot(snapshot, { centralIamExpected: true });
  assert.equal(result.applied, true);
  assert.equal(result.recoverySeed, true);
  assert.equal(result.restoredUsers, 441);
  const profiles = userAccess.allPublicProfiles();
  assert.equal(profiles.length, 441);
  assert.equal(profiles.some(item => item.id === 'user-439'), true);
  const raw = JSON.parse(await fsp.readFile(access.ACCESS_FILE, 'utf8'));
  assert.equal(raw._restoreSeed.kind, 'full-system-backup');
  assert.equal(raw.users.length, 440);
});
