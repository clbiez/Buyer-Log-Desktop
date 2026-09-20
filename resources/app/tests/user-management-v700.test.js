'use strict';

/*
 * v7.00 — Kullanıcı & Yetki Yönetimi baştan tasarımı için koruma testleri.
 *
 * İki katman sınanır:
 *  (A) SUNUCU — buyer rehberi, MAG→MMYG bağımlılığı, aktif/pasif turu, parola,
 *      mükerrer engeli, yönetici ataması ve döngü, yetki kopyalama kipleri,
 *      hiyerarşik miras ve rol matrisi.
 *  (B) ARAYÜZ — public/user-management.js asgari bir DOM taklidinde GERÇEKTEN
 *      çalıştırılır. Gerekçe: `node --check` şablon içindeki tanımsız değişkeni
 *      sessizce geçirir; çizim kodu bir kez koşturulmadan hata görünmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-um-v700-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const iam = require('../server/lib/iam-core');
const access = require('../server/lib/user-access');
const { loadUserManagement } = require('./helpers/um-dom');
const { assertLazy } = require('./helpers/script-loading');

const ROOT = path.join(__dirname, '..');
const UI_SOURCE = fs.readFileSync(path.join(ROOT, 'public', 'user-management.js'), 'utf8');
const UI_CSS = fs.readFileSync(path.join(ROOT, 'public', 'user-management.css'), 'utf8');
const ACCESS_UI = fs.readFileSync(path.join(ROOT, 'public', 'user-access-ui.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

/* ============================ Sunucu yardımcıları ============================ */

function response() {
  return {
    statusCode: 200, body: null, headers: {}, cookies: [],
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
    append(key, value) { this.cookies.push(value); return this; },
  };
}
function call(handler, actor, body, params = {}, query = {}) {
  const req = { currentUser: actor, body, params, query, headers: {}, socket: {} };
  const res = response();
  handler(req, res);
  return res;
}
async function callAsync(handler, actor, body, params = {}) {
  const req = { currentUser: actor, body, params, query: {}, headers: {}, socket: {} };
  const res = response();
  await handler(req, res);
  return res;
}
function moderator() { return access.loadStore().moderator; }
function revision() { return access.loadStore()._revision; }

// ASAS sipariş kayıtları buyer rehberinin ve MAG/MMYG kataloğunun kaynağıdır.
const ORDERS = [
  { ocode: 1001, buyer: 'FATİH AVCI', merch: 'ÇOCUK', ageGroup: 'ÇOCUK-01', buyerGrup: 'LİSANS' },
  { ocode: 1002, buyer: 'FATİH AVCI', merch: 'ÇOCUK', ageGroup: 'ÇOCUK-02', buyerGrup: 'LİSANS' },
  { ocode: 1003, buyer: 'AYŞE YILMAZ', merch: 'KADIN', ageGroup: 'KADIN-05', buyerGrup: 'TEMEL' },
  { ocode: 1004, buyer: 'MEHMET DEMİR', merch: 'ERKEK', ageGroup: 'ERKEK-03', buyerGrup: 'TEMEL' },
];
function runtime() {
  const instance = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => ORDERS });
  instance.syncProfiles(ORDERS, { authoritative: true });
  return instance;
}
function createUser(instance, name, extra = {}) {
  const res = call(instance.adminCreateHandler, moderator(), Object.assign({
    expectedRevision: revision(), username: name, displayName: name, title: 'Buyer',
    systemRole: 'buyer', orgLevel: 'job_title', managerId: 'moderator',
    status: 'ACTIVE', password: 'Passw0rd!',
  }, extra));
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.user.id;
}

/* ============================ A · Sunucu ============================ */

