'use strict';

/* v20261009 — Kullanıcı & Yetki Yönetimi ERP eklemeleri (kullanıcı talebi
 * "hepsini yap"): ek roller (yetki paketleri), süreli yetki, rol varsayılan
 * ufku, yetki kaynağı ve ASAS kaynak kayıtlarının gizlenmesi.
 *
 * Ek rol tanımı merkezi politikada, üyeliği kişinin "bundle:" kimlikli doğrudan
 * yetki kayıtlarında tutulur; böylece eski sürümlü cihazlar dizini reddetmez ve
 * yetkiyi yine doğru uygular. */

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-um-erp-')), shared = path.join(root, 'shared'); fs.mkdirSync(shared);
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
    async function raw(url, who = 'admin') {
      const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers: { Cookie: cookies.get(who) || '' } });
      return { status: response.status, type: response.headers.get('content-type'), buffer: Buffer.from(await response.arrayBuffer()) };
    }
    return { request, raw };
  }
  return { device };
}
async function bootstrap(t) {
  const { device } = await setup(t), a = await device('a', seed());
  await a.request('/api/user-login', 'POST', { username: 'admin', password: 'Test-admin-123' });
  await a.request('/api/iam/initialize', 'POST', { expectedRevision: 1, confirmCritical: true });
  const created = await a.request('/api/users', 'POST', { expectedRevision: 1, username: 'buyer', displayName: 'Buyer', title: 'Buyer', managerId: 'moderator', password: 'Buyer-pass-123' });
  assert.equal(created.status, 201, JSON.stringify(created));
  return { a, buyerId: created.body.user.id };
}
const profileOf = async (a, id) => (await a.request('/api/users/admin')).body.profiles.find(item => item.id === id);

test('ek rol üyelerine iş yetkisi verir, kaynağı "BUNDLE" olur, düzenleme ve silme tüm üyelere uygulanır', async t => {
  const { a, buyerId } = await bootstrap(t);
  let r = await a.request('/api/iam/role-bundles', 'POST', { expectedRevision: 2, confirmCritical: true, reason: 'Onay ekibi',
    bundle: { nameTr: 'Fiyat Onaycısı', nameEn: 'Price Approver', permissions: ['QUOTATIONS.APPROVE', 'OPEN_COSTING.EDIT'] }, memberIds: [buyerId] });
  assert.equal(r.status, 200, JSON.stringify(r));
  const bundleId = r.body.bundle.id;
  assert.deepEqual(r.body.bundle.memberIds, [buyerId]);
  let buyer = await profileOf(a, buyerId);
  assert.deepEqual(buyer.roleBundleIds, [bundleId]);
  const fromBundle = buyer.effectivePermissions.filter(item => item.source === 'BUNDLE').map(item => item.permission).sort();
  assert.deepEqual(fromBundle, ['OPEN_COSTING.EDIT', 'QUOTATIONS.APPROVE']);
  assert.equal(buyer.effectivePermissions.find(item => item.source === 'BUNDLE').sourceLabelEn, 'Price Approver');

  // Kişisel yetki formu ek rol kayıtlarını silmez.
  r = await a.request(`/api/users/${buyerId}`, 'PUT', { expectedRevision: 3, permissionCodes: ['ANALYSIS.EXPORT'], reason: 'Kişisel' });
  assert.equal(r.status, 200, JSON.stringify(r));
  buyer = await profileOf(a, buyerId);
  assert.ok(buyer.effectivePermissions.some(item => item.permission === 'QUOTATIONS.APPROVE' && item.source === 'BUNDLE'));
  assert.ok(buyer.effectivePermissions.some(item => item.permission === 'ANALYSIS.EXPORT' && item.source === 'DIRECT'));

  // Paket yetkisi değişince üyeye uygulanır.
  r = await a.request('/api/iam/role-bundles', 'POST', { expectedRevision: 4, confirmCritical: true, reason: 'Daralt',
    bundle: { id: bundleId, nameTr: 'Fiyat Onaycısı', nameEn: 'Price Approver', permissions: ['QUOTATIONS.APPROVE'] }, memberIds: [buyerId] });
  assert.equal(r.status, 200, JSON.stringify(r));
  buyer = await profileOf(a, buyerId);
  assert.equal(buyer.effectivePermissions.some(item => item.permission === 'OPEN_COSTING.EDIT'), false);

  // Güvenlik yetkisi pakete konamaz; kişi kendini ekleyemez.
  r = await a.request('/api/iam/role-bundles', 'POST', { expectedRevision: 5, confirmCritical: true, reason: 'x', bundle: { nameTr: 'Yönetici', permissions: ['USER.MANAGE'] }, memberIds: [] });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'BUNDLE_SECURITY_PERMISSION');
  r = await a.request('/api/iam/role-bundles', 'POST', { expectedRevision: 5, confirmCritical: true, reason: 'x', bundle: { nameTr: 'Ben', permissions: ['CP.EDIT'] }, memberIds: ['moderator'] });
  assert.equal(r.status, 403);

  // Silme bütün üyelerden yetkiyi kaldırır; kişisel yetki kalır.
  r = await a.request('/api/iam/role-bundles', 'POST', { expectedRevision: 5, confirmCritical: true, reason: 'Kaldır', bundle: { id: bundleId }, remove: true });
  assert.equal(r.status, 200, JSON.stringify(r));
  buyer = await profileOf(a, buyerId);
  assert.deepEqual(buyer.roleBundleIds, []);
  assert.equal(buyer.effectivePermissions.some(item => item.permission === 'QUOTATIONS.APPROVE'), false);
  assert.ok(buyer.effectivePermissions.some(item => item.permission === 'ANALYSIS.EXPORT'));
  assert.deepEqual((await a.request('/api/users/admin')).body.roleBundles, []);
});

