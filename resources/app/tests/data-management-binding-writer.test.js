'use strict';

/* v7.81 (P5) — MODÜL BAĞLANTISINI AÇ / KAPAT.
 *
 * Korunan söz (kullanıcı brief'i §11): "IAS → Siparişler bağlantısını
 * kapatırsam IAS silinmemeli. Bağlantı, şema, alan eşlemesi ve IAS'ın diğer
 * modül bağlantıları korunmalı. Tekrar bağlandığında eski ayarlar yeniden
 * kullanılabilmeli."
 *
 * Bugünkü depoda bunun önünde gerçek bir engel var: bir modül bağlantısı ayrı
 * bir kayıt değil, bir kapsamın targets[] elemanı. Son hedef de çıkınca kapsam
 * ve onun FİLTRESİ kayboluyor. Park mekanizması bunu karşılar.
 *
 * İKİNCİ GÜVENCE — KİLİT BİR İŞ KURALIDIR, DEPO DAVRANIŞI DEĞİL.
 *
 * Bu dosyanın ilk sürümü kilidi ÖLÇÜYORDU: kapatmayı simüle edip
 * modelScopes.normalizeScopes hedefi geri ekliyor mu diye bakıyordu. Ölçüm
 * doğru çalışıyordu ama yanlış soruyu cevaplıyordu ve canlı kullanımda YANLIŞ
 * CEVAP verdi: IAS → Siparişler'i "kapatılamaz" gösterdi. Oysa Siparişler
 * antrepo verisi olmadan da doğru çalışır — ASAS sipariş satırlarını gösterir
 * ve yeniler, yalnız antrepo sütunları boş kalır ve bunu bildirir.
 *
 * Kural artık source-profiles.js'teki requiredModules kaydından okunur ve
 * aşağıdaki testler bu kuralı kilitler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-binding-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const writer = require('../server/lib/data-domain/binding-writer');
const readModel = require('../server/lib/data-domain/read-model');
const profiles = require('../server/lib/data-domain/source-profiles');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function horizonOf(values) {
  return { table: 'ASAS', groups: [{ id: 'g', conditions: [{ id: 'c', table: 'ASAS', field: 'Sezon', op: 'in', valueType: 'text', values }] }] };
}

function setup() {
  return db.replaceModelConnections([{
    id: 'mc_asas', name: 'ASAS', server: 'lcwtabular_s30', catalog: 'ASAS_30', role: 'asas', refreshEnabled: true,
    scopes: [
      { id: 'sc_core', name: 'Licensing Core', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7', 'S8']) },
      { id: 'sc_lfl', name: 'LFL Karşılaştırma', targets: ['lfl'], enabled: true, horizon: horizonOf(['S6', 'S7', 'S8']) },
    ],
    mapping: {
      'Sipariş Kod': { table: 'ASAS', name: 'SIPARIS_KOD', kind: 'column', folder: '' },
      'Model Adı': { table: 'ASAS', name: 'MODEL_ADI', kind: 'column', folder: '' },
    },
    customFields: [{ header: 'Özel Alan', custom: true }],
    cpColumns: [{ id: 'cpx1', label: 'Statü', table: 'ASAS', name: 'STATU', kind: 'column', group: '' }],
  }, {
    id: 'mc_ias', name: 'IAS', server: 'lcwtabular_s30', catalog: 'IAS_30', role: 'antrepo', refreshEnabled: true,
    scopes: [
      { id: 'sc_ias_core', name: 'Antrepo Çekirdek', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7', 'S8']) },
      { id: 'sc_ias_orders', name: 'Siparişler Antrepo', targets: ['orders'], enabled: true, horizon: horizonOf(['S8']) },
    ],
    mapping: { 'Sipariş Kod': { table: 'IAS', name: 'SIPARIS_KOD', kind: 'column', folder: '' } },
    customFields: [{ header: 'Sezon', custom: true }],
  }], null).items;
}

const apply = (items, change) => {
  const plan = writer.planBindingChange(items, change);
  return { plan, items: plan.ok && plan.code !== 'NO_CHANGE' ? db.replaceModelConnections(plan.items, null).items : items };
};
const targetsOf = (items, id) => items.find(entry => entry.id === id).scopes.flatMap(scope => scope.targets).sort();
const scopeFor = (items, id, target) =>
  items.find(entry => entry.id === id).scopes.find(scope => scope.targets.includes(target)) || null;

/* ------------------------------------------------------------------ */

