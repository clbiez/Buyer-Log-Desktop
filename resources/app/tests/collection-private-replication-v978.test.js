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
const crypto = require('node:crypto');
const SERVER_SOURCE = require('./helpers/server-source')();
const UI_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

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
    { id: 'store:collection-workspaces/shared-collection.json', patch: { rows: [{ id: 3, plmId: 'LEGACY-SHARED' }] } },
    { id: 'store:settings.json', patch: { theme: 'dark' } },
  ];
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[0]), 'owner-a');
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[1]), 'user-c');
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[2]), 'shared-collection');
  assert.equal(collectionWorkspaceOwnerFromDelta(incoming[3]), null);
  assert.deepEqual(filterCollectionWorkspaceDeltas(incoming, allowed), [incoming[3]],
    'emekli shared-collection dahil hiçbir Collection iş belgesi genel delta yoluna girmemeli');
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
  let localWorkspace = workspace;
  const workspaces = {
    loadWorkspace: ownerId => ({ ...localWorkspace, ownerId }),
    replaceWorkspaceReplica: async (_ownerId, incoming) => { replaced += 1; return { applied: true, workspace: incoming }; },
  };
  const replication = createCollectionReplication({ workspaces, permissions: store, getSharedSyncRoot: async () => path.join(root, 'shared') });
  await replication.publishOwner('owner-a');
  localWorkspace = { ...workspace, initialized: false, _revision: 0, rows: [] };
  const allowed = await replication.syncOwner('user-b', 'owner-a');
  assert.equal(allowed.synced, true);
  assert.equal(replaced, 1);
  await assert.rejects(() => replication.syncOwner('user-c', 'owner-a'), error => error.code === 'COLLECTION_ACCESS_DENIED');
  assert.equal(replaced, 1, 'yetkisiz istek iş belgesini yerelleştirmemeli');
});

test('aynı revizyondaki farklı Collection kopyası sessizce yerel verinin üstüne yazılmaz', async t => {
  const { root, store } = await fixture(t);
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'edit', actorId: 'owner-a' });
  const sharedRoot = path.join(root, 'shared');
  const remote = { schemaVersion: 1, ownerId: 'owner-a', _revision: 7, rows: [{ id: 1, note: 'uzak değişiklik' }], manufacturers: [], customColumns: [], nextId: 2 };
  const publisher = createCollectionReplication({
    workspaces: { loadWorkspace: () => remote, replaceWorkspaceReplica: async () => ({ applied: false }) },
    permissions: store,
    getSharedSyncRoot: async () => sharedRoot,
  });
  await publisher.publishOwner('owner-a');

  const local = { ...remote, rows: [{ id: 1, note: 'yerel değişiklik' }] };
  let replaced = 0;
  const receiver = createCollectionReplication({
    workspaces: {
      loadWorkspace: () => local,
      replaceWorkspaceReplica: async (_ownerId, incoming) => { replaced += 1; return { applied: true, workspace: incoming }; },
    },
    permissions: store,
    getSharedSyncRoot: async () => sharedRoot,
  });
  await assert.rejects(() => receiver.publishOwner('owner-a'), error => error.code === 'COLLECTION_REPLICA_CONFLICT');
  const result = await receiver.syncOwner('user-b', 'owner-a');
  assert.equal(result.synced, false);
  assert.equal(result.reason, 'EQUAL_REVISION_DIVERGED');
  assert.equal(replaced, 0, 'eşit revizyonlu farklı içerik yerel değişikliği ezmemeli');
  assert.equal(local.rows[0].note, 'yerel değişiklik');
});

