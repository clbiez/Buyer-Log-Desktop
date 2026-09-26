'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan hata: merkezi IAM kipinde
   sipariş sahipliği (orderAccess) yalnız Moderatör cihazında kalıyordu; kendi
   bilgisayarındaki Buyer kendi kapsamındaki CP satırını bile düzenleyemiyordu
   (ORDER_VIEW_ONLY). Sahiplik artık hub üzerinden, bütünlük özetiyle taşınır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const iam = require('../server/lib/iam-core');
const share = require('../server/lib/order-authority-share');

function seed() {
  const salt = crypto.randomBytes(16), hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Test-admin-123', salt, 32).toString('hex')}`;
  return iam.migrateStore({ schemaVersion: 8, _revision: 1, moderator: { id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', enabled: true, passwordHash: hash, pinHash: hash, title: 'Admin' }, users: [] });
}
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-order-authority-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const children = [];
  t.after(async () => { for (const child of children) if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } fs.rmSync(root, { recursive: true, force: true }); });
  async function device(name, initial) {
    const auth = path.join(root, name, 'auth'); fs.mkdirSync(auth, { recursive: true });
    if (initial) fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(initial));
    const child = fork(path.join(__dirname, 'helpers', 'order-authority-device.js'), [], { env: { ...process.env,
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
    return { request, refresh, auth };
  }
  return { device, shared };
}

test('Moderatörün türettiği sipariş sahipliği hub ile Buyer cihazına ulaşır; Buyer kendi kapsamını düzenler', async t => {
  const { device, shared } = await setup(t), a = await device('a', seed()), b = await device('b');
  assert.equal((await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' })).status, 200);
  assert.equal((await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true })).status, 200);
  const created = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'buyer', displayName: 'Buyer', title: 'Buyer', managerId: 'moderator', password: 'Buyer-password-1', dataScope: { mode: 'CUSTOM', buyers: ['Ece B.'] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const orders = [
    { ocode: 4100002, buyer: 'Ece B.', merch: 'A1', ageGroup: 'KG', buyerGrup: 'BG1' },
    { ocode: 4100000, buyer: 'Mert Y.', merch: 'A1', ageGroup: 'KG', buyerGrup: 'BG1' },
  ];
  assert.equal((await a.request('/api/test/sync-orders', 'POST', { orders })).status, 200);
  // Yayın arka planda: hub belgesi oluşana kadar kısa süre bekle.
  let published = null;
  for (let i = 0; i < 50 && !published; i++) { published = await share.readShared(shared); if (!published) await new Promise(r => setTimeout(r, 50)); }
  assert.ok(published, 'Moderatör cihazı sipariş sahipliğini hub’a yayımlar');
  assert.deepEqual(Object.keys(published.orderAccess).sort(), ['4100000', '4100002']);

  await b.refresh();
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'Buyer-password-1' }, 'buyer')).status, 200);
  assert.deepEqual((await b.request('/api/test/can-edit/4100002', 'GET', undefined, 'buyer')).body, { rows: 1, canEdit: true }, 'kapsamındaki sipariş düzenlenebilir');
  assert.deepEqual((await b.request('/api/test/can-edit/4100000', 'GET', undefined, 'buyer')).body, { rows: 1, canEdit: false }, 'kapsam dışı sipariş salt okunur kalır');
  assert.ok(fs.existsSync(path.join(b.auth, 'iam-derived.json')), 'Buyer cihazı çevrimdışı kullanım için yerel kopya tutar');
});

test('Bozuk ya da kurcalanmış hub belgesi yok sayılır; yayın paylaşım kökü yoksa hiçbir şey oluşturmaz', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-order-authority-doc-'));
  try {
    assert.deepEqual(await share.publishShared(path.join(root, 'missing'), { orderAccess: {} }), { published: false, reason: 'iam-not-initialized' });
    assert.equal(fs.existsSync(path.join(root, 'missing')), false);
    fs.mkdirSync(path.join(root, 'iam'));
    const saved = await share.publishShared(root, { orderAccess: { 1: [{ buyer: 'X' }] }, generatedBy: 'moderator' });
    assert.equal(saved.published, true);
    assert.equal((await share.publishShared(root, { orderAccess: { 1: [{ buyer: 'X' }] } })).unchanged, true, 'aynı içerik yeniden yazılmaz');
    const file = share.sharedFile(root), doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.orderAccess['2'] = [{ buyer: 'Sahte' }];
    fs.writeFileSync(file, JSON.stringify(doc));
    assert.equal(await share.readShared(root), null, 'özeti tutmayan belge reddedilir');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
