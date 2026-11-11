'use strict';

/* Saha bulgusu (2026-11): ekip arkadaşının CP'de seçtiği önem etiketi Sync Now
   sonrası yerel DB'ye iniyor, fakat açık ekrana ve sayfa projeksiyonu
   önbelleğine yansımıyordu; yalnız kaynak "Yenile" gösteriyordu.

   Kök neden: projeksiyon önbelleği anahtarı yalnız YEREL yazmanın artırdığı
   overrides._revisions.orders'a bakıyordu; uzaktan uygulanan cp-order deltası
   anahtarı değiştirmiyor, senkron da açık istemcilere sinyal göndermiyordu.

   Sözleşme:
   - Uzaktan cp-order verisini GERÇEKTEN değiştiren her uygulama, yerel DB'de
     aynı işlemle kalıcı bir sayaç artırır (yeniden başlatmada sıfırlanmaz).
   - Tekrar/boş senkron, receipt-only (sahibi olmayan) olay ve cp-order dışı
     kayıt sayacı artırmaz: gereksiz projeksiyon yeniden kurulumu yok.
   - Sayaç projeksiyon bağlam anahtarına girer; senkron sonrası açık ekranlar
     hafif yeniden yükleme sinyali alır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const policy = require('../server/lib/shared-sync-policy');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { createDeltaStore } = require('../server/lib/delta-store');
const { createOwnershipResolver } = require('../server/lib/cp-field-ownership');

const ID = 'cp-order:1001|DEMO MODEL|BLUE';
const resolve = createOwnershipResolver({ 1001:[{ buyer:'Demo Owner' }] }, [{ id:'owner', username:'Demo Owner' }, { id:'other', username:'Other' }]);
const ownerOf = (recordId, userId) => resolve({ recordId, userId });
const counter = state => Number(state.remoteApplyRevisions && state.remoteApplyRevisions['cp-order']) || 0;

async function devices(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'cp-remote-visibility-'));
  t.after(() => fsp.rm(root, { recursive:true, force:true, maxRetries:10, retryDelay:50 }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared);
  const result = [];
  for (const name of ['a','b']) {
    const file = path.join(root, name, 'BuyerLogLocal.db');
    const db = createLocalDb(file);
    db.setSharedOwnerResolver(ownerOf);
    db.setTransportFilter(delta => policy.filterDeltas([delta]).length === 1);
    const sync = createSyncSettings({ localDataRoot:path.join(root,name,'settings'), localDb:db,
      filterIncomingDeltas:d => policy.filterDeltas(d, 'incoming'), filterOutgoingDeltas:d => policy.filterDeltas(d, 'outgoing') });
    await sync.save(shared);
    result.push({ db, sync, file });
  }
  return result;
}
async function exchange(writer, reader) {
  for (const device of [writer, reader]) {
    const result = await device.sync.syncOnce();
    assert.equal(result.online, true, result.lastError || 'folder transport stays online');
  }
}

test('remote cp-order apply advances a persistent counter; idle sync and own writes do not', async t => {
  const [a, b] = await devices(t);
  assert.equal(counter(await b.db.read()), 0);
  await a.db.queuePatch({ id:ID, patch:{ importance:'transition' }, userId:'owner' });
  assert.equal(counter(await a.db.read()), 0, 'own local write is covered by overrides revisions, not this counter');
  await exchange(a, b);
  const afterFirst = counter(await b.db.read());
  assert.ok(afterFirst > 0, 'receiver marks the remote cp-order change');
  assert.equal((await b.db.read()).records[ID].importance, 'transition');
  assert.equal(counter(await createLocalDb(b.file).read()), afterFirst, 'counter survives restart (cold reload)');
  await b.sync.syncOnce();
  assert.equal(counter(await b.db.read()), afterFirst, 'idle sync does not invalidate projections');
  await a.db.queuePatch({ id:ID, patch:{ importance:'regular' }, userId:'owner' });
  await exchange(a, b);
  assert.ok(counter(await b.db.read()) > afterFirst, 'reverse edit to Regular advances again');
});

test('receipt-only foreign write and non cp-order records do not advance the counter', async t => {
  const [a] = await devices(t);
  const result = await a.db.applyDelta({ id:ID, eventId:'foreign-1', deviceId:'foreign-device', userId:'other', localSequence:1, revision:9, patch:{ importance:'bts' } });
  assert.equal(result.applied, false);
  await a.db.applyDelta({ id:'store:email-groups.json', eventId:'mail-1', deviceId:'peer-device', userId:'owner', localSequence:1, revision:9, patch:{ groups:[] } });
  assert.equal(counter(await a.db.read()), 0);
  await a.db.applyDelta({ id:ID, eventId:'owner-1', deviceId:'peer-device', userId:'owner', localSequence:2, revision:10, patch:{ importance:'bts' } });
  assert.equal(counter(await a.db.read()), 1);
});

test('delta store exposes the counter only after hydrate, consistent with the overlay snapshot', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-remote-delta-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const db = createLocalDb(path.join(root, 'Local.db'));
  const store = createDeltaStore({ localDb:db, mode:'delta' });
  await store.hydrate();
  assert.equal(store.remoteApplyRevision('cp-order'), 0);
  await db.applyDelta({ id:'cp-order:2002', eventId:'peer-1', deviceId:'peer-device', userId:'', localSequence:1, revision:3, patch:{ importance:'bts' } });
  assert.equal(store.remoteApplyRevision('cp-order'), 0, 'memory snapshot changes only on hydrate');
  await store.hydrate();
  assert.equal(store.remoteApplyRevision('cp-order'), 1);
  assert.equal(store.readAllSync('cp-order')['2002'].importance, 'bts');
});

test('server keys page projections on remote cp revision and signals open screens after sync', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const ctx = source.slice(source.indexOf('function pageProjectionContext'), source.indexOf('function projectionSourceRevision'));
  assert.match(ctx, /cpRemote:\s*cpSharedStore\.remoteRevision\(\)/, 'projection context includes remote cp-order revision');
  const after = source.slice(source.indexOf('function afterSharedSyncCompleted'), source.indexOf('let masterCheckpointTimer'));
  assert.match(after, /announceRemoteCpChanges\(\)/, 'post-sync hook announces remote cp-order changes');
  const announce = source.slice(source.indexOf('function announceRemoteCpChanges'), source.indexOf('function afterSharedSyncCompleted'));
  assert.match(announce, /liveEvents\.notifyChange\('orders',\s*null/, 'open screens get a lean reload signal');
  assert.match(announce, /sharedRevisionStore\.update\('cpOverrides'/, 'polling fallback sees the change when SSE is down');
  const store = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'cp-shared-store.js'), 'utf8');
  assert.match(store, /function remoteRevision\(/);
});

test('checkpoint repair of cp-order records advances the same counter inside its transaction', () => {
  const { bumpRemoteApplyRevision } = require('../server/lib/local-db');
  const state = {};
  bumpRemoteApplyRevision(state, 'store:email-groups.json');
  assert.equal(counter(state), 0);
  bumpRemoteApplyRevision(state, ID);
  assert.equal(counter(state), 1);
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const repair = source.slice(source.indexOf('async function applyMissingCheckpointRecords'), source.indexOf('async function reconcileSharedCheckpointCoverage'));
  assert.match(repair, /delete next\.tombstones\[id\];\s*\/\/[^\n]*\n\s*bumpRemoteApplyRevision\(next, id\);/);
});