test('v7.00 buyer rehberi kişi başına MAG/MMYG taşır ve kayıtlı kullanıcıyı işaretler', () => {
  const instance = runtime();
  const listed = call(instance.adminListHandler, moderator(), {});
  const directory = listed.body.directory;
  const fatih = directory.find(item => item.displayName === 'FATİH AVCI');
  assert.ok(fatih, 'rehberde FATİH AVCI bulunmalı');
  assert.deepEqual(fatih.mags, ['ÇOCUK']);
  assert.deepEqual(fatih.mmygs, ['ÇOCUK-01', 'ÇOCUK-02']);
  assert.equal(fatih.existingUserId, null, 'henüz kullanıcı değil');
  assert.ok(fatih.stableIds.buyerId, 'mükerrer kontrolü için sabit kimlik üretilmeli');

  createUser(instance, 'FATİH AVCI', { stableIds: fatih.stableIds });
  const again = call(instance.adminListHandler, moderator(), {});
  const marked = again.body.directory.find(item => item.displayName === 'FATİH AVCI');
  assert.ok(marked.existingUserId, 'kullanıcı oluşturulunca rehber kaydı işaretlenmeli');
  assert.equal(marked.existing, true);
});

test('v7.00 MAG seçilince yalnız o MAG in MMYG değerleri gelir', () => {
  const instance = runtime();
  const listed = call(instance.adminListHandler, moderator(), {});
  const map = listed.body.magMmyg;
  assert.deepEqual(map['ÇOCUK'], ['ÇOCUK-01', 'ÇOCUK-02']);
  assert.deepEqual(map['KADIN'], ['KADIN-05']);
  assert.ok(!map['ÇOCUK'].includes('KADIN-05'), 'başka MAG in MMYG si sızmamalı');
});

test('v7.00 aktif kullanıcı pasife alınır, inaktif listede kalır ve yeniden aktifleşir', () => {
  const instance = runtime();
  const id = createUser(instance, 'durum-turu');

  const off = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), status: 'INACTIVE', reason: 'test' }, { id });
  assert.equal(off.statusCode, 200);
  let listed = call(instance.adminListHandler, moderator(), {}).body;
  let profile = listed.profiles.find(item => item.id === id);
  assert.equal(profile.status, 'INACTIVE');
  assert.equal(profile.enabled, false);
  assert.equal(listed.profiles.filter(item => item.status !== 'ACTIVE').length, 1, 'inaktif sayacı bir olmalı');

  const on = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), status: 'ACTIVE', reason: 'test' }, { id });
  assert.equal(on.statusCode, 200);
  // Yenileme sonrası durum korunur: depo yeniden okunur.
  listed = call(instance.adminListHandler, moderator(), {}).body;
  profile = listed.profiles.find(item => item.id === id);
  assert.equal(profile.status, 'ACTIVE');
  assert.equal(profile.enabled, true);
});

test('v7.00 parola atanır, hash saklanır ve yeni parolayla giriş yapılır', async () => {
  const instance = runtime();
  const id = createUser(instance, 'parola-turu');

  const saved = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), password: 'YeniParola123', reason: 'parola' }, { id });
  assert.equal(saved.statusCode, 200);

  const stored = access.loadStore().users.find(item => item.id === id);
  assert.ok(stored.passwordHash, 'parola hash i yazılmalı');
  assert.ok(!stored.passwordHash.includes('YeniParola123'), 'açık metin parola saklanmamalı');
  assert.ok(!JSON.stringify(stored).includes('YeniParola123'), 'profilin hiçbir alanında açık parola bulunmamalı');

  const login = await callAsync(instance.loginHandler, null, { username: 'parola-turu', password: 'YeniParola123' });
  assert.equal(login.statusCode, 200, JSON.stringify(login.body));
  assert.equal(login.body.ok, true);

  const wrong = await callAsync(instance.loginHandler, null, { username: 'parola-turu', password: 'EskiParola' });
  assert.equal(wrong.statusCode, 401);
});

test('v7.00 kısa parola reddedilir', () => {
  const instance = runtime();
  const id = createUser(instance, 'kisa-parola');
  const res = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), password: 'abc', reason: 'test' }, { id });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'PASSWORD_TOO_SHORT');
});

