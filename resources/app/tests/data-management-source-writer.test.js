'use strict';

/* v7.81 — KAYNAK EKLE / DÜZENLE / AÇ-KAPAT (§7, §8).
 *
 * Korunan kusurlar:
 *
 * 1) AD DOĞRULAMASI İKİ YERDE OLMAMALI. Sunucu ve katalog adları bağlantı
 *    dizesine gömülür; modelQuery.validateName bunu zaten koruyor. İkinci bir
 *    desen yazmak, kurulumda kabul edilen ama sorguda reddedilen bir ad
 *    üretirdi — "kaydettim ama çalışmıyor".
 *
 * 2) ROL BAŞINA TEK AKTİF KURALI SESSİZ KALMAMALI. db.js ikinci aktif kaydı
 *    kendiliğinden kapatır. Kullanıcı bunu "ekledim ama çalışmıyor" diye
 *    keşfetmemeli.
 *
 * 3) YENİ KAYNAĞA FİLTRE UYDURULMAMALI. Varsayılan bir ufuk, beklenmedik
 *    hacimde ilk sorgu demektir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-sourcew-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const writer = require('../server/lib/data-domain/source-writer');
const modelQuery = require('../server/lib/modelQuery');
const modelHorizon = require('../server/lib/modelHorizon');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const save = plan => db.replaceModelConnections(plan.items, null).items;

/* ------------------------------------------------------------------ */

test('v7.81 ad doğrulaması modelQuery ile AYNI fonksiyondan gelir', () => {
  /* İkinci bir desen yazsaydık er geç ayrışırdı. Kurulumda kabul edilen her ad
     gerçek sorguda da kabul edilmeli; reddedilen de reddedilmeli. */
  const samples = ['SUNUCU\\ORNEK', 'sunucu.local:2383', 'ASAS_30', 'a;b=c', 'x'.repeat(200), ''];
  for (const value of samples) {
    let queryOk = true;
    try { modelQuery.validateName(value, 'Sunucu'); } catch (_) { queryOk = false; }
    const writerOk = writer._checkName(value, 'Sunucu') === '';
    assert.equal(writerOk, queryOk, `"${value}" için iki taraf ayrışıyor`);
  }
});

