'use strict';
// Regression: Shared Hub OneDrive'dan eşitlenen cihazda kullanıcı listesi boş
// kalıyordu. (1) OneDrive "Files On-Demand" klasörleri Windows'ta reparse point
// olduğu için Dirent.isDirectory()=false döner; IAM revizyonları görünmüyordu.
// (2) Merkezi dizin + yerel önbellek ikisi birden yokken giriş tamamen
// kapanıyordu; artık bu cihazda giriş yapmış kişinin kendi kişisel kaydı
// son çare giriş kaynağıdır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');
const { createPersonalLoginCache } = require('../server/lib/personal-login-cache');

function verifier(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function seed() {
  const admin = verifier('Test-admin-123'), buyer = verifier('Buyer-pass-123');
  return iam.migrateStore({ schemaVersion: 8, _revision: 1,
    moderator: { id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', systemRole: 'moderator', enabled: true, status: 'ACTIVE',
      passwordHash: admin, pinHash: admin, title: 'Admin', orgLevel: 'manager', managerId: null, supervisorId: null, directPermissions: [], temporaryPermissions: [],
      collectionAccess: [], accessAreas: {}, permissions: {}, mags: [], mmygs: [], buyingGroups: [] },
    users: [{ id: 'buyer-1', username: 'dilan.der', displayName: 'Dilan', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE',
      passwordHash: buyer, pinHash: buyer, title: 'Buyer', orgLevel: 'job_title', managerId: 'moderator', supervisorId: 'moderator', directPermissions: [], temporaryPermissions: [],
      collectionAccess: [], accessAreas: {}, permissions: {}, mags: [], mmygs: [], buyingGroups: [] }] });
}

test('IAM head accepts OneDrive reparse-point revision folders (reported as symlinks)', { skip: process.platform === 'win32' }, async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-iam-onedrive-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sharedRoot = path.join(root, 'shared'); await fsp.mkdir(sharedRoot);
  const writer = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'a', 'user-access.json') });
  await writer.initialize(seed(), { id: 'moderator' });
  const revisions = path.join(sharedRoot, 'iam', 'revisions');
  for (const name of fs.readdirSync(revisions)) {
    const real = path.join(root, 'cloud', name);
    fs.mkdirSync(path.dirname(real), { recursive: true });
    fs.renameSync(path.join(revisions, name), real);
    fs.symlinkSync(real, path.join(revisions, name), 'dir');
  }
  assert.ok(fs.readdirSync(revisions, { withFileTypes: true }).every(entry => entry.isSymbolicLink() && !entry.isDirectory()));
  const reader = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'b', 'user-access.json') });
  const store = await reader.refresh();
  assert.equal(store._revision, 1);
  assert.deepEqual([store.moderator, ...store.users].map(u => u.username).sort(), ['admin', 'dilan.der']);
});

test('personal login cache keeps only verified own profiles and follows the authoritative directory', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-personal-login-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const cache = createPersonalLoginCache({ file: path.join(root, 'personal-login.json') });
  const store = seed();
  assert.equal(cache.remember({ ...store.users[0], passwordHash: '', pinHash: '' }, store), false, 'no verifier → not stored');
  assert.equal(cache.remember(store.users[0], store), true);
  assert.deepEqual(cache.profiles().map(p => p.id), ['buyer-1'], 'only the signed-in person is written');
  assert.ok(cache.iamState() && cache.iamState().roles);
  const changed = JSON.parse(JSON.stringify(store)); changed.users[0].displayName = 'Dilan D.';
  cache.reconcile(changed);
  assert.equal(cache.profiles()[0].displayName, 'Dilan D.');
  changed.users[0].enabled = false; changed.users[0].status = 'INACTIVE';
  cache.reconcile(changed);
  assert.deepEqual(cache.profiles(), [], 'disabled users lose the offline fallback');
  if (process.platform !== 'win32') assert.equal(fs.statSync(cache.file).mode & 0o777, 0o600);
});

test('Central IAM: lost local cache + unreachable directory still lets the person who signed in here log in', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-personal-api-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const auth = path.join(root, 'device', 'auth'); fs.mkdirSync(auth, { recursive: true });
  fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(seed()));
  const child = fork(path.join(__dirname, 'helpers', 'iam-device.js'), [], { env: { ...process.env,
    BUYER_LOG_AUTH_DATA_ROOT: auth, BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'device', 'server'), BUYER_LOG_DATA_ROOT: path.join(root, 'device', 'data'),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'device', 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, 'device', 'config.json'),
    BUYER_LOG_PORTABLE_DATA_ROOT: path.join(root, 'device', 'portable-data'),
    BUYER_LOG_CENTRAL_IAM_ENABLED: '1', BUYER_LOG_IAM_SHARED_ROOT: shared }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  t.after(async () => { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } fs.rmSync(root, { recursive: true, force: true }); });
  const [{ port }] = await once(child, 'message');
  const cookies = new Map();
  async function request(url, method = 'GET', body, who = 'admin') {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookies.get(who) || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const cookie = response.headers.get('set-cookie'); if (cookie) cookies.set(who, cookie.split(';')[0]);
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' })).status, 200);
  assert.equal((await request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true })).status, 200);
  assert.equal((await request('/api/user-login', 'POST', { username: 'dilan.der', password: 'Buyer-pass-123' }, 'buyer')).status, 200);
  const personal = JSON.parse(fs.readFileSync(path.join(auth, 'personal-login.json'), 'utf8'));
  assert.deepEqual(personal.entries.map(entry => entry.username).sort(), ['admin', 'dilan.der']);

  // Güncelleme sonrası durum: yerel IAM önbelleği yok, Shared Hub dizini okunamıyor.
  for (const name of fs.readdirSync(auth)) if (/^user-access/.test(name)) fs.rmSync(path.join(auth, name));
  fs.renameSync(shared, shared + '-offline');
  cookies.clear();
  const wrong = await request('/api/user-login', 'POST', { username: 'dilan.der', password: 'wrong-password' }, 'buyer');
  assert.equal(wrong.status, 401, JSON.stringify(wrong));
  const login = await request('/api/user-login', 'POST', { username: 'dilan.der', password: 'Buyer-pass-123' }, 'buyer');
  assert.equal(login.status, 200, JSON.stringify(login));
  assert.equal((await request('/api/current-user', 'GET', undefined, 'buyer')).body.user.username, 'dilan.der');
  assert.equal((await request('/api/user-login', 'POST', { username: 'someone.else', password: 'Buyer-pass-123' }, 'x')).status, 401);
});
