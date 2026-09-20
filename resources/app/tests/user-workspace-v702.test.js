'use strict';

/* v7.02 — Rol workspace varsayılanları ve standart profil şablonları. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-workspace-v702-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const prefs = require('../server/lib/user-preferences');
const access = require('../server/lib/user-access');
const iam = require('../server/lib/iam-core');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
const STORAGE = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-storage.js'), 'utf8');
const UI = fs.readFileSync(path.join(__dirname, '..', 'public', 'user-management.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; } };
}
function call(handler, actor, body = {}, params = {}, query = {}) {
  const req = { currentUser: actor, body, params, query, headers: {}, socket: {} }, res = response();
  handler(req, res); return res;
}
function moderator() { return access.loadStore().moderator; }
function revision() { return access.loadStore()._revision; }
function runtime() { return access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] }); }
function horizon(month) { return { table: 'ASAS_30', groups: [{ field: 'In Store', values: [`2026-${String(month).padStart(2, '0')}`] }] }; }
function entry(value) { return { value: JSON.stringify(value), updatedAt: '2026-08-24T00:00:00.000Z' }; }
function createUser(instance, name, role = 'buyer') {
  const result = call(instance.adminCreateHandler, moderator(), {
    expectedRevision: revision(), username: name, displayName: name, title: iam.SYSTEM_ROLES[role], systemRole: role,
    orgLevel: role === 'buyer' ? 'job_title' : role === 'manager' ? 'mmyg' : 'mag', managerId: 'moderator',
    status: 'ACTIVE', password: 'Passw0rd!', reason: 'v7.02 test user', confirmCritical: true,
  });
  assert.equal(result.statusCode, 201, JSON.stringify(result.body));
  return result.body.user.id;
}

test('Horizon fallback sırası User Module → User Default → Role Module → Role Default → Application Default olur', () => {
  const roleEntries = {
    [prefs.horizonKey('default')]: entry(horizon(4)),
    [prefs.horizonKey('backlog')]: entry(horizon(5)),
  };
  assert.deepEqual(prefs.resolveHorizon('fallback-user', 'backlog', horizon(1), {}, roleEntries), horizon(5));
  prefs.saveHorizon('fallback-user', 'default', horizon(6));
  assert.deepEqual(prefs.resolveHorizon('fallback-user', 'backlog', horizon(1), {}, roleEntries), horizon(6));
  prefs.saveHorizon('fallback-user', 'backlog', horizon(7));
  assert.deepEqual(prefs.resolveHorizon('fallback-user', 'backlog', horizon(1), {}, roleEntries), horizon(7));
  assert.deepEqual(prefs.resolveHorizon('fresh-user', 'orders', horizon(1), {}, {}), horizon(1));
});

test('rol workspace fallback kişisel kaydı ezmez ve ayrı kaynak olarak kalır', () => {
  const roleEntries = {
    'lcw.cp.dimFilters.v1': { value: 'ROLE-FILTER', updatedAt: '2026-08-24T00:00:00.000Z' },
    'lcw.table.columnState.cp': { value: 'ROLE-COLUMNS', updatedAt: '2026-08-24T00:00:00.000Z' },
  };
  prefs.merge('effective-user', { 'lcw.cp.dimFilters.v1': { value: 'PERSONAL-FILTER', updatedAt: '2026-08-25T00:00:00.000Z' } });
  const effective = prefs.effectiveWorkspaceEntries('effective-user', roleEntries);
  assert.equal(effective.entries['lcw.cp.dimFilters.v1'].value, 'PERSONAL-FILTER');
  assert.equal(effective.entries['lcw.table.columnState.cp'].value, 'ROLE-COLUMNS');
  assert.equal(effective.personal['lcw.table.columnState.cp'], undefined);
  assert.equal(effective.inherited['lcw.cp.dimFilters.v1'].value, 'ROLE-FILTER');
});

test('IAM v4 workspace şablonlarını migrate eder ve Gökberk Moderatörü korur', () => {
  const migrated = iam.migrateStore({
    moderator: { id: 'moderator', username: 'Gökberk', displayName: 'Gökberk', systemRole: 'moderator', role: 'moderator', enabled: true }, users: [],
    iam: { version: 2, roles: {}, workspaceTemplates: { buyer: { entries: { 'lcw.cp.dimFilters.v1': { value: 'X' } }, sourceName: 'SOURCE' } } },
  });
  assert.equal(migrated.iam.version, 5);
  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.moderator.displayName, 'Gökberk');
  assert.equal(migrated.iam.workspaceTemplates.buyer.sourceName, 'SOURCE');
});

test('mevcut workspace servisi kullanıcıdan Standard Buyer şablonu üretir ve aynı profil kopyalama motoru hedefe uygular', () => {
  const instance = runtime(), sourceId = createUser(instance, 'TEMPLATE SOURCE'), targetId = createUser(instance, 'TEMPLATE TARGET');
  prefs.saveHorizon(sourceId, 'backlog', horizon(8));
  prefs.merge(sourceId, { 'lcw.cp.dimFilters.v1': { value: 'SOURCE-FILTER' }, 'lcw.table.columnState.cp': { value: 'SOURCE-COLUMNS' } });
  const saved = call(instance.workspaceTemplateUpdateHandler, moderator(), {
    expectedRevision: revision(), sourceUserId: sourceId, categories: ['horizon', 'filters', 'columns'], reason: 'Standard Buyer template', confirmCritical: true,
  }, { roleId: 'buyer' });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.template.sourceUserId, sourceId);
  assert.equal(saved.body.template.entryCount, 3);
  const roleEntries = access.roleWorkspaceEntries(targetId);
  assert.deepEqual(prefs.resolveHorizon(targetId, 'backlog', horizon(1), {}, roleEntries), horizon(8));

  const copied = call(instance.profileCopyHandler, moderator(), {
    expectedRevision: revision(), sourceTemplateRole: 'buyer', targetUserIds: [targetId], mode: 'MERGE',
    categories: { userPermissions: true, workspace: { horizon: true, filters: true, columns: true }, organization: {} }, reason: 'Apply Standard Buyer',
  });
  assert.equal(copied.statusCode, 200, JSON.stringify(copied.body));
  assert.equal(copied.body.success, 1);
  assert.equal(prefs.load(targetId).entries['lcw.cp.dimFilters.v1'].value, 'SOURCE-FILTER');
  assert.equal(prefs.load(targetId).entries['lcw.table.columnState.cp'].value, 'SOURCE-COLUMNS');
  assert.deepEqual(prefs.getHorizon(targetId, 'backlog'), horizon(8));
});

test('rol şablonu API, UI, audit ve tarayıcı fallback cache entegrasyonu mevcuttur', () => {
  assert.match(SERVER, /\/api\/iam\/workspace-templates\/:roleId/);
  assert.match(SERVER, /roleWorkspaceEntries\(req\.currentUser\)/);
  // v7.23: çağrıya MAG/MMYG/Buying Group ön ayar çözücüsü 5. argüman olarak
  // eklendi. Testin AMACI değişmedi — override hâlâ SESSION kullanıcısı ve rol
  // varsayılanlarıyla çözülüyor; imza kontrolü yeni argümanı da kapsar.
  assert.match(SERVER, /applyHorizonOverrides\(store\.items,id,requestedTargets,userAccess\.roleWorkspaceEntries\(value\)\)/);
  assert.match(STORAGE, /__roleWorkspaceDefaults\.v1/);
  assert.match(STORAGE, /if\(personal!=null\)return personal/);
  assert.match(UI, /Workspace Şablonları/);
  assert.match(UI, /Standart Şablon/);
  assert.match(UI, /sourceTemplateRole/);
  assert.match(UI, /ROLE_WORKSPACE_TEMPLATE_UPDATE/);
});
