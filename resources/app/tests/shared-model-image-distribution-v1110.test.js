'use strict';

/* YEREL-ÖNCELİKLİ PAYLAŞILAN GÖRSEL DAĞITIMI — v11.10
 *
 * Korunan regresyonlar:
 *  · Arama sırası LOCAL → SHARED → ASAS/PLM.
 *  · Kaynak SIKI: PLM kökenli nesne bir ASAS isteğini karşılayamaz.
 *  · Manuel sahiplik AĞDAN GEÇER ve otomatik senkron onu EZEMEZ.
 *  · Aynı bayt tek nesne (içerik adresli); aynı yayım revizyon şişirmez.
 *  · Mezar taşı eski istemcinin yerel kopyasından geri DİRİLMEZ.
 *  · Çekme delta'dır: her açılışta bütün baytlar taranmaz.
 *  · Kira aynı kimlik+kaynak için ikinci bir üst-kaynak isteğini engeller.
 *  · Ağ yoksa yerel başarı GERİ ALINMAZ, yayım kuyrukta bekler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const sharedImageStore = require(path.join(ROOT, 'server/lib/shared-image-store.js'));
const distributionLib = require(path.join(ROOT, 'server/lib/model-image-distribution.js'));
const ownershipLib = require(path.join(ROOT, 'server/lib/plm-image-ownership.js'));

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(256, 7)]);
const OTHER_JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(256, 9)]);

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/* Bir Buyer Log kurulumunun sahte hâli: kendi yerel görsel deposu, kendi
   imagemap'i, kendi sahiplik kaydı. Gerçek diske ve ağa yalnız paylaşılan
   klasör için dokunulur. */
function createClient(sharedRoot, deviceId, { revisionCounter } = {}) {
  const files = new Map();
  let imagemap = {};
  let state = distributionLib.emptyState();
  let store = ownershipLib.emptyStore();
  const ownership = { ...ownershipLib, loadOwnership: () => store, saveOwnership: value => { store = value; return value; } };
  const sharedStore = sharedImageStore.createSharedImageStore({
    getSharedSyncRoot: async () => sharedRoot,
    getDeviceId: () => deviceId,
    allocateRevision: revisionCounter ? async () => revisionCounter.next() : null,
  });
  const distribution = distributionLib.createModelImageDistribution({
    sharedStore, ownership,
    readState: () => state,
    writeState: value => { state = value; return value; },
    getImage: ref => (files.has(ref) ? { item: { id: ref, url: `/api/collection-images/${ref}`, mimeType: 'image/jpeg' }, full: ref } : null),
    readImageBytes: found => files.get(found.item.id),
    saveImage: payload => {
      const id = `ci_${crypto.randomBytes(5).toString('hex')}`;
      files.set(id, Buffer.from(payload.base64, 'base64'));
      return { id, url: `/api/collection-images/${id}`, mimeType: payload.mimeType, size: files.get(id).length, updatedAt: new Date().toISOString() };
    },
    deleteImage: ref => files.delete(ref),
    patchLinks: links => {
      for (const link of links) {
        const key = link.colourCode ? `plm:${link.plmId}|colour:${link.colourCode}` : `plm:${link.plmId}`;
        imagemap[key] = link.imageRef;
      }
      return { overrides: { imagemap }, updated: links.length };
    },
  });
  return {
    deviceId, sharedStore, distribution, files,
    get imagemap() { return imagemap; },
    get store() { return store; },
    set store(value) { store = value; },
    reset() { files.clear(); imagemap = {}; state = distributionLib.emptyState(); store = ownershipLib.emptyStore(); },
    // Yeniden başlatma: DİSK kalır (files/imagemap/store), bellek içi hiçbir
    // şeye güvenilmez.
    restart() { state = distributionLib.normalizeState(JSON.parse(JSON.stringify(state))); },
  };
}

function sharedCounter() {
  let value = 0;
  return { next: () => { value += 1; return value; } };
}

