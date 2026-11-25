'use strict';

/* Gerçek server/server.js sürecini yalıtılmış veri kökleriyle başlatır ve
   verilen kullanıcı dizinine (yerel IAM) oturum açtırır. Çok kullanıcılı
   yetki/görünürlük testleri (Koleksiyon + Fiyat Masası) bunu paylaşır.
   Demo veriler sentetiktir; gerçek iş verisi kullanılmaz. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const iam = require('../../server/lib/iam-core');

const APP = path.resolve(__dirname, '..', '..');
const PASSWORD = 'Demo-password-123';
const salt = crypto.randomBytes(16);
const HASH = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(PASSWORD, salt, 32).toString('hex')}`;

function profile(id, { role = 'buyer', dataScope = null, managerId = 'moderator', directPermissions = [] } = {}) {
  const systemRole = role === 'moderator' ? 'moderator' : role === 'manager' ? 'senior_manager' : 'buyer';
  const legacyRole = role === 'moderator' ? 'moderator' : role === 'manager' ? 'manager' : 'buyer';
  return {
    id, username: id, displayName: `Demo ${id}`, title: 'Demo', role: legacyRole, systemRole, enabled: true, status: 'ACTIVE',
    passwordHash: HASH, pinHash: HASH, directPermissions, temporaryPermissions: [], collectionAccess: [], accessAreas: {}, permissions: {},
    mags: [], mmygs: [], buyingGroups: [], managerId: id === 'moderator' ? null : managerId, supervisorId: id === 'moderator' ? null : managerId,
    ...(dataScope ? { dataScope } : {}),
  };
}

function directory(users, { orderAccess = {} } = {}) {
  const moderator = { ...profile('moderator', { role: 'moderator' }), username: 'demo.admin' };
  return iam.migrateStore({ schemaVersion: 8, _revision: 1, moderator, users: users.map(spec => profile(spec.id, spec)), orderAccess, scopeCatalog: {} });
}

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function startServer(t, { users, orderAccess } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-mu-access-'));
  // Yetki dizini sunucu veri kökünde durur (BUYER_LOG_AUTH_DATA_ROOT verilmez):
  // kalıcı yazma koruması yalnız izinli veri köklerine yazmaya izin verir.
  const auth = path.join(home, 'server'), local = path.join(home, 'local');
  fs.mkdirSync(auth, { recursive: true }); fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(directory(users, { orderAccess })));
  const port = await freePort();
  const config = path.join(home, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ host: '127.0.0.1', port, centralIamEnabled: false, refreshWithExcel: false, updates: { enabled: false } }));
  const env = { ...process.env, BUYER_LOG_CONFIG_PATH: config, BUYER_LOG_CENTRAL_IAM_ENABLED: '0',
    BUYER_LOG_DATA_ROOT: path.join(home, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: local,
    BUYER_LOG_SERVER_DATA_ROOT: auth,
    BUYER_LOG_PORTABLE_DATA_ROOT: path.join(home, 'portable'), BUYER_LOG_TEMP_ROOT: path.join(home, 'temp'), BL_KEEP_ALIVE: '1' };
  delete env.BUYER_LOG_IAM_SHARED_ROOT; delete env.BUYER_LOG_LOCAL_DB; delete env.BUYER_LOG_AUTH_DATA_ROOT;
  const child = spawn(process.execPath, ['server/server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit'); child.kill();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      await stopped; clearTimeout(timer);
    }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  async function request(method, url, { body, cookie, raw = false } = {}) {
    const headers = { ...(cookie ? { Cookie: cookie } : {}) };
    let payload;
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
    const response = await fetch(base + url, { method, headers, body: payload, signal: AbortSignal.timeout(20000) });
    const text = raw ? null : await response.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch (_) { json = { text }; }
    return { status: response.status, body: json, response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const deadline = Date.now() + 60000;
  for (;;) {
    if (child.exitCode !== null) throw new Error('backend exited: ' + output);
    try { const probe = await request('GET', '/api/auth/users/suggest?q=demo'); if (probe.status < 500) break; } catch (error) { if (error.cause?.code !== 'ECONNREFUSED') throw error; }
    if (Date.now() > deadline) throw new Error('backend start timed out: ' + output);
    await delay(100);
  }
  async function login(username) {
    const result = await request('POST', '/api/user-login', { body: { username, password: PASSWORD } });
    if (result.status !== 200 || !result.cookie) throw new Error(`login ${username} failed: ${result.status} ${JSON.stringify(result.body)}`);
    const cookie = result.cookie;
    const as = (method, url, options = {}) => request(method, url, { ...options, cookie });
    return { id: username === 'demo.admin' ? 'moderator' : username, cookie, as,
      get: url => as('GET', url), put: (url, body) => as('PUT', url, { body }), post: (url, body) => as('POST', url, { body }),
      patch: (url, body) => as('PATCH', url, { body }), del: (url, body) => as('DELETE', url, { body }) };
  }
  return { base, request, login, home, auth, output: () => output, child };
}

module.exports = { startServer, directory, PASSWORD };
