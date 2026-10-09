'use strict';

/* v20261009 — "MERKEZİ DİZİNİ ESAS AL" (Moderatör onaylı kurtarma).
 *
 * Kullanıcı bildirimi: Moderatör kullanıcı yönetiminde düzenleme yapamıyordu
 * ("Revizyon 0 · Salt okunur"). Otomatik yenileme, kullanıcı kaybetmemek için
 * yerel liste merkezle uyuşmadığında (IAM_MIGRATION_CONFLICT), yerel taban
 * merkezden yeniyken (IAM_REMOTE_REVISION_REGRESSION) ya da aynı revizyon farklı
 * içerikteyken (IAM_REVISION_HASH_CONFLICT) bilerek durur ve cihaz kalıcı olarak
 * salt okunur kalıyordu. adopt bu durumdan çıkışı Moderatör kararına bağlar:
 *   · merkezin en yeni GEÇERLİ revizyonu okunabilmeli,
 *   · işlemi yapan o dizinde aktif kullanıcı yöneticisi olmalı,
 *   · bu cihazın dosyaları önce yedeklenir; merkezdeki dizine yazılmaz.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');

const passwordHash = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
function profile(id, role, extra = {}) {
  return { id, username: id, displayName: id, role, systemRole: role, enabled: true, status: 'ACTIVE', passwordHash, pinHash: passwordHash, iamVersion: 1,
    orgLevel: role === 'moderator' ? 'manager' : 'job_title', managerId: id === 'moderator' ? null : 'moderator', supervisorId: id === 'moderator' ? null : 'moderator',
    directPermissions: [], temporaryPermissions: [], collectionAccess: [], accessAreas: {}, permissions: {}, mags: [], mmygs: [], buyingGroups: [], title: 'T', ...extra };
}
function fixture(users) {
  return iam.migrateStore({ schemaVersion: 8, _revision: 1, moderator: profile('moderator', 'moderator'), users: users.map(id => profile(id, 'buyer')) });
}
async function environment(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-iam-adopt-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sharedRoot = path.join(root, 'shared'); await fsp.mkdir(sharedRoot);
  return { root, sharedRoot };
}
const backupsIn = dir => fs.readdirSync(dir).filter(name => name.includes('.pre-adopt-'));

test('yerel liste merkezle uyuşmazsa (IAM_MIGRATION_CONFLICT) Moderatör merkezi dizini esas alır; yerel dosya yedeklenir', async t => {
  const { root, sharedRoot } = await environment(t);
  const a = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'a', 'user-access.json') });
  await a.initialize(fixture(['ayse', 'ali']), { id: 'moderator' });
  const bFile = path.join(root, 'b', 'user-access.json');
  fs.mkdirSync(path.dirname(bFile), { recursive: true });
  const legacy = fixture(['eski1', 'eski2', 'eski3']);
  fs.writeFileSync(bFile, JSON.stringify(legacy));
  const b = central.createCentralIam({ sharedRoot, cacheFile: bFile });
  await assert.rejects(b.refresh(), { code: 'IAM_MIGRATION_CONFLICT' });
  assert.equal(b.health().status, 'conflict');

  const result = await b.adopt({ actorId: 'moderator' });
  assert.equal(result.revision, 1);
  assert.deepEqual(b.readLocal().users.map(user => user.id).sort(), ['ali', 'ayse']);
  assert.equal(b.health().status, 'synced');
  // Eski yerel liste kaybolmaz: yedekte birebir durur.
  const backups = backupsIn(path.dirname(bFile));
  assert.ok(backups.some(name => name.startsWith('user-access.pre-adopt-')));
  const saved = JSON.parse(fs.readFileSync(path.join(path.dirname(bFile), backups.find(name => name.startsWith('user-access.pre-adopt-'))), 'utf8'));
  assert.deepEqual(saved.users.map(user => user.id).sort(), ['eski1', 'eski2', 'eski3']);
  // Merkezdeki dizine yazılmadı: hâlâ tek revizyon.
  assert.equal(fs.readdirSync(path.join(sharedRoot, 'iam', 'revisions')).length, 1);
  // Sonrasında normal eşitleme ve yazma çalışır.
  await b.commit(b.readLocal(), 1, { id: 'moderator' }, { action: 'USER_UPDATE' });
  assert.equal(b.readLocal()._revision, 2);
});

test('Shared Hub geri yüklenip revizyon gerilediğinde (IAM_REMOTE_REVISION_REGRESSION) esas alma tabanı bilerek aşar', async t => {
  const { root, sharedRoot } = await environment(t);
  const bFile = path.join(root, 'b', 'user-access.json');
  const a = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'a', 'user-access.json') });
  const b = central.createCentralIam({ sharedRoot, cacheFile: bFile });
  await a.initialize(fixture(['ayse']), { id: 'moderator' });
  const next = a.readLocal(); next.users[0].displayName = 'Değişti';
  await a.commit(next, 1, { id: 'moderator' }, { action: 'USER_UPDATE' });
  await b.refresh(); assert.equal(b.readLocal()._revision, 2);
  // Hub yedekten geri yüklendi: yalnız revizyon 1 kaldı.
  const revisions = path.join(sharedRoot, 'iam', 'revisions');
  fs.rmSync(path.join(revisions, fs.readdirSync(revisions).sort().at(-1)), { recursive: true, force: true });
  await assert.rejects(b.refresh(), { code: 'IAM_REMOTE_REVISION_REGRESSION' });
  const result = await b.adopt({ actorId: 'moderator' });
  assert.equal(result.revision, 1);
  assert.equal(b.readLocal()._revision, 1);
  assert.equal(b.health().status, 'synced');
  assert.ok(backupsIn(path.dirname(bFile)).some(name => name.startsWith('user-access.meta.pre-adopt-')));
  await b.refresh(); // taban artık 1: normal yenileme hata vermez
  assert.equal(b.health().status, 'synced');
});

test('merkezi dizinde yönetici olmayan kişi esas alamaz; okunamayan merkez hiçbir dosyaya dokunmaz', async t => {
  const { root, sharedRoot } = await environment(t);
  const a = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'a', 'user-access.json') });
  await a.initialize(fixture(['ayse']), { id: 'moderator' });
  const bFile = path.join(root, 'b', 'user-access.json');
  fs.mkdirSync(path.dirname(bFile), { recursive: true });
  fs.writeFileSync(bFile, JSON.stringify(fixture(['baska'])));
  const before = fs.readFileSync(bFile, 'utf8');
  const b = central.createCentralIam({ sharedRoot, cacheFile: bFile });
  await assert.rejects(b.adopt({ actorId: 'ayse' }), { code: 'IAM_ADOPT_ADMIN_REQUIRED' });
  await assert.rejects(b.adopt({ actorId: 'yok' }), { code: 'IAM_ADOPT_ADMIN_REQUIRED' });
  assert.equal(fs.readFileSync(bFile, 'utf8'), before);
  assert.deepEqual(backupsIn(path.dirname(bFile)), []);
  // Merkezdeki tek revizyon bozulursa esas alınacak geçerli dizin yoktur.
  const revisions = path.join(sharedRoot, 'iam', 'revisions'), head = path.join(revisions, fs.readdirSync(revisions)[0]);
  fs.writeFileSync(path.join(head, 'snapshot.json'), '{bozuk');
  await assert.rejects(b.adopt({ actorId: 'moderator' }), { code: 'IAM_REMOTE_INVALID' });
  assert.equal(fs.readFileSync(bFile, 'utf8'), before);
  assert.deepEqual(backupsIn(path.dirname(bFile)), []);
});

test('uç yalnız Moderatöre, açık onay ve gerekçeyle açılır; arayüz yalnız bu üç durumda düğme gösterir', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /app\.post\('\/api\/iam\/adopt-central', userAccess\.requireModerator,/);
  const access = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'user-access.js'), 'utf8');
  const handler = access.slice(access.indexOf('async function iamAdoptHandler'), access.indexOf('async function iamInitializeHandler'));
  assert.match(handler, /body\.confirmCritical !== true \|\| !clean\(body\.reason\)/);
  assert.match(handler, /appendAudit\(actor, 'IAM_ADOPT_CENTRAL'/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-management.js'), 'utf8');
  assert.match(ui, /const ADOPTABLE_IAM_ERRORS = \['IAM_MIGRATION_CONFLICT', 'IAM_REMOTE_REVISION_REGRESSION', 'IAM_REVISION_HASH_CONFLICT'\]/);
  assert.match(ui, /store\.actor\.systemRole === 'moderator'/);
  assert.match(ui, /'\/api\/iam\/adopt-central'/);
});

test('uçtan uca: uyuşmazlıktaki cihazda Moderatör merkezi dizini esas alır ve düzenleme açılır', async t => {
  const crypto = require('node:crypto');
  const { fork } = require('node:child_process');
  const { once } = require('node:events');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-iam-adopt-http-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const children = [];
  t.after(async () => { for (const child of children) if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } fs.rmSync(root, { recursive: true, force: true }); });
  const salt = crypto.randomBytes(16), hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Test-admin-123', salt, 32).toString('hex')}`;
  const seed = users => iam.migrateStore({ schemaVersion: 8, _revision: 1, moderator: { id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', enabled: true, passwordHash: hash, pinHash: hash, title: 'Admin' },
    users: users.map(id => ({ id, username: id, displayName: id, title: 'Buyer', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE', passwordHash: hash, pinHash: hash, managerId: 'moderator', supervisorId: 'moderator' })) });
  async function device(name, initial) {
    const auth = path.join(root, name, 'auth'); fs.mkdirSync(auth, { recursive: true });
    fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(initial));
    const child = fork(path.join(__dirname, 'helpers', 'iam-device.js'), [], { env: { ...process.env,
      BUYER_LOG_AUTH_DATA_ROOT: auth, BUYER_LOG_SERVER_DATA_ROOT: path.join(root, name, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, name, 'data'),
      BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, name, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, name, 'config.json'),
      BUYER_LOG_PORTABLE_DATA_ROOT: path.join(root, name, 'portable-data'), BUYER_LOG_CENTRAL_IAM_ENABLED: '1', BUYER_LOG_IAM_SHARED_ROOT: shared }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    children.push(child); const [{ port }] = await once(child, 'message');
    let cookie = '';
    const request = async (url, method = 'GET', body) => {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
      const set = response.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
      return { status: response.status, body: await response.json() };
    };
    const refresh = async () => { const done = once(child, 'message'); child.send('refresh'); await done; };
    return { request, refresh };
  }
  const a = await device('a', seed(['merkez1', 'merkez2']));
  await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  assert.equal((await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true })).status, 200);
  const b = await device('b', seed(['yerel1', 'yerel2', 'yerel3']));
  await b.refresh();
  assert.equal((await b.request('/api/iam/health')).body.lastError, 'IAM_MIGRATION_CONFLICT');
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' })).status, 200);
  // Onaysız/gerekçesiz istek reddedilir.
  assert.equal((await b.request('/api/iam/adopt-central', 'POST', { confirmCritical: true })).status, 400);
  const adopted = await b.request('/api/iam/adopt-central', 'POST', { confirmCritical: true, reason: 'Merkez doğru' });
  assert.equal(adopted.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.centralIam.status, 'synced');
  const model = (await b.request('/api/users/admin')).body;
  assert.deepEqual(model.profiles.map(item => item.username).sort(), ['admin', 'merkez1', 'merkez2']);
  // Düzenleme artık merkezi revizyonla çalışır.
  const id = model.profiles.find(item => item.username === 'merkez1').id;
  const saved = await b.request(`/api/users/${id}`, 'PUT', { expectedRevision: model.revision, displayName: 'Merkez Bir' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
});
