'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-owner-recovery-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const store = require('../server/lib/collection-workspaces');
const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive:true, force:true }));

function seed(ownerId, rows) {
  const current = store.loadWorkspace(ownerId);
  return store.saveWorkspace(ownerId, {
    rows,
    manufacturers: [],
    customColumns: [],
    nextId: 1 + rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0),
  }, current._revision);
}

function baseRow(id, plmId, modelKod, colourCode, extra = {}) {
  return {
    id, plmId, modelKod, colourCode, colour:'BLACK',
    inStoreMonth:'JUNE 2027', status:'Sent for MB Approval',
    productMainDefinition:'T-Shirt', category:'KEY ORME BODY K.KOL-LISANS',
    ...extra,
  };
}

test('legacy shared/alias Collection recovery deduplicates safely and remains idempotent', async () => {
  seed('owner-main', [
    baseRow(1, '2102172', 'SPIDERMAN-4-YD', 'ST7GY6224', { quantity:'100', note:'', img:'', imgRef:'' }),
  ]);
  seed('alias-gokberk', [
    baseRow(2, '2102172', 'SPIDERMAN-4-YD', 'ST7GY6224', { quantity:'100', note:'recovered note', imgRef:'ci_spider' }),
  ]);
  seed('alias-gokberk-celebi', [
    baseRow(3, '2102172', 'SPIDERMAN-4-YD', 'ST7GY6224', { quantity:'100', note:'recovered note' }),
  ]);
  seed(store.SHARED_COLLECTION_OWNER, [
    { ...baseRow(10, '2102172', 'SPIDERMAN-4-YD', 'ST7GY6224', { quantity:'100', note:'recovered note' }), _legacyOwnerId:'alias-gokberk', _legacyRowId:'2' },
    { ...baseRow(11, '2121291', 'MINECRAFT-19-YD', 'ST7GY4524', { quantity:'80' }), _legacyOwnerId:'alias-gokberk', _legacyRowId:'11' },
    { ...baseRow(12, '2121291', 'MINECRAFT-19-YD', 'ST7GY4524', { quantity:'80', imgRef:'ci_minecraft' }), _legacyOwnerId:'alias-gokberk-celebi', _legacyRowId:'12' },
    { ...baseRow(13, '2092935', 'SHADOW-1-TKM-YD', 'ST7PM8824', { quantity:'10' }), _legacyOwnerId:'alias-gokberk', _legacyRowId:'13' },
    { ...baseRow(14, '2092935', 'SHADOW-1-TKM-YD', 'ST7PM8824', { quantity:'20' }), _legacyOwnerId:'alias-gokberk-celebi', _legacyRowId:'14' },
    { ...baseRow(15, '9999999', 'FOREIGN-MODEL', 'FOREIGN', { quantity:'1' }), _legacyOwnerId:'real-other-user', _legacyRowId:'15' },
  ]);

  const sharedBefore = store.loadWorkspace(store.SHARED_COLLECTION_OWNER);
  const first = store.recoverSharedWorkspaceIntoOwner('owner-main', {
    sourceOwnerIds:['alias-gokberk', 'alias-gokberk-celebi'],
    sharedSourceOwnerIds:['owner-main', 'alias-gokberk', 'alias-gokberk-celebi'],
  });
  assert.equal(first.changed, true);
  assert.ok(first.duplicatesMerged >= 3);

  const recovered = store.loadWorkspace('owner-main');
  assert.equal(recovered.rows.length, 4, 'exact/compatible recovery copies should collapse, conflicting business rows should remain separate');
  assert.equal(recovered.rows.some(row => row.modelKod === 'FOREIGN-MODEL'), false, 'restricted shared provenance must not import another real owner');
  const spider = recovered.rows.find(row => row.modelKod === 'SPIDERMAN-4-YD');
  assert.equal(spider.note, 'recovered note', 'a richer compatible copy should fill a blank field');
  assert.equal(spider.imgRef, 'ci_spider', 'image ownership should be recovered when the target copy is blank');
  assert.equal(recovered.rows.filter(row => row.modelKod === 'MINECRAFT-19-YD').length, 1);
  assert.deepEqual(recovered.rows.filter(row => row.modelKod === 'SHADOW-1-TKM-YD').map(row => row.quantity).sort(), ['10','20'],
    'two non-empty conflicting quantities must never be silently merged');

  const sharedAfter = store.loadWorkspace(store.SHARED_COLLECTION_OWNER);
  assert.equal(sharedAfter.rows.length, sharedBefore.rows.length, 'legacy shared evidence must not be deleted or rewritten');

  const revision = recovered._revision;
  const second = store.recoverSharedWorkspaceIntoOwner('owner-main', {
    sourceOwnerIds:['alias-gokberk', 'alias-gokberk-celebi'],
    sharedSourceOwnerIds:['owner-main', 'alias-gokberk', 'alias-gokberk-celebi'],
  });
  assert.equal(second.changed, false, 'restarting Buyer Log must not duplicate the same recovery again');
  assert.equal(store.loadWorkspace('owner-main')._revision, revision);

  const beforeEdit = store.loadWorkspace('owner-main');
  const editable = beforeEdit.rows.find(row => row.modelKod === 'MINECRAFT-19-YD');
  const edited = await store.applyRowChangesAsync('owner-main', { upserts:[{ ...editable, note:'editable by owner' }] });
  assert.equal(edited.conflicts.length, 0);
  const fresh = store.loadWorkspace('owner-main');
  const deletable = fresh.rows.find(row => row.modelKod === 'MINECRAFT-19-YD');
  const removed = await store.applyRowChangesAsync('owner-main', { deletes:[{ id:deletable.id, _rev:store.rowRev(deletable) }] });
  assert.equal(removed.conflicts.length, 0);
  assert.equal(store.loadWorkspace('owner-main').rows.some(row => row.modelKod === 'MINECRAFT-19-YD'), false,
    'recovered rows use the normal owner workspace and must be deletable');

  const afterDeleteRecovery = store.recoverSharedWorkspaceIntoOwner('owner-main', {
    sourceOwnerIds:['alias-gokberk', 'alias-gokberk-celebi'],
    sharedSourceOwnerIds:['owner-main', 'alias-gokberk', 'alias-gokberk-celebi'],
  });
  assert.equal(afterDeleteRecovery.reason, 'already-recovered');
  assert.equal(store.loadWorkspace('owner-main').rows.some(row => row.modelKod === 'MINECRAFT-19-YD'), false,
    'the preserved legacy source must never resurrect a model the owner intentionally deleted later');
});