test('v7.00 aynı kişi için ikinci hesap açılamaz ve mevcut kullanıcı bildirilir', () => {
  const instance = runtime();
  const directory = call(instance.adminListHandler, moderator(), {}).body.directory;
  const entry = directory.find(item => item.displayName === 'MEHMET DEMİR');
  const firstId = createUser(instance, 'MEHMET DEMİR', { stableIds: entry.stableIds });

  const second = call(instance.adminCreateHandler, moderator(), {
    expectedRevision: revision(), username: 'MEHMET DEMİR (2)', displayName: 'MEHMET DEMİR', title: 'Buyer',
    systemRole: 'buyer', orgLevel: 'job_title', managerId: 'moderator', status: 'ACTIVE',
    password: 'Passw0rd!', stableIds: entry.stableIds,
  });
  assert.equal(second.statusCode, 409);
  assert.equal(second.body.code, 'IDENTITY_EXISTS');
  assert.equal(second.body.existingUserId, firstId, 'mevcut kullanıcının kimliği dönmeli ki arayüz "Kullanıcıyı Aç" diyebilsin');
});

test('v7.00 yönetici ataması taşınır ve döngü backend tarafından reddedilir', () => {
  const instance = runtime();
  // Üçü de aynı organizasyon seviyesinde: sınanan kural seviye değil DÖNGÜ.
  const aId = createUser(instance, 'hiyerarsi-a');
  const bId = createUser(instance, 'hiyerarsi-b');
  const cId = createUser(instance, 'hiyerarsi-c');

  // A → B → C zinciri kurulur.
  assert.equal(call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), managerId: aId, reason: 'zincir' }, { id: bId }).statusCode, 200);
  assert.equal(call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), managerId: bId, reason: 'zincir' }, { id: cId }).statusCode, 200);
  assert.equal(access.loadStore().users.find(item => item.id === cId).managerId, bId);

  // Yönetici değiştirme çalışır ve kalıcıdır: C doğrudan A ya bağlanır.
  assert.equal(call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), managerId: aId, reason: 'taşındı' }, { id: cId }).statusCode, 200);
  assert.equal(access.loadStore().users.find(item => item.id === cId).managerId, aId);
  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), managerId: bId, reason: 'geri' }, { id: cId });

  // A → B → C varken A nın yöneticisini C yapmak döngü kurar.
  const cycle = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), managerId: cId, reason: 'döngü' }, { id: aId });
  assert.equal(cycle.statusCode, 400);
  assert.equal(cycle.body.code, 'HIERARCHY_CYCLE');
  assert.equal(access.loadStore().users.find(item => item.id === aId).managerId, 'moderator', 'reddedilen değişiklik yazılmamalı');

  const self = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), managerId: aId, reason: 'kendisi' }, { id: aId });
  assert.equal(self.statusCode, 400);
  assert.equal(self.body.code, 'HIERARCHY_CYCLE');
});

test('v7.00 yetki kopyalama varsayılan olarak hedefin mevcut yetkilerini korur', () => {
  const instance = runtime();
  const sourceId = createUser(instance, 'kopya-kaynak');
  const targetId = createUser(instance, 'kopya-hedef');

  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), permissionCodes: ['CP.EDIT', 'ORDERS.EXPORT'], reason: 'kaynak' }, { id: sourceId });
  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), permissionCodes: ['OAB.EDIT'], reason: 'hedef' }, { id: targetId });

  const merged = call(instance.permissionCopyHandler, moderator(), {
    expectedRevision: revision(), sourceUserId: sourceId, targetUserIds: [targetId],
    copyPermissions: true, reason: 'aynı ekip',
  });
  assert.equal(merged.statusCode, 200, JSON.stringify(merged.body));
  assert.equal(merged.body.mode, 'MERGE', 'mod belirtilmezse ekleme kipi kullanılır');

  const after = access.loadStore().users.find(item => item.id === targetId);
  const codes = after.directPermissions.map(item => item.permission).sort();
  assert.deepEqual(codes, ['CP.EDIT', 'OAB.EDIT', 'ORDERS.EXPORT'], 'hedefin kendi yetkisi korunup kaynağınkiler eklenmeli');
  assert.equal(new Set(codes).size, codes.length, 'mükerrer kayıt oluşmamalı');
});

