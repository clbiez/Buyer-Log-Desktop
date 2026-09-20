'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-iam-v671-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const iam = require('../server/lib/iam-core');
const access = require('../server/lib/user-access');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function baseProfile(id, extra = {}) {
  return iam.normalizeProfileIam({
    id, iamVersion: 1, username: id, displayName: id, role: 'buyer', systemRole: 'buyer',
    orgLevel: 'job_title', status: 'ACTIVE', enabled: true, accessAreas: {}, permissions: {},
    stableIds: { sourceId: `test:${id}` }, directPermissions: [], temporaryPermissions: [],
    mags: [], mmygs: [], buyingGroups: [], dataScope: { mode: 'SELF' }, ...extra,
  });
}
function storeOf(moderator, users) { return iam.migrateStore({ schemaVersion: 4, moderator, users, orderAccess: {}, _revision: 0 }); }

test('legacy migration is idempotent and preserves Gökberk moderator identity and access', () => {
  const legacy = { id: 'moderator', role: 'moderator', username: 'Gökberk', displayName: 'Gökberk', enabled: true, passwordHash: 'hash', accessAreas: { cp: true }, permissions: {} };
  const once = storeOf(legacy, []), twice = iam.migrateStore(once);
  assert.equal(twice.moderator.id, 'moderator');
  assert.equal(twice.moderator.displayName, 'Gökberk');
  assert.equal(twice.moderator.systemRole, 'moderator');
  assert.equal(twice.moderator.status, 'ACTIVE');
  assert.equal(twice.moderator.passwordHash, 'hash');
  assert.deepEqual(twice.moderator.directPermissions, once.moderator.directPermissions);
  assert.equal(iam.hasPermission(twice.moderator, 'USER.GRANT', twice), true);
});

test('new Buyer role grants only safe business VIEW permissions', () => {
  const user = baseProfile('viewer'), store = storeOf(baseProfile('moderator', { role: 'moderator', systemRole: 'moderator' }), [user]);
  const set = iam.effectivePermissionSet(store.users[0], store);
  assert.deepEqual([...iam.SAFE_VIEW_PERMISSIONS].sort(), [...set].sort());
  assert.equal(set.has('USER.MANAGE'), false);
  assert.equal(set.has('SYSTEM.MANAGE'), false);
});

test('stable identity duplicate detection does not depend on display name', () => {
  const first = baseProfile('u1', { displayName: 'Old Name', stableIds: { employeeId: 'EMP-42' } });
  const store = storeOf(baseProfile('moderator', { role: 'moderator', systemRole: 'moderator' }), [first]);
  assert.equal(iam.findDuplicate(store, { employeeId: 'emp-42' }).id, 'u1');
  assert.equal(iam.findDuplicate(store, { employeeId: 'EMP-99' }), null);
});

test('business permission inherits recursively upward while security permission never inherits', () => {
  const leaf = baseProfile('leaf', { managerId: 'middle', supervisorId: 'middle', directPermissions: [
    { permission: 'CP.EDIT', reason: 'work' }, { permission: 'USER.MANAGE', reason: 'security' },
  ] });
  const middle = baseProfile('middle', { managerId: 'top', supervisorId: 'top' });
  const top = baseProfile('top');
  const store = storeOf(baseProfile('moderator', { role: 'moderator', systemRole: 'moderator' }), [top, middle, leaf]);
  const details = iam.effectivePermissionDetails(store.users.find(item => item.id === 'top'), store);
  assert.equal(details.some(item => item.permission === 'CP.EDIT' && item.source === 'HIERARCHY'), true);
  assert.equal(details.some(item => item.permission === 'USER.MANAGE' && item.source === 'HIERARCHY'), false);
});

test('an actor cannot grant a permission they do not effectively own', () => {
  const moderator = baseProfile('m', { role: 'moderator', systemRole: 'moderator', directPermissions: [{ permission: 'USER.GRANT' }] });
  const store = storeOf(moderator, []);
  store.iam.roles.moderator.permissions = ['USER.GRANT', 'CP.VIEW'];
  assert.equal(iam.canGrant(store.moderator, 'CP.VIEW', store), true, 'moderator role owns business permissions');
  assert.equal(iam.canGrant(store.moderator, 'SYSTEM.MANAGE', store), false);
});

test('temporary permissions expire without deleting their audit-ready assignment', () => {
  const user = baseProfile('temp', { temporaryPermissions: [{ permission: 'CP.EDIT', source: 'TEMPORARY', validFrom: '2026-08-01T00:00:00.000Z', validUntil: '2026-08-02T00:00:00.000Z', reason: 'cover' }] });
  const store = storeOf(baseProfile('moderator', { role: 'moderator', systemRole: 'moderator' }), [user]);
  assert.equal(iam.hasPermission(store.users[0], 'CP.EDIT', store, Date.parse('2026-08-01T12:00:00Z')), true);
  assert.equal(iam.hasPermission(store.users[0], 'CP.EDIT', store, Date.parse('2026-08-03T00:00:00Z')), false);
  assert.equal(store.users[0].temporaryPermissions.length, 1);
});

test('TEAM and CUSTOM data scopes are enforced by the shared backend predicate', () => {
  const child = baseProfile('child', { username: 'Child Buyer', displayName: 'Child Buyer', managerId: 'lead', supervisorId: 'lead' });
  const lead = baseProfile('lead', { dataScope: { mode: 'TEAM' } });
  const custom = baseProfile('custom', { dataScope: { mode: 'CUSTOM', buyers: ['Only Buyer'] } });
  const store = storeOf(baseProfile('moderator', { role: 'moderator', systemRole: 'moderator' }), [lead, child, custom]);
  assert.equal(iam.rowInScope({ Buyer: 'Child Buyer' }, iam.effectiveDataScope(store.users[0], store)), true);
  assert.equal(iam.filterRows(store.users[2], [{ Buyer: 'Only Buyer' }, { Buyer: 'Other' }], store).length, 1);
});

test('circular manager relationships are rejected', () => {
  const a = baseProfile('a', { managerId: 'b', supervisorId: 'b' }), b = baseProfile('b');
  const store = storeOf(baseProfile('moderator', { role: 'moderator', systemRole: 'moderator' }), [a, b]);
  assert.throws(() => iam.validateHierarchy(store, 'b', 'a'), error => error.code === 'HIERARCHY_CYCLE');
});

test('self privilege change is rejected by the backend handler', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  const actor = access.loadStore().moderator, req = { currentUser: actor, params: { id: actor.id }, body: { permissionCodes: ['CP.VIEW'], expectedRevision: access.loadStore()._revision }, headers: {}, socket: {} };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  runtime.adminUpdateHandler(req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'SELF_ESCALATION_DENIED');
});

// v7.00: beş bölümlü çalışma alanı korunuyor ama arayüz user-access-ui.js'ten
// public/user-management.js'e taşındı. v7.01'de mevcut yetki kopyalama bölümü
// kişisel çalışma alanını da kapsayacak biçimde Profil Kopyalama'ya genişletildi.
test('server and UI expose the five-part centralized IAM workspace', () => {
  const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '../public/user-management.js'), 'utf8');
  assert.match(server, /\/api\/iam\/roles/);
  assert.match(server, /\/api\/iam\/audit/);
  for (const marker of ['Kullanıcılar', 'Roller & Yetkiler', 'Organizasyon', 'Profil Kopyalama', 'Değişiklik Geçmişi']) assert.match(ui, new RegExp(marker));
});
