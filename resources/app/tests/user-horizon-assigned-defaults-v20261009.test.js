'use strict';

/* v20261009 — KİŞİYE ATANMIŞ VARSAYILAN UFUK (çoklu kullanıcı / çoklu cihaz).
 *
 * Kullanıcı talebi: "Kullanıcılar horizonlarını kendileri ayarlayabilsin ancak
 * onların varsayılanını açılışta moderatör ve yönetici belirleyebilsin" ve
 * "kullanıcılar arası horizon gibi detayları birbirine kopyalayabileyim".
 *
 * Kişisel ufuk cihazda yaşar. Eskiden Moderatörün kendi cihazında başka bir
 * kullanıcı için yazdığı/kopyaladığı ufuk o kullanıcının cihazına ULAŞMIYORDU.
 * Atanmış varsayılan artık merkezi IAM dizininde taşınır; her cihazda rol
 * şablonunun üstünde, kişinin kendi (daha yeni) ayarının altında çözülür.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');

function seed() {
  const salt = crypto.randomBytes(16), hash = `scrypt$${salt.toString('hex')}$${crypto.scryptSync('Test-admin-123', salt, 32).toString('hex')}`;
  return iam.migrateStore({ schemaVersion: 8, _revision: 1, moderator: { id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', enabled: true, passwordHash: hash, pinHash: hash, title: 'Admin' }, users: [] });
}
async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-horizon-default-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
  const children = [];
  t.after(async () => { for (const child of children) { if (child.exitCode === null) { const stopped = once(child, 'exit'); child.kill(); await stopped; } } fs.rmSync(root, { recursive: true, force: true }); });
  async function device(name, initial) {
    const auth = path.join(root, name, 'auth'); fs.mkdirSync(auth, { recursive: true });
    if (initial) fs.writeFileSync(path.join(auth, 'user-access.json'), JSON.stringify(initial));
    const child = fork(path.join(__dirname, 'helpers', 'iam-device.js'), [], { env: { ...process.env,
      BUYER_LOG_AUTH_DATA_ROOT: auth, BUYER_LOG_SERVER_DATA_ROOT: path.join(root, name, 'server'), BUYER_LOG_DATA_ROOT: path.join(root, name, 'data'),
      BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, name, 'local'), BUYER_LOG_CONFIG_PATH: path.join(root, name, 'config.json'),
      BUYER_LOG_PORTABLE_DATA_ROOT: path.join(root, name, 'portable-data'),
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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Moderatörün atadığı varsayılan ufuk kullanıcının BAŞKA cihazında geçerli olur; kullanıcı sonra kendisi değiştirebilir', async t => {
  const { device } = await setup(t), a = await device('a', seed()), b = await device('b');
  assert.equal((await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' })).status, 200);
  assert.equal((await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true })).status, 200);
  const created = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'buyer', displayName: 'Buyer', title: 'Buyer', managerId: 'moderator', password: 'Buyer-pass-123' });
  assert.equal(created.status, 201, JSON.stringify(created));
  const buyerId = created.body.user.id;

  // Moderatör kendi ekranında ufkunu kurar ve bunu kullanıcıya varsayılan yapar.
  const moderatorHorizon = { seasons: ['2027-SS'], groups: ['DOKUMA'] };
  await a.request('/api/user-workspace/cp/horizon', 'PUT', { horizon: moderatorHorizon });
  let r = await a.request('/api/iam/horizon-defaults', 'POST', { expectedRevision: 2, targetUserIds: [buyerId], modules: ['cp'], reason: 'Sezon açılışı' });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.body.modules, ['cp']);
  const listed = (await a.request('/api/users/admin')).body.profiles.find(item => item.id === buyerId);
  assert.deepEqual(listed.horizonDefault.modules, ['cp']);
  assert.equal(listed.horizonDefault.sourceName, 'Admin');

  // Kullanıcı başka bir cihazda açar: atanmış varsayılanı görür.
  await b.refresh();
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'buyer', password: 'Buyer-pass-123' }, 'buyer')).status, 200);
  r = await b.request('/api/user-workspace/cp', 'GET', undefined, 'buyer');
  assert.deepEqual(r.body.horizon, moderatorHorizon);
  assert.equal(r.body.layer, 'roleTemplate');

  // Kullanıcı ufkunu kendisi değiştirir: kendi (daha yeni) ayarı kazanır.
  const ownHorizon = { seasons: ['2027-AW'] };
  await pause(5);
  await b.request('/api/user-workspace/cp/horizon', 'PUT', { horizon: ownHorizon }, 'buyer');
  r = await b.request('/api/user-workspace/cp', 'GET', undefined, 'buyer');
  assert.deepEqual(r.body.horizon, ownHorizon);
  assert.equal(r.body.layer, 'personal');

  // Moderatör varsayılanı YENİDEN atar: atamadan eski kişisel ayar bir kez kalkar.
  await pause(5);
  r = await a.request('/api/iam/horizon-defaults', 'POST', { expectedRevision: 3, targetUserIds: [buyerId], modules: ['cp'], reason: 'Yeniden uygula' });
  assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  // Erişim değişmediği için kullanıcının oturumu düşmez.
  r = await b.request('/api/user-workspace/cp', 'GET', undefined, 'buyer');
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.body.horizon, moderatorHorizon);

  // Atama kaldırılınca kullanıcı rol şablonuna / ortak filtreye döner.
  r = await a.request('/api/iam/horizon-defaults', 'POST', { expectedRevision: 4, targetUserIds: [buyerId], modules: ['cp'], clear: true, reason: 'Kaldır' });
  assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  r = await b.request('/api/user-workspace/cp', 'GET', undefined, 'buyer');
  assert.equal(r.body.layer, 'source');
  assert.equal((await a.request('/api/users/admin')).body.profiles.find(item => item.id === buyerId).horizonDefault, null);
});

test('Profil kopyalamada Horizon, hedeflerin merkezi varsayılanı olur; yetkisiz kullanıcı atayamaz', async t => {
  const { device } = await setup(t), a = await device('a', seed()), b = await device('b');
  await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true });
  const source = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'source', title: 'Buyer', managerId: 'moderator', password: 'Source-pass-123' });
  const target = await a.request('/api/users', 'POST', { expectedRevision: 2, username: 'target', title: 'Buyer', managerId: 'moderator', password: 'Target-pass-123' });
  assert.equal(target.status, 201, JSON.stringify(target));
  const sourceHorizon = { seasons: ['2027-SS'], table: 'orders' };
  // Kaynak kullanıcının ufku, varsayılan atanarak kaynağın kendisine verilir.
  await a.request('/api/user-workspace/orders/horizon', 'PUT', { horizon: sourceHorizon });
  let r = await a.request('/api/iam/horizon-defaults', 'POST', { expectedRevision: 3, targetUserIds: [source.body.user.id], modules: ['orders'], reason: 'Kaynak' });
  assert.equal(r.status, 200, JSON.stringify(r));
  r = await a.request('/api/iam/profile-copy', 'POST', { expectedRevision: 4, sourceUserId: source.body.user.id, targetUserIds: [target.body.user.id], categories: { userPermissions: false, workspace: { horizon: true } }, reason: 'Horizon kopyası' });
  assert.equal(r.status, 200, JSON.stringify(r));
  await b.refresh();
  assert.equal((await b.request('/api/user-login', 'POST', { username: 'target', password: 'Target-pass-123' }, 'target')).status, 200);
  r = await b.request('/api/user-workspace/orders', 'GET', undefined, 'target');
  assert.deepEqual(r.body.horizon, sourceHorizon);

  // Kullanıcı yönetimi yetkisi olmayan kişi atama yapamaz.
  r = await b.request('/api/iam/horizon-defaults', 'POST', { expectedRevision: 5, targetUserIds: [source.body.user.id], modules: ['orders'], reason: 'x' }, 'target');
  assert.equal(r.status, 403);
  // Ufku olmayan kaynak sessiz bir "başarı" üretmez.
  r = await a.request('/api/iam/horizon-defaults', 'POST', { expectedRevision: 5, sourceUserId: target.body.user.id, targetUserIds: [source.body.user.id], modules: ['lfl'], reason: 'boş' });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'SOURCE_HORIZON_EMPTY');
});

test('merkezi dizin yalnız Horizon anahtarlı kişi varsayılanlarını taşır ve doğrulamadan geçer', () => {
  const store = seed();
  store.iam.workspaceTemplates.userDefaults = [
    { userId: 'moderator', assignedAt: '2026-10-09T08:00:00.000Z', assignedBy: 'moderator', sourceName: 'Admin',
      entries: { 'buyerlog.workspace.horizon.cp.v1': { value: '{"seasons":["2027-SS"]}' }, 'lcw.secretToken': { value: 'x' }, 'lcw.tableColumns.cp': { value: '[]' } } },
    { userId: 'empty', entries: {} },
  ];
  const migrated = iam.migrateStore(store);
  assert.deepEqual(Object.keys(migrated.iam.workspaceTemplates.userDefaults[0].entries), ['buyerlog.workspace.horizon.cp.v1']);
  assert.equal(migrated.iam.workspaceTemplates.userDefaults.length, 1);
  const snapshot = central.snapshotFromStore(migrated, 1, { id: 'moderator' });
  assert.doesNotThrow(() => central.validateSnapshot(snapshot));
  // Atama yoksa alan hiç yazılmaz: mevcut merkezi dizinlerin içeriği değişmez.
  assert.equal(Object.prototype.hasOwnProperty.call(iam.migrateStore(seed()).iam.workspaceTemplates, 'userDefaults'), false);
});

test('yerel IAM önbelleği Windows geçici dosya kilidinde (EPERM/EBUSY) yeniden denenir, kalıcı hata gizlenmez', () => {
  let calls = 0;
  const flaky = () => { calls += 1; if (calls < 3) throw Object.assign(new Error('locked'), { code: calls === 1 ? 'EPERM' : 'EBUSY' }); return 'ok'; };
  assert.equal(central.renameWithRetry('a', 'b', [1, 1, 1], flaky), 'ok');
  assert.equal(calls, 3);
  let permanent = 0;
  assert.throws(() => central.renameWithRetry('a', 'b', [1, 1], () => { permanent += 1; throw Object.assign(new Error('locked'), { code: 'EPERM' }); }), { code: 'EPERM' });
  assert.equal(permanent, 3);
  let missing = 0;
  assert.throws(() => central.renameWithRetry('a', 'b', [1, 1], () => { missing += 1; throw Object.assign(new Error('gone'), { code: 'ENOENT' }); }), { code: 'ENOENT' });
  assert.equal(missing, 1);
});

test('Kullanıcı yönetimi ekranı varsayılan ufku merkezi uçtan atar ve kilit nedenini gösterir', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-management.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-management.css'), 'utf8');
  // Tekil ve toplu atama aynı merkezi uca gider.
  assert.match(ui, /data-act="horizonAssign" data-id=/);
  assert.match(ui, /data-act="horizonAssign">/);
  assert.match(ui, /send\('\/api\/iam\/horizon-defaults', 'POST'/);
  assert.match(ui, /data-act="horizonClear"/);
  // Kilit nedeni sunucunun hata kodundan çevrilir; her temel durum karşılanır.
  for (const code of ['IAM_MIGRATION_CONFLICT', 'IAM_REVISION_CONFLICT', 'IAM_REMOTE_REVISION_REGRESSION', 'IAM_REMOTE_INVALID', 'IAM_NOT_INITIALIZED', 'EPERM']) assert.match(ui, new RegExp(code));
  assert.match(ui, /Shared Hub is unreachable/);
  // Açılışta eşit olmayan dizin bir kez sessizce yeniden denenir.
  assert.match(ui, /refreshDirectory\(\{ silent: true \}\)/);
  // Durum kartı bölümün üstünde tam genişlik durur.
  assert.match(css, /\.umMain\{[^}]*flex-direction:column/);
});
