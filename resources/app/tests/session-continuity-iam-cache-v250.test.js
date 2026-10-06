'use strict';
// Regression (7.0.250): kullanıcı Buyer Log'dan başka uygulamaya geçip
// döndüğünde giriş ekranına düşüyordu; merkezi kullanıcı dizini açıkken her
// API isteği user-access.json + iam-derived.json'u yeniden okuyup ayrıştırıyor
// (istek başına ~50-60 ms), sayfa geçişlerini yavaşlatıyordu.
//  1) Oturum imza anahtarı gözetmen/masaüstünden gelir: sunucu süreci yeniden
//     başlasa da oturum geçerli kalır; farklı anahtar eski çerezi kabul etmez.
//  2) Merkezi IAM deposu dosya imzasıyla bellekte tutulur, dosya değişince
//     yenilenir; anlık okuma hatasında son doğrulanmış dizin kısa süre kullanılır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');

function verifier(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function seed() {
  const admin = verifier('Test-admin-123');
  return iam.migrateStore({ schemaVersion: 8, _revision: 1,
    moderator: { id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', systemRole: 'moderator', enabled: true, status: 'ACTIVE',
      passwordHash: admin, pinHash: admin, title: 'Admin', orgLevel: 'manager', managerId: null, supervisorId: null, directPermissions: [], temporaryPermissions: [],
      collectionAccess: [], accessAreas: {}, permissions: {}, mags: [], mmygs: [], buyingGroups: [] },
    users: [] });
}
function deviceEnv(root, extra = {}) {
  return { ...process.env,
    BUYER_LOG_AUTH_DATA_ROOT: path.join(root, 'auth'), BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, 'data'),
    BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
    BUYER_LOG_PORTABLE_DATA_ROOT: path.join(root, 'portable-data'), ...extra };
}
async function startDevice(env) {
  const child = fork(path.join(__dirname, 'helpers', 'iam-device.js'), [], { env, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const [{ port }] = await once(child, 'message');
  return { child, port };
}
async function stopDevice(device) {
  if (device.child.exitCode !== null) return;
  const stopped = once(device.child, 'exit'); device.child.kill(); await stopped;
}
async function call(device, url, cookie = '', method = 'GET', body) {
  const response = await fetch(`http://127.0.0.1:${device.port}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get('set-cookie');
  return { status: response.status, cookie: setCookie ? setCookie.split(';')[0] : cookie, body: await response.json() };
}

test('a server restart with the same session secret keeps the signed-in user signed in', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-session-continuity-'));
  fs.mkdirSync(path.join(root, 'auth'), { recursive: true });
  fs.writeFileSync(path.join(root, 'auth', 'user-access.json'), JSON.stringify(seed()));
  const secret = crypto.randomBytes(32).toString('hex');
  let device = await startDevice(deviceEnv(root, { BUYER_LOG_SESSION_SECRET: secret }));
  t.after(async () => { await stopDevice(device); fs.rmSync(root, { recursive: true, force: true }); });
  const login = await call(device, '/api/user-login', '', 'POST', { username: 'admin', password: 'Test-admin-123' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal((await call(device, '/api/current-user', login.cookie)).body.selected, true);

  await stopDevice(device);
  device = await startDevice(deviceEnv(root, { BUYER_LOG_SESSION_SECRET: secret }));
  const afterRestart = await call(device, '/api/current-user', login.cookie);
  assert.equal(afterRestart.body.selected, true, 'watchdog restart must not log the user out');

  await stopDevice(device);
  device = await startDevice(deviceEnv(root, { BUYER_LOG_SESSION_SECRET: crypto.randomBytes(32).toString('hex') }));
  assert.equal((await call(device, '/api/current-user', login.cookie)).body.selected, false, 'a new app session still requires a new sign-in');
});

test('watchdog and desktop backend hand one in-memory session secret to the server', () => {
  const watchdog = fs.readFileSync(path.join(__dirname, '..', 'server', 'watchdog.js'), 'utf8');
  assert.match(watchdog, /BUYER_LOG_SESSION_SECRET: SESSION_SECRET/);
  const backend = fs.readFileSync(path.join(__dirname, '..', 'electron', 'backend.js'), 'utf8');
  assert.match(backend, /env\.BUYER_LOG_SESSION_SECRET = this\.sessionSecret/);
  assert.doesNotMatch(backend, /writeFile[^\n]*sessionSecret/, 'the session secret is never written to disk');
});

test('central IAM store is memoized by file signature and survives a momentary read failure', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-central-store-cache-'));
  const shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const auth = path.join(root, 'auth');
  const env = deviceEnv(root, { BUYER_LOG_CENTRAL_IAM_ENABLED: '1', BUYER_LOG_IAM_SHARED_ROOT: shared });
  await central.createCentralIam({ sharedRoot: shared, cacheFile: path.join(auth, 'user-access.json') }).initialize(seed(), { id: 'moderator' });
  fs.writeFileSync(path.join(auth, 'iam-derived.json'), JSON.stringify({ orderAccess: { 1001: [{ buyer: 'A' }] }, scopeCatalog: {} }));
  const script = path.join(root, 'probe.js');
  fs.writeFileSync(script, `
    const fs = require('fs'), path = require('path');
    const access = require(${JSON.stringify(path.join(__dirname, '..', 'server', 'lib', 'user-access.js'))});
    const auth = process.env.BUYER_LOG_AUTH_DATA_ROOT, out = {};
    const first = access.readStore(), second = access.readStore();
    out.sameIdentity = first === second;
    out.loadIsCopy = access.loadStore() !== first;
    out.users = [first.moderator, ...first.users].filter(Boolean).map(u => u.username);
    out.firstAccess = Object.keys(first.orderAccess);
    fs.writeFileSync(path.join(auth, 'iam-derived.json'), JSON.stringify({ orderAccess: { 1001: [], 2002: [] }, scopeCatalog: {} }));
    out.afterDerivedWrite = Object.keys(access.readStore().orderAccess);
    const file = path.join(auth, 'user-access.json');
    fs.renameSync(file, file + '.moving'); fs.renameSync(file + '.bak', file + '.bak.moving');
    const during = access.readStore();
    out.duringMove = [during.moderator, ...during.users].filter(Boolean).map(u => u.username);
    process.stdout.write(JSON.stringify(out));
  `);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const child = fork(script, [], { env, stdio: ['ignore', 'pipe', 'inherit', 'ipc'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 0);
  const result = JSON.parse(output);
  assert.equal(result.sameIdentity, true, 'unchanged files are not re-read per request');
  assert.equal(result.loadIsCopy, true, 'writers still receive a private copy');
  assert.deepEqual(result.users, ['admin']);
  assert.deepEqual(result.firstAccess, ['1001']);
  assert.deepEqual(result.afterDerivedWrite.sort(), ['1001', '2002'], 'a derived-access write invalidates the cache');
  assert.deepEqual(result.duringMove, ['admin'], 'a momentary unreadable cache does not empty the directory');
});
