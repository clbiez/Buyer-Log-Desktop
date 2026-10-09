'use strict';

/* SYNC kapsamı ve Moderatör otoritesi (v20261009).
   Sahada 169 açık "store:settings.json · modelConnections" çakışması görüldü:
   her kullanıcının veri yenilemesi bağlantı listesine lastRun yazıyor, liste
   bütün olarak 200 cihaza yayılıyor ve her cihazın kendi lastRun'ıyla
   çakışıyordu. Bu testler yeni sözleşmeyi korur:
   - eşler arası kanal yalnız izin listesindeki iş verisini taşır;
   - çalışma kuralları yalnız Moderatör yayımıyla gelir, çakışma üretmez;
   - yerel kalan olaylar bekleyen değişiklik sayılmaz ve alıcının kesintisiz
     checkpoint'ini takılı bırakmaz. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const policy = require('../server/lib/shared-sync-policy');
const syncPackage = require('../server/lib/sync-package');
const { filterCollectionWorkspaceDeltas } = require('../server/lib/collection-replication');

function serverFilter(deltas) { return policy.filterDeltas(filterCollectionWorkspaceDeltas(deltas), 'outgoing'); }
function transportable(item) { return serverFilter([item]).length === 1; }

async function device(root, name, shared) {
  const db = createLocalDb(path.join(root, name, 'BuyerLogLocal.db'));
  db.setTransportFilter(transportable);
  const sync = createSyncSettings({ localDataRoot: path.join(root, name, 'settings'), localDb: db, filterIncomingDeltas: serverFilter, filterOutgoingDeltas: serverFilter });
  await sync.save(shared);
  return { db, sync };
}

test('eşler arası kanal yalnız izin listesini taşır; çalışma kuralları ve tanınmayan kayıtlar yerel kalır', () => {
  for (const id of ['store:settings.json', 'store:overrides.json', 'store:fx-rates.json', 'endeksmatik:snapshot', 'store:quotations.json', 'store:shipping-comparison.json', 'store:user/fx-rates.json', 'plm-style-link:ABC']) {
    assert.equal(policy.sanitizeDelta({ id, patch: { a: 1 } }), null, `${id} eşler arası taşınmamalı`);
  }
  assert.equal(policy.classifyRecordId('store:open-costing.json'), 'LOCAL_ONLY');

  const cp = policy.sanitizeDelta({ id: 'cp-order:1001', patch: { notes: { Notes: 'özel' }, subManufacturer: 'SUB', suppFob: 4.2, suppFobMeta: { at: 'x' }, dates: { ex: '2026-11-01' }, shortage: true, licensor: 'L' } });
  assert.deepEqual(Object.keys(cp.patch).sort(), ['dates', 'subManufacturer', 'suppFob', 'suppFobMeta']);
  assert.equal(policy.sanitizeDelta({ id: 'cp-order:1001', patch: { notes: { Notes: 'yalnız not' } } }), null, 'yalnız yerel alan taşıyan CP olayı paket üretmez');
  assert.equal(policy.sanitizeDelta({ id: 'cp-order:1001', delete: true }), null, 'CP kaydının tamamı eşten silinmez');

  const email = policy.sanitizeDelta({ id: 'store:email-groups.json', patch: { records: [{ id: 'r1', email: 'a@b.c' }], apiToken: 'x' } });
  assert.ok(email && email.patch.records.length === 1);
  assert.equal(email.patch.apiToken, undefined);
});

test('kapsam dışı çakışmalar kapanabilir; paylaşılan CP alanı çakışması açık kalır', () => {
  assert.equal(policy.conflictInPeerScope({ id: 'store:settings.json', type: 'field', field: 'modelConnections' }), false);
  assert.equal(policy.conflictInPeerScope({ id: 'cp-order:1', type: 'field', field: 'notes' }), false);
  assert.equal(policy.conflictInPeerScope({ id: 'cp-order:1', type: 'delete' }), false);
  assert.equal(policy.conflictInPeerScope({ id: 'cp-order:1', type: 'field', field: 'suppFob' }), true);
  assert.equal(policy.conflictInPeerScope({ id: 'store:email-groups.json', type: 'field', field: 'countries' }), true);
});

test('iş checkpoint\'i CP notlarını taşımaz; eski checkpoint kapsamla okunur ve onarım yerel notu korur', () => {
  const state = { records: {
    'cp-order:1': { notes: { Notes: 'yerel' }, suppFob: 3, _revision: 4, _fieldRevisions: { notes: 4, suppFob: 2 } },
    'cp-order:2': { notes: { Notes: 'yalnız not' }, _revision: 1 },
    'store:quotations.json': { requests: [] },
  } };
  const business = policy.businessRecordsFromState(state);
  assert.deepEqual(Object.keys(business), ['cp-order:1']);
  assert.equal(business['cp-order:1'].notes, undefined);
  assert.deepEqual(business['cp-order:1']._fieldRevisions, { suppFob: 2 });

  const legacyRemote = { 'cp-order:1': { notes: { Notes: 'uzak' }, suppFob: 5, _revision: 9 }, 'store:quotations.json': { requests: [{ id: 'q' }] } };
  const scoped = policy.scopeCheckpointRecords('business', legacyRemote);
  assert.deepEqual(Object.keys(scoped), ['cp-order:1']);
  const merged = policy.mergeCheckpointRecord(state.records['cp-order:1'], scoped['cp-order:1']);
  assert.deepEqual(merged.notes, { Notes: 'yerel' }, 'onarım yerel notu ezmez');
  assert.equal(merged.suppFob, 5);
});

test('Moderatör bağlantı listesi birleşirken cihazın son çalıştırma bilgisi korunur', () => {
  const local = { modelConnections: [{ id: 'c1', server: 'old', lastRun: { at: 'dün', ok: true } }], sourceFolders: { u: 'C:/x' } };
  const remote = { modelConnections: [{ id: 'c1', server: 'new' }, { id: 'c2', server: 's2' }], storeRevisionMeta: { revision: 3 } };
  const merged = policy.mergeCheckpointRecord(local, remote);
  assert.equal(merged.modelConnections[0].server, 'new');
  assert.deepEqual(merged.modelConnections[0].lastRun, { at: 'dün', ok: true });
  assert.equal(merged.modelConnections[1].lastRun, undefined);
  assert.deepEqual(merged.sourceFolders, { u: 'C:/x' });
});

test('paket kapsamı yerel sıra boşluğunu kapatır; eski alıcı paketi doğrulayabilir', () => {
  const events = [5, 6, 9].map(seq => ({ eventId: `e${seq}`, id: `cp-order:${seq}`, localSequence: seq, patch: { suppFob: seq } }));
  const built = syncPackage.buildSyncPackages(events, { deviceId: 'dev', coverFromSeq: 3, maxEvents: 2 });
  assert.equal(built.packages.length, 2);
  const [first, second] = built.packages.map(item => item.manifest);
  assert.equal(first.firstSeq, 5); assert.equal(first.coverFromSeq, 3);
  assert.equal(second.firstSeq, 9); assert.equal(second.coverFromSeq, 7);
  for (const manifest of [first, second]) assert.doesNotThrow(() => syncPackage.validateSyncPackage(JSON.parse(JSON.stringify(manifest))));
  assert.equal(syncPackage.receiptFirstSeq(first), 3);
  assert.equal(syncPackage.receiptFirstSeq({ firstSeq: 4 }), 4);
  const name = syncPackage.gzipBundleFileName(built.packages[0]);
  assert.equal(syncPackage.packageIdFromBundleFile(name), first.packageId);
  assert.throws(() => syncPackage.validateSyncPackage({ ...first, coverFromSeq: first.firstSeq, checksum: undefined }), /cover range/);
});

test('yerel kalan yazım bekleyen değişiklik sayılmaz', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-scope-pending-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  db.setTransportFilter(transportable);
  await db.queuePatch({ id: 'store:settings.json', patch: { modelConnections: [{ id: 'c1', lastRun: { at: 'x' } }] } });
  await db.queuePatch({ id: 'cp-order:1', patch: { notes: { Notes: 'yerel' } } });
  assert.equal(await db.pendingCount(), 0);
  assert.equal(await db.unacknowledgedCount(), 0);
  await db.queuePatch({ id: 'cp-order:1', patch: { suppFob: 7 } });
  assert.equal(await db.pendingCount(), 1);
});

test('iki cihaz: bağlantı listesi yenilemeleri çakışma üretmez, CP paylaşılan alanları geçer, checkpoint kesintisiz ilerler', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-scope-two-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });
  const a = await device(root, 'a', shared), b = await device(root, 'b', shared);

  // İki kullanıcı aynı anda veri yeniler: ikisi de bağlantı listesine lastRun yazar.
  await a.db.queuePatch({ id: 'store:settings.json', patch: { modelConnections: [{ id: 'c1', lastRun: { at: 'A' } }] } });
  await b.db.queuePatch({ id: 'store:settings.json', patch: { modelConnections: [{ id: 'c1', lastRun: { at: 'B' } }] } });
  // A: yerel not + paylaşılan Sub-Manufacturer / Ex-Factory.
  await a.db.queuePatch({ id: 'cp-order:1001', patch: { notes: { Notes: 'A notu' } } });
  await a.db.queuePatch({ id: 'cp-order:1001', patch: { subManufacturer: 'SUB-A', dates: { ex: '2026-11-01' } } });
  await a.db.queuePatch({ id: 'store:shipping-comparison.json', patch: { rows: [1] } });

  for (const item of [a, b, a, b]) {
    const result = await item.sync.syncOnce();
    assert.equal(result.online, true, result.lastError || 'sync çevrimiçi kalmalı');
  }

  const stateB = await b.db.read();
  assert.equal(stateB.conflicts.filter(item => !item.resolved).length, 0, 'çakışma oluşmamalı');
  assert.equal(stateB.records['cp-order:1001'].subManufacturer, 'SUB-A');
  assert.deepEqual(stateB.records['cp-order:1001'].dates, { ex: '2026-11-01' });
  assert.equal(stateB.records['cp-order:1001'].notes, undefined, 'not yerel kalır');
  assert.equal(stateB.records['store:shipping-comparison.json'], undefined, 'kişisel dosya yayılmaz');
  assert.deepEqual(stateB.records['store:settings.json'].modelConnections[0].lastRun, { at: 'B' }, 'B kendi lastRun değerini korur');

  // A'nın sırası yerel kalan olaylarla boşluklu (1, 2 yerel; 3 paylaşılan);
  // B'nin kesintisiz checkpoint'i yine A'nın yayımladığı son sıraya ulaşır.
  const stateA = await a.db.read();
  const headA = JSON.parse(await fsp.readFile(path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(stateA.deviceId), '_head.json'), 'utf8'));
  assert.equal(headA.latestSequence, 3);
  assert.equal(stateB.syncCheckpoints[stateA.deviceId], 3);

  // A yeni bir paylaşılan alan yazar: önceki yerel sıra (4) da kapsanır.
  await a.db.queuePatch({ id: 'cp-order:1001', patch: { suppFob: 4.5 } });
  await a.sync.syncOnce();
  await b.sync.syncOnce();
  assert.equal((await b.db.read()).syncCheckpoints[stateA.deviceId], 5);

  // Yeni değişiklik yoksa sonraki tur paket indirmez, A'nın klasörünü atlar.
  const again = await b.sync.syncOnce();
  assert.equal(again.downloadedPackages, 0);
  assert.ok(again.skippedDeviceFolders >= 1 || again.scannedPackages === 0);
});

test('sunucu: Master yayımı ve çakışma temizliği Moderatör otoritesine bağlı', () => {
  const server = require('./helpers/server-source')();
  const publish = server.slice(server.indexOf('function publishSharedMasterChange'), server.indexOf('function moderatorActiveOnThisDevice'));
  assert.match(publish, /if \(isModeratorProfile\(actor\)\) \{[\s\S]*scheduleMasterCheckpointPublish/);
  assert.match(server, /if \(!moderatorActiveOnThisDevice\(\)\) return \{ published:false, reason:'moderator-only' \}/);
  assert.match(server, /authority:'moderator'/);
  assert.match(server, /if \(moderatorActiveOnThisDevice\(\)\) scheduleMasterCheckpointPublish\(moderatorSessionActor, 750\)/);
  const pull = server.slice(server.indexOf('async function pullModeratorMasterIfNewer'), server.indexOf('async function retireOutOfScopeSyncConflicts'));
  assert.match(pull, /masterCheckpointHasModeratorAuthority\(remote\)/);
  assert.match(pull, /resolution = 'moderator-master'/);
  assert.match(pull, /filter\(id => !sharedSyncPolicy\.peerChannelAllows\(id\)\)/);
  assert.match(server, /localDb\.setTransportFilter\(/);
  assert.match(server, /void afterSharedSyncCompleted\(\)/);
  // Her sync sonrası tam bootstrap çalışmaz; 45 sn turu hazır cihazda yalnız IAM tazeler.
  assert.doesNotMatch(server, /onStateChange\(state => \{\s*if \(state && state\.lastSync && !state\.progress\) \{\s*void bootstrapSharedHub\(\)/);
  assert.match(server, /return userAccess\.refreshIam\(\{ timeoutMs:30000 \}\)/);
});