test('v7.00 "kaynakla aynı yap" kipi hedefin kişisel yetkilerini kaynağınkilerle değiştirir', () => {
  const instance = runtime();
  const sourceId = createUser(instance, 'esitle-kaynak');
  const targetId = createUser(instance, 'esitle-hedef');
  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), permissionCodes: ['CP.EDIT'], reason: 'kaynak' }, { id: sourceId });
  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), permissionCodes: ['OAB.EDIT'], reason: 'hedef' }, { id: targetId });

  const replaced = call(instance.permissionCopyHandler, moderator(), {
    expectedRevision: revision(), sourceUserId: sourceId, targetUserIds: [targetId],
    copyPermissions: true, mode: 'REPLACE', reason: 'eşitleme',
  });
  assert.equal(replaced.statusCode, 200);
  assert.equal(replaced.body.mode, 'REPLACE');
  const after = access.loadStore().users.find(item => item.id === targetId);
  assert.deepEqual(after.directPermissions.map(item => item.permission), ['CP.EDIT']);
});

test('v7.00 rol yetkileri kopyalanmaz; kopyalama yalnız kişisel yetkileri taşır', () => {
  const instance = runtime();
  const sourceId = createUser(instance, 'rolsuz-kaynak', { systemRole: 'manager', orgLevel: 'mmyg', reason: 'kurulum' });
  const targetId = createUser(instance, 'rolsuz-hedef');
  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), permissionCodes: ['CP.EDIT'], reason: 'kaynak' }, { id: sourceId });

  call(instance.permissionCopyHandler, moderator(), {
    expectedRevision: revision(), sourceUserId: sourceId, targetUserIds: [targetId], copyPermissions: true, reason: 'aktarım',
  });
  const after = access.loadStore().users.find(item => item.id === targetId);
  assert.deepEqual(after.directPermissions.map(item => item.permission), ['CP.EDIT']);
  assert.equal(after.systemRole, 'buyer', 'hedefin rolü değişmemeli');
});

test('v7.00 iş yetkisi hiyerarşiyle yukarı taşınır, güvenlik yetkisi taşınmaz', () => {
  const instance = runtime();
  const managerId = createUser(instance, 'miras-yonetici', { systemRole: 'manager', orgLevel: 'mmyg', reason: 'kurulum' });
  const buyerId = createUser(instance, 'miras-buyer', { managerId });
  call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), permissionCodes: ['CP.EDIT', 'USER.MANAGE'], reason: 'alt kullanıcı' }, { id: buyerId });

  const store = access.loadStore();
  const managerProfile = store.users.find(item => item.id === managerId);
  const effective = iam.effectivePermissionDetails(managerProfile, store);
  const inherited = effective.filter(item => item.source === 'HIERARCHY').map(item => item.permission);
  assert.ok(inherited.includes('CP.EDIT'), 'normal operasyonel yetki üst yöneticiye taşınmalı');
  assert.ok(!inherited.includes('USER.MANAGE'), 'güvenlik yetkisi hiyerarşiyle devredilmemeli');
});

test('v7.00 rol matrisi kaydı kalıcıdır ve o roldeki kullanıcıya yansır', () => {
  const instance = runtime();
  const userId = createUser(instance, 'matris-kullanici', { systemRole: 'manager', orgLevel: 'mmyg', reason: 'kurulum' });
  const before = call(instance.adminListHandler, moderator(), {}).body.roleDefinitions.manager.permissions;
  assert.ok(!before.includes('SYSTEM.MANAGE'));

  const roles = JSON.parse(JSON.stringify(call(instance.adminListHandler, moderator(), {}).body.roleDefinitions));
  roles.manager.permissions = [...new Set([...roles.manager.permissions, 'QUOTATIONS.APPROVE'])];
  const saved = call(instance.roleMatrixUpdateHandler, moderator(), { expectedRevision: revision(), roles, reason: 'Manager onay yetkisi', confirmCritical: true });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));

  const listed = call(instance.adminListHandler, moderator(), {}).body;
  assert.ok(listed.roleDefinitions.manager.permissions.includes('QUOTATIONS.APPROVE'), 'kaydedilen seçim yeniden okunduğunda korunmalı');
  const profile = listed.profiles.find(item => item.id === userId);
  const roleGranted = profile.effectivePermissions.filter(item => item.source === 'ROLE').map(item => item.permission);
  assert.ok(roleGranted.includes('QUOTATIONS.APPROVE'), 'roldeki kullanıcı güncel efektif yetkiyi almalı');
});