test('daha eski yerel Collection revizyonu uzaktaki yeni kopyayı geri alamaz', async t => {
  const { root, store } = await fixture(t);
  await store.ensure();
  const sharedRoot = path.join(root, 'shared');
  const remote = { schemaVersion: 1, ownerId: 'owner-a', _revision: 9, rows: [{ id: 1, note: 'yeni' }], manufacturers: [], customColumns: [], nextId: 2 };
  await createCollectionReplication({
    workspaces: { loadWorkspace: () => remote, replaceWorkspaceReplica: async () => ({ applied: false }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
  }).publishOwner('owner-a');
  const stale = { ...remote, _revision: 8, rows: [{ id: 1, note: 'eski' }] };
  const stalePublisher = createCollectionReplication({
    workspaces: { loadWorkspace: () => stale, replaceWorkspaceReplica: async () => ({ applied: false }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
  });
  await assert.rejects(() => stalePublisher.publishOwner('owner-a'), error => error.code === 'COLLECTION_REPLICA_STALE');
});

test('yalnız son görülen uzak SHA üzerinden türeyen daha yüksek revizyon yayınlanır ve parent zinciri korunur', async t => {
  const { root, store } = await fixture(t);
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'edit', actorId: 'owner-a' });
  const sharedRoot = path.join(root, 'shared');
  const remote = { schemaVersion: 1, ownerId: 'owner-a', initialized: true, _revision: 5, rows: [{ id: 1, _rev: 5, note: 'temel' }], manufacturers: [], customColumns: [], nextId: 2 };
  const first = createCollectionReplication({
    workspaces: { loadWorkspace: () => remote, replaceWorkspaceReplica: async () => ({ applied: false }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
  });
  await first.publishOwner('owner-a');
  const target = first.remoteWorkspaceFile(sharedRoot, 'owner-a');
  const firstEnvelope = JSON.parse(await fsp.readFile(target, 'utf8'));
  const legacyChecksum = crypto.createHash('sha256').update(JSON.stringify({ version:firstEnvelope.version, ownerId:firstEnvelope.ownerId, workspace:firstEnvelope.workspace }), 'utf8').digest('hex');
  assert.equal(firstEnvelope.sha256, legacyChecksum, 'parent zinciri eski v1 checksum okuyucularını bozmamalı');

  let local = remote;
  const descendant = createCollectionReplication({
    workspaces: { loadWorkspace: () => local, replaceWorkspaceReplica: async (_ownerId, incoming) => ({ applied: true, workspace: incoming }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
    stateFile: path.join(root, 'device-b-replication-state.json'),
  });
  assert.equal((await descendant.syncOwner('user-b', 'owner-a')).reason, 'UP_TO_DATE');
  local = { ...remote, _revision: 6, rows: [{ id: 1, _rev: 6, note: 'doğrulanmış devam' }] };
  const published = await descendant.syncOwner('user-b', 'owner-a');
  assert.equal(published.published, true);
  assert.equal(published.reason, 'LOCAL_NEWER_PUBLISHED');
  const secondEnvelope = JSON.parse(await fsp.readFile(target, 'utf8'));
  assert.equal(secondEnvelope.parentSha256, firstEnvelope.chainSha256, 'yeni envelope önceki uzak zincir SHA ile bağlanmalı');

  const unrelated = { ...local, _revision: 8, rows: [{ id: 1, _rev: 8, note: 'başka offline dal' }] };
  const unknownDevice = createCollectionReplication({
    workspaces: { loadWorkspace: () => unrelated, replaceWorkspaceReplica: async () => ({ applied: false }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
    stateFile: path.join(root, 'device-c-replication-state.json'),
  });
  await assert.rejects(() => unknownDevice.publishOwner('owner-a'), error => error.code === 'COLLECTION_REPLICA_ANCESTRY_CONFLICT');
  assert.equal((await unknownDevice.status('owner-a')).state, 'conflict');
});

test('uzak revizyon ilerlediğinde yayımlanmamış yerel değişiklik indirme sırasında ezilmez', async t => {
  const { root, store } = await fixture(t);
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'edit', actorId: 'owner-a' });
  const sharedRoot = path.join(root, 'shared');
  const base = { schemaVersion: 1, ownerId: 'owner-a', initialized: true, _revision: 5, rows: [{ id: 1, _rev: 5, note: 'temel' }], manufacturers: [], customColumns: [], nextId: 2 };
  await createCollectionReplication({
    workspaces: { loadWorkspace: () => base, replaceWorkspaceReplica: async () => ({ applied: false }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
  }).publishOwner('owner-a');

  let dirtyLocal = base;
  let dirtyReplaced = 0;
  const dirtyDevice = createCollectionReplication({
    workspaces: {
      loadWorkspace: () => dirtyLocal,
      replaceWorkspaceReplica: async (_ownerId, incoming) => { dirtyReplaced += 1; dirtyLocal = incoming; return { applied: true, workspace: incoming }; },
    },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
    stateFile: path.join(root, 'dirty-device-state.json'),
  });
  await dirtyDevice.syncOwner('user-b', 'owner-a');
  dirtyLocal = { ...base, _revision: 6, rows: [{ id: 1, _rev: 6, note: 'yerel bekleyen' }] };

  let otherLocal = base;
  const otherDevice = createCollectionReplication({
    workspaces: { loadWorkspace: () => otherLocal, replaceWorkspaceReplica: async (_ownerId, incoming) => ({ applied: true, workspace: incoming }) },
    permissions: store, getSharedSyncRoot: async () => sharedRoot,
    stateFile: path.join(root, 'other-device-state.json'),
  });
  await otherDevice.syncOwner('user-b', 'owner-a');
  otherLocal = { ...base, _revision: 7, rows: [{ id: 1, _rev: 7, note: 'uzak ilerledi' }] };
  await otherDevice.publishOwner('owner-a');

  const result = await dirtyDevice.syncOwner('user-b', 'owner-a');
  assert.equal(result.reason, 'REMOTE_NEWER_LOCAL_DIRTY');
  assert.equal(result.conflict, true);
  assert.equal(dirtyReplaced, 0);
  assert.equal(dirtyLocal.rows[0].note, 'yerel bekleyen');
});

test('replikasyon sağlığı save/load yanıtından kullanıcıya görünür biçimde taşınır', () => {
  assert.match(SERVER_SOURCE, /stateFile: path\.join\(LOCAL_DATA_ROOT, 'collection-replication-state\.json'\)/);
  assert.match(SERVER_SOURCE, /workspace: \{ _revision: result\.revision[\s\S]*?replication \}\);/);
  assert.match(SERVER_SOURCE, /replication: result\.replication \|\| await collectionReplicaStatus\(ownerId\)/);
  assert.match(SERVER_SOURCE, /replication:await collectionReplicaStatus\(ownerId, syncError\)/);
  assert.match(UI_SOURCE, /function kolReportReplication\(replication\)/);
  assert.match(UI_SOURCE, /kolReportReplication\(data\.replication\)/);
  assert.match(UI_SOURCE, /Yerel kayıt tamamlandı; Koleksiyon paylaşımı ilgilenmenizi gerektiriyor/);
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
