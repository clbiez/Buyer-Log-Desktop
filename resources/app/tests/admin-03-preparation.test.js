'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AT, fixture, grant, isolate, response } = require('../../../docs/performance-program/admin-03/fixture.cjs');
const root = isolate();
const access = require('../server/lib/user-access');
const iam = require('../server/lib/iam-core');
const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
const clone = value => JSON.parse(JSON.stringify(value));
function seed(value = fixture(3, 2)) {
  fs.writeFileSync(path.join(process.env.BUYER_LOG_AUTH_DATA_ROOT, 'user-access.json'), JSON.stringify(value));
  return access.readStore();
}
function at(now, work) { const original = Date.now; Date.now = () => now; try { return work(); } finally { Date.now = original; } }

test('ADMIN-03 full public DTOs and actual admin list match frozen #892 baseline including array order', () => {
  const store = seed(), res = response(); runtime.adminListHandler({ currentUser: store.moderator, headers: {} }, res);
  const actual = { publicProfiles: [store.moderator, ...store.users].map(p => access.publicProfile(p, store)), adminList: res.body };
  const expected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/admin-03-baseline.json'), 'utf8'));
  assert.deepEqual(clone(actual), expected);
  assert.equal(access.publicProfile(null, store), null);
});

test('ADMIN-03 direct and temporary grants activate at validFrom and expire at validUntil on the SAME store object', () => {
  const start = Date.parse(AT), end = start + 1000;
  for (const field of ['directPermissions', 'temporaryPermissions']) {
    const store = clone(seed()); const profile = store.users[0];
    profile[field] = [grant('USER.GRANT', { source: field === 'directPermissions' ? 'DIRECT' : 'TEMPORARY', validFrom: AT, validUntil: new Date(end).toISOString() })];
    for (const [now, allowed] of [[start - 1, false], [start, true], [end - 1, true], [end, false], [end + 1, false]]) {
      assert.equal(iam.hasPermission(profile, 'USER.GRANT', store, now), allowed, `${field}:${now}`);
      at(now, () => {
        const dto = access.publicProfile(profile, store);
        assert.equal(dto.capabilities.includes('USER.GRANT'), allowed);
        assert.equal(dto.canManageUsers, allowed);
      });
    }
  }
});

test('ADMIN-03 revocation and role replacement are observed even with the same revision', () => {
  const first = clone(seed()); first.users[0].directPermissions = [grant('USER.GRANT')];
  assert.equal(iam.hasPermission(first.users[0], 'USER.GRANT', first), true);
  const second = clone(first); second.users[0].directPermissions = [];
  assert.equal(second._revision, first._revision);
  assert.equal(access.publicProfile(second.users[0], second).capabilities.includes('USER.GRANT'), false);
  const third = clone(second); third.iam.roles.buyer.permissions.push('USER.GRANT');
  assert.equal(access.publicProfile(third.users[0], third).capabilities.includes('USER.GRANT'), true);
  assert.equal(access.publicProfile(second.users[0], second).capabilities.includes('USER.GRANT'), false);
});

test('ADMIN-03 team scopes and business grants inherit; security and shared-settings grants do not', () => {
  const store = clone(seed()), manager = store.users[0], child = store.users[1];
  manager.directPermissions = []; child.directPermissions = [grant('CP.EDIT'), grant('USER.GRANT'), grant('SOURCE_DATA.MANAGE')];
  assert.equal(iam.hasPermission(manager, 'CP.EDIT', store), true);
  for (const permission of ['USER.GRANT', 'SOURCE_DATA.MANAGE']) {
    assert.equal(iam.hasPermission(manager, permission, store), false);
    assert.equal(iam.hasPermission(child, permission, store), true);
  }
  assert.deepEqual(access.publicProfile(manager, store).delegatedUserIds, ['u1', 'u2']);
  assert.deepEqual(access.publicProfile(manager, store).scopes.buyers, ['demo-u0', 'DEMO u0', 'demo-u1', 'DEMO u1', 'demo-u2', 'DEMO u2']);
  child.managerId = 'moderator'; child.supervisorId = 'moderator';
  assert.deepEqual(access.publicProfile(manager, store).delegatedUserIds, ['u2']);
  assert.equal(access.publicProfile(manager, store).scopes.buyers.includes('demo-u1'), false);
});

test('ADMIN-03 IAM managerId precedence and legacy supervisorId traversal remain distinct; cycles terminate', () => {
  const store = clone(seed()), child = store.users[1];
  child.managerId = 'moderator'; child.supervisorId = 'u0';
  assert.deepEqual(iam.descendants(store, 'u0').map(p => p.id), ['u2']);
  assert.deepEqual(access.descendantProfiles(store, 'u0').map(p => p.id), ['u1', 'u2']);
  store.users[0].managerId = 'u2'; store.users[0].supervisorId = 'u2';
  assert.deepEqual(iam.descendants(store, 'u0').map(p => p.id), ['u2']);
  assert.deepEqual(access.descendantProfiles(store, 'u0').map(p => p.id), ['u1', 'u2']);
});

test('ADMIN-03 collection resolver empty/error stays fail-closed and retains only self ownership', () => {
  const store = seed(), profile = store.users[0]; profile.collectionAccess = [{ ownerId: 'u1', level: 'edit' }];
  try {
    for (const resolver of [() => [], () => { throw new Error('synthetic unavailable'); }]) {
      runtime.setCollectionAccessResolver(resolver);
      assert.deepEqual(access.publicProfile(profile, store).collectionAccess, [{ ownerId: 'u0', level: 'edit' }]);
      assert.equal(access.collectionAccessLevel(profile, 'u1', store), null);
    }
  } finally { runtime.setCollectionAccessResolver(null); }
});

test('ADMIN-03 real central IAM commit changes store identity, role matrix, inherited rights and team scope', async () => {
  seed();
  access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [], centralIam: { enabled: true, sharedRoot: process.env.BUYER_LOG_IAM_SHARED_ROOT } });
  try {
    // Central publication accepts a migrated directory and requires a verifier
    // for every active account. This is synthetic format-valid test material.
    const initial = iam.migrateStore(fixture(3, 2));
    for (const profile of [initial.moderator, ...initial.users]) {
      profile.passwordHash = profile.pinHash = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
    }
    initial.users[1].directPermissions.push(grant('ORDERS.DELETE'));
    const central = access.getCentralIam(); await central.initialize(initial, { id: 'moderator' });
    const before = access.readStore(), manager = before.users.find(p => p.username === 'demo-u0');
    assert.equal(access.publicProfile(manager, before).capabilities.includes('ORDERS.DELETE'), true);
    const next = access.loadStore(); const child = next.users.find(p => p.username === 'demo-u1');
    child.directPermissions = []; child.managerId = 'moderator'; child.supervisorId = 'moderator';
    next.iam.roles.buyer.permissions = next.iam.roles.buyer.permissions.filter(p => p !== 'CP.VIEW');
    await central.commit(next, before._revision, { id: 'moderator' });
    const after = access.readStore(), updated = after.users.find(p => p.username === 'demo-u0');
    assert.notEqual(after, before); assert.ok(after._revision > before._revision);
    const dto = access.publicProfile(updated, after);
    assert.equal(dto.capabilities.includes('ORDERS.DELETE'), false);
    assert.equal(dto.capabilities.includes('CP.VIEW'), false);
    assert.equal(dto.scopes.buyers.includes('demo-u1'), false);
  } finally { access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [], centralIam: { enabled: false } }); }
});
