'use strict';

/* Saha profili: her istekte publicProfile / fiyat talebi görünürlüğü,
   izin belgesini isReady() + effectiveOwners() üzerinden her çağrıda yeniden
   okuyup normalize ediyordu (fiyat talebi başına iki kez). Senkron okuyucular
   artık dosya kimliği + süreç içi yazım sayacıyla anahtarlanmış önbellek
   kullanır. Bu test (1) tekrarlı çağrıların belgeyi yeniden okumadığını,
   (2) yazım, hub içe aktarımı ve dış dosya değişiminin önbelleği anında
   geçersiz kıldığını ve (3) sonuçların önbelleksiz referansla aynı olduğunu
   sabitler. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCollectionPermissionsStore, normalizeState } = require('../server/lib/collection-permissions-store');

const USERS = ['owner', 'viewer', 'editor', 'other'];

function reference(file, userId) {
  // Önbelleksiz eski hesap: dosyayı oku, normalize et, grantee'ye göre süz.
  const state = normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')));
  return [{ ownerId: userId, level: 'edit' }, ...state.grants.filter(g => g.granteeId === userId).map(g => ({ ownerId: g.ownerId, level: g.level }))];
}
function referenceOutgoing(file, ownerId) {
  return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8'))).grants.filter(g => g.ownerId === ownerId);
}
function assertEquivalent(store) {
  for (const id of USERS) {
    assert.deepEqual(store.effectiveOwners(id), reference(store.file, id), `effectiveOwners(${id})`);
    assert.deepEqual(store.outgoing(id), referenceOutgoing(store.file, id), `outgoing(${id})`);
    for (const owner of USERS) {
      const expected = reference(store.file, id).find(item => item.ownerId === owner)?.level || null;
      assert.equal(store.accessLevel(id, owner), expected, `accessLevel(${id}, ${owner})`);
    }
  }
}

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-perm-cache-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const hub = { root: '' };
  const make = name => createCollectionPermissionsStore({
    file: path.join(root, name, 'collection-permissions.json'),
    getProfiles: () => USERS.map(id => ({ id, enabled: true })),
    getSharedSyncRoot: async () => hub.root,
  });
  const store = make('a');
  await store.ensure();
  await store.migrateLegacyInboundAccess([]);
  return { root, hub, store, make };
}

function countReads(t, file) {
  const original = fs.readFileSync;
  const counter = { count: 0 };
  fs.readFileSync = function patched(target, ...rest) {
    if (path.resolve(String(target)) === path.resolve(file)) counter.count += 1;
    return original.call(this, target, ...rest);
  };
  t.after(() => { fs.readFileSync = original; });
  return counter;
}

test('tekrarlı isReady/effectiveOwners/accessLevel/outgoing çağrıları izin belgesini yeniden okumaz', async t => {
  const { store } = await fixture(t);
  await store.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'view', actorId: 'owner' });
  assert.equal(store.isReady(), true);
  store.effectiveOwners('viewer');
  const reads = countReads(t, store.file);
  for (let i = 0; i < 500; i++) {
    assert.equal(store.isReady(), true);
    assert.deepEqual(store.effectiveOwners('viewer'), [{ ownerId: 'viewer', level: 'edit' }, { ownerId: 'owner', level: 'view' }]);
    assert.equal(store.accessLevel('viewer', 'owner'), 'view');
    store.outgoing('owner');
  }
  assert.equal(reads.count, 0, 'değişmemiş belge için yeniden okuma/normalize olmamalı');
});

test('grant ve revoke sonrası sonuç anında güncellenir; çok kullanıcıda önbelleksiz referansla aynıdır', async t => {
  const { store } = await fixture(t);
  assertEquivalent(store);
  await store.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'view', actorId: 'owner' });
  assert.equal(store.accessLevel('viewer', 'owner'), 'view');
  await store.setGrant({ ownerId: 'owner', granteeId: 'editor', level: 'edit', actorId: 'owner' });
  await store.setGrant({ ownerId: 'other', granteeId: 'viewer', level: 'edit', actorId: 'other' });
  assertEquivalent(store);
  await store.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'edit', actorId: 'owner' });
  assert.equal(store.accessLevel('viewer', 'owner'), 'edit', 'seviye yükseltme hemen görünür');
  await store.removeGrant({ ownerId: 'owner', granteeId: 'viewer', actorId: 'owner' });
  assert.equal(store.accessLevel('viewer', 'owner'), null, 'geri alınan yetki hiçbir istekte servis edilmez');
  assertEquivalent(store);
});

test('hub senkron içe aktarımı önbelleği geçersiz kılar (yetki verme ve geri alma)', async t => {
  const { root, hub, store, make } = await fixture(t);
  const b = make('b');
  await b.ensure(); await b.migrateLegacyInboundAccess([]);
  hub.root = path.join(root, 'hub');
  assert.equal(b.accessLevel('viewer', 'owner'), null);
  await store.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'view', actorId: 'owner' });
  await b.sync();
  assert.equal(b.accessLevel('viewer', 'owner'), 'view');
  await store.removeGrant({ ownerId: 'owner', granteeId: 'viewer', actorId: 'owner' });
  await b.sync();
  assert.equal(b.accessLevel('viewer', 'owner'), null);
  assertEquivalent(b);
});

test('dosya dışarıdan değiştirilince (yerinde yazım, rename ile değişim, silme, bozulma) eski izin servis edilmez', async t => {
  const { store } = await fixture(t);
  await store.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'view', actorId: 'owner' });
  assert.equal(store.accessLevel('viewer', 'owner'), 'view');
  const state = JSON.parse(fs.readFileSync(store.file, 'utf8'));

  // Aynı uzunlukta yerinde yazım: view -> edit (boyut değişmez).
  state.grants[0].level = 'edit';
  fs.writeFileSync(store.file, JSON.stringify(state, null, 2));
  assert.equal(store.accessLevel('viewer', 'owner'), 'edit');

  // Atomik rename ile yeni belge: yetki kaldırılmış.
  const temp = `${store.file}.ext.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...state, grants: [] }, null, 2));
  fs.renameSync(temp, store.file);
  assert.equal(store.accessLevel('viewer', 'owner'), null);
  assertEquivalent(store);

  // Geçiş işareti düşen belge: isReady false'a döner.
  fs.writeFileSync(store.file, JSON.stringify({ ...state, migrations: {} }, null, 2));
  assert.equal(store.isReady(), false);

  // Bozuk ve silinmiş belge: eski fail-closed geri dönüşler korunur.
  fs.writeFileSync(store.file, '{not json');
  assert.equal(store.isReady(), false);
  assert.deepEqual(store.effectiveOwners('viewer'), [{ ownerId: 'viewer', level: 'edit' }]);
  assert.deepEqual(store.outgoing('owner'), []);
  fs.unlinkSync(store.file);
  assert.equal(store.isReady(), false);
  assert.deepEqual(store.effectiveOwners('viewer'), [{ ownerId: 'viewer', level: 'edit' }]);
  assert.deepEqual(store.effectiveOwners(''), []);
});

test('döndürülen nesneleri değiştirmek önbelleği bozmaz', async t => {
  const { store } = await fixture(t);
  await store.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'view', actorId: 'owner' });
  store.effectiveOwners('viewer')[1].level = 'edit';
  store.effectiveOwners('viewer').push({ ownerId: 'other', level: 'edit' });
  store.outgoing('owner')[0].level = 'edit';
  store.outgoing('owner').length = 0;
  assert.equal(store.accessLevel('viewer', 'owner'), 'view');
  assert.equal(store.accessLevel('viewer', 'other'), null);
  assertEquivalent(store);
});
