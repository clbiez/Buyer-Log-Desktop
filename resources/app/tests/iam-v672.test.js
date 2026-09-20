'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-iam-v672-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const iam = require('../server/lib/iam-core');
const access = require('../server/lib/user-access');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
function call(handler, actor, body, params = {}) {
  const req = { currentUser: actor, body, params, headers: {}, socket: {} }, res = response();
  handler(req, res); return res;
}

test('legacy roles migrate idempotently to the four requested roles and keep Gökberk protected', () => {
  const old = {
    moderator: { id: 'moderator', username: 'Gökberk', displayName: 'Gökberk', role: 'moderator', systemRole: 'system_admin', enabled: true, passwordHash: 'preserved', stableIds: { sourceId: 'root' } },
    users: [{ id: 'u1', username: 'Buyer One', displayName: 'Buyer One', role: 'buyer', systemRole: 'standard', enabled: true, stableIds: { sourceId: 'u1' } }],
    iam: { roles: { standard: { permissions: ['CP.VIEW'] }, system_admin: { permissions: ['USER.MANAGE'] } } },
  };
  const once = iam.migrateStore(old), twice = iam.migrateStore(once);
  assert.deepEqual(Object.keys(twice.iam.roles), ['buyer', 'manager', 'senior_manager', 'moderator']);
  assert.equal(twice.users[0].systemRole, 'buyer');
  assert.equal(twice.moderator.systemRole, 'moderator');
  assert.equal(twice.moderator.displayName, 'Gökberk');
  assert.equal(twice.moderator.passwordHash, 'preserved');
  assert.equal(twice.moderator.managerId, null);
});

test('the four roles expose distinct default MAG/MMYG-aware scopes', () => {
  const roles = iam.normalizeRoles({});
  assert.equal(roles.buyer.defaultDataScope, 'SELF');
  assert.equal(roles.manager.defaultDataScope, 'MMYG');
  assert.equal(roles.senior_manager.defaultDataScope, 'MAG');
  assert.equal(roles.moderator.defaultDataScope, 'ALL');
});

test('inactive user can be created, assigned a password and activated by Moderator', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  let store = access.loadStore(), actor = store.moderator;
  const created = call(runtime.adminCreateHandler, actor, {
    expectedRevision: store._revision, username: 'inactive-user', displayName: 'Inactive User', title: 'Buyer',
    systemRole: 'buyer', orgLevel: 'job_title', managerId: 'moderator', status: 'INACTIVE', password: 'Passw0rd!', dataScope: { mode: 'SELF' },
  });
  assert.equal(created.statusCode, 201);
  store = access.loadStore(); actor = store.moderator;
  const activated = call(runtime.adminUpdateHandler, actor, { expectedRevision: store._revision, status: 'ACTIVE', password: 'NewPassw0rd!' }, { id: created.body.user.id });
  assert.equal(activated.statusCode, 200);
  assert.equal(activated.body.user.status, 'ACTIVE');
});

test('direct permissions and MAG/MMYG scope can be copied to multiple users atomically', () => {
  const runtime = access.buildUserAccess({ ensureDataLoaded: async () => {}, getOrders: () => [] });
  let store = access.loadStore(), actor = store.moderator;
  const create = name => {
    const result = call(runtime.adminCreateHandler, actor, { expectedRevision: access.loadStore()._revision, username: name, displayName: name, title: 'Buyer', systemRole: 'buyer', orgLevel: 'job_title', managerId: 'moderator', status: 'ACTIVE', password: 'Passw0rd!' });
    actor = access.loadStore().moderator; return result.body.user.id;
  };
  const sourceId = create('copy-source'), firstId = create('copy-first'), secondId = create('copy-second');
  store = access.loadStore(); actor = store.moderator;
  const sourceUpdate = call(runtime.adminUpdateHandler, actor, { expectedRevision: store._revision, permissionCodes: ['CP.EDIT'], mags: ['CU4E'], mmygs: ['CU4E-01'], dataScope: { mode: 'MAG', mags: ['CU4E'] }, reason: 'source setup' }, { id: sourceId });
  assert.equal(sourceUpdate.statusCode, 200);
  store = access.loadStore(); actor = store.moderator;
  const copied = call(runtime.permissionCopyHandler, actor, { expectedRevision: store._revision, sourceUserId: sourceId, targetUserIds: [firstId, secondId], copyPermissions: true, copyDataScope: true, copyMagMmyg: true, reason: 'same team assignment' });
  assert.equal(copied.statusCode, 200);
  const saved = access.loadStore();
  for (const id of [firstId, secondId]) {
    const target = saved.users.find(item => item.id === id);
    assert.deepEqual(target.directPermissions.map(item => item.permission), ['CP.EDIT']);
    assert.deepEqual(target.mags, ['CU4E']);
    assert.deepEqual(target.mmygs, ['CU4E-01']);
    assert.equal(target.dataScope.mode, 'MAG');
  }
});

// v7.00: arayüz sıfırdan yazıldı ve public/user-management.js'e taşındı.
// İddiaların NİYETİ korundu — pasif kullanıcı seçimi yeniden çizimden sonra da
// çalışmalı (artık tek delegasyonla), matris başlığı sabit Modül sütunu
// taşımalı, hiyerarşi düzenlenebilmeli ve yetki kopyalama hedef seçebilmeli.
test('IAM UI has delegated inactive-card selection, a corrected two-column matrix header and hierarchy editing', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/user-management.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '../server/server.js'), 'utf8');
  assert.match(ui, /shell\.addEventListener\('click', onClick\)/);
  assert.match(ui, /event\.target\.closest\('\[data-act\]'\)/);
  assert.match(ui, /case 'openDetail':/);
  assert.match(ui, /umMatrixModule/);
  assert.match(ui, /data-um-form="manager"/);
  assert.match(ui, /data-um-copytarget/);
  assert.match(ui, /data-act="activate"/);
  assert.match(server, /\/api\/iam\/permissions\/copy/);
});