test('P5 kilitli hedefler İŞ KURALINDAN okunur, depo davranışından ölçülmez', () => {
  const items = setup();
  const asas = items.find(entry => entry.id === 'mc_asas');
  const ias = items.find(entry => entry.id === 'mc_ias');

  // ASAS sipariş satırının kendisidir: beslediği her sayfa onsuz boş kalır.
  assert.deepEqual(writer.lockedTargets(asas).slice().sort(),
    ['backlog', 'cp', 'lfl', 'orders', 'priceanalysis']);

  // IAS yalnız CP ve Backlog'da zorunludur.
  assert.deepEqual(writer.lockedTargets(ias).slice().sort(), ['backlog', 'cp']);

  /* KORUNAN KUSUR: ölçüme dayalı eski model burada 'orders' da diyordu, çünkü
     normalizeScopes Siparişler kapsamını eski kayıtlar için geri yaratıyor.
     O bir depo kurtarma dalıdır; "Siparişler antrepo verisi olmadan çalışamaz"
     demek değildir. */
  assert.equal(writer.isTargetLocked(ias, 'orders'), false);
});

test('P5 iş kuralı: ASAS hiçbir sayfadan kaldırılamaz, IAS yalnız Siparişler’den kaldırılabilir', () => {
  const items = setup();
  const reject = (sourceId, moduleId) => {
    const plan = writer.planBindingChange(items, { sourceId, moduleId, enabled: false });
    assert.equal(plan.ok, false, `${sourceId}/${moduleId} kapatılabilir görünüyor`);
    assert.equal(plan.code, 'BINDING_LOCKED');
    // Reddedilen bir istek veriyi DEĞİŞTİRMEMELİ.
    assert.deepEqual(plan.items, items);
  };

  for (const moduleId of ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']) reject('mc_asas', moduleId);
  for (const moduleId of ['cp', 'backlog']) reject('mc_ias', moduleId);

  const allowed = writer.planBindingChange(items, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  assert.equal(allowed.ok, true, 'IAS → Siparişler kapatılabilmeli');
});

test('P5 kural kaydı ile ekran aynı kaynaktan okur', () => {
  // Kilit iki yerde ayrı ayrı yazılırsa sessizce sapar; ikisi de profil kaydını okur.
  assert.deepEqual(profiles.detachableModules('asas-orders'), []);
  assert.deepEqual(profiles.detachableModules('ias-warehouse'), ['orders']);
  assert.deepEqual(profiles.detachableModules('intake-budget'), []);
});

test('P5 imkânsız hücre sunucuda reddedilir — istemciye güvenilmez', () => {
  const items = setup();
  const plan = writer.planBindingChange(items, { sourceId: 'mc_asas', moduleId: 'intake', enabled: true });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'MODULE_NOT_FEEDABLE');
});

/* ------------------------------------------------------------------ */

test('P5 §11 — bağlantıyı kapatmak eşlemeyi ve diğer bağları KORUR', () => {
  const before = setup();
  const { plan, items } = apply(before, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  assert.equal(plan.ok, true);

  const source = items.find(entry => entry.id === 'mc_ias');
  // Kaynak silinmedi.
  assert.ok(source);
  assert.equal(source.server, 'lcwtabular_s30');
  assert.equal(source.catalog, 'IAS_30');
  // Alan eşlemesi olduğu gibi duruyor.
  assert.deepEqual(source.mapping, before.find(entry => entry.id === 'mc_ias').mapping);
  assert.deepEqual(source.customFields, before.find(entry => entry.id === 'mc_ias').customFields);
  // Diğer modül bağlantıları ve ONLARIN FİLTRESİ duruyor.
  assert.ok(targetsOf(items, 'mc_ias').includes('cp'));
  assert.ok(targetsOf(items, 'mc_ias').includes('backlog'));
  const core = source.scopes.find(scope => scope.id === 'sc_ias_core');
  assert.ok(core, 'paylaşılan kapsam yok olmamalı');
  assert.deepEqual(core.horizon.groups[0].conditions[0].values, ['S7', 'S8']);
  // Başka bir kaynağın bağlantıları da etkilenmedi.
  assert.deepEqual(targetsOf(items, 'mc_asas'), targetsOf(before, 'mc_asas'));
  // Siparişler gitti.
  assert.ok(!targetsOf(items, 'mc_ias').includes('orders'));
  // Ve filtresi kaybolmadı, park edildi.
  assert.deepEqual(source.parkedBindings.map(entry => entry.moduleId), ['orders']);
  assert.equal(source.parkedBindings[0].scopeName, 'Siparişler Antrepo');
});

test('P5 kapatılan besleme depo normalizasyonunda GERİ DOĞMAZ', () => {
  /* KORUNAN KUSUR: normalizeScopes eksik bir Siparişler kapsamını eski kayıtlar
     için kendiliğinden yaratıyordu. Park listesi geçirilmeseydi kullanıcının
     kapattığı bağlantı bir sonraki okumada geri gelir, kapatma düğmesi hiç
     çalışmamış gibi görünürdü. */
  const before = setup();
  let state = apply(before, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false }).items;
  assert.ok(!targetsOf(state, 'mc_ias').includes('orders'));

  // Kaydet–oku döngüsü birden çok kez dönse de karar korunmalı.
  for (let round = 0; round < 3; round += 1) {
    state = db.replaceModelConnections(state, null).items;
    assert.ok(!targetsOf(state, 'mc_ias').includes('orders'), `${round + 1}. turda geri doğdu`);
  }
  state = db.loadModelConnections().items;
  assert.ok(!targetsOf(state, 'mc_ias').includes('orders'), 'diskten okunduğunda geri doğdu');
  // ASAS tarafındaki Siparişler beslemesi bundan etkilenmez: sayfa çalışmaya devam eder.
  assert.ok(targetsOf(state, 'mc_asas').includes('orders'));
});

test('P5 §11 — tekrar bağlayınca ESKİ filtre birebir geri gelir', () => {
  const before = setup();
  const originalScope = scopeFor(before, 'mc_ias', 'orders');

  let state = apply(before, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false }).items;
  state = apply(state, { sourceId: 'mc_ias', moduleId: 'orders', enabled: true }).items;

  const restored = scopeFor(state, 'mc_ias', 'orders');
  assert.ok(restored, 'Siparişler geri bağlanmadı');
  assert.equal(restored.id, originalScope.id, 'kapsam kimliği korunmalı');
  assert.equal(restored.name, originalScope.name);
  assert.deepEqual(restored.horizon, originalScope.horizon, 'filtre birebir geri gelmeli');
  // Park kaydı temizlendi; ikinci kez geri yüklenmeye çalışılmamalı.
  assert.deepEqual(state.find(entry => entry.id === 'mc_ias').parkedBindings, []);
});