test('v7.00 alt kullanıcısı olan bir kullanıcı doğrudan pasife alınamaz', () => {
  const instance = runtime();
  const managerId = createUser(instance, 'pasif-yonetici', { systemRole: 'manager', orgLevel: 'mmyg', reason: 'kurulum' });
  createUser(instance, 'pasif-alt', { managerId });
  const res = call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), status: 'INACTIVE', reason: 'test' }, { id: managerId });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'SUPERVISOR_HAS_REPORTS');
});

/* ============================ B · Arayüz ============================ */

// Arayüz sabit veri kümesi BİR KEZ kurulur; her çağrıda yeniden kullanıcı
// oluşturmak "bu kullanıcı adı zaten kullanılıyor" hatası verirdi.
let uiFixture = null;
function uiModel() {
  if (!uiFixture) {
    const instance = runtime();
    createUser(instance, 'AKTİF KULLANICI', { mags: ['ÇOCUK'], mmygs: ['ÇOCUK-01'] });
    const inactiveId = createUser(instance, 'PASİF KULLANICI', { mags: ['KADIN'] });
    call(instance.adminUpdateHandler, moderator(), { expectedRevision: revision(), status: 'INACTIVE', reason: 'test' }, { id: inactiveId });
    uiFixture = call(instance.adminListHandler, moderator(), {}).body;
  }
  return JSON.parse(JSON.stringify(uiFixture));
}

async function bootUi(overrides = {}) {
  const model = Object.assign(uiModel(), overrides);
  const env = loadUserManagement({ model, source: UI_SOURCE });
  await env.open();
  return env;
}

test('v7.00 arayüz beş bölümü de gerçekten çizer', async () => {
  const env = await bootUi();
  assert.match(env.nav, /Kullanıcılar/);
  for (const [section, marker] of [
    ['users', /umTable|umEmpty/],
    ['roles', /umMatrix/],
    ['organization', /umTree/],
    ['copy', /umCopyGrid/],
    ['history', /umHistoryList|umEmpty/],
  ]) {
    env.click({ act: 'section', id: section });
    assert.ok(env.main.length > 200, `${section} bölümü boş çizildi`);
    assert.match(env.main, marker, `${section} bölümünün ana bileşeni bulunamadı`);
  }
});

test('v7.00 Tümü / Aktif / İnaktif sekmeleri sayaç gösterir ve inaktif liste anında dolar', async () => {
  const env = await bootUi();
  env.click({ act: 'section', id: 'users' });
  assert.match(env.main, /data-act="statusFilter" data-id="all"/);
  assert.match(env.main, /data-act="statusFilter" data-id="active"/);
  assert.match(env.main, /data-act="statusFilter" data-id="inactive"/);
  assert.match(env.main, /Aktif<\/span><b>\d+<\/b>/, 'aktif sayacı görünmeli');

  env.click({ act: 'statusFilter', id: 'inactive' });
  const inactive = env.main;
  assert.match(inactive, /PASİF KULLANICI/);
  assert.ok(!inactive.includes('AKTİF KULLANICI'), 'inaktif sekmesinde aktif kullanıcı listelenmemeli');
  assert.match(inactive, /data-act="activate"/, 'her inaktif kullanıcıda Aktifleştir düğmesi olmalı');

  env.click({ act: 'statusFilter', id: 'active' });
  assert.match(env.main, /AKTİF KULLANICI/);
  assert.match(env.main, /data-act="deactivate"/);
});

test('v7.00 inaktif kullanıcı yoksa boş ekran açıklamalı metin gösterir', async () => {
  const model = uiModel();
  model.profiles = model.profiles.filter(item => item.status === 'ACTIVE');
  const env = loadUserManagement({ model, source: UI_SOURCE });
  await env.open();
  env.click({ act: 'statusFilter', id: 'inactive' });
  assert.match(env.main, /umEmpty/);
  assert.match(env.main, /İnaktif kullanıcı bulunmuyor/);
});

test('v7.00 aktifleştirme uzun form değil küçük onay penceresi açar', async () => {
  const env = await bootUi();
  const inactive = env.context.window.document.body.children.length;
  env.click({ act: 'statusFilter', id: 'inactive' });
  env.click({ act: 'activate', id: uiModel().profiles.find(item => item.status !== 'ACTIVE').id });
  const dialog = env.body.children[env.body.children.length - 1];
  assert.ok(env.body.children.length > inactive, 'onay penceresi açılmalı');
  assert.match(dialog.innerHTML, /aktifleştirilsin mi\?/);
  assert.match(dialog.innerHTML, /Aktifleştir<\/button>/);
});

