'use strict';

/*
 * v7.?? — Collection yetkisi yalnız ekran filtresi değildir. Bu sözleşme
 * sahiplik kapsamını hem API hem de yerel replikasyon için çiviler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCollectionPermissionsStore } = require('../server/lib/collection-permissions-store');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { collectionWorkspaceOwnerFromDelta, filterCollectionWorkspaceDeltas, quarantineLegacyCollectionDeltas, createCollectionReplication } = require('../server/lib/collection-replication');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-private-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const profiles = [
    { id: 'owner-a', enabled: true, displayName: 'Owner A' },
    { id: 'user-b', enabled: true, displayName: 'User B' },
    { id: 'user-c', enabled: true, displayName: 'User C' },
  ];
  return {
    root,
    profiles,
    store: createCollectionPermissionsStore({
      file: path.join(root, 'collection-permissions.json'),
      getProfiles: () => profiles,
      getSharedSyncRoot: async () => path.join(root, 'shared'),
    }),
  };
}

test('Collection erişimi varsayılan olarak yalnız sahibidir; hiyerarşi veya yönetici rolü otomatik kapsam açmaz', async t => {
  const { store } = await fixture(t);
  await store.ensure();
  assert.deepEqual(store.effectiveOwners('owner-a'), [{ ownerId: 'owner-a', level: 'edit' }]);
  assert.deepEqual(store.effectiveOwners('user-b'), [{ ownerId: 'user-b', level: 'edit' }]);
});

test('sahibin açık VIEW/EDIT granti yalnız hedef kullanıcıya gelir ve revoke ile kaybolur', async t => {
  const { store } = await fixture(t);
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'view', actorId: 'owner-a' });
  assert.deepEqual(store.effectiveOwners('user-b'), [
    { ownerId: 'user-b', level: 'edit' },
    { ownerId: 'owner-a', level: 'view' },
  ]);
  assert.equal(store.accessLevel('user-c', 'owner-a'), null, 'aynı grant üçüncü kullanıcıya taşmamalı');
  await store.removeGrant({ ownerId: 'owner-a', granteeId: 'user-b', actorId: 'owner-a' });
  assert.equal(store.accessLevel('user-b', 'owner-a'), null, 'revoke sonrası eski erişim kalmamalı');
});

test('genel delta paketindeki Collection belgeleri uygulanmadan önce ayıklanır; yetkili belge de yeni sahip-bazlı akışa bırakılır', () => {
  const allowed = new Set(['user-b', 'owner-a']);
  const incoming = [
    { id: 'store:collection-workspaces/owner-a.json', patch: { rows: [{ id: 1, plmId: 'A' }] } },
    { id: 'store:collection-workspaces/user-c.json', patch: { rows: [{ id: 2, plmId: 'SECRET' }] } },
    { id: 'store:settings.json', patch: { theme: 'dark' } },
  ];
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[0]), 'owner-a');
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[1]), 'user-c');
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[2]), null);
  assert.deepEqual(filterCollectionWorkspaceDeltas(incoming, allowed), [incoming[2]], 'genel delta yolu hiçbir Collection iş belgesini yerelleştirmemeli');
});

test('geçmişteki açık inbound grantler yalnız birebir kayda dönüştürülür; tüm kullanıcılar için genişletilmez', async t => {
  const { store, profiles } = await fixture(t);
  await store.ensure();
  const result = await store.migrateLegacyInboundAccess([
    { ...profiles[0], collectionAccess: [] },
    { ...profiles[1], collectionAccess: [{ ownerId: 'owner-a', level: 'edit' }] },
    { ...profiles[2], collectionAccess: [] },
  ], { actorId: 'collection-migration' });
  assert.equal(result.created, 1);
  assert.equal(store.accessLevel('user-b', 'owner-a'), 'edit');
  assert.equal(store.accessLevel('user-c', 'owner-a'), null);
  const repeated = await store.migrateLegacyInboundAccess(profiles, { actorId: 'collection-migration' });
  assert.equal(repeated.created, 0, 'geçiş tekrar çalışınca grant çoğalmamalı');
});

test('geçmişteki silinmiş kullanıcı grantı migrationı durdurmaz veya erişim açmaz', async t => {
  const { store, profiles } = await fixture(t);
  await store.ensure();
  const result = await store.migrateLegacyInboundAccess([
    { ...profiles[1], collectionAccess: [{ ownerId: 'missing-owner', level: 'view' }] },
  ]);
  assert.equal(result.created, 0);
  assert.equal(result.invalid, 1);
  assert.equal(store.accessLevel('user-b', 'missing-owner'), null);
});

test('geçersiz owner/grantee veya self-grant kabul edilmez', async t => {
  const { store } = await fixture(t);
  await store.ensure();
  await assert.rejects(() => store.setGrant({ ownerId: 'owner-a', granteeId: 'missing', level: 'view', actorId: 'owner-a' }), /kullanıcı/i);
  await assert.rejects(() => store.setGrant({ ownerId: 'owner-a', granteeId: 'owner-a', level: 'edit', actorId: 'owner-a' }), /kendisine/i);
  await assert.rejects(() => store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'admin', actorId: 'owner-a' }), /geçersiz/i);
});

test('yetkili sahip belgesi ayrı taşıma yolundan gelir; yetkisiz kullanıcıda uzaktaki belge hiç okunmaz', async t => {
  const { root, store } = await fixture(t);
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'view', actorId: 'owner-a' });
  let replaced = 0;
  const workspace = { schemaVersion: 1, ownerId: 'owner-a', _revision: 4, rows: [{ id: 1, plmId: 'A' }], manufacturers: [], customColumns: [], nextId: 2 };
  const workspaces = {
    loadWorkspace: ownerId => ({ ...workspace, ownerId }),
    replaceWorkspaceReplica: async (_ownerId, incoming) => { replaced += 1; return { applied: true, workspace: incoming }; },
  };
  const replication = createCollectionReplication({ workspaces, permissions: store, getSharedSyncRoot: async () => path.join(root, 'shared') });
  await replication.publishOwner('owner-a');
  const allowed = await replication.syncOwner('user-b', 'owner-a');
  assert.equal(allowed.synced, true);
  assert.equal(replaced, 1);
  await assert.rejects(() => replication.syncOwner('user-c', 'owner-a'), error => error.code === 'COLLECTION_ACCESS_DENIED');
  assert.equal(replaced, 1, 'yetkisiz istek iş belgesini yerelleştirmemeli');
});

test('eski genel delta kaydı yalnız kanonik çalışma alanı doğrulanınca aktif yerel DBden kaldırılır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-quarantine-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  await db.ensure();
  const id = 'store:collection-workspaces/owner-a.json';
  await db.queuePatch({ id, patch: { rows: [{ id: 1, plmId: 'SAFE' }] } });
  const eventId = (await db.pending())[0].eventId;
  await db.markSynced([eventId]);
  const canonical = path.join(root, 'canonical-owner-a.json');
  await fsp.writeFile(canonical, '{}');
  const result = await quarantineLegacyCollectionDeltas({ localDb: db, workspaceFileForOwner: () => canonical });
  const state = await db.read();
  assert.equal(result.removed, 1);
  assert.equal(state.records[id], undefined);
  assert.equal(state.journal.some(item => item.id === id), false);
  assert.equal(state.collectionReplicationRecovery.entries[id], undefined);
});

test('doğrulanmamış veya bekleyen eski Collection verisi silinmez; erişilemeyen recovery alanına alınır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-recovery-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  await db.ensure();
  const id = 'store:collection-workspaces/owner-a.json';
  await db.queuePatch({ id, patch: { rows: [{ id: 7, plmId: 'UNSYNCED' }] } });
  const result = await quarantineLegacyCollectionDeltas({ localDb: db, workspaceFileForOwner: () => path.join(root, 'absent.json') });
  const state = await db.read();
  assert.equal(result.quarantined, 1);
  assert.equal(result.pending, 1);
  assert.equal(state.records[id], undefined);
  assert.equal(state.journal.some(item => item.id === id), false);
  assert.equal(state.collectionReplicationRecovery.entries[id].record.rows[0].plmId, 'UNSYNCED');
  assert.equal(state.collectionReplicationRecovery.entries[id].journal.length, 1);
});

test('eski genel Collection delta olayı ortak sync paketine yüklenmez veya diğer cihazın local DBsine düşmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-collection-sync-filter-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const a = createLocalDb(path.join(root, 'a', 'BuyerLogLocal.db'));
  const b = createLocalDb(path.join(root, 'b', 'BuyerLogLocal.db'));
  const sourceSync = createSyncSettings({
    localDataRoot: path.join(root, 'settings-a'), localDb: a,
    filterIncomingDeltas: filterCollectionWorkspaceDeltas, filterOutgoingDeltas: filterCollectionWorkspaceDeltas,
  });
  const targetSync = createSyncSettings({
    localDataRoot: path.join(root, 'settings-b'), localDb: b,
    filterIncomingDeltas: filterCollectionWorkspaceDeltas, filterOutgoingDeltas: filterCollectionWorkspaceDeltas,
  });
  await sourceSync.save(shared); await targetSync.save(shared);
  await sourceSync.syncOnce(); await targetSync.syncOnce(); await sourceSync.syncOnce();
  const collectionId = 'store:collection-workspaces/owner-a.json';
  await a.queuePatch({ id: collectionId, patch: { rows: [{ id: 1, plmId: 'PRIVATE' }] } });
  await a.queuePatch({ id: 'store:settings.json', patch: { theme: 'dark' } });
  const result = await sourceSync.syncOnce();
  await targetSync.syncOnce();
  assert.equal(result.uploadedEvents, 1, 'yalnız Collection dışındaki olay taşınır');
  assert.equal((await a.pending()).some(item => item.id === collectionId), false, 'eski olay tekrar kuyrukta kalmaz');
  const target = await b.read();
  assert.equal(target.records[collectionId], undefined, 'hedef local DBde Collection iş belgesi oluşmaz');
  assert.equal(target.records['store:settings.json'].theme, 'dark');
});