test('LOCAL → SHARED → UPSTREAM sırası korunur', async () => {
  const root = tempRoot('bl-order-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });

    // A, ASAS'tan aldığı görseli yayımlar.
    await a.sharedStore.publish([{ canonicalKey: 'plm:100|colour:RED', plmId: '100', colourCode: 'RED', source: 'ASAS', buffer: JPEG, mimeType: 'image/jpeg', sourceFetchedAt: new Date().toISOString() }]);

    // B'de hiçbir şey yok → paylaşılan depodan çekilebilir, ÜST KAYNAĞA GİTMEZ.
    let plan = await b.distribution.plan([{ plmId: '100', colourCode: 'RED' }], { source: 'ASAS', mode: 'missing', imagemap: b.imagemap, store: b.store });
    assert.equal(plan.counts.sharedPullable, 1);
    assert.equal(plan.counts.remoteRequired, 0, 'paylaşılanda varken ASAS’a gidilmemeli');

    const installed = await b.distribution.installFromShared(plan.fromShared, { imagemap: b.imagemap, store: b.store });
    b.store = installed.store;
    assert.equal(installed.installed, 1);
    assert.equal(b.files.size, 1, 'bayt B’nin YEREL deposuna indi');

    // Artık yereldedir → ne paylaşılana ne üst kaynağa gidilir.
    plan = await b.distribution.plan([{ plmId: '100', colourCode: 'RED' }], { source: 'ASAS', mode: 'missing', imagemap: b.imagemap, store: b.store });
    assert.equal(plan.counts.localAvailable, 1);
    assert.equal(plan.counts.sharedPullable, 0);
    assert.equal(plan.counts.remoteRequired, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('KAYNAK SIKI: PLM kökenli paylaşılan nesne bir ASAS işlemini karşılayamaz', async () => {
  const root = tempRoot('bl-source-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    await a.sharedStore.publish([{ canonicalKey: 'plm:200|colour:X', plmId: '200', colourCode: 'X', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);

    const asasPlan = await b.distribution.plan([{ plmId: '200', colourCode: 'X' }], { source: 'ASAS', mode: 'missing', imagemap: b.imagemap, store: b.store });
    assert.equal(asasPlan.counts.sharedPullable, 0, 'PLM nesnesi ASAS isteğini karşılamamalı');
    assert.equal(asasPlan.counts.remoteRequired, 1, 'ASAS isteği ASAS’a gitmeli');

    const plmPlan = await b.distribution.plan([{ plmId: '200', colourCode: 'X' }], { source: 'PLM', mode: 'missing', imagemap: b.imagemap, store: b.store });
    assert.equal(plmPlan.counts.sharedPullable, 1, 'PLM isteği PLM nesnesiyle karşılanmalı');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('MANUEL sahiplik ağdan geçer ve otomatik yenileme onu EZEMEZ', async () => {
  const root = tempRoot('bl-manual-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    // A kullanıcısı ELLE bir görsel bağlar ve MANUAL sahiplikle yayımlar.
    await a.sharedStore.publish([{
      canonicalKey: 'plm:300|colour:K', plmId: '300', colourCode: 'K',
      source: 'MANUAL', ownership: sharedImageStore.OWNERSHIP_MANUAL, buffer: JPEG, mimeType: 'image/jpeg',
    }]);

    // B çeker: yerel sahiplik de MANUEL olmalı, yoksa sonraki senkron ezerdi.
    const pulled = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    b.store = pulled.store;
    assert.equal(pulled.installed, 1);
    const key = 'plm:300|colour:K';
    assert.ok(ownershipLib.manualRecordOf(b.store, key), 'manuel kayıt yerelde açık olmalı');
    assert.equal(ownershipLib.ownershipOf(b.store, key, b.imagemap[key]).state, ownershipLib.OWNERSHIP_MANUAL);

    // B "PLM'den Tümünü Yenile" çalıştırır: manuel görsel KORUNUR.
    const plan = await b.distribution.plan([{ plmId: '300', colourCode: 'K' }], { source: 'PLM', mode: 'all', imagemap: b.imagemap, store: b.store });
    assert.equal(plan.counts.manualProtected, 1);
    assert.equal(plan.counts.remoteRequired, 0, 'manuel görsel için üst kaynağa gidilmemeli');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('içerik özeti aynı baytı TEK nesne olarak tutar ve yeniden yazmaz', async () => {
  const root = tempRoot('bl-hash-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const first = await a.sharedStore.publish([{ canonicalKey: 'plm:400|colour:A', plmId: '400', colourCode: 'A', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);
    assert.equal(first.reused, 0);
    // Farklı kimlik, AYNI baytlar → nesne yeniden yazılmaz.
    const second = await a.sharedStore.publish([{ canonicalKey: 'plm:401|colour:B', plmId: '401', colourCode: 'B', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);
    assert.equal(second.reused, 1, 'aynı hash için ikinci bir bayt kopyası yazılmamalı');
    const packsRoot = path.join(root, 'model-images', 'packs', 'devA');
    const packs = fs.readdirSync(packsRoot).filter(name => name.endsWith('.blpack'));
    assert.equal(packs.length, 1, 'aynı bayt için ikinci pack oluşturulmamalı');
    assert.equal(fs.statSync(path.join(packsRoot,packs[0])).size, JPEG.length, 'aynı hash pack içine ikinci kez append edilmemeli');
    const indexFiles = fs.readdirSync(path.join(root,'model-images','content-index')).filter(name=>name.endsWith('.json'));
    const indexed = indexFiles.flatMap(name=>Object.keys(JSON.parse(fs.readFileSync(path.join(root,'model-images','content-index',name),'utf8')).records||{}));
    assert.equal(indexed.filter(hash=>hash===crypto.createHash('sha256').update(JPEG).digest('hex')).length,1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('çekme DELTA’dır: uygulanmış revizyon yeniden kurulmaz', async () => {
  const root = tempRoot('bl-delta-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    await a.sharedStore.publish([{ canonicalKey: 'plm:500|colour:A', plmId: '500', colourCode: 'A', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);

    const first = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    b.store = first.store;
    assert.equal(first.installed, 1);

    const second = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    assert.equal(second.candidates, 0, 'değişmemiş kayıt yeniden aday olmamalı');
    assert.equal(second.installed, 0);
    assert.equal(b.files.size, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('MEZAR TAŞI: silinen görsel eski yerel kopyadan geri DİRİLMEZ', async () => {
  const root = tempRoot('bl-tomb-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    await a.sharedStore.publish([{ canonicalKey: 'plm:600|colour:A', plmId: '600', colourCode: 'A', source: 'MANUAL', ownership: sharedImageStore.OWNERSHIP_MANUAL, buffer: JPEG, mimeType: 'image/jpeg' }]);
    let pulled = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    b.store = pulled.store;
    assert.equal(b.imagemap['plm:600|colour:A'].startsWith('ci_'), true);

    // A kullanıcısı görseli kaldırır.
    await a.sharedStore.publish([{ canonicalKey: 'plm:600|colour:A', plmId: '600', colourCode: 'A', source: 'MANUAL', ownership: sharedImageStore.OWNERSHIP_MANUAL, status: sharedImageStore.STATUS_DELETED }]);
    pulled = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    b.store = pulled.store;
    assert.equal(pulled.tombstones, 1);
    assert.equal(b.imagemap['plm:600|colour:A'], '', 'kayıt mezar taşına düşmeli');
    assert.equal(ownershipLib.manualRecordOf(b.store, 'plm:600|colour:A'), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('MANUEL, aynı kimlikteki OTOMATİK kaydı deterministik olarak yener', () => {
  const automatic = sharedImageStore.normalizeRecord({
    canonicalKey: 'k', source: 'PLM', ownership: 'AUTOMATIC', contentHash: 'a'.repeat(64),
    mimeType: 'image/jpeg', bytes: 10, objectPath: 'objects/aa/x.jpg', revision: 99, updatedByDevice: 'devZ',
  });
  const manual = sharedImageStore.normalizeRecord({
    canonicalKey: 'k', source: 'MANUAL', ownership: 'MANUAL', contentHash: 'b'.repeat(64),
    mimeType: 'image/jpeg', bytes: 10, objectPath: 'objects/bb/y.jpg', revision: 2, updatedByDevice: 'devA',
  });
  // Revizyonu DÜŞÜK olsa bile manuel kazanır.
  assert.equal(sharedImageStore.isNewer(manual, automatic), true);
  assert.equal(sharedImageStore.isNewer(automatic, manual), false);
  // Aynı sahiplik sınıfında sıralama revizyondur, dosya zamanı DEĞİL.
  const newer = { ...automatic, revision: 100 };
  assert.equal(sharedImageStore.isNewer(newer, automatic), true);
});

test('bozuk/yarım paylaşılan nesne yerel depoya GİRMEZ', async () => {
  const root = tempRoot('bl-corrupt-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    await a.sharedStore.publish([{ canonicalKey: 'plm:700|colour:A', plmId: '700', colourCode: 'A', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);
    // v2 depoda nesne bir .blpack dilimidir; pack içeriğini aynı uzunlukta boz.
    const packsDir = path.join(root, 'model-images', 'packs', 'devA');
    const pack = fs.readdirSync(packsDir).find(name=>name.endsWith('.blpack'));
    assert.ok(pack,'pack oluşturulmalı');
    fs.writeFileSync(path.join(packsDir,pack), OTHER_JPEG);

    const plan = await b.distribution.plan([{ plmId: '700', colourCode: 'A' }], { source: 'PLM', mode: 'missing', imagemap: b.imagemap, store: b.store });
    const installed = await b.distribution.installFromShared(plan.fromShared, { imagemap: b.imagemap, store: b.store });
    assert.equal(installed.installed, 0);
    assert.equal(installed.outcomes[0].status, 'failed');
    assert.equal(installed.outcomes[0].code, 'SHARED_OBJECT_UNREADABLE');
    assert.equal(b.files.size, 0, 'bütünlüğü bozuk bayt yerel depoya yazılmamalı');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ağ YOKKEN yerel çalışma sürer, yayım kuyrukta bekler ve geri alınmaz', async () => {
  const offline = createClient('', 'devOffline');
  offline.distribution.queuePublish([{
    canonicalKey: 'plm:800|colour:A', plmId: '800', colourCode: 'A', source: 'PLM',
    imageRef: 'ci_local', contentHash: 'c'.repeat(64), mimeType: 'image/jpeg',
  }]);
  const status = offline.distribution.status();
  assert.equal(status.pendingPublish, 1, 'ağ yokken yayım kuyrukta beklemeli');
  const flushed = await offline.distribution.flushPublish();
  assert.equal(flushed.available, false);
  assert.equal(offline.distribution.status().pendingPublish, 1, 'başarısız yayım kuyruktan DÜŞMEMELİ');
  // Ağ yokken plan yine çalışır; yalnız paylaşılan adım atlanır.
  const plan = await offline.distribution.plan([{ plmId: '800', colourCode: 'A' }], { source: 'PLM', mode: 'missing', imagemap: {}, store: offline.store });
  assert.equal(plan.sharedAvailable, false);
  assert.equal(plan.counts.remoteRequired, 1);
});

test('kaynak duyarlı "bulunamadı" belleği: ASAS yoksa PLM için hiçbir şey demez', async () => {
  const client = createClient('', 'devNF');
  client.distribution.rememberNotFound([{ canonicalKey: 'plm:900|colour:A', source: 'ASAS', code: 'ASAS_TECHNICAL_IMAGE_MISSING' }]);
  assert.equal(client.distribution.isSuppressed('plm:900|colour:A', 'ASAS', { mode: 'missing' }), true);
  assert.equal(client.distribution.isSuppressed('plm:900|colour:A', 'PLM', { mode: 'missing' }), false, 'ASAS bulunamadı PLM’i bağlamaz');
  // Açık bir yenileme yeniden DENEYEBİLİR.
  assert.equal(client.distribution.isSuppressed('plm:900|colour:A', 'ASAS', { mode: 'all' }), false);
  assert.equal(client.distribution.isSuppressed('plm:900|colour:A', 'ASAS', { mode: 'selected' }), false);
  client.distribution.clearNotFound([{ canonicalKey: 'plm:900|colour:A', source: 'ASAS' }]);
  assert.equal(client.distribution.isSuppressed('plm:900|colour:A', 'ASAS', { mode: 'missing' }), false);
});

test('tazelik: başkası yakın zamanda aynı kaynaktan tazelediyse üst kaynağa GİDİLMEZ', async () => {
  const root = tempRoot('bl-fresh-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    await a.sharedStore.publish([{ canonicalKey: 'plm:950|colour:A', plmId: '950', colourCode: 'A', source: 'ASAS', buffer: JPEG, mimeType: 'image/jpeg', sourceFetchedAt: new Date().toISOString() }]);
    // B'de zaten geçerli bir yerel görsel var; yine de TAZELEME istiyor.
    const pulled = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    b.store = pulled.store;
    const plan = await b.distribution.plan([{ plmId: '950', colourCode: 'A' }], { source: 'ASAS', mode: 'all', imagemap: b.imagemap, store: b.store });
    assert.equal(plan.counts.remoteRequired, 0, 'taze paylaşılan sonuç varken üst kaynak dövülmemeli');
    // Açık "force" tazelik korumasını AŞABİLİR.
    const forced = await b.distribution.plan([{ plmId: '950', colourCode: 'A' }], { source: 'ASAS', mode: 'all', force: true, imagemap: b.imagemap, store: b.store });
    assert.equal(forced.counts.remoteRequired, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('kira: aynı kimlik+kaynak için ikinci istek beklemeye alınır, farklı kaynak serbesttir', async () => {
  const root = tempRoot('bl-lease-');
  try {
    const store = sharedImageStore.createSharedImageStore({ getSharedSyncRoot: async () => root, getDeviceId: () => 'devA' });
    const first = await store.acquireRefreshLease('plm:1|colour:RED', 'ASAS');
    assert.equal(first.acquired, true);
    const duplicate = await store.acquireRefreshLease('plm:1|colour:RED', 'ASAS', { timeoutMs: 150 });
    assert.equal(duplicate.acquired, false, 'aynı varlık için ikinci iş üst kaynağa gitmemeli');
    const otherSource = await store.acquireRefreshLease('plm:1|colour:RED', 'PLM', { timeoutMs: 150 });
    assert.equal(otherSource.acquired, true, 'ASAS kirası PLM’i kilitlememeli');
    await otherSource.release();
    await first.release();
    // Kira KALICI DEĞİL: bırakıldıktan sonra model yeniden tazelenebilir.
    const again = await store.acquireRefreshLease('plm:1|colour:RED', 'ASAS', { timeoutMs: 150 });
    assert.equal(again.acquired, true);
    await again.release();
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('yeniden başlatmadan sonra görsel YEREL olarak çözülür, üst kaynağa gidilmez', async () => {
  const root = tempRoot('bl-restart-');
  try {
    const counter = sharedCounter();
    const a = createClient(root, 'devA', { revisionCounter: counter });
    const b = createClient(root, 'devB', { revisionCounter: counter });
    await a.sharedStore.publish([{ canonicalKey: 'plm:1000|colour:A', plmId: '1000', colourCode: 'A', source: 'ASAS', buffer: JPEG, mimeType: 'image/jpeg' }]);
    const pulled = await b.distribution.pull({ deviceId: 'devB', imagemap: b.imagemap, store: b.store });
    b.store = pulled.store;
    assert.equal(b.files.size, 1);

    b.restart();
    const plan = await b.distribution.plan([{ plmId: '1000', colourCode: 'A' }], { source: 'ASAS', mode: 'missing', imagemap: b.imagemap, store: b.store });
    assert.equal(plan.counts.localAvailable, 1, 'yeniden başlatmadan sonra görsel yerelde çözülmeli');
    assert.equal(plan.counts.remoteRequired, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

/* Sıralama sayacı paylaşılan deponun KENDİ dosyasındadır. SharedRevisionStore
   bilerek kullanılmaz: o depo her yerde ateşle-unut çağrılır ve await edilmesi
   "ağ hatası iş mutasyonunu düşürmez" sözleşmesini bozardı. */
test('yayım revizyonu cihazlar arasında monoton artar ve dosya zamanına dayanmaz', async () => {
  const root = tempRoot('bl-rev-');
  try {
    const a = createClient(root, 'devA');
    const b = createClient(root, 'devB');
    const first = await a.sharedStore.publish([{ canonicalKey: 'k1', plmId: '1', colourCode: 'A', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);
    const second = await b.sharedStore.publish([{ canonicalKey: 'k2', plmId: '2', colourCode: 'A', source: 'PLM', buffer: OTHER_JPEG, mimeType: 'image/jpeg' }]);
    const third = await a.sharedStore.publish([{ canonicalKey: 'k3', plmId: '3', colourCode: 'A', source: 'PLM', buffer: JPEG, mimeType: 'image/jpeg' }]);
    assert.ok(first.revision < second.revision && second.revision < third.revision, 'revizyon monoton artmalı');
    const counter = JSON.parse(fs.readFileSync(path.join(root, 'model-images', 'revision.json'), 'utf8'));
    assert.equal(counter.revision, third.revision);
    const server = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
    assert.doesNotMatch(server, /allocateRevision:\s*async/, 'yayım SharedRevisionStore’u await ETMEMELİ');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('ASAS yazımları artık KÖKEN kaydı bırakır (otomatik/ASAS)', () => {
  let store = ownershipLib.emptyStore();
  store = ownershipLib.rememberAutomatic([{ key: 'plm:1|colour:A', owner: ownershipLib.OWNER_ASAS, imageRef: 'ci_x', sourceType: 'ASAS', hash: 'h' }], { store, persist: value => value }).store;
  const record = ownershipLib.recordOf(store, 'plm:1|colour:A');
  assert.equal(record.owner, 'asas');
  assert.equal(ownershipLib.provenanceOf(record.owner), 'ASAS');
  assert.equal(ownershipLib.ownershipOf(store, 'plm:1|colour:A', 'ci_x').state, ownershipLib.OWNERSHIP_AUTOMATIC);
  // Sahiplik kaydı KAYBOLURSA davranış güvenli tarafa düşer: her şey manuel.
  const empty = ownershipLib.emptyStore();
  assert.equal(ownershipLib.ownershipOf(empty, 'plm:1|colour:A', 'ci_x').state, ownershipLib.OWNERSHIP_MANUAL);
});