test('v7.00 kullanıcı detayı özet, düzenleme ve yetki sekmeleriyle açılır', async () => {
  const env = await bootUi();
  const target = uiModel().profiles.find(item => item.username === 'AKTİF KULLANICI');
  env.click({ act: 'openDetail', id: target.id });
  assert.match(env.main, /umDrawer/);
  assert.match(env.main, /Toplam Yetkiler/);
  assert.match(env.main, /data-act="password"/, 'yerel kimlik doğrulamada parola aksiyonu görünmeli');
  assert.match(env.main, /data-act="copyFrom"/);

  env.click({ act: 'detailTab', id: 'edit' });
  const edit = env.main;
  assert.match(edit, /data-um-form="profile"/);
  for (const field of ['name="systemRole"', 'name="mag"', 'name="mmyg"', 'name="managerId"', 'name="scopeMode"']) {
    assert.ok(edit.includes(field), `düzenleme panelinde ${field} bulunmalı`);
  }

  env.click({ act: 'detailTab', id: 'permissions' });
  assert.match(env.main, /data-um-form="grants"/);
});

test('v7.00 veri kapsamı teknik kod yerine anlaşılır karşılıklarla gösterilir', async () => {
  const env = await bootUi();
  const target = uiModel().profiles.find(item => item.username === 'AKTİF KULLANICI');
  env.click({ act: 'openDetail', id: target.id });
  const html = env.main;
  assert.match(html, /Veri Kapsamı/);
  assert.match(html, /Kendi Kayıtları/);
  assert.ok(!/>SELF</.test(html), 'ham SELF/TEAM kodları ekrana yazılmamalı');
});

test('v7.00 rol · yetki matrisi sabit modül sütunu, kategoriler ve toplu seçim taşır', async () => {
  const env = await bootUi();
  env.click({ act: 'section', id: 'roles' });
  const html = env.main;
  assert.match(html, /umMatrixModule/, 'sabit Modül sütunu olmalı');
  assert.match(html, /data-act="toggleCategory"/, 'kategoriler katlanabilir olmalı');
  assert.match(html, /data-act="toggleColumn"/, 'kolon başlığından toplu açma olmalı');
  assert.match(html, /data-um-permsearch/, 'yetki arama alanı olmalı');
  assert.match(html, /Değişiklikleri Kaydet/);
  assert.match(html, /Vazgeç/);
  for (const role of ['Buyer', 'Manager', 'Senior Manager', 'Moderatör']) assert.ok(html.includes(role), `${role} sekmesi olmalı`);
});

test('v7.00 matriste yapılan değişiklik kaydedilene kadar sunucuya gitmez', async () => {
  const env = await bootUi();
  env.click({ act: 'section', id: 'roles' });
  const before = env.calls.length;
  env.change('[data-um-rolecell]', { dataset: { umRolecell: 'ORDERS.EXPORT' }, checked: true });
  env.click({ act: 'toggleColumn', id: 'VIEW' });
  assert.equal(env.calls.length, before, 'her kutucuk için ayrı istek gönderilmemeli');
  env.click({ act: 'saveRoles' });
  const dialog = env.body.children[env.body.children.length - 1];
  assert.match(dialog.innerHTML, /Rol Yetkilerini Kaydet/, 'kaydetme öncesi değişiklik özeti gösterilmeli');
});

test('v7.00 yetki arama modülleri filtreler', async () => {
  const env = await bootUi();
  env.click({ act: 'section', id: 'roles' });
  env.input('[data-um-permsearch]', 'backlog');
  const html = env.main;
  assert.match(html, /Backlog/);
  assert.ok(!html.includes('Nakliye Kıyaslama'), 'aramayla eşleşmeyen modül gizlenmeli');
});

