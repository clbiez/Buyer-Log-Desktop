'use strict';

/* v7.01 — Personal Workspace, kullanıcıya özel Horizon ve profil snapshot
 * kopyalama koruma testleri. Bu dosya özellikle iki eşzamanlı kullanıcının
 * birbirinin sorgu kapsamını ve görünüm tercihlerini etkileyemediğini sabitler. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-workspace-v701-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const prefs = require('../server/lib/user-preferences');
const access = require('../server/lib/user-access');
const iam = require('../server/lib/iam-core');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const STORAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-storage.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(key, value) { this.headers[key] = value; return this; },
  };
}
function call(handler, actor, body, params = {}, query = {}) {
  const req = { currentUser: actor, body, params, query, headers: {}, socket: {} };
  const res = response(); handler(req, res); return res;
}
function moderator() { return access.loadStore().moderator; }
function revision() { return access.loadStore()._revision; }
function runtime() { return access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] }); }
function createUser(instance, username, extra = {}) {
  const res = call(instance.adminCreateHandler, moderator(), {
    expectedRevision: revision(), username, displayName: username,
    title: extra.systemRole === 'manager' ? 'Manager' : 'Buyer', systemRole: 'buyer',
    orgLevel: 'job_title', managerId: 'moderator', status: 'ACTIVE', password: 'Passw0rd!',
    reason: 'v7.01 test user', confirmCritical: true,
    ...extra,
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  return res.body.user.id;
}
function profile(id) {
  const store = access.loadStore();
  return id === 'moderator' ? store.moderator : store.users.find(item => item.id === id);
}
function horizon(month) {
  return { table: 'ASAS_30', groups: [{ field: 'In Store', values: [`2026-${String(month).padStart(2, '0')}`] }] };
}

test('iki kullanıcı aynı modülde farklı Horizon ile sorgu scope üretir ve bağlantı tanımını değiştirmez', () => {
  const connections = [{
    id: 'asas-main', role: 'ASAS', enabled: true,
    scopes: [{ id: 'orders-scope', enabled: true, targets: ['cp', 'backlog'], horizon: horizon(1) }],
  }];
  prefs.saveHorizon('user-a', 'backlog', horizon(6), { connectionId: 'asas-main', role: 'ASAS' });
  prefs.saveHorizon('user-b', 'backlog', horizon(12), { connectionId: 'asas-main', role: 'ASAS' });

  const forA = prefs.applyHorizonOverrides(connections, 'user-a', ['backlog']);
  const forB = prefs.applyHorizonOverrides(connections, 'user-b', ['backlog']);
  const aScope = forA[0].scopes.find(scope => scope.targets.includes('backlog'));
  const bScope = forB[0].scopes.find(scope => scope.targets.includes('backlog'));

  assert.deepEqual(aScope.horizon, horizon(6));
  assert.deepEqual(bScope.horizon, horizon(12));
  assert.notDeepEqual(aScope.horizon, bScope.horizon);
  assert.deepEqual(connections[0].scopes[0].horizon, horizon(1), 'ortak bağlantı tanımı mutate edilmemeli');
  assert.equal(aScope._personalHorizon, true);
  assert.equal(bScope._personalHorizon, true);
});

test('Horizon user + module bazında ayrıdır ve default fallback yalnız aynı kullanıcıdan gelir', () => {
  prefs.saveHorizon('user-a', 'default', horizon(2));
  prefs.saveHorizon('user-a', 'cp', horizon(3));
  prefs.saveHorizon('user-b', 'default', horizon(9));
  assert.deepEqual(prefs.resolveHorizon('user-a', 'cp', horizon(1)), horizon(3));
  assert.deepEqual(prefs.resolveHorizon('user-a', 'orders', horizon(1)), horizon(2));
  assert.deepEqual(prefs.resolveHorizon('user-b', 'orders', horizon(1)), horizon(9));
});

test('filtre, kolon ve görünüm tercihleri gerçek user ID ile izole edilir', () => {
  prefs.merge('user-a', {
    'lcw.cp.dimFilters.v1': { value: JSON.stringify({ manufacturer: ['X'] }) },
    'lcw.table.columnState.cp': { value: JSON.stringify({ hidden: ['FOB'] }) },
  });
  prefs.merge('user-b', {
    'lcw.cp.dimFilters.v1': { value: JSON.stringify({ manufacturer: ['Y'] }) },
    'lcw.table.columnState.cp': { value: JSON.stringify({ hidden: ['Termin'] }) },
  });
  assert.notEqual(prefs.load('user-a').entries['lcw.cp.dimFilters.v1'].value, prefs.load('user-b').entries['lcw.cp.dimFilters.v1'].value);
  assert.notEqual(prefs.load('user-a').entries['lcw.table.columnState.cp'].value, prefs.load('user-b').entries['lcw.table.columnState.cp'].value);
  assert.match(STORAGE, /bl\.user\./, 'local cache anahtarı da user ID ile scope edilmelidir');
});

test('workspace snapshot MERGE bağımsızdır; kaynak sonradan değişince hedef değişmez', () => {
  prefs.merge('copy-source', {
    'lcw.cp.dimFilters.v1': { value: 'SOURCE-A' },
    'lcw.table.columnState.cp': { value: 'COLUMNS-A' },
  });
  prefs.merge('copy-target', {
    'lcw.orders.dimFilters.v1': { value: 'TARGET-ORDERS' },
  });
  prefs.copyWorkspaceSnapshot('copy-source', 'copy-target', ['filters', 'columns'], 'MERGE');
  let target = prefs.load('copy-target').entries;
  assert.equal(target['lcw.cp.dimFilters.v1'].value, 'SOURCE-A');
  assert.equal(target['lcw.table.columnState.cp'].value, 'COLUMNS-A');
  assert.equal(target['lcw.orders.dimFilters.v1'].value, 'TARGET-ORDERS');

  prefs.merge('copy-source', { 'lcw.cp.dimFilters.v1': { value: 'SOURCE-B', updatedAt: '2031-01-01T00:00:00.000Z' } });
  target = prefs.load('copy-target').entries;
  assert.equal(target['lcw.cp.dimFilters.v1'].value, 'SOURCE-A', 'kopyalama canlı inheritance olmamalı');
});

test('workspace REPLACE yalnız seçilen kategoriyi değiştirir', () => {
  prefs.merge('replace-source', { 'lcw.cp.dimFilters.v1': { value: 'NEW' } });
  prefs.merge('replace-target', {
    'lcw.orders.dimFilters.v1': { value: 'OLD' },
    'lcw.table.columnState.cp': { value: 'KEEP-COLUMNS' },
    'lcw.todo.pages.v1': { value: 'KEEP-NOTES' },
  });
  prefs.copyWorkspaceSnapshot('replace-source', 'replace-target', ['filters'], 'REPLACE');
  const target = prefs.load('replace-target').entries;
  assert.equal(target['lcw.cp.dimFilters.v1'].value, 'NEW');
  assert.equal(target['lcw.orders.dimFilters.v1'], undefined);
  assert.equal(target['lcw.table.columnState.cp'].value, 'KEEP-COLUMNS');
  assert.equal(target['lcw.todo.pages.v1'].value, 'KEEP-NOTES');
});

test('profil kopyalama aynı snapshotı beş hedefe uygular, partial failure raporlar ve organizasyonu değiştirmez', () => {
  const instance = runtime();
  const sourceId = createUser(instance, 'PROFILE SOURCE', { permissionCodes: ['CP.EDIT'], mags: ['SOURCE-MAG'], mmygs: ['SOURCE-MMYG'] });
  const targetIds = Array.from({ length: 5 }, (_, index) => createUser(instance, `PROFILE TARGET ${index + 1}`, {
    permissionCodes: index === 0 ? ['ORDERS.EXPORT'] : [], mags: [`TARGET-MAG-${index + 1}`], mmygs: [`TARGET-MMYG-${index + 1}`],
  }));
  prefs.saveHorizon(sourceId, 'backlog', horizon(8));
  prefs.merge(sourceId, { 'lcw.lfl.filters.v1': { value: 'LFL-SOURCE' }, 'lcw.table.columnState.cp': { value: 'COL-SOURCE' } });

  const result = call(instance.profileCopyHandler, moderator(), {
    expectedRevision: revision(), sourceUserId: sourceId, targetUserIds: [...targetIds, 'missing-user'], mode: 'MERGE',
    categories: { userPermissions: true, workspace: { horizon: true, filters: true, columns: true }, organization: {} },
    reason: 'v7.01 multi-user profile test',
  });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.body.success, 5);
  assert.equal(result.body.failed, 1);
  assert.equal(result.body.results.find(item => item.targetUserId === 'missing-user').code, 'TARGET_USER_NOT_FOUND');

  const audit = call(instance.auditListHandler, moderator(), {}, {}, { action: 'USER_PROFILE_COPIED', limit: 10 });
  assert.equal(audit.statusCode, 200);
  assert.equal(audit.body.items[0].action, 'USER_PROFILE_COPIED');
  assert.equal(audit.body.items[0].details.mode, 'MERGE');
  assert.equal(audit.body.items[0].details.success, 5);
  assert.equal(audit.body.items[0].details.failed, 1);

  for (let index = 0; index < targetIds.length; index += 1) {
    const target = profile(targetIds[index]);
    const codes = new Set(target.directPermissions.map(item => item.permission));
    assert.equal(codes.has('CP.EDIT'), true);
    if (index === 0) assert.equal(codes.has('ORDERS.EXPORT'), true, 'MERGE mevcut kişisel yetkiyi korumalı');
    assert.deepEqual(target.mags, [`TARGET-MAG-${index + 1}`], 'organizasyon default kopyalanmamalı');
    assert.deepEqual(prefs.getHorizon(target.id, 'backlog'), horizon(8));
    assert.equal(prefs.load(target.id).entries['lcw.lfl.filters.v1'].value, 'LFL-SOURCE');
    assert.equal(prefs.load(target.id).entries['lcw.table.columnState.cp'].value, 'COL-SOURCE');
  }
});

test('REPLACE yalnız seçilen workspace alanını değiştirir; rol, MAG, MMYG ve manager kalır', () => {
  const instance = runtime();
  const sourceId = createUser(instance, 'REPLACE SOURCE');
  const targetId = createUser(instance, 'REPLACE TARGET', { systemRole: 'manager', title: 'Manager', mags: ['M1'], mmygs: ['MM1'] });
  prefs.merge(sourceId, { 'lcw.cp.dimFilters.v1': { value: 'SOURCE-FILTER' } });
  prefs.merge(targetId, { 'lcw.orders.dimFilters.v1': { value: 'TARGET-FILTER' }, 'lcw.table.columnState.cp': { value: 'TARGET-COLUMNS' } });
  const before = profile(targetId);
  const org = { systemRole: before.systemRole, mags: before.mags, mmygs: before.mmygs, managerId: before.managerId };
  const result = call(instance.profileCopyHandler, moderator(), {
    sourceUserId: sourceId, targetUserIds: [targetId], mode: 'REPLACE', categories: { userPermissions: false, workspace: { filters: true }, organization: {} }, reason: 'replace workspace only',
  });
  assert.equal(result.body.success, 1, JSON.stringify(result.body));
  const after = profile(targetId), entries = prefs.load(targetId).entries;
  assert.deepEqual({ systemRole: after.systemRole, mags: after.mags, mmygs: after.mmygs, managerId: after.managerId }, org);
  assert.equal(entries['lcw.cp.dimFilters.v1'].value, 'SOURCE-FILTER');
  assert.equal(entries['lcw.orders.dimFilters.v1'], undefined);
  assert.equal(entries['lcw.table.columnState.cp'].value, 'TARGET-COLUMNS');
});

test('actor sahip olmadığı güvenlik yetkisini profil kopyalama ile devredemez', () => {
  const instance = runtime();
  const managerId = createUser(instance, 'COPY MANAGER', { systemRole: 'manager', title: 'Manager', permissionCodes: ['USER.PROFILE_COPY', 'USER.MANAGE'] });
  const sourceId = createUser(instance, 'SECURITY SOURCE', { managerId, permissionCodes: ['SYSTEM.MANAGE'] });
  const targetId = createUser(instance, 'SECURITY TARGET', { managerId });
  const result = call(instance.profileCopyHandler, profile(managerId), {
    sourceUserId: sourceId, targetUserIds: [targetId], mode: 'MERGE', categories: { userPermissions: true, workspace: {}, organization: {} }, reason: 'must reject escalation',
  });
  assert.equal(result.body.success, 0);
  assert.equal(result.body.failed, 1);
  assert.equal(result.body.results[0].code, 'PERMISSION_ESCALATION_DENIED');
  assert.equal(profile(targetId).directPermissions.some(item => item.permission === 'SYSTEM.MANAGE'), false);
});

test('operasyonel ortak veriler workspace whitelistine girmez ve profil kopyasıyla taşınmaz', () => {
  for (const key of ['lcw.koleksiyon.rows.v1', 'lcw.collection.notes.v1', 'lcw.cp.terminRevisions.v1', 'login.sessions']) {
    assert.equal(prefs.categoryForKey(key), null, `${key} kişisel workspace olmamalı`);
    assert.equal(prefs.isSyncedKey(key), false, `${key} profil deposuna yazılmamalı`);
  }
});

test('workspace API client user ID değerine güvenmez; session kullanıcısını kullanır ve cache sonuçları kullanıcı bazlıdır', () => {
  assert.match(SERVER, /\/api\/iam\/profile-copy\/preview', userAccess\.requireCapability\('USER\.PROFILE_COPY'\)/);
  assert.match(SERVER, /\/api\/iam\/profile-copy', userAccess\.requireCapability\('USER\.PROFILE_COPY'\)/);
  assert.match(SERVER, /userPreferences\.merge\(req\.currentUser\.id/);
  assert.match(SERVER, /userPreferences\.saveHorizon\(req\.currentUser\.id/);
  assert.match(SERVER, /userPreferences\.resetWorkspace\(req\.currentUser\.id/);
  // v7.23: çağrıya MAG/MMYG/Buying Group ön ayar çözücüsü 5. argüman olarak
  // eklendi. Testin AMACI değişmedi — override hâlâ SESSION kullanıcısı ve rol
  // varsayılanlarıyla çözülüyor; imza kontrolü yeni argümanı da kapsar.
  assert.match(SERVER, /applyHorizonOverrides\(store\.items,id,requestedTargets,userAccess\.roleWorkspaceEntries\(value\)\)/);
  assert.match(SERVER, /function cacheForUser\(value\)/);
  assert.match(SERVER, /sourceCaches\.get\(id\)/);
  assert.match(SERVER, /const snapshot = await hydrateModelSnapshotAsync\(id\);/);
  assert.doesNotMatch(SERVER, /hydrateModelSnapshot(?:Async)?\(id\) \|\| hydrateSharedModelSnapshot\(id\)/);
  assert.doesNotMatch(SERVER, /globalHorizon|sharedBacklogFilter/);
});

test('Reset My View yalnız aktif modülün authenticated workspace endpointini kullanır', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-access-ui.js'), 'utf8');
  assert.match(ui, /Görünümümü Sıfırla/);
  assert.match(ui, /\/api\/user-workspace\/\$\{encodeURIComponent\(module\)\}\/reset/);
  assert.match(ui, /categories: \['horizon','filters','columns','views','dashboard','favorites'\]/);
});

test('Gökberk moderatör migrasyonda korunur ve PROFILE_COPY varsayılan yetkisini alır', () => {
  const legacy = iam.migrateStore({
    schemaVersion: 4,
    moderator: { id: 'moderator', username: 'Gökberk', displayName: 'Gökberk', role: 'moderator', systemRole: 'moderator', enabled: true, status: 'ACTIVE' },
    users: [], iam: { version: 1, roles: {} },
  });
  assert.equal(legacy.moderator.displayName, 'Gökberk');
  assert.equal(iam.hasPermission(legacy.moderator, 'USER.PROFILE_COPY', legacy), true);
});