test('v7.81 tehlikeli sunucu adı kaynağı oluşturmaz', () => {
  const plan = writer.planSourceCreate([], {
    name: 'Kötü', profileId: 'asas-orders', server: 'a;Password=x', catalog: 'c',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'SERVER_INVALID');
  assert.deepEqual(plan.items, []);
});

/* ------------------------------------------------------------------ */

test('v7.81 ilk kaynak AKTİF doğar', () => {
  const plan = writer.planSourceCreate([], {
    name: 'ASAS', profileId: 'asas-orders', server: 'lcwtabular_s30', catalog: 'ASAS_30',
    moduleIds: ['cp', 'backlog'],
  });
  assert.equal(plan.ok, true);
  const created = plan.items[0];
  assert.equal(created.refreshEnabled, true);
  assert.equal(created.role, 'asas');
  assert.deepEqual(plan.warnings, []);
});

test('v7.81 aynı türde ikinci kaynak KAPALI doğar ve sebebi söylenir', () => {
  const first = writer.planSourceCreate([], {
    name: 'ASAS', profileId: 'asas-orders', server: 's1', catalog: 'c1', moduleIds: ['cp'],
  }).items;

  const second = writer.planSourceCreate(first, {
    name: 'ASAS Yedek', profileId: 'asas-orders', server: 's2', catalog: 'c2', moduleIds: ['cp'],
  });
  assert.equal(second.ok, true);
  const created = second.items[1];
  /* db.js bu kaydı zaten sessizce kapatırdı; burada ÖNCEDEN söyleniyor ki
     kullanıcı "ekledim ama çalışmıyor" demesin. */
  assert.equal(created.refreshEnabled, false);
  assert.ok(second.warnings.some(text => /KAPALI olarak eklendi/.test(text)));
});

test('v7.81 yeni kaynağa filtre UYDURULMAZ', () => {
  const plan = writer.planSourceCreate([], {
    name: 'ASAS', profileId: 'asas-orders', server: 's', catalog: 'c', moduleIds: ['cp'],
  });
  const scope = plan.items[0].scopes[0];
  assert.deepEqual(scope.horizon, {});
  // Ve gerçekten sınırsız: ekran "filtre gerekli" demeli.
  assert.equal(modelHorizon.buildHorizonFilter(scope.horizon).expression, null);
});

test('v7.81 profilin besleyemeyeceği modül seçilemez', () => {
  const plan = writer.planSourceCreate([], {
    name: 'IAS', profileId: 'ias-warehouse', server: 's', catalog: 'c', moduleIds: ['cp', 'lfl'],
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'MODULE_NOT_FEEDABLE');
  assert.match(plan.message, /lfl/);
});

test('v7.81 aynı sunucu+model ikinci kez eklenirse engellenmez ama söylenir', () => {
  const first = writer.planSourceCreate([], {
    name: 'ASAS', profileId: 'asas-orders', server: 'S1', catalog: 'C1', moduleIds: ['cp'],
  }).items;
  const second = writer.planSourceCreate(first, {
    name: 'Kopya', profileId: 'asas-orders', server: 's1', catalog: 'c1', moduleIds: [],
  });
  assert.equal(second.ok, true, 'bilinçli bir kopya olabilir; engellenmemeli');
  assert.ok(second.warnings.some(text => /zaten .* olarak kayıtlı/.test(text)));
});

test('v7.81 bilinmeyen kaynak türü seçenekleriyle birlikte reddedilir', () => {
  const plan = writer.planSourceCreate([], { name: 'X', profileId: 'yok', server: 's', catalog: 'c' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'PROFILE_UNKNOWN');
  assert.match(plan.message, /asas-orders/);
});

/* ------------------------------------------------------------------ */

test('v7.81 bağlantı güncellemek eşlemeyi ve bağları KORUR', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_a', name: 'ASAS', server: 's1', catalog: 'c1', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Core', targets: ['cp'], enabled: true, horizon: { table: 'ASAS', seasons: ['S7'] } }],
    mapping: { 'Sipariş Kod': { table: 'ASAS', name: 'SK', kind: 'column', folder: '' } },
  }], null).items;

  const plan = writer.planSourceUpdate(items, { sourceId: 'mc_a', server: 's2', catalog: 'c2' });
  assert.equal(plan.ok, true);
  const next = save(plan);
  const source = next.find(entry => entry.id === 'mc_a');
  assert.equal(source.server, 's2');
  assert.deepEqual(source.mapping, items.find(entry => entry.id === 'mc_a').mapping);
  assert.ok(source.scopes.some(scope => scope.targets.includes('cp')));
  /* Şema değişmiş olabilir: eşleme sessizce yanlış sütunlara işaret edebilir.
     Silmiyoruz ama uyarıyoruz. */
  assert.ok(plan.warnings.some(text => /alan eşlemesini gözden geçirin/i.test(text)));
});

/* ------------------------------------------------------------------ */

test('v7.81 kapatmak SİLMEZ; ayarlar yerinde kalır', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_a', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true,
    scopes: [{ id: 'sc', name: 'Core', targets: ['cp', 'backlog'], enabled: true, horizon: { table: 'ASAS', seasons: ['S7'] } }],
    mapping: { 'Sipariş Kod': { table: 'ASAS', name: 'SK', kind: 'column', folder: '' } },
  }], null).items;

  const plan = writer.planSourceEnabled(items, { sourceId: 'mc_a', enabled: false });
  assert.equal(plan.ok, true);
  assert.ok(plan.warnings.some(text => /artık ondan veri almayacak/.test(text)));

  const next = save(plan);
  const source = next.find(entry => entry.id === 'mc_a');
  assert.equal(source.refreshEnabled, false);
  assert.ok(source.mapping['Sipariş Kod'], 'eşleme silinmemeli');
  assert.ok(source.scopes.some(scope => scope.targets.includes('cp')), 'bağlar silinmemeli');
});

test('v7.81 ikinci kaynağı açmak SESSİZCE yutulmaz, reddedilir', () => {
  const items = [
    { id: 'a', name: 'A', server: 's1', catalog: 'c1', role: 'asas', refreshEnabled: true, scopes: [] },
    { id: 'b', name: 'B', server: 's2', catalog: 'c2', role: 'asas', refreshEnabled: false, scopes: [] },
  ];
  const plan = writer.planSourceEnabled(items, { sourceId: 'b', enabled: true });
  /* db.js bunu kabul eder ve sonra sessizce kapatırdı; kullanıcı "açtım ama
     kapalı kaldı" derdi. Açıkça reddetmek daha dürüst. */
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'ROLE_ALREADY_ACTIVE');
  assert.match(plan.message, /Önce onu kapatın/);
});