test('v7.00 organizasyon ağacı manager_user_id üzerinden kurulur ve yönetici değiştirilebilir', async () => {
  const env = await bootUi();
  env.click({ act: 'section', id: 'organization' });
  assert.match(env.main, /umTree/);
  assert.match(env.main, /data-um-node="moderator"/, 'kök düğüm çizilmeli');
  const target = uiModel().profiles.find(item => item.username === 'AKTİF KULLANICI');
  env.click({ act: 'orgSelect', id: target.id });
  const panel = env.main;
  assert.match(panel, /data-um-form="manager"/);
  assert.match(panel, /Alt Kullanıcı Ekle/);
  assert.match(panel, /Kullanıcıyı Düzenle/);
});

test('v7.01 profil kopyalama önizleme penceresi kaynağı, yetkileri, workspace kategorilerini, hedefleri ve kipi gösterir', async () => {
  const model = uiModel();
  const source = model.profiles.find(item => item.username === 'AKTİF KULLANICI');
  const other = model.profiles.find(item => item.id !== source.id && item.id !== 'moderator');
  source.directPermissions = [{ id: 'g1', permission: 'CP.EDIT', source: 'DIRECT' }];
  const env = loadUserManagement({ model, source: UI_SOURCE, fetchImpl: async url => ({
    ok: true, status: 200, statusText: 'OK',
    json: async () => String(url).includes('/api/iam/profile-copy/preview')
      ? { ok: true, preview: true, sourceUserId: source.id, sourceName: source.displayName, mode: 'MERGE', targets: [{ targetUserId: other.id, targetName: other.displayName, status: 'READY' }] }
      : model,
  }) });
  await env.open();
  env.click({ act: 'section', id: 'copy' });
  assert.match(env.main, /Mevcut Ayarlara Ekle/);
  assert.match(env.main, /Seçilen Kategorileri Değiştir/);
  assert.match(env.main, /Horizon/);
  assert.match(env.main, /Kolon düzenleri/);

  env.change('[data-um-copysource]', { dataset: {}, value: source.id });
  env.change('[data-um-copytarget]', { dataset: { umCopytarget: other.id }, checked: true });
  env.click({ act: 'copyPreview' });
  for (let index = 0; index < 6; index += 1) await new Promise(resolve => setImmediate(resolve));
  const dialog = env.body.children[env.body.children.length - 1];
  assert.match(dialog.innerHTML, /Kaynak/);
  assert.match(dialog.innerHTML, /1 kişisel yetki dahil/);
  assert.match(dialog.innerHTML, /horizon/);
  assert.match(dialog.innerHTML, new RegExp(other.displayName));
});

test('v7.00 değişiklik geçmişi teknik döküm yerine cümle gösterir', async () => {
  const model = uiModel();
  model.audit = [{
    id: 'a1', at: '2026-08-24T12:42:00.000Z', action: 'USER_UPDATE', actor: 'Gökberk', targetId: 'u1', reason: 'terfi',
    details: {
      targetName: 'FATİH AVCI',
      oldValue: { systemRole: 'buyer', status: 'ACTIVE', managerId: '', mags: [], mmygs: [], directPermissions: [] },
      newValue: { systemRole: 'manager', status: 'ACTIVE', managerId: '', mags: [], mmygs: [], directPermissions: [] },
    },
  }];
  const env = loadUserManagement({ model, source: UI_SOURCE });
  await env.open();
  env.click({ act: 'section', id: 'history' });
  const html = env.main;
  assert.match(html, /FATİH AVCI/);
  assert.match(html, /Buyer → Manager/);
  assert.ok(!html.includes('USER_UPDATE'), 'ham eylem kodu gösterilmemeli');
  assert.match(html, /Gerekçe: terfi/);
});

test('v7.00 yükleme ve hata durumları ekranı boş bırakmaz', async () => {
  const failing = loadUserManagement({
    source: UI_SOURCE,
    fetchImpl: async () => ({ ok: false, status: 500, statusText: 'Server Error', json: async () => ({ error: 'Kullanıcılar okunamadı.' }) }),
  });
  await failing.open();
  assert.match(failing.main, /Kullanıcılar yüklenemedi/);
  assert.match(failing.main, /data-act="retry"/);

  let resolveFetch;
  const pending = loadUserManagement({
    source: UI_SOURCE,
    fetchImpl: () => new Promise(resolve => { resolveFetch = resolve; }),
  });
  pending.api.open();
  assert.match(pending.main, /umSpinner/, 'istek sürerken yükleniyor durumu gösterilmeli');
  resolveFetch({ ok: true, json: async () => uiModel() });
});

