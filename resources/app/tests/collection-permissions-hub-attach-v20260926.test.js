'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan hata:
   Her cihaz açılışta izin önbelleğini YEREL olarak taşır ve
   legacyInboundAccessV1 işaretini yerele yazar. Shared Hub SONRADAN
   bağlandığında ilk yetki hub'da işaretsiz bir belge oluşturuyordu; her cihaz
   eşitlemede yerel işaretini bu belgeyle eziyor, isReady() false dönüyor ve
   çözücü eski IAM profil alanına düşüyordu. Sonuç: verilen hiçbir Koleksiyon
   yetkisi karşı cihazda etkili olmuyordu (COLLECTION_ACCESS_DENIED). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCollectionPermissionsStore } = require('../server/lib/collection-permissions-store');

async function devices(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-hub-attach-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const profiles = [
    { id: 'owner', enabled: true },
    { id: 'viewer', enabled: true },
    { id: 'editor', enabled: true, collectionAccess: [{ ownerId: 'owner', level: 'edit' }] },
  ];
  const hub = { root: '' };
  const device = name => createCollectionPermissionsStore({
    file: path.join(root, name, 'collection-permissions.json'),
    getProfiles: () => profiles,
    getSharedSyncRoot: async () => hub.root,
  });
  return { root, hub, a: device('a'), b: device('b') };
}

async function startupBeforeHub(store, profiles = []) {
  await store.ensure();
  await store.sync();
  await store.migrateLegacyInboundAccess(profiles);
}

test('Hub sonradan bağlanınca ilk yetki geçiş işaretini düşürmez; karşı cihazda etkili olur', async t => {
  const { root, hub, a, b } = await devices(t);
  await startupBeforeHub(a);
  await startupBeforeHub(b);
  assert.equal(a.isReady(), true);
  assert.equal(b.isReady(), true);

  hub.root = path.join(root, 'hub');
  await a.setGrant({ ownerId: 'owner', granteeId: 'viewer', level: 'view', actorId: 'owner' });
  assert.equal(a.isReady(), true, 'yetkiyi veren cihaz hazır kalmalı');

  await b.sync();
  assert.equal(b.isReady(), true, 'eşitlenen cihaz hazır olmalı');
  assert.deepEqual(b.effectiveOwners('viewer'), [{ ownerId: 'viewer', level: 'edit' }, { ownerId: 'owner', level: 'view' }]);
  assert.equal(b.accessLevel('viewer', 'owner'), 'view');
});

test('İşaretsiz oluşmuş mevcut hub belgesi eşitlemede kendiliğinden onarılır, verilmiş yetkiler korunur', async t => {
  const { root, hub, a } = await devices(t);
  hub.root = path.join(root, 'hub');
  const remote = path.join(hub.root, 'BUYER_LOG_SYNC', 'collection-permissions', 'v1.json');
  await fsp.mkdir(path.dirname(remote), { recursive: true });
  // Hatalı sürümün hub'da bıraktığı belge: yetkiler var, geçiş işareti yok.
  await fsp.writeFile(remote, JSON.stringify({
    schemaVersion: 1, revision: 1, migrations: {}, audit: [],
    grants: [{ ownerId: 'owner', granteeId: 'viewer', level: 'view', grantedAt: '2026-09-26T00:00:00.000Z', grantedBy: 'owner', updatedAt: '2026-09-26T00:00:00.000Z', updatedBy: 'owner' }],
  }));

  const result = await a.sync();
  assert.equal(result.synced, true);
  assert.equal(a.isReady(), true, 'işaretsiz uzak belge onarılmalı');
  assert.equal(a.accessLevel('viewer', 'owner'), 'view', 'hub’da verilmiş yetki korunur');
  assert.equal(a.accessLevel('editor', 'owner'), 'edit', 'eski IAM profil yetkisi geçişle taşınır');
  const healed = JSON.parse(await fsp.readFile(remote, 'utf8'));
  assert.ok(healed.migrations && healed.migrations.legacyInboundAccessV1, 'onarım hub belgesine yazılır');

  // İkinci eşitleme idempotenttir: revizyon ve yetkiler değişmez.
  const before = healed.revision;
  await a.sync();
  assert.equal(JSON.parse(await fsp.readFile(remote, 'utf8')).revision, before);
});
