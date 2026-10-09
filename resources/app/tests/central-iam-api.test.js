'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const iam = require('../server/lib/iam-core');
function seed() {
  const salt = crypto.randomBytes(16), hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Test-admin-123', salt, 32).toString('hex')}`;
  return iam.migrateStore({ schemaVersion: 8, _revision: 1, moderator: { id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', enabled: true, passwordHash: hash, pinHash: hash, title: 'Admin' }, users: [] });
}
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-iam-api-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const children = [];
  t.after(async () => { for (const child of children) { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } } fs.rmSync(root, { recursive: true, force: true }); });
  async function device(name, initial, options = {}) {
    const auth = path.join(root, name, 'auth'); fs.mkdirSync(auth, { recursive: true });
    const serverData = path.join(root, name, 'server');
    const portableDataRoot = path.join(root, name, 'portable-data');
    if (initial) fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(initial));
    if (options.legacyInitial) {
      fs.mkdirSync(serverData, { recursive: true });
      fs.writeFileSync(path.join(serverData, 'user-access.json'), JSON.stringify(options.legacyInitial));
    }
    if (options.portableBackupInitial) {
      const backupAuth = path.join(path.dirname(portableDataRoot), 'data-BACKUP-20260921', 'app', 'auth');
      fs.mkdirSync(backupAuth, { recursive:true });
      fs.writeFileSync(path.join(backupAuth, 'user-access.json'), JSON.stringify(options.portableBackupInitial));
    }
    if (options.resourcesDataInitial) {
      const legacyAuth = path.join(path.dirname(portableDataRoot), 'resources', 'app', 'data', 'app', 'auth');
      fs.mkdirSync(legacyAuth, { recursive:true });
      fs.writeFileSync(path.join(legacyAuth, 'user-access.json'), JSON.stringify(options.resourcesDataInitial));
    }
    if (options.siblingInstallInitial) {
      const siblingAuth = path.join(root, 'Buyer-Log-Desktop-OLD', 'data', 'app', 'auth');
      fs.mkdirSync(siblingAuth, { recursive:true });
      fs.writeFileSync(path.join(siblingAuth, 'user-access.json'), JSON.stringify(options.siblingInstallInitial));
    }
    if (options.nestedEvidenceInitial) {
      const evidence = path.join(portableDataRoot, 'migration-evidence', 'legacy-auth-folder', 'archived', 'auth');
      fs.mkdirSync(evidence, { recursive:true });
      fs.writeFileSync(path.join(evidence, 'selected-20260921-user-access.json'), JSON.stringify(options.nestedEvidenceInitial));
    }
    const child = fork(path.join(__dirname, 'helpers', 'iam-device.js'), [], { env: { ...process.env,
      BUYER_LOG_AUTH_DATA_ROOT: auth, BUYER_LOG_SERVER_DATA_ROOT: serverData, BUYER_LOG_DATA_ROOT: path.join(root, name, 'data'),
      BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, name, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, name, 'config.json'),
      BUYER_LOG_PORTABLE_DATA_ROOT: portableDataRoot,
      BUYER_LOG_CENTRAL_IAM_ENABLED: '1', BUYER_LOG_IAM_SHARED_ROOT: shared }, stdio: ['ignore','pipe','pipe','ipc'] });
    children.push(child); const [{ port }] = await once(child, 'message');
    const cookies = new Map();
    async function request(url, method = 'GET', body, who = 'admin') {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookies.get(who) || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const cookie = response.headers.get('set-cookie'); if (cookie) cookies.set(who, cookie.split(';')[0]);
      return { status: response.status, body: await response.json() };
    }
    async function refresh() { const done = once(child, 'message'); child.send('refresh'); await done; }
    return { request, refresh, auth };
  }
  return { device, shared };
}
test('Central IAM offline login recovers legacy auth and accepts a credentialed non-Moderator account', async t => {
  const { device, shared } = await setup(t);
  const legacy = seed();
  const verifier = legacy.moderator.passwordHash;
  legacy.moderator.passwordHash = '';
  legacy.moderator.pinHash = '';
  legacy.users = [{
    id: 'buyer-local', username: 'gokberk.celebi', displayName: 'Gökberk Çelebi',
    role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE',
    passwordHash: verifier, pinHash: verifier, title: 'Buyer',
    managerId: 'moderator', supervisorId: 'moderator',
  }];
  const local = iam.migrateStore(legacy);
  const client = await device('legacy-offline', null, { legacyInitial: local });

  fs.renameSync(shared, shared + '-offline');
  const login = await client.request('/api/user-login', 'POST', {
    username: 'gokberk.celebi', password: 'Test-admin-123',
  }, 'buyer');
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal(login.body.user.username, 'gokberk.celebi');
  assert.ok(fs.existsSync(path.join(client.auth, 'user-access.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(client.auth, 'user-access.json'))).users.length, 1);
});

test('packaged desktop recovers user store from data-BACKUP even when SERVER_DATA_ROOT env is set', async t => {
  const { device, shared } = await setup(t);
  const backup = seed();
  const verifier = backup.moderator.passwordHash;
  backup.moderator.passwordHash = '';
  backup.moderator.pinHash = '';
  backup.users = [{
    id:'buyer-backup', username:'gokberk.celebi', displayName:'Gökberk Çelebi',
    role:'buyer', systemRole:'buyer', enabled:true, status:'ACTIVE',
    passwordHash:verifier, pinHash:verifier, title:'Buyer',
    managerId:'moderator', supervisorId:'moderator',
  }];
  const client = await device('portable-backup', null, { portableBackupInitial:iam.migrateStore(backup) });

  fs.renameSync(shared, shared + '-offline');
  const login = await client.request('/api/user-login', 'POST', {
    username:'gokberk.celebi', password:'Test-admin-123',
  }, 'buyer');
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal(login.body.user.username, 'gokberk.celebi');
  const recovered = JSON.parse(fs.readFileSync(path.join(client.auth, 'user-access.json'), 'utf8'));
  assert.equal(recovered.users.length, 1);
  assert.equal(recovered.users[0].username, 'gokberk.celebi');
});

test('packaged desktop recovers user store from resources/app/data legacy layout', async t => {
  const { device, shared } = await setup(t);
  const legacy = seed();
  const verifier = legacy.moderator.passwordHash;
  legacy.moderator.passwordHash = '';
  legacy.moderator.pinHash = '';
  legacy.users = [{
    id:'buyer-resource', username:'gokberk.celebi', displayName:'Gökberk Çelebi',
    role:'buyer', systemRole:'buyer', enabled:true, status:'ACTIVE',
    passwordHash:verifier, pinHash:verifier, title:'Buyer',
    managerId:'moderator', supervisorId:'moderator',
  }];
  const client = await device('resource-layout', null, { resourcesDataInitial:iam.migrateStore(legacy) });
  fs.renameSync(shared, shared + '-offline');
  const login = await client.request('/api/user-login', 'POST', { username:'gokberk.celebi', password:'Test-admin-123' }, 'buyer');
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal(login.body.user.username, 'gokberk.celebi');
});

test('packaged desktop discovers an older sibling Buyer Log installation even with SERVER_DATA_ROOT set', async t => {
  const { device, shared } = await setup(t);
  const legacy = seed();
  const verifier = legacy.moderator.passwordHash;
  legacy.moderator.passwordHash = '';
  legacy.moderator.pinHash = '';
  legacy.users = [{
    id:'buyer-sibling', username:'gokberk.celebi', displayName:'Gökberk Çelebi',
    role:'buyer', systemRole:'buyer', enabled:true, status:'ACTIVE',
    passwordHash:verifier, pinHash:verifier, title:'Buyer',
    managerId:'moderator', supervisorId:'moderator',
  }];
  const client = await device('current-install', null, { siblingInstallInitial:iam.migrateStore(legacy) });
  fs.renameSync(shared, shared + '-offline');
  const login = await client.request('/api/user-login', 'POST', { username:'gokberk.celebi', password:'Test-admin-123' }, 'buyer');
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal(login.body.user.username, 'gokberk.celebi');
});

test('packaged desktop recursively recovers nested migration-evidence auth copies', async t => {
  const { device, shared } = await setup(t);
  const legacy = seed();
  const verifier = legacy.moderator.passwordHash;
  legacy.moderator.passwordHash = '';
  legacy.moderator.pinHash = '';
  legacy.users = [{
    id:'buyer-evidence', username:'gokberk.celebi', displayName:'Gökberk Çelebi',
    role:'buyer', systemRole:'buyer', enabled:true, status:'ACTIVE',
    passwordHash:verifier, pinHash:verifier, title:'Buyer',
    managerId:'moderator', supervisorId:'moderator',
  }];
  const client = await device('nested-evidence', null, { nestedEvidenceInitial:iam.migrateStore(legacy) });
  fs.renameSync(shared, shared + '-offline');
  const login = await client.request('/api/user-login', 'POST', { username:'gokberk.celebi', password:'Test-admin-123' }, 'buyer');
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal(login.body.user.username, 'gokberk.celebi');
});

test('Central IAM acceptance: create, second PC login, CP revoke/403, reset, offline login and reconnect', async t => {
  const { device, shared } = await setup(t), a = await device('a', seed()), b = await device('b');
  assert.equal((await a.request('/api/users/admin')).status, 401);
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' })).status, 503);
  assert.equal((await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' })).status, 200);
  let r = await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true }); assert.equal(r.status, 200, JSON.stringify(r));
  const created = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'buyer', displayName: 'Buyer', title: 'Buyer', managerId: 'moderator', password: 'Old-password-123' });
  assert.equal(created.status, 201, JSON.stringify(created)); const id = created.body.user.id;
  await b.refresh();
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'Old-password-123' }, 'buyer')).status, 200);
  assert.equal((await b.request('/api/users/admin', 'GET', undefined, 'buyer')).status, 403);
  assert.equal((await b.request('/api/cp-probe', 'GET', undefined, 'buyer')).status, 200);
  r = await a.request(`/api/users/${id}`, 'PUT', { expectedRevision: 2, systemRole: 'manager', role: 'manager', reason: 'Acceptance promotion' }); assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  // v20261009: yetki değişimi oturumu düşürmez; yeni rol aynı oturumda hemen geçerlidir.
  r = await b.request('/api/current-user', 'GET', undefined, 'buyer');
  assert.equal(r.body.selected, true);
  assert.equal(r.body.user.systemRole, 'manager');
  const directory = await a.request('/api/users/admin');
  const roles = directory.body.roleDefinitions; roles.manager.permissions = roles.manager.permissions.filter(p => p !== 'CP.VIEW');
  r = await a.request('/api/iam/roles', 'PUT', { expectedRevision: 3, roles, confirmCritical: true, reason: 'Restrict CP' }); assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  // Kısıtlama aynı oturumda, yeniden giriş gerekmeden sunucuda uygulanır.
  r = await b.request('/api/current-user', 'GET', undefined, 'buyer');
  assert.equal(r.body.selected, true);
  assert.equal(r.body.user.accessAreas.cp, false);
  assert.equal((await b.request('/api/cp-probe', 'GET', undefined, 'buyer')).status, 403);
  r = await a.request(`/api/users/${id}`, 'PUT', { expectedRevision: 4, password: 'New-password-123', confirmCritical: true }); assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  assert.equal((await b.request('/api/current-user', 'GET', undefined, 'buyer')).body.selected, false);
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'Old-password-123' }, 'buyer')).status, 401);
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'New-password-123' }, 'buyer')).status, 200);
  const metrics = (await b.request('/api/metrics', 'GET', undefined, 'buyer')).body;
  for (let i = 0; i < 100; i++) await b.request('/api/cp-probe', 'GET', undefined, 'buyer');
  assert.equal((await b.request('/api/metrics', 'GET', undefined, 'buyer')).body.remoteReads, metrics.remoteReads);
  fs.renameSync(shared, shared + '-offline');
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'New-password-123' }, 'buyer')).status, 200);
  r = await a.request(`/api/users/${id}`, 'PUT', { expectedRevision: 5, displayName: 'Offline write' }); assert.equal(r.status, 503); assert.equal(r.body.code, 'IAM_OFFLINE');
  fs.renameSync(shared + '-offline', shared); await b.refresh();
  assert.equal((await b.request('/api/iam/health')).body.localRevision, 5);
  r = await a.request(`/api/users/${id}`, 'PUT', { expectedRevision: 5, enabled: false, status: 'INACTIVE', confirmCritical: true, reason: 'Acceptance disable' }); assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  assert.equal((await b.request('/api/current-user', 'GET', undefined, 'buyer')).body.selected, false);
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'New-password-123' }, 'buyer')).status, 403);
  const auditFiles = fs.readdirSync(path.join(shared, 'iam', 'revisions'));
  assert.equal(auditFiles.length, 6);
  for (const folder of auditFiles) assert.doesNotMatch(fs.readFileSync(path.join(shared, 'iam', 'revisions', folder, 'audit.json'), 'utf8'), /passwordHash|pinHash|Old-password|New-password|sessionSecret|token/i);
});
test('bulk updates are all-or-none and same-revision stale client cannot overwrite', async t => {
  const { device } = await setup(t), a = await device('a', seed()), b = await device('b');
  await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true });
  const r = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'target', title: 'Buyer', managerId: 'moderator', password: 'Password-123' }); assert.equal(r.status, 201);
  await b.refresh(); await b.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  const id = r.body.user.id;
  const bulk = await a.request('/api/iam/users/bulk', 'POST', { expectedRevision: 2, confirmCritical: true, changes: [{ id, patch: { displayName: 'Must not persist' } }, { id: 'missing', patch: { enabled: false } }] });
  assert.equal(bulk.status, 400);
  assert.equal((await a.request('/api/users/admin')).body.revision, 2);
  assert.equal((await a.request('/api/users/admin')).body.profiles.find(u => u.id === id).displayName, 'target');
  assert.equal((await a.request(`/api/users/${id}`, 'PUT', { expectedRevision: 2, displayName: 'First writer' })).status, 200);
  const stale = await b.request(`/api/users/${id}`, 'PUT', { expectedRevision: 2, displayName: 'Stale writer' });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'IAM_REVISION_CONFLICT');
});