test('süreli yetki verilir, etkin yetkide görünür ve geri alınır', async t => {
  const { a, buyerId } = await bootstrap(t);
  const until = new Date(Date.now() + 3 * 864e5).toISOString();
  let r = await a.request(`/api/iam/users/${buyerId}/temporary-grants`, 'POST', { expectedRevision: 2, permission: 'OPEN_COSTING.EDIT', validUntil: until, reason: 'Sezon kapanışı' });
  assert.equal(r.status, 201, JSON.stringify(r));
  let buyer = await profileOf(a, buyerId);
  assert.ok(buyer.effectivePermissions.some(item => item.permission === 'OPEN_COSTING.EDIT' && item.source === 'TEMPORARY'));
  r = await a.request(`/api/iam/users/${buyerId}/temporary-grants/${encodeURIComponent(r.body.grant.id)}`, 'DELETE', { expectedRevision: 3, reason: 'Bitti' });
  assert.equal(r.status, 200, JSON.stringify(r));
  buyer = await profileOf(a, buyerId);
  assert.equal(buyer.effectivePermissions.some(item => item.permission === 'OPEN_COSTING.EDIT'), false);
});

test('rol varsayılan ufku yalnız Horizon anahtarlarını yazar; şablonun diğer ayarları korunur', async t => {
  const { a, buyerId } = await bootstrap(t);
  await a.request('/api/user-workspace/backlog/horizon', 'PUT', { horizon: { seasons: ['2027-SS'] } });
  let r = await a.request('/api/iam/role-horizon-defaults', 'POST', { expectedRevision: 2, roleId: 'buyer', modules: ['backlog'], reason: 'Rol ufku', confirmCritical: true });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.body.template.horizonModules, ['backlog']);
  assert.equal((await a.request('/api/user-login', 'POST', { username: 'buyer', password: 'Buyer-pass-123' }, 'buyer')).status, 200);
  r = await a.request('/api/user-workspace/backlog', 'GET', undefined, 'buyer');
  assert.deepEqual(r.body.horizon, { seasons: ['2027-SS'] });
  assert.equal(r.body.layer, 'roleTemplate');
  r = await a.request('/api/iam/role-horizon-defaults', 'POST', { expectedRevision: 3, roleId: 'buyer', modules: ['backlog'], clear: true, reason: 'Kaldır', confirmCritical: true });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.body.template.horizonModules, []);
  r = await a.request('/api/user-workspace/backlog', 'GET', undefined, 'buyer');
  assert.equal(r.body.layer, 'source');
  // Gerekçesiz/onaysız istek reddedilir.
  r = await a.request('/api/iam/role-horizon-defaults', 'POST', { expectedRevision: 4, roleId: 'buyer', modules: ['backlog'] });
  assert.equal(r.status, 400);
  assert.ok(buyerId);
});

test('ek rol kayıtları merkezi dizin doğrulamasından geçer ve eski sürüm şemasını değiştirmez', () => {
  const store = seed();
  store.users.push({ ...store.moderator, id: 'u1', username: 'u1', systemRole: 'buyer', role: 'buyer',
    directPermissions: [iam.normalizeGrant({ id: iam.bundleGrantId('r1', 'CP.EDIT'), permission: 'CP.EDIT', source: 'DIRECT' })] });
  store.iam.workspaceTemplates.roleBundles = [{ id: 'r1', nameTr: 'CP Editörü', permissions: ['CP.EDIT', 'USER.MANAGE'] }];
  const migrated = iam.migrateStore(store);
  assert.deepEqual(migrated.iam.workspaceTemplates.roleBundles[0].permissions, ['CP.EDIT']);
  const snapshot = central.snapshotFromStore(migrated, 1, { id: 'moderator' });
  assert.doesNotThrow(() => central.validateSnapshot(snapshot));
  const user = migrated.users.find(item => item.id === 'u1');
  const detail = iam.effectivePermissionDetails(user, migrated).find(item => item.permission === 'CP.EDIT' && item.source === 'BUNDLE');
  assert.equal(detail.sourceLabel, 'CP Editörü');
});