test('v7.81 zaten istenen durumdaysa değişiklik yapılmaz', () => {
  const items = [{ id: 'a', name: 'A', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true, scopes: [] }];
  const plan = writer.planSourceEnabled(items, { sourceId: 'a', enabled: true });
  assert.equal(plan.ok, true);
  assert.equal(plan.code, 'NO_CHANGE');
  assert.deepEqual(plan.items, items);
});

/* ------------------------------------------------------------------ */

test('v7.81 sihirbaz seçenekleri profillerden üretilir, listeden değil', () => {
  const options = writer.createOptions();
  const profiles = require('../server/lib/data-domain/source-profiles');
  assert.deepEqual(options.map(entry => entry.id), profiles.ids());
  for (const option of options) {
    assert.ok(option.label.tr && option.label.en);
    assert.ok(Array.isArray(option.feedableModules));
    if (option.id !== 'custom-database') assert.ok(option.feedableModules.length);
  }
});

test('v7.81 otomatik eşleme sonucu kaynağa yazılabilir', () => {
  const items = db.replaceModelConnections([{
    id: 'mc_a', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true, scopes: [],
  }], null).items;
  const mapping = { 'Sipariş Kod': { table: 'ASAS', name: 'SIPARIS_KOD', kind: 'column', folder: '' } };
  const plan = writer.planMappingWrite(items, { sourceId: 'mc_a', mapping });
  assert.equal(plan.ok, true);
  const next = save(plan);
  assert.equal(next.find(entry => entry.id === 'mc_a').mapping['Sipariş Kod'].name, 'SIPARIS_KOD');
});

/* ------------------------------------------------------------------ */
/* v7.81 (P4-yazma) — TEK ALAN EŞLEMESİ. */

