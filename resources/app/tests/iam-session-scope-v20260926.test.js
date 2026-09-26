'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan hata: merkezi IAM her
   kayıtta (tek bir kullanıcının unvanı değişse bile) BÜTÜN kullanıcıların
   oturum revizyonunu artırıyordu; Moderatör birini her düzenlediğinde ya da
   yeni kullanıcı eklediğinde tüm ekip iş ortasında sistemden atılıyordu.
   Artık yalnız ETKİN ERİŞİMİ değişen kullanıcının oturumu düşer. */
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-iam-session-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const children = [];
  t.after(async () => { for (const child of children) if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } fs.rmSync(root, { recursive: true, force: true }); });
  async function device(name, initial) {
    const auth = path.join(root, name, 'auth'); fs.mkdirSync(auth, { recursive: true });
    if (initial) fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(initial));
    const child = fork(path.join(__dirname, 'helpers', 'iam-device.js'), [], { env: { ...process.env,
      BUYER_LOG_AUTH_DATA_ROOT: auth, BUYER_LOG_SERVER_DATA_ROOT: path.join(root, name, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, name, 'data'),
      BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, name, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, name, 'config.json'),
      BUYER_LOG_CENTRAL_IAM_ENABLED: '1', BUYER_LOG_IAM_SHARED_ROOT: shared }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.push(child); const [{ port }] = await once(child, 'message');
    const cookies = new Map();
    async function request(url, method = 'GET', body, who = 'admin') {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookies.get(who) || '' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const cookie = response.headers.get('set-cookie'); if (cookie) cookies.set(who, cookie.split(';')[0]);
      return { status: response.status, body: await response.json() };
    }
    async function refresh() { const done = once(child, 'message'); child.send('refresh'); await done; }
    return { request, refresh };
  }
  return { device };
}

test('Başka kullanıcının unvanı değişince oturum sürer; kendi erişimi değişince düşer', async t => {
  const { device } = await setup(t), a = await device('a', seed()), b = await device('b');
  await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  let r = await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true }); assert.equal(r.status, 200);
  const mehmet = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'mehmet', title: 'Buyer', managerId: 'moderator', password: 'Mehmet-12345' });
  const elif = await a.request('/api/users', 'POST', { expectedRevision: 2, username: 'elif', title: 'Buyer', managerId: 'moderator', password: 'Elif-123456' });
  assert.equal(elif.status, 201);
  await b.refresh();
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'mehmet', password: 'Mehmet-12345' }, 'mehmet')).status, 200);

  r = await a.request(`/api/users/${elif.body.user.id}`, 'PUT', { expectedRevision: 3, title: 'Kıdemli Buyer' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await a.request('/api/users', 'POST', { expectedRevision: 4, username: 'yeni', title: 'Buyer', managerId: 'moderator', password: 'Yeni-123456' }); assert.equal(r.status, 201);
  await b.refresh();
  assert.equal((await b.request('/api/current-user', 'GET', undefined, 'mehmet')).body.selected, true, 'ilgisiz IAM değişikliği oturumu düşürmez');

  r = await a.request(`/api/users/${mehmet.body.user.id}`, 'PUT', { expectedRevision: 5, systemRole: 'manager', role: 'manager', reason: 'Terfi' }); assert.equal(r.status, 200, JSON.stringify(r.body));
  await b.refresh();
  assert.equal((await b.request('/api/current-user', 'GET', undefined, 'mehmet')).body.selected, false, 'kendi erişimi değişen kullanıcının oturumu düşer');
});