test('P5 kaydı olmayan bir modül bağlanınca filtre UYDURULMAZ', () => {
  // Filtresi saklanmadan park edilmiş (eski sürümden gelen) bir bağlantı.
  const items = db.replaceModelConnections([{
    id: 'mc_ias', name: 'IAS', server: 's', catalog: 'i', role: 'antrepo', refreshEnabled: true,
    scopes: [{ id: 'sc_ias_core', name: 'Antrepo Çekirdek', targets: ['cp', 'backlog'], enabled: true, horizon: horizonOf(['S7']) }],
    parkedBindings: [{ moduleId: 'orders' }],
  }], null).items;
  assert.ok(!targetsOf(items, 'mc_ias').includes('orders'));

  const { items: next } = apply(items, { sourceId: 'mc_ias', moduleId: 'orders', enabled: true });
  const ordersScope = scopeFor(next, 'mc_ias', 'orders');
  assert.ok(ordersScope);
  /* Başka bir modülün filtresini sessizce kopyalamak, beklenmedik hacimde
     sorgu demek olurdu. Boş bırakılır ve ekran "filtre gerekli" der. */
  assert.deepEqual(ordersScope.horizon.groups, []);
  assert.deepEqual(ordersScope.horizon.seasons, []);
});

test('P5 aynı isteği iki kez göndermek durumu bozmaz', () => {
  const before = setup();
  const first = apply(before, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  const second = writer.planBindingChange(first.items, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  assert.equal(second.ok, true);
  assert.equal(second.code, 'NO_CHANGE');
  assert.deepEqual(second.items, first.items);
});

/* ------------------------------------------------------------------ */

test('P5 ekran "kapalı" ile "kilitli"yi ayırır', () => {
  const items = setup();
  const model = readModel.build(items, { language: 'tr' });

  // ASAS'ın beslediği her hücre kilitli.
  for (const moduleId of ['cp', 'orders', 'backlog', 'lfl', 'priceanalysis']) {
    assert.equal(model.matrix.cells[`mc_asas:${moduleId}`], 'locked', `mc_asas:${moduleId}`);
  }
  // IAS'ta yalnız CP ve Backlog kilitli; Siparişler açık ve kapatılabilir.
  assert.equal(model.matrix.cells['mc_ias:cp'], 'locked');
  assert.equal(model.matrix.cells['mc_ias:backlog'], 'locked');
  assert.equal(model.matrix.cells['mc_ias:orders'], 'on');
  // Beslenemeyen hücre kapalı bir anahtar değil, imkânsız bir hücredir.
  assert.equal(model.matrix.cells['mc_ias:lfl'], 'unavailable');

  const ias = model.sources.find(entry => entry.id === 'mc_ias');
  assert.deepEqual(ias.lockedModules.slice().sort(), ['backlog', 'cp']);
});

test('P5 park edilmiş bağlantı ekranda görünür — "eski ayarın duruyor"', () => {
  const before = setup();
  const { items } = apply(before, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  const model = readModel.build(items, { language: 'tr' });

  assert.equal(model.matrix.cells['mc_ias:orders'], 'off');
  const ias = model.sources.find(entry => entry.id === 'mc_ias');
  assert.deepEqual(ias.parkedModules.map(entry => entry.moduleId), ['orders']);
  assert.equal(ias.parkedModules[0].filterName, 'Siparişler Antrepo');
});

test('P5 park kaydı depo normalizasyonundan sağ çıkar', () => {
  const before = setup();
  const { items } = apply(before, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  // İkinci kez normalize et: yeni alan bilinmediği için düşürülmemeli.
  const again = db.replaceModelConnections(items, null).items;
  assert.deepEqual(again.find(entry => entry.id === 'mc_ias').parkedBindings.map(entry => entry.moduleId), ['orders']);
});

/* ------------------------------------------------------------------ */
/* v7.81 (P9) — ÇOKLU KULLANICI: EŞZAMANLILIK KONTROLÜ KAYNAK BAŞINADIR.
 *
 * Korunan kusur (ölçülerek doğrulandı): depodaki revizyon sayacı BÜTÜN diziye
 * ait olduğu için, ASAS'ı düzenleyen bir yönetici IAS'ı düzenleyen diğerini
 * "başkası değiştirdi" diye reddettiriyordu. İki yönetici aynı anda
 * çalışamıyordu — kullanıcı brief'i §42'nin çekirdeği.
 */

const adapter = require('../server/lib/data-domain/legacy-adapter');
const sourceWriter = require('../server/lib/data-domain/source-writer');

test('P9 kaynak sürümü yapılandırmaya bağlıdır, son çalıştırmaya değil', () => {
  const asas = setup().find(entry => entry.id === 'mc_asas');
  const before = adapter.configRevision(asas);
  // Arka planda çalışan bir yenileme kullanıcının açık ekranını bayatlatmamalı.
  const afterRefresh = adapter.configRevision({ ...asas, lastRun: { at: new Date().toISOString(), ok: true, rowCount: 5 } });
  assert.equal(afterRefresh, before);
  // Gerçek bir yapılandırma değişikliği ise sürümü değiştirmeli.
  const renamed = adapter.configRevision({ ...asas, name: 'ASAS Yedek' });
  assert.notEqual(renamed, before);
});

test('P9 farklı kaynakları düzenleyen iki yönetici birbirini ENGELLEMEZ', () => {
  const items = setup();
  // İkisi de ekranı aynı anda açtı ve kendi kaynağının sürümünü gördü.
  const asasSeen = adapter.configRevision(items.find(entry => entry.id === 'mc_asas'));
  const iasSeen = adapter.configRevision(items.find(entry => entry.id === 'mc_ias'));

  // A: ASAS'ı yeniden adlandırıyor.
  const planA = sourceWriter.planSourceUpdate(db.loadModelConnections().items, { sourceId: 'mc_asas', name: 'ASAS Üretim' });
  assert.equal(planA.ok, true);
  db.replaceModelConnections(planA.items, null);

  // B: IAS'ta Siparişler'i kapatıyor. Gördüğü IAS sürümü HÂLÂ GEÇERLİ olmalı.
  const after = db.loadModelConnections().items;
  const iasNow = adapter.configRevision(after.find(entry => entry.id === 'mc_ias'));
  assert.equal(iasNow, iasSeen, 'IAS değişmediği hâlde sürümü kaydı — B gereksiz yere engellenirdi');

  const planB = writer.planBindingChange(after, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  assert.equal(planB.ok, true);
  const savedB = db.replaceModelConnections(planB.items, null);

  // Her iki değişiklik de yaşıyor: biri diğerini ezmedi.
  const final = savedB.items;
  assert.equal(final.find(entry => entry.id === 'mc_asas').name, 'ASAS Üretim', 'A’nın değişikliği kayboldu');
  assert.ok(!targetsOf(final, 'mc_ias').includes('orders'), 'B’nin değişikliği kayboldu');

  // Ve A'nın gördüğü ASAS sürümü artık geçersiz — aynı kaynağa ikinci bir
  // düzenleme gelirse yakalanmalı.
  assert.notEqual(adapter.configRevision(final.find(entry => entry.id === 'mc_asas')), asasSeen);
});

test('P9 AYNI kaynağa eşzamanlı iki düzenlemeden ikincisi yakalanır', () => {
  const items = setup();
  const seen = adapter.configRevision(items.find(entry => entry.id === 'mc_ias'));

  const planA = writer.planBindingChange(db.loadModelConnections().items, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  assert.equal(planA.ok, true);
  db.replaceModelConnections(planA.items, null);

  const current = db.loadModelConnections().items.find(entry => entry.id === 'mc_ias');
  /* Sunucu bu karşılaştırmayı yapar: gördüğü sürüm artık tutmuyor → 409.
     Yoksa B, A'nın az önce kapattığı bağlantıyı farkında olmadan geri açardı. */
  assert.notEqual(adapter.configRevision(current), seen);
});

test('P9 sürüm göndermeyen istemci çalışmaya devam eder', () => {
  // Eski istemciler ve betikler kırılmamalı; yalnız korumasız kalırlar.
  const items = setup();
  const plan = writer.planBindingChange(items, { sourceId: 'mc_ias', moduleId: 'orders', enabled: false });
  assert.equal(plan.ok, true);
  assert.doesNotThrow(() => db.replaceModelConnections(plan.items, null));
});