test('v7.00 kullanıcı oluşturma penceresi buyer otomatik tamamlaması ve zorunlu yönetici ister', async () => {
  const env = await bootUi();
  env.click({ act: 'newUser' });
  const dialog = env.body.children[env.body.children.length - 1];
  const html = dialog.innerHTML;
  assert.match(html, /data-um-candidate/, 'kişi seçimi Buyer veritabanından otomatik tamamlanmalı');
  assert.match(html, /MAG: /, 'öneride MAG bilgisi görünmeli');
  /* v7.37 — GÜNCELLENDİ (§156). İddianın amacı aynı: pencerede MAG ve MMYG
     alanları bulunmalı. Değişen yalnız DENETİM: tek değerlik metin kutusu
     yerine artık çoklu seçim çipleri var (kullanıcı "çoktan seçmeli olsun ve
     istenildiği kadar alan atanabilsin" dedi). Buying Group da aynı denetimi
     kullandığı için o da doğrulanır. */
  assert.match(html, /data-um-chipfield="mag"/);
  assert.match(html, /data-um-chipfield="mmyg"/);
  assert.match(html, /data-um-chipfield="buyingGroup"/);
  assert.match(html, /data-um-chippick/, 'veri tabanı seçenekleri sunulmalı');
  assert.match(html, /data-um-chipnew/, 'elle giriş açık olmalı');
  assert.match(html, /name="managerId" required/, 'yönetici alanı zorunlu olmalı');
  assert.match(html, /name="password"/);
  for (const role of ['Buyer', 'Manager', 'Senior Manager', 'Moderatör']) assert.ok(html.includes(role));
});

/* ============================ C · Kurulum ============================ */

test('v7.00 eski yönetim arayüzü kaldırıldı ve yenisi yükleniyor', () => {
  for (const marker of ['data-select-user', 'iamWizard', 'data-role-permission', 'data-copy-target', 'openCreateWizard', 'rolesView']) {
    assert.ok(!ACCESS_UI.includes(marker), `eski arayüz kalıntısı: ${marker}`);
  }
  assert.match(ACCESS_UI, /window\.BLUserManagement/, 'menü yeni ekrana yönlendirmeli');
  assert.match(ACCESS_UI, /Kullanıcılar ve Hiyerarşi/, 'yükseltme tanılaması için eski ekran adı yorumda kalmalı');
  // v7.69: 138 KB'lık ekran betiği açılışta eager değil; stil dosyası eager
  // kalıyor çünkü katman sırası (design-butunluk.css sonrası) korunmalı.
  assertLazy('user-management.js');
  assert.match(INDEX, /<link rel="stylesheet" href="user-management\.css\?v=__BL_ASSET_VERSION__">/);
  // Yeni katman en sonda yüklenmeli ki app.css / design.css ile çakışmasın.
  assert.ok(INDEX.indexOf('user-management.css') > INDEX.indexOf('design-butunluk.css'));
});

test('v7.00 stil katmanı yalnız um öneki kullanır ve !important gerektirmez', () => {
  // Yorumlar sayılmaz: metinde "!important" geçen açıklama satırları var.
  const rules = UI_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...rules.matchAll(/(^|[},])\s*(\.[A-Za-z][\w-]*)/g)].map(match => match[2]);
  const foreign = [...new Set(selectors.filter(selector => !selector.startsWith('.um')))];
  assert.deepEqual(foreign, [], `um öneki taşımayan seçiciler: ${foreign.join(', ')}`);
  assert.ok(!rules.includes('!important'), 'yeni katmanda !important gerekmemeli');
});

test('v7.00 matris ve kullanıcı tablosunda başlık ile ilk sütun sabitlenir', () => {
  assert.match(UI_CSS, /\.umTable thead th\{[^}]*position:sticky/);
  assert.match(UI_CSS, /\.umMatrix thead th\{[^}]*position:sticky/);
  assert.match(UI_CSS, /\.umMatrixModule\{[^}]*position:sticky[^}]*left:0/);
  assert.match(UI_CSS, /\.umMatrixWrap\{[^}]*overflow:auto/);
});