test('v7.81 tek alan yazmak diğer alanları düşürmez', () => {
  /* İstemci bayat bir görünüm üzerinden TAM eşleme gönderseydi, o arada
     eklenmiş bir alan sessizce kaybolurdu. Kullanıcı üç alanı düzeltirken
     dördüncüyü kaybetmemeli. */
  const items = [{
    id: 'a', name: 'A', server: 's', catalog: 'c', role: 'asas', scopes: [],
    mapping: {
      'Sezon': { table: 'ASAS', name: 'SEZON', kind: 'column', folder: '' },
      'Renk': { table: 'ASAS', name: 'RENK', kind: 'column', folder: '' },
    },
  }];
  const plan = writer.planMappingEntry(items, {
    sourceId: 'a', header: 'Model Adı', entry: { table: 'ASAS', name: 'MODEL_ADI', kind: 'column' },
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(Object.keys(plan.items[0].mapping).sort(), ['Model Adı', 'Renk', 'Sezon']);
  // Girdi dizisi DEĞİŞMEMELİ.
  assert.deepEqual(Object.keys(items[0].mapping).sort(), ['Renk', 'Sezon']);
});

test('v7.81 boş girdi alanı eşlemeden kaldırır', () => {
  const items = [{ id: 'a', name: 'A', server: 's', catalog: 'c', role: 'asas', scopes: [],
    mapping: { 'Sezon': { table: 'ASAS', name: 'SEZON', kind: 'column', folder: '' } } }];
  for (const entry of [null, undefined, {}, { name: '   ' }]) {
    const plan = writer.planMappingEntry(items, { sourceId: 'a', header: 'Sezon', entry });
    assert.equal(plan.ok, true);
    assert.deepEqual(Object.keys(plan.items[0].mapping), [], `entry=${JSON.stringify(entry)} kaldırmadı`);
  }
});

test('v7.81 kind serbest metin kabul etmez', () => {
  /* Ölçü/sütun ayrımını bozmak, DAX üretiminde sessizce yanlış sonuç verir
     (FOB bir ölçüdür; aynı adlı boyut sütunu varsa bile doğru olan ölçüdür). */
  const items = [{ id: 'a', name: 'A', server: 's', catalog: 'c', role: 'asas', scopes: [], mapping: {} }];
  assert.equal(writer.planMappingEntry(items, { sourceId: 'a', header: 'X', entry: { name: 'Y', kind: 'uydurma' } })
    .items[0].mapping['X'].kind, 'column');
  assert.equal(writer.planMappingEntry(items, { sourceId: 'a', header: 'X', entry: { name: 'Y', kind: 'measure' } })
    .items[0].mapping['X'].kind, 'measure');
});

test('v7.81 başlıksız istek reddedilir', () => {
  const items = [{ id: 'a', name: 'A', server: 's', catalog: 'c', role: 'asas', scopes: [], mapping: {} }];
  for (const header of ['', '   ', null, undefined]) {
    assert.equal(writer.planMappingEntry(items, { sourceId: 'a', header }).code, 'HEADER_REQUIRED');
  }
});

test('v7.81 yazılan eşleme sağlık raporunu gerçekten düzeltir', () => {
  const modelFields = require('../server/lib/model-fields');
  const items = db.replaceModelConnections([{
    id: 'mc_a', name: 'ASAS', server: 's', catalog: 'c', role: 'asas', refreshEnabled: true, scopes: [],
    mapping: { 'Lisans': { table: 'ASAS', name: 'Internal_Status_9', kind: 'column', folder: '' } },
  }], null).items;

  const before = modelFields.mappingHealth('asas', items.find(e => e.id === 'mc_a').mapping);
  assert.ok(before.reviewHeaders.includes('Lisans'));

  const plan = writer.planMappingEntry(items, {
    sourceId: 'mc_a', header: 'Lisans', entry: { table: 'ASAS', name: 'Lisans', kind: 'column' },
  });
  const next = db.replaceModelConnections(plan.items, null).items;
  const after = modelFields.mappingHealth('asas', next.find(e => e.id === 'mc_a').mapping);
  assert.ok(!after.reviewHeaders.includes('Lisans'), 'düzeltilen alan hâlâ gözden geçirmede');
});

/* ------------------------------------------------------------------ */
/* v7.81 — KAYNAĞI SİL (§7).
 *
 * Silme kapatmaktan farklıdır ve geri alınamaz. Korunan iki kusur:
 *
 * 4) SİLME, BAĞLANTI KİLİDİNİN ARKA KAPISI OLMAMALI. IAS → CP bağlantısını
 *    tek tek kapatmak reddediliyor (iş kuralı: CP antrepo verisi olmadan
 *    eksik veri gösterir). Kaynağın tamamını silmek aynı sonucu doğurur;
 *    biri engelliyse diğeri de engellemeli.
 *
 * 5) NE KAYBEDİLDİĞİ SAYILARAK DÖNMELİ. Sessiz bir 200, kullanıcının
 *    kaybını ancak bir sonraki yenilemede fark etmesi demektir.
 */

function deletable() {
  /* Silinebilir bir kaynak kurmak için zorunlu beslemesi OLMAYAN bir kayıt
     gerekir: IAS yalnız Siparişler'e bağlıyken (CP/Backlog kapalı) silinebilir. */
  return db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'a', role: 'asas', refreshEnabled: true,
      scopes: [{ id: 'sc_a', targets: ['cp', 'backlog', 'lfl'], enabled: true, horizon: {} }] },
    { id: 'mc_ias', name: 'IAS Antrepo', server: 's', catalog: 'i', role: 'antrepo', refreshEnabled: true,
      scopes: [{ id: 'sc_io', name: 'Sip. Antrepo', targets: ['orders'], enabled: true, horizon: {} }],
      parkedBindings: [{ moduleId: 'cp' }, { moduleId: 'backlog' }],
      mapping: { 'Sipariş Kod': { table: 'IAS', name: 'SK', kind: 'column', folder: '' } },
    },
  ], null).items;
}

