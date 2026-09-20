'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('v7.82 · backup config Central IAM açıkken runtime henüz kapalı olsa da kullanıcılar restart-safe recovery seed olur', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-restore-users-config-'));
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
  const moderatorHash = access.hashPin('current-admin-password');
  await fsp.writeFile(access.ACCESS_FILE, JSON.stringify({
    schemaVersion: 8, _revision: 1,
    moderator: { id: 'moderator', username: 'Gokberk', displayName: 'Gokberk', role: 'moderator', systemRole: 'moderator', orgLevel: 'manager', status: 'ACTIVE', enabled: true, passwordHash: moderatorHash, pinHash: moderatorHash },
    users: [], iam: access.iam.migrateStore({}).iam, orderAccess: {}, scopeCatalog: {},
  }));
  const userAccess = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const snapshot = access.backupSafeStore(access.iam.migrateStore({
    schemaVersion: 8, _revision: 9,
    moderator: { id: 'moderator', username: 'Gokberk', displayName: 'Gokberk', role: 'moderator', systemRole: 'moderator', orgLevel: 'manager', status: 'ACTIVE', enabled: true, passwordHash: 'removed', pinHash: 'removed' },
    users: [{ id: 'u2', username: 'Buyer Two', displayName: 'Buyer Two', role: 'buyer', systemRole: 'buyer', orgLevel: 'job_title', status: 'ACTIVE', enabled: true }],
    orderAccess: {}, scopeCatalog: {},
  }));
  const result = await userAccess.restoreBackupSnapshot(snapshot, { centralIamExpected: true });
  assert.equal(result.recoverySeed, true);
  assert.equal(result.restoredUsers, 2);
  const raw = JSON.parse(await fsp.readFile(access.ACCESS_FILE, 'utf8'));
  assert.equal(raw._restoreSeed.kind, 'full-system-backup');
  assert.equal(raw.users.some(user => user.id === 'u2'), true);
  assert.equal(raw.moderator.passwordHash, moderatorHash);
});