function block(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, 'missing start: ' + start);
  assert.ok(to > from, 'missing end: ' + end);
  return source.slice(from, to);
}

test('Shared Hub transports owner workspaces and never replaces them with Shared Collection', () => {
  const activation = block(SERVER, 'async function activateSharedHubRuntime', 'async function bootstrapSharedHub');
  assert.doesNotMatch(activation, /ensureSharedWorkspace|mirrorWorkspace\(SHARED_COLLECTION_OWNER\)/);
  assert.match(activation, /COLLECTION_OWNER_REPLICATION_READY/);

  const mode = block(SERVER, 'function sharedCollectionModeEnabled()', 'function canonicalCollectionOwner');
  assert.match(mode, /return false/);
  const canonical = block(SERVER, 'function canonicalCollectionOwner', 'function collectionWorkspaceEditAllowed');
  assert.match(canonical, /return String\(ownerId \|\| ''\)/);
  assert.doesNotMatch(canonical, /SHARED_COLLECTION_OWNER/);

  const listing = block(SERVER, "app.get('/api/collection-workspaces'", "app.get('/api/collection-permissions'");
  assert.doesNotMatch(listing, /ensureLegacyCollectionOwnerRecovery\(req\.currentUser\)/,
    'opening/listing Collection must never mutate live data through legacy recovery');
  assert.match(listing, /Legacy Collection recovery is forensic\/manual-only/);
  assert.match(listing, /effectiveCollectionAccess\(req\.currentUser\)/);
  assert.match(listing, /shared:false/);
  assert.match(listing, /samePersonOwnerIds/);
});

test('Permissions and multi-owner Collection view remain the canonical UI flow', () => {
  const init = block(APP, 'async function initKolWorkspaces(options)', 'const KOL_STATUS_API=window.BLCollectionStatusCatalog');
  assert.match(init, /await kolLoadPermissions\(\)/);
  assert.match(init, /kolLoadWorkspaceBatch\(kolWorkspaceList\.map\(item=>item\.ownerId\)\)/);
  const scope = block(APP, 'function renderKolScopeFilters()', 'const KOL_INIT_RETRY_DELAYS');
  assert.match(scope, /workspacePermissions/);
  assert.match(scope, /data-owner-id/);
  assert.match(scope, /data-grant-level/);

  const batch = block(SERVER, "app.get('/api/collection-workspaces-batch'", "app.get('/api/collection-workspaces/:ownerId'");
  assert.match(batch, /collectionAccessLevel\(req\.currentUser, ownerId\)/);
  assert.match(batch, /workspaces\.push/);
  assert.match(batch, /readOnly:true, shared:false/);
});

test('granting Collection access publishes the owner workspace as well as images', () => {
  const route = block(SERVER, 'async function updateCollectionPermission', "app.put('/api/collection-permissions/:granteeId'");
  assert.match(route, /collectionReplication\.publishOwner\(ownerId\)/);
  assert.match(route, /publishCollectionWorkspaceImages\(ownerId\)/);
  assert.match(route, /collectionWorkspacePublishOnGrant/);
});

test('recycle bin deletion follows the real owner workspace instead of shared-collection', () => {
  const client = block(APP, 'async function kolBinApi', 'function kolBinDaysLeft');
  assert.match(client, /encodeURIComponent\(kolWorkspaceOwnerId\)/);
  const access = block(SERVER, 'function collectionBinAccess', "app.get('/api/collection-recycle-bin/:ownerId'");
  assert.match(access, /collectionAccessLevel\(req\.currentUser, ownerId\)/);
  assert.match(access, /collectionWorkspaceEditAllowed\(req\.currentUser, ownerId\)/);
  const canonical = block(SERVER, 'function canonicalCollectionOwner', 'function collectionWorkspaceEditAllowed');
  assert.doesNotMatch(canonical, /SHARED_COLLECTION_OWNER/);
});

test('personal backup restore writes back to the signed-in owner workspace', () => {
  assert.match(SERVER, /const userRestoreService = createUserRestoreService\(\);/);
  const init = SERVER.slice(SERVER.indexOf('const userRestoreService ='), SERVER.indexOf('const userRestoreUploads'));
  assert.doesNotMatch(init, /mergePersonalBackupIntoShared|SHARED_COLLECTION_OWNER|userRestoreSharedCollectionSync/);
});