test('P7 zorunlu besleme varken kaynak SİLİNEMEZ — kilidin arka kapısı yok', () => {
  const items = db.replaceModelConnections([
    { id: 'mc_ias', name: 'IAS', server: 's', catalog: 'i', role: 'antrepo', refreshEnabled: true,
      scopes: [{ id: 'sc_i', targets: ['cp', 'backlog'], enabled: true, horizon: {} }] },
  ], null).items;

  const plan = writer.planSourceDelete(items, { sourceId: 'mc_ias' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'SOURCE_REQUIRED');
  assert.match(plan.message, /cp|backlog/);
  // Reddedilen istek veriyi DEĞİŞTİRMEMELİ.
  assert.deepEqual(plan.items, items);
});

test('P7 zorunlu beslemesi kalmayan kaynak silinebilir', () => {
  const items = deletable();
  const plan = writer.planSourceDelete(items, { sourceId: 'mc_ias' });
  assert.equal(plan.ok, true, plan.message);
  const after = db.replaceModelConnections(plan.items, null).items;
  assert.equal(after.find(entry => entry.id === 'mc_ias'), undefined, 'kaynak silinmedi');
  // Diğer kaynak etkilenmemeli.
  assert.ok(after.find(entry => entry.id === 'mc_asas'), 'yanlış kaynak silindi');
});

test('P7 silme NE KAYBEDİLDİĞİNİ sayarak döner', () => {
  const plan = writer.planSourceDelete(deletable(), { sourceId: 'mc_ias' });
  assert.equal(plan.ok, true);
  assert.equal(plan.removed.name, 'IAS Antrepo');
  assert.deepEqual(plan.removed.moduleIds, ['orders']);
  assert.equal(plan.removed.mappedFieldCount, 1);
  assert.equal(plan.removed.parkedCount, 2, 'park edilmiş bağlantılar da gidiyor, sayılmalı');
  // Ve hangi modülün veri kaybedeceği açıkça uyarılır.
  assert.ok(plan.warnings.some(text => /orders/.test(text)), `uyarı yok: ${plan.warnings.join(' | ')}`);
});

test('P7 ad teyidi yanlışsa silinmez — yanlış kart kolayca tıklanır', () => {
  const items = deletable();
  const wrong = writer.planSourceDelete(items, { sourceId: 'mc_ias', expectedName: 'ASAS' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'NAME_MISMATCH');
  assert.deepEqual(wrong.items, items);

  const right = writer.planSourceDelete(items, { sourceId: 'mc_ias', expectedName: 'IAS Antrepo' });
  assert.equal(right.ok, true);

  /* Teyit GÖNDERİLMEZSE zorlanmaz: betikler ve eski istemciler kırılmamalı.
     Koruma arayüzün kazara tıklamaya karşı verdiği bir güvencedir, bir yetki
     kontrolü değil — o ayrı ve sunucuda duruyor. */
  assert.equal(writer.planSourceDelete(items, { sourceId: 'mc_ias' }).ok, true);
});

test('P7 olmayan kaynağı silmek 404 kodu verir', () => {
  const plan = writer.planSourceDelete(deletable(), { sourceId: 'yok' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'SOURCE_NOT_FOUND');
});

/* ------------------------------------------------------------------ */
/* v7.81 — CP SÜTUNLARI (§7, eski ekrandan taşınan yetenek).
 *
 * Korunan kusurlar:
 *
 * 6) TEK İŞLEM YAZILIR. Tam listeyi göndermek, bayat bir görünümde başka bir
 *    pencerede eklenmiş sütunun sessizce düşmesi demekti.
 *
 * 7) ETİKET ÇAKIŞMASI SESSİZ KALMAMALI. db.js aynı etiketi taşıyan ikinci
 *    kaydı atıyor; kullanıcı "ekledim ama listede yok" derdi.
 *
 * 8) YETENEK PROFİLDEN OKUNUR. Pivot raporunda CP sütunu kavramı yok; orada
 *    kabul etmek hiçbir yere çıkmayan bir kayıt üretirdi.
 */

function withCpColumns() {
  return db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'a', role: 'asas', refreshEnabled: true,
      scopes: [{ id: 'sc_a', targets: ['cp'], enabled: true, horizon: {} }],
      cpColumns: [{ id: 'cpx1', label: 'Statü', table: 'ASAS', name: 'STATU', kind: 'column', group: 'Database' }] },
    { id: 'mc_intake', name: 'Bütçe', server: 's', catalog: 'b', role: 'intake', refreshEnabled: true,
      scopes: [{ id: 'sc_b', targets: ['intake'], enabled: true, horizon: {} }] },
  ], null).items;
}

test('P7 CP sütunu eklenir ve tek işlem olarak yazılır', () => {
  const items = withCpColumns();
  const plan = writer.planCpColumn(items, {
    sourceId: 'mc_asas', op: 'add', label: 'Fabrika',
    entry: { kind: 'column', table: 'ASAS', name: 'FABRIKA' }, group: 'Database',
  });
  assert.equal(plan.ok, true, plan.message);
  const saved = db.replaceModelConnections(plan.items, null).items.find(entry => entry.id === 'mc_asas');
  assert.deepEqual(saved.cpColumns.map(column => column.label), ['Statü', 'Fabrika'],
    'var olan sütun korunmalı — tek işlem yazılıyor, tam liste değil');
  assert.equal(saved.cpColumns[1].name, 'FABRIKA');
});

