'use strict';

/* Çok cihazlı senaryoda bulunan hata: iki kullanıcı (karşılıklı düzenleme
   yetkisiyle) aynı Koleksiyonu AYNI ANDA iki cihazda düzenlediğinde kopyalar
   kalıcı olarak ayrışıyordu. Replikasyon belgeyi bütün olarak CAS ile
   yayınladığı için ikinci cihaz "ANCESTRY/EQUAL_REVISION conflict" durumunda
   kalıyor, hiçbir cihaz diğerinin değişikliğini bir daha görmüyordu (sonraki
   sıralı düzenlemeler dahil). Kullanıcıya yalnız "paylaşım ilgilenmenizi
   gerektiriyor" deniyor, çözüm yolu yoktu.

   Artık son ortak taban (cihazın gördüğü son uzak kopya) saklanır ve satır/alan
   bazında üç yönlü birleşim yapılır:
   - farklı alanlar birlikte korunur;
   - aynı alan iki tarafta farklı değiştiyse ÖNCE yayımlanan değer kalır, ikinci
     değer sessizce kaybolmaz: senkron çakışması olarak kaydedilir;
   - aynı yeni satır kimliği iki cihazda farklı modeller için kullanıldıysa ikisi
     de korunur;
   - taban yoksa (soy doğrulanamıyorsa) eski davranış: yerel kopya korunur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createCollectionPermissionsStore } = require('../server/lib/collection-permissions-store');
const { createCollectionReplication, mergeCollectionWorkspaces } = require('../server/lib/collection-replication');

const ws = (revision, rows, extra = {}) => ({ schemaVersion: 1, ownerId: 'owner-a', initialized: true, _revision: revision, rows, manufacturers: [], customColumns: [], statusCatalog: [], nextId: 10, ...extra });

test('üç yönlü birleşim: farklı alanlar korunur, aynı alanda önce yayımlanan kalır ve çakışma kaydedilir', () => {
  const base = ws(5, [{ id: 1, _rev: 5, not: '', fob: '', targetPrice: '3,00' }, { id: 2, _rev: 5, not: 'x' }, { id: 3, _rev: 5, not: 'silinecek' }]);
  const local = ws(6, [{ id: 1, _rev: 6, not: 'Mehmet', fob: '', targetPrice: '1,11', pricing: { B: '2', A: '1' } }, { id: 2, _rev: 5, not: 'x' }, { id: 4, _rev: 6, modelKod: 'M-yeni' }]);
  const remote = ws(6, [{ id: 1, _rev: 6, not: '', fob: '9,99', targetPrice: '2,22', pricing: { A: '1', B: '2' } }, { id: 2, _rev: 5, not: 'x' }, { id: 3, _rev: 5, not: 'silinecek' }, { id: 4, _rev: 6, modelKod: 'Z-yeni' }]);
  const { workspace, conflicts } = mergeCollectionWorkspaces(base, local, remote);
  const row = id => workspace.rows.find(item => item.id === id);
  assert.equal(row(1).not, 'Mehmet');
  assert.equal(row(1).fob, '9,99');
  assert.equal(row(1).targetPrice, '2,22', 'önce yayımlanan (uzak) değer kalır');
  assert.deepEqual(conflicts, [{ rowId: '1', field: 'targetPrice', current: '2,22', incoming: '1,11' }], 'anahtar sırası farkı çakışma sayılmaz');
  assert.equal(row(3), undefined, 'yerelde silinen, uzakta dokunulmayan satır silinmiş kalır');
  assert.equal(row(4).modelKod, 'Z-yeni');
  const renamed = workspace.rows.find(item => item.modelKod === 'M-yeni');
  assert.ok(renamed && renamed.id !== 4, 'aynı yeni kimlikle eklenen iki farklı model ikisi de korunur');
  assert.ok(workspace.nextId > renamed.id);
  assert.equal(workspace._revision, 7);
  assert.ok(row(1)._rev > 6, 'birleşen satırın revizyonu ilerler: bayat istemci üstüne yazamaz');
  assert.equal(row(2)._rev, 5, 'değişmeyen satırın revizyonu korunur');
});

test('uzakta değiştirilen satır yerelde silinmişse değişiklik korunur ve bildirilir', () => {
  const base = ws(5, [{ id: 1, _rev: 5, not: 'a' }]);
  const { workspace, conflicts } = mergeCollectionWorkspaces(base, ws(6, []), ws(6, [{ id: 1, _rev: 6, not: 'b' }]));
  assert.equal(workspace.rows[0].not, 'b');
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, '_deleted');
});

async function hub(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-coedit-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const store = createCollectionPermissionsStore({ file: path.join(root, 'perm.json'), getProfiles: () => [{ id: 'owner-a', enabled: true }, { id: 'user-b', enabled: true }], getSharedSyncRoot: async () => path.join(root, 'shared') });
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'user-b', level: 'edit', actorId: 'owner-a' });
  const device = (name, onApplied, beforeReplace) => {
    const box = { local: null, replaced: 0 };
    box.replication = createCollectionReplication({
      workspaces: {
        loadWorkspace: () => JSON.parse(JSON.stringify(box.local)),
        replaceWorkspaceReplica: async (_owner, incoming, options = {}) => {
          if(beforeReplace)await beforeReplace(box,incoming,options);
          if (options.expectedSha256 && require('node:crypto').createHash('sha256').update(JSON.stringify(box.local)).digest('hex') !== options.expectedSha256) return { applied: false, reason: 'LOCAL_CHANGED' };
          box.local = JSON.parse(JSON.stringify(incoming)); box.replaced += 1; return { applied: true, workspace: box.local };
        },
      },
      onApplied, permissions: store, getSharedSyncRoot: async () => path.join(root, 'shared'), stateFile: path.join(root, `${name}-state.json`),
    });
    return box;
  };
  return { device };
}

test('iki cihaz aynı anda düzenler: ikinci yayın birleşir, iki cihaz aynı sonuca yakınsar, kaybeden değer çakışma olur', async t => {
  const { device } = await hub(t);
  const owner = device('owner'), editor = device('editor');
  owner.local = ws(5, [{ id: 1, _rev: 5, not: '', fob: '', targetPrice: '3,00' }]);
  await owner.replication.publishOwner('owner-a');
  editor.local = ws(0, [], { initialized: false });
  await editor.replication.syncOwner('user-b', 'owner-a');
  assert.equal(editor.local._revision, 5);
  // Eşzamanlı yerel yazımlar (her cihaz kendi sunucusunda)
  owner.local = ws(6, [{ id: 1, _rev: 6, not: 'Mehmet', fob: '', targetPrice: '1,11' }]);
  editor.local = ws(6, [{ id: 1, _rev: 6, not: '', fob: '9,99', targetPrice: '2,22' }]);
  await editor.replication.publishOwner('owner-a');          // önce yayımlayan
  const merged = await owner.replication.publishOwner('owner-a'); // ikinci: CAS çakışır → birleşir
  assert.equal(merged.merged, true);
  assert.equal(merged.published, true);
  assert.deepEqual([owner.local.rows[0].not, owner.local.rows[0].fob, owner.local.rows[0].targetPrice], ['Mehmet', '9,99', '2,22']);
  const conflicts = await owner.replication.listMergeConflicts(['owner-a']);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].incoming, '1,11');
  assert.equal((await owner.replication.status('owner-a')).mergeConflicts, 1);
  // Diğer cihaz birleşmiş kopyayı alır
  const pulled = await editor.replication.syncOwner('user-b', 'owner-a');
  assert.equal(pulled.synced, true);
  assert.deepEqual(editor.local.rows, owner.local.rows);
  // Sonraki sıralı düzenleme normal akar
  editor.local = { ...editor.local, _revision: editor.local._revision + 1, rows: [{ ...editor.local.rows[0], _rev: 99, quantity: '7777' }] };
  await editor.replication.publishOwner('owner-a');
  await owner.replication.syncOwner('owner-a', 'owner-a');
  assert.equal(owner.local.rows[0].quantity, '7777');
  // Çakışma çözümü: kaybeden değer açıkça geri yazılabilir
  let applied = null;
  await owner.replication.resolveMergeConflict(conflicts[0].conflictId, 'incoming', async conflict => { applied = conflict; });
  assert.equal(applied.field, 'targetPrice');
  assert.equal((await owner.replication.listMergeConflicts(['owner-a'])).length, 0);
});

test('satır/sayfa senkronu sırasında eşzamanlı bekleyen yerel değişiklik birleşimle korunur (REMOTE_NEWER_LOCAL_DIRTY)', async t => {
  const { device } = await hub(t);
  const owner = device('owner'), editor = device('editor');
  owner.local = ws(5, [{ id: 1, _rev: 5, not: 'temel', quantity: '1' }]);
  await owner.replication.publishOwner('owner-a');
  editor.local = ws(0, [], { initialized: false });
  await editor.replication.syncOwner('user-b', 'owner-a');
  editor.local = ws(6, [{ id: 1, _rev: 6, not: 'editör bekleyen', quantity: '1' }]);
  owner.local = ws(7, [{ id: 1, _rev: 7, not: 'temel', quantity: '5' }]);
  await owner.replication.publishOwner('owner-a');
  const result = await editor.replication.syncOwner('user-b', 'owner-a');
  assert.equal(result.merged, true);
  assert.deepEqual([editor.local.rows[0].not, editor.local.rows[0].quantity], ['editör bekleyen', '5']);
});

test('sunucu: birleşim canlı yayılır, uzak değişiklik yoklanır, çakışmalar Senkron çakışmalarında listelenip çözülür', () => {
  const source = require('./helpers/server-source')();
  const publish = source.slice(source.indexOf('async function publishCollectionReplica'), source.indexOf('async function collectionReplicaStatus'));
  assert.match(publish, /if \(result && result\.merged\) liveEvents\.notifyChange\('collection', null, \{ ownerId/);
  assert.match(publish, /collectionReplication\.pollOwners\(userId, ownerIds\)/);
  assert.match(publish, /setInterval\(\(\) => \{\s*if \(!uiReadySignaled\) return;\s*void pollCollectionReplicas\(\)/);
  // Yerel + koleksiyon çakışmaları tek listede; arayüze yalnız sınırlı özet gider.
  assert.match(source, /async function allSyncConflicts\(profile\) \{[\s\S]{0,300}localDb\.listConflictSummaries\(\)[\s\S]{0,200}return \[\.\.\.local, \.\.\.\(await collectionMergeConflictsFor\(profile\)\)\.map\(item => summarizeConflict\(item\)\)\];/);
  assert.match(source, /String\(req\.params\.id\)\.startsWith\('collection:'\)[\s\S]{0,400}collectionReplication\.resolveMergeConflict\(req\.params\.id, choice, item => applyCollectionConflictChoice\(req\.currentUser, item\)\)/);
  assert.match(source, /function applyCollectionConflictChoice\(profile, conflict\) \{[\s\S]{0,200}collectionWorkspaceEditAllowed\(profile, ownerId\)/, 'çözüm yazımı düzenleme yetkisine bağlı');
});

test('istemci: birleşimde korunan değer kullanıcıya bildirilir', () => {
  const ui = require('node:fs').readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const body = ui.slice(ui.indexOf('function kolReportReplication('), ui.indexOf('async function kolLoadWorkspace('));
  assert.match(body, /const mergeConflicts=Number\(replication\.mergeConflicts\)\|\|0;/);
  assert.match(body, /if\(!failed&&!mergeConflicts\)/);
  assert.match(body, /Senkron çakışmalarında bekliyor/);
});

test('izleyici cihazın ayrışmış kopyası birleştirilip yayımlanmaz; uzak kopya benimsenir', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-coedit-view-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const store = createCollectionPermissionsStore({ file: path.join(root, 'perm.json'), getProfiles: () => [{ id: 'owner-a', enabled: true }, { id: 'viewer', enabled: true }], getSharedSyncRoot: async () => path.join(root, 'shared') });
  await store.ensure();
  await store.setGrant({ ownerId: 'owner-a', granteeId: 'viewer', level: 'view', actorId: 'owner-a' });
  const remote = ws(9, [{ id: 1, _rev: 9, not: 'sahip' }]);
  await createCollectionReplication({ workspaces: { loadWorkspace: () => remote, replaceWorkspaceReplica: async () => ({ applied: false }) }, permissions: store, getSharedSyncRoot: async () => path.join(root, 'shared') }).publishOwner('owner-a');
  let local = ws(9, [{ id: 1, _rev: 9, not: 'eski' }, { id: 2, _rev: 3, not: 'sahibin sildiği' }]);
  const options = [];
  const viewer = createCollectionReplication({
    workspaces: { loadWorkspace: () => local, replaceWorkspaceReplica: async (_o, incoming, opts) => { options.push(opts); local = incoming; return { applied: true, workspace: incoming }; } },
    permissions: store, getSharedSyncRoot: async () => path.join(root, 'shared'), stateFile: path.join(root, 'viewer-state.json'),
  });
  const result = await viewer.syncOwner('viewer', 'owner-a');
  assert.equal(result.reason, 'READ_ONLY_ADOPTED');
  assert.deepEqual(local.rows, remote.rows, 'silinmiş satır geri gelmez, yayımlanmaz');
  assert.equal(options[0].force, true);
  assert.equal((await viewer.listMergeConflicts(['owner-a'])).length, 0);
});

test('replica imported by a read notifies open clients once, before the poll can consume its change',async t=>{const {device}=await hub(t),events=[],owner=device('notify-owner'),peer=device('notify-peer',event=>events.push({...event,rows:peer.local.rows.map(r=>r.id)}));owner.local=ws(1,[{id:1,modelKod:'base',_rev:1}]);peer.local=ws(0,[],{initialized:false});await owner.replication.publishOwner('owner-a');await peer.replication.syncOwner('user-b','owner-a');assert.equal(events.length,1);assert.deepEqual(events[0].rows,[1]);owner.local=ws(2,[{id:1,modelKod:'base',_rev:1},{id:2,modelKod:'new',_rev:2}]);await owner.replication.publishOwner('owner-a');await peer.replication.syncOwner('user-b','owner-a');assert.equal(events.length,2);assert.deepEqual(events[1].rows,[1,2]);await peer.replication.pollOwners('user-b',['owner-a']);assert.equal(events.length,2,'poll must not duplicate an already notified imported read');await assert.rejects(peer.replication.syncOwner('unknown','owner-a'),{code:'COLLECTION_ACCESS_DENIED'});assert.equal(events.length,2);});

test('a pull rechecks the local content at commit and polling retries an interrupted import',async t=>{const {device}=await hub(t),owner=device('pull-owner');let armed=false;const peer=device('pull-peer',null,box=>{if(armed){armed=false;box.local=ws(2,[{id:1,modelKod:'local-new',_rev:2},{id:2,not:'old',_rev:1}]);}});owner.local=ws(1,[{id:1,modelKod:'old',_rev:1},{id:2,not:'old',_rev:1}]);peer.local=ws(0,[],{initialized:false});await owner.replication.publishOwner('owner-a');await peer.replication.syncOwner('user-b','owner-a');owner.local=ws(2,[{id:1,modelKod:'old',_rev:1},{id:2,not:'remote-new',_rev:2}]);await owner.replication.publishOwner('owner-a');armed=true;const first=await peer.replication.pollOwners('user-b',['owner-a']);assert.equal(peer.local.rows[0].modelKod,'local-new','intervening local commit must survive the stale pull');assert.equal(first.length,0);const next=await peer.replication.pollOwners('user-b',['owner-a']);assert.equal(next.length,1,'unchanged remote stamp must still retry the interrupted import');assert.equal(peer.local.rows[0].modelKod,'local-new');assert.equal(peer.local.rows[1].not,'remote-new');});