test('kullanıcı yönetimi ekranı yeni ERP bölümlerini sunar', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-management.js'), 'utf8');
  assert.match(ui, /id: 'bundles'/);
  assert.match(ui, /id: 'compare'/);
  assert.match(ui, /send\('\/api\/iam\/role-bundles', 'POST'/);
  assert.match(ui, /\/temporary-grants`, 'POST'/);
  assert.match(ui, /send\('\/api\/iam\/role-horizon-defaults', 'POST'/);
  assert.match(ui, /function explainSource\(item\)/);
  // ASAS kaynak kayıtları varsayılan gizli, tek tıkla açılır.
  assert.match(ui, /const isSourceRecord = user =>/);
  assert.match(ui, /data-act="toggleSourceRecords"/);
  assert.match(ui, /showSourceRecords: false/);
});

test('Excel dışa aktarma dört sayfa yazar, parola yazmaz; içe aktarma önizler ve tek revizyonda uygular', async t => {
  const XLSX = require('xlsx');
  const { a, buyerId } = await bootstrap(t);
  const exported = await a.raw('/api/iam/export.xlsx?lang=tr');
  assert.equal(exported.status, 200);
  assert.match(exported.type, /spreadsheetml/);
  const book = XLSX.read(exported.buffer, { type: 'buffer' });
  assert.deepEqual(book.SheetNames, ['Kullanıcılar', 'Yetki Gözden Geçirme', 'Etkin Yetkiler', 'Roller']);
  assert.doesNotMatch(JSON.stringify(book.Sheets), /scrypt\$|passwordHash|pinHash/);
  const users = XLSX.utils.sheet_to_json(book.Sheets['Kullanıcılar'], { header: 1, defval: '' });
  const header = users[0], buyerRow = users.find(row => row[0] === 'buyer');
  assert.ok(buyerRow);
  buyerRow[header.indexOf('MAG')] = 'DEMO MAG A; DEMO MAG B';
  buyerRow[header.indexOf('Görünen ad')] = 'Buyer Yeni';
  const fresh = header.map(() => '');
  Object.assign(fresh, { 0: 'yeni.kisi' }); fresh[header.indexOf('Title')] = 'Buyer'; fresh[header.indexOf('Rol')] = 'Buyer'; fresh[header.indexOf('Yönetici (kullanıcı adı)')] = 'admin';
  const sourceRecord = header.map(() => ''); sourceRecord[header.indexOf('Görünen ad')] = 'KAYNAK KAYIT'; sourceRecord[header.indexOf('Durum')] = 'İnaktif';
  users.push(sourceRecord);
  const bad = header.map(() => ''); bad[0] = 'hatali'; bad[header.indexOf('Rol')] = 'Moderatör'; bad[header.indexOf('Title')] = 'X'; bad[header.indexOf('Yönetici (kullanıcı adı)')] = 'admin';
  const build = rows => { const next = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(next, XLSX.utils.aoa_to_sheet(rows), 'Kullanıcılar'); return XLSX.write(next, { type: 'buffer', bookType: 'xlsx' }).toString('base64'); };
  // Hatalı satır varsa hiçbir şey yazılmaz.
  let r = await a.request('/api/iam/import/preview', 'POST', { fileBase64: build([header, ...users.slice(1), fresh, bad]) });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.deepEqual(r.body.summary, { create: 1, update: 1, unchanged: 1, skipped: 1, error: 1 });
  assert.deepEqual(r.body.plan.find(item => item.username === 'hatali').errors, ['ROLE_MODERATOR_NOT_IMPORTABLE']);
  r = await a.request('/api/iam/import', 'POST', { expectedRevision: 2, fileBase64: build([header, ...users.slice(1), fresh, bad]), reason: 'Toplu', confirmCritical: true });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'IAM_IMPORT_INVALID');
  r = await a.request('/api/iam/import', 'POST', { expectedRevision: 2, fileBase64: build([header, ...users.slice(1), fresh]), reason: 'Toplu', confirmCritical: true });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.body.revision, 3);
  const model = (await a.request('/api/users/admin')).body;
  const buyer = model.profiles.find(item => item.id === buyerId);
  assert.equal(buyer.displayName, 'Buyer Yeni');
  assert.deepEqual(buyer.mags, ['DEMO MAG A', 'DEMO MAG B']);
  const created = model.profiles.find(item => item.username === 'yeni.kisi');
  assert.equal(created.status, 'INACTIVE');
  assert.equal(created.hasPassword, false);
  assert.equal(created.managerId, 'moderator');
});

test('yetki değişimi oturumu düşürmez; parola değişimi hâlâ düşürür; istemci menüyü yeniler', () => {
  const access = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'user-access.js'), 'utf8');
  const session = access.slice(access.indexOf('function sessionProfile(req)'), access.indexOf('function setCookie('));
  assert.match(session, /payload\.credentialRevision \|\| 1\) !== \(profile\.credentialRevision/);
  assert.doesNotMatch(session, /payload\.accessRevision/);
  assert.match(session, /profile\.status !== 'ACTIVE'\) return null/);
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-access-ui.js'), 'utf8');
  assert.match(ui, /Your permissions were updated/);
  const um = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-management.js'), 'utf8');
  assert.match(um, /id: 'transfer'/);
  assert.match(um, /\/api\/iam\/export\.xlsx/);
  assert.match(um, /'\/api\/iam\/import\/preview'/);
  assert.match(um, /send\('\/api\/iam\/import', 'POST'/);
});