test('P7 aynı etiket ikinci kez kabul edilmez — sessizce düşmesindense reddedilir', () => {
  const items = withCpColumns();
  const plan = writer.planCpColumn(items, {
    sourceId: 'mc_asas', op: 'add', label: 'statü',   // büyük/küçük harf farkı yeter
    entry: { kind: 'column', table: 'ASAS', name: 'X' },
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'CP_COLUMN_LABEL_TAKEN');
  assert.deepEqual(plan.items, items);
});

test('P7 veriye bağlanmamış sütun kabul edilmez — CP’de boş kolon doğurur', () => {
  const plan = writer.planCpColumn(withCpColumns(), { sourceId: 'mc_asas', op: 'add', label: 'Boş' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'CP_COLUMN_SOURCE_REQUIRED');
});

test('P7 başlıksız sütun kabul edilmez', () => {
  const plan = writer.planCpColumn(withCpColumns(), {
    sourceId: 'mc_asas', op: 'add', label: '  ', entry: { kind: 'column', table: 'ASAS', name: 'X' },
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'CP_COLUMN_LABEL_REQUIRED');
});

test('P7 sütun güncellenir; kimlik ve diğer sütunlar korunur', () => {
  const plan = writer.planCpColumn(withCpColumns(), {
    sourceId: 'mc_asas', op: 'update', id: 'cpx1', label: 'Sipariş Statüsü', group: 'ASAS',
    entry: { kind: 'measure', table: 'ASAS', name: 'STATU2' },
  });
  assert.equal(plan.ok, true, plan.message);
  const saved = db.replaceModelConnections(plan.items, null).items.find(entry => entry.id === 'mc_asas');
  assert.equal(saved.cpColumns.length, 1);
  assert.equal(saved.cpColumns[0].id, 'cpx1', 'kimlik korunmalı — CP kolon düzeni buna bağlı');
  assert.equal(saved.cpColumns[0].label, 'Sipariş Statüsü');
  assert.equal(saved.cpColumns[0].kind, 'measure');
  assert.equal(saved.cpColumns[0].group, 'ASAS');
});

test('P7 sütun silinir; ikinci kez silmek durumu bozmaz', () => {
  const items = withCpColumns();
  const first = writer.planCpColumn(items, { sourceId: 'mc_asas', op: 'remove', id: 'cpx1' });
  assert.equal(first.ok, true);
  const saved = db.replaceModelConnections(first.items, null).items;
  assert.deepEqual(saved.find(entry => entry.id === 'mc_asas').cpColumns, []);

  const second = writer.planCpColumn(saved, { sourceId: 'mc_asas', op: 'remove', id: 'cpx1' });
  assert.equal(second.ok, true);
  assert.equal(second.code, 'NO_CHANGE');
});

test('P7 pivot kaynağında CP sütunu kavramı yoktur', () => {
  const plan = writer.planCpColumn(withCpColumns(), {
    sourceId: 'mc_intake', op: 'add', label: 'X', entry: { kind: 'column', table: 'T', name: 'C' },
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'CP_COLUMNS_UNSUPPORTED');
});

test('P7 ekran CP sütunlarını okuma modelinden görür', () => {
  const readModel = require('../server/lib/data-domain/read-model');
  const model = readModel.build(withCpColumns(), { language: 'tr' });
  const asas = model.sources.find(entry => entry.id === 'mc_asas');
  assert.deepEqual(asas.cpColumns.map(column => ({ label: column.label, column: column.column, group: column.group })),
    [{ label: 'Statü', column: 'STATU', group: 'Database' }]);
  // Yeteneği olmayan kaynak boş liste taşır; arayüz bölümü hiç çizmez.
  assert.deepEqual(model.sources.find(entry => entry.id === 'mc_intake').cpColumns, []);
});

/* ------------------------------------------------------------------ */
/* v7.81 — SORGU MODU / ELLE YAZILAN DAX (§7, eski ekrandan taşınan yetenek).
 *
 * Korunan kusurlar:
 *
 *  9) MOD DEĞİŞİMİNİN SONUCU SÖYLENMELİ. Elle yazılan sorgu kapsam
 *     filtrelerini devre dışı bırakır. Eski ekranda bu yalnız bir açılır
 *     listeydi; kullanıcı filtresini değiştirip hiçbir şeyin değişmediğini
 *     görüyor ve nedenini bulamıyordu.
 *
 * 10) OTOMATİĞE DÖNERKEN METİN SİLİNMEZ. Saatlerce uğraşılmış bir DAX'ı
 *     sessizce yok etmek kabul edilemez; kullanıcı deneme amacıyla geri
 *     dönmüş olabilir.
 *
 * 11) BOŞ MANUEL SORGU KABUL EDİLMEZ. Yenilemenin sessizce hiçbir şey
 *     getirmemesi demekti.
 */

function queryable() {
  return db.replaceModelConnections([
    { id: 'mc_asas', name: 'ASAS', server: 's', catalog: 'a', role: 'asas', refreshEnabled: true,
      scopes: [{ id: 'sc_a', targets: ['cp', 'backlog'], enabled: true, horizon: {} }] },
    { id: 'mc_intake', name: 'Bütçe', server: 's', catalog: 'b', role: 'intake', refreshEnabled: true,
      scopes: [{ id: 'sc_b', targets: ['intake'], enabled: true, horizon: {} }] },
  ], null).items;
}

test('P7 manuel moda geçerken hangi sayfaların filtresiz kalacağı SÖYLENİR', () => {
  const plan = writer.planSourceQuery(queryable(), {
    sourceId: 'mc_asas', mode: 'manual', query: 'EVALUATE ASAS',
  });
  assert.equal(plan.ok, true, plan.message);
  const notice = plan.warnings.join(' | ');
  assert.match(notice, /cp/);
  assert.match(notice, /backlog/);
  assert.match(notice, /kapsam filtreleri uygulanmaz/i);
});

test('P7 boş manuel sorgu reddedilir', () => {
  const items = queryable();
  const plan = writer.planSourceQuery(items, { sourceId: 'mc_asas', mode: 'manual', query: '   ' });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'QUERY_REQUIRED');
  assert.deepEqual(plan.items, items);
});

test('P7 otomatiğe dönmek yazılmış DAX’ı SİLMEZ', () => {
  let state = db.replaceModelConnections(
    writer.planSourceQuery(queryable(), { sourceId: 'mc_asas', mode: 'manual', query: 'EVALUATE ASAS' }).items, null).items;
  assert.equal(state.find(entry => entry.id === 'mc_asas').mode, 'manual');

  const back = writer.planSourceQuery(state, { sourceId: 'mc_asas', mode: 'auto' });
  assert.equal(back.ok, true);
  assert.ok(back.warnings.some(text => /saklandı/i.test(text)), 'metnin saklandığı söylenmeli');
  state = db.replaceModelConnections(back.items, null).items;
  const source = state.find(entry => entry.id === 'mc_asas');
  assert.equal(source.mode, 'auto');
  assert.equal(source.query, 'EVALUATE ASAS', 'kullanıcının yazdığı sorgu sessizce silinmemeli');
});

test('P7 DAX metninin girintisi korunur — clean() ile ezilmez', () => {
  const dax = 'EVALUATE\r\n  FILTER(\r\n    ASAS,\r\n    ASAS[Sezon] = "S8"\r\n  )';
  const plan = writer.planSourceQuery(queryable(), { sourceId: 'mc_asas', mode: 'manual', query: dax });
  assert.equal(plan.ok, true);
  const saved = db.replaceModelConnections(plan.items, null).items.find(entry => entry.id === 'mc_asas');
  assert.equal(saved.query, dax);
});

test('P7 pivot kaynağında elle yazılan sorgu yoktur', () => {
  const plan = writer.planSourceQuery(queryable(), {
    sourceId: 'mc_intake', mode: 'manual', query: 'EVALUATE X',
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'MANUAL_QUERY_UNSUPPORTED');
});

test('P7 çok uzun sorgu reddedilir', () => {
  const plan = writer.planSourceQuery(queryable(), {
    sourceId: 'mc_asas', mode: 'manual', query: 'E'.repeat(20001),
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'QUERY_TOO_LONG');
});

test('P7 ekran sorgu metnini okuma modelinden görür', () => {
  const readModel = require('../server/lib/data-domain/read-model');
  const items = db.replaceModelConnections(
    writer.planSourceQuery(queryable(), { sourceId: 'mc_asas', mode: 'manual', query: 'EVALUATE ASAS' }).items, null).items;
  const asas = readModel.build(items, { language: 'tr' }).sources.find(entry => entry.id === 'mc_asas');
  assert.equal(asas.queryMode, 'manual');
  /* Metnin kendisi gitmeli: kesilirse düzenleyici boş açılır ve kaydedince
     kullanıcının DAX'ını siler. */
  assert.equal(asas.query, 'EVALUATE ASAS');
});

/* ------------------------------------------------------------------ */
/* v7.81 — CP SÜTUNLARI: CANLI DOĞRULAMADA YAKALANAN İKİ KUSUR.
 *
 * 12) IAS'TA DA CP SÜTUNU VARDIR. Profil kaydına 'extra-columns' yazılmamıştı
 *     ve yeni düzenleyici antrepo kaynağını reddediyordu. Oysa özellik canlı:
 *     /api/data cpColumns'ı ROLE BAKMADAN topluyor ve CP tablosundaki sütun
 *     ekleme ekranı kaynak listesinde IAS'ı da sunuyor. Sessiz bir yetenek
 *     kaybı olurdu — bir sütunu ASAS'tan IAS'a taşırken ortaya çıktı.
 *
 * 13) TAŞIMA SIRASI: ÖNCE EKLE, SONRA KALDIR. Ters sırada ekleme reddedilirse
 *     sütun hiçbir kaynakta kalmıyordu.
 */

test('P7 antrepo kaynağı da CP sütunu taşıyabilir', () => {
  const items = db.replaceModelConnections([
    { id: 'mc_ias', name: 'IAS', server: 's', catalog: 'i', role: 'antrepo', refreshEnabled: true,
      scopes: [{ id: 'sc_i', targets: ['cp'], enabled: true, horizon: {} }] },
  ], null).items;

  const plan = writer.planCpColumn(items, {
    sourceId: 'mc_ias', op: 'add', label: 'Antrepo Statü',
    entry: { kind: 'column', table: 'IAS', name: 'STATU' },
  });
  assert.equal(plan.ok, true, plan.message);
  const saved = db.replaceModelConnections(plan.items, null).items.find(entry => entry.id === 'mc_ias');
  assert.deepEqual(saved.cpColumns.map(column => column.label), ['Antrepo Statü']);
});

test('P7 CP sütunu yeteneği, sunucunun gerçekte topladığı rollerle örtüşür', () => {
  /* Korunan kusur: profil kaydı ile GERÇEK davranış sessizce ayrışabilir.
     server.js cpColumns'ı role bakmadan topluyor; dolayısıyla satır verisi
     taşıyan (shape 'rows') her profil bu yeteneğe sahip olmalı. Pivot rapor
     (INTAKE) hariç — orada CP sütunu diye bir kavram yok. */
  const profiles = require('../server/lib/data-domain/source-profiles');
  const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(SERVER, /items\.flatMap\(item => \(item\.cpColumns \|\| \[\]\)/,
    'sunucu cpColumns\'ı role bakmadan topluyor olmalı — varsayım değişirse bu test kırılır');

  for (const profile of profiles.list()) {
    const expected = profile.shape === 'rows' && profile.feedableModules.includes('cp');
    assert.equal(profile.capabilities.includes('extra-columns'), expected,
      `${profile.id}: shape='${profile.shape}' iken extra-columns ${expected ? 'olmalı' : 'olmamalı'}`);
  }
});

test('P7 kaynaklar arası taşıma ÖNCE EKLER, sonra kaldırır', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const block = ui.slice(ui.indexOf('const previous=editId?'), ui.indexOf('syncCpModelColumns(cpModelColumnDefinitionsFromConnections(saved));', ui.indexOf('const previous=editId?')));
  assert.ok(block, 'taşıma bloğu bulunamadı');
  const addAt = block.indexOf("op:'add'");
  const removeAt = block.indexOf("op:'remove'");
  assert.notEqual(addAt, -1);
  assert.notEqual(removeAt, -1);
  assert.ok(addAt < removeAt,
    'kaldırma eklemeden önce gelirse, ekleme reddedildiğinde sütun hiçbir kaynakta kalmaz');
});

test('P7 CP sütunu yazması TEK İŞLEMDİR; tam dizi gönderilmez', () => {
  /* Bayat bir görünümden bütün diziyi yazmak, başka bir pencerede eklenmiş
     sütunu SESSİZCE düşürüyordu (canlı ölçümde doğrulandı). */
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
  const fn = ui.slice(ui.indexOf('async function writeCpModelColumn('), ui.indexOf('async function removeCpModelColumn('));
  assert.ok(fn, 'writeCpModelColumn bulunamadı');
  assert.match(fn, /\/api\/data-management\/source\//);
  assert.match(fn, /expectedSourceRevision:source\.configRevision/);
  assert.doesNotMatch(fn, /modelConnSave/, 'tam dizi yazıcısı kullanılmamalı');
  // Ve CP ekranındaki iki yol da artık o yardımcıdan geçer.
  assert.ok(!/items\.forEach\(item=>\{item\.cpColumns=/.test(ui), 'tam dizi üzerinde cpColumns düzenlemesi kalmamalı');
});
