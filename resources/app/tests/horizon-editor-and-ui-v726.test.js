'use strict';

/*
 * v7.26 — SAYFA UFKU (HORIZON) EKRANI + ARAYÜZ SADELEŞTİRMELERİ
 *
 * Kullanıcı talepleri (saha, birebir):
 *   · "Horizon ayarlamak excel tablosuna filtre koymak kadar basit bir işlem
 *      olsun. Kullanıcı istediği tablo başlıklarını ekleyip istediği
 *      filtrelemeyi yapabilsin."
 *   · "Merch Alt Grup Kod = MAG, Merch Marka Yaş Grup Kod = MMYG, Buyer Group
 *      (EN) = Buying Group olduğu için kullanıcı oluşturulurken girilen
 *      bilgilere göre direkt olarak sayfalara horizon çizilebilir. ... asas
 *      başlıklarının eşlemelerinin doğru olduğunu ve bu yöntemin çalışır
 *      durumda olduğunu kontrol et."
 *   · "Update History butonunu Bildirimler Butonunun içine koy."
 *   · "Yenile butonuyla açılan pencerede sayfaların en son güncellenme saatini
 *      göster." / "Yenileme butonlarını Source Data ekranından kaldır."
 *   · "Bildirimler butonunun solundaki arama kutusunu programdan kaldıralım."
 *   · "CP ve Orders'daki basic filters alanının adını Page Filters olarak
 *      değiştirelim. ayrıca bu filtreleme alanı tablonun arkasında açıldığı
 *      için filtreleme yapamıyorum."
 *
 * EN KRİTİK İKİ DAVRANIŞ:
 *   1) Ufuk koşulları (MAG/MMYG/Buying Group) artık satır süzmede de işler.
 *      Önceden yalnız SEZON ve TARİH işliyordu; yani Excel modunda "MAG =
 *      CK1E" diye kurulan bir ufuk hiçbir şeyi süzmüyordu.
 *   2) İki yol (DAX ve satır süzme) AYNI önceliği uygular: aktif koşul grubu
 *      varsa eski sezon/tarih alanları yok sayılır. Aksi halde aynı ufuk
 *      Excel modunda başka, veri tabanı modunda başka sonuç verirdi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const horizonFields = require('../server/lib/horizon-fields');
const modelFields = require('../server/lib/model-fields');
const modelHorizon = require('../server/lib/modelHorizon');
const { assertLazy } = require('./helpers/script-loading');

const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const KPI = fs.readFileSync(path.join(ROOT, 'public', 'kpi-groups.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const SERVER = require('./helpers/server-source')();

/* ------------------------------- 1) ASAS BAŞLIK EŞLEMESİ DOĞRU MU? */

test('v7.26 MAG / MMYG / Buying Group başlıkları ASAS ile birebir', () => {
  const byProfile = Object.fromEntries(horizonFields.PROFILE_FIELDS.map(field => [field.profile, field]));
  assert.equal(byProfile.mags.header, 'Merch Alt Grup Kod');
  assert.equal(byProfile.mmygs.header, 'Merch Marka Yaş Grup Kod');
  assert.equal(byProfile.buyingGroups.header, 'Buyer Grup (TR)');
  // Aynı başlıklar ASAS alan kataloğunda da tanımlı olmalı; iki liste
  // ayrışırsa ufuk, var olmayan bir sütuna filtre koyardı.
  const catalogue = modelFields.fieldList ? modelFields.fieldList('asas') : null;
  const headers = new Set((catalogue || modelFields.FIELDS && modelFields.FIELDS.asas || []).map(item => item.header));
  if (headers.size) {
    for (const field of horizonFields.PROFILE_FIELDS) {
      assert.ok(headers.has(field.header), `${field.header} ASAS alan kataloğunda yok`);
    }
  }
});

test('v7.26 "Buyer Group" ve "Buying Group" takma adları kabul ediliyor', () => {
  // Kullanıcı "Buyer Group (EN)" diyor; ASAS çıktısında sütun 'Buyer Grup (TR)'.
  // İngilizce başlıklı bir çıktı gelirse eşleme takma adlardan tutmalı.
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'model-fields.js'), 'utf8');
  const line = source.split('\n').find(item => item.includes("header: 'Buyer Grup (TR)'"));
  assert.ok(line, 'Buyer Grup (TR) tanımı bulunmalı');
  assert.match(line, /BUYING GROUP/);
  assert.match(line, /BUYER GROUP/);
});

/* ------------------------------- 2) KOŞULLAR SATIR SÜZMEDE İŞLİYOR MU? */

const ROWS = [
  { merch: 'CK1E', ageGroup: 'CKW1', buyerGrup: 'ELBISE', season: 'S6', ex: '2026-02-16' },
  { merch: 'CK1E', ageGroup: 'CKW1', buyerGrup: 'DENİM', season: 'S6', ex: '2026-03-02' },
  { merch: 'CU4E', ageGroup: 'CKW1', buyerGrup: 'ELBISE', season: 'S7', ex: '2026-05-20' },
  { merch: 'CX9E', ageGroup: 'CXK1', buyerGrup: 'AKSESUAR', season: 'S6', ex: '' },
];

test('v7.26 kullanıcı bilgisinden kurulan ufuk gerçekten süzüyor', () => {
  const horizon = horizonFields.horizonFromProfile({ mags: ['CK1E'], mmygs: ['CKW1'], buyingGroups: ['ELBISE'] }, { table: 'Siparis' });
  const kept = horizonFields.filterRows(ROWS, horizon);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].buyerGrup, 'ELBISE');
});

test('v7.26 üst düzey yönetici için ÇOKLU seçim çalışıyor', () => {
  const horizon = horizonFields.horizonFromProfile({ mags: ['CK1E', 'CU4E'], mmygs: [], buyingGroups: [] }, { table: 'Siparis' });
  assert.equal(horizonFields.filterRows(ROWS, horizon).length, 3);
});

test('v7.26 kullanıcı kartı boşsa ufuk kurulmaz (herkes her şeyi görür)', () => {
  assert.equal(horizonFields.horizonFromProfile({ mags: [], mmygs: [], buyingGroups: [] }), null);
});

test('v7.26 koşulsuz ufuk hiçbir satırı düşürmez', () => {
  assert.equal(horizonFields.filterRows(ROWS, {}).length, ROWS.length);
  assert.equal(horizonFields.filterRows(ROWS, { groups: [{ conditions: [] }] }).length, ROWS.length);
});

test('v7.26 satır süzme ile DAX AYNI önceliği uygular: grup varsa sezon/tarih yok sayılır', () => {
  const horizon = {
    table: 'Siparis', seasons: ['S9'], dateStart: '2020-01-01', dateEnd: '2020-12-31',
    groups: [{ conditions: [{ table: 'Siparis', field: 'Merch Alt Grup Kod', op: 'in', values: ['CK1E'] }] }],
  };
  // DAX tarafı: gruplar kullanıldı, sezon/tarih kullanılmadı.
  const dax = modelHorizon.buildHorizonFilter(horizon);
  assert.equal(dax.usedGroups, true);
  assert.equal(dax.usedSeasons, false);
  assert.equal(dax.usedDates, false);
  // Satır süzme tarafı: aynı sonucu vermeli (sezon S9 tutmasa da satırlar gelir).
  const kept = horizonFields.filterRows(ROWS, horizon);
  assert.equal(kept.length, 2, 'grup kazanmalı; sezon/tarih ufku daraltmamalı');
});

test('v7.26 grup yokken sezon ve tarih VEYA ile birleşir (modelHorizon ile aynı)', () => {
  const horizon = { seasons: ['S7'], dateStart: '2026-02-01', dateEnd: '2026-02-28' };
  const kept = horizonFields.filterRows(ROWS, horizon);
  // S7 satırı (sezondan) + 16 Şubat satırı (tarihten) = 2
  assert.equal(kept.length, 2);
});

test('v7.26 tarihi olmayan satır, tarih koşulu olan ufukta dışarıda kalır', () => {
  const kept = horizonFields.filterRows(ROWS, { dateStart: '2026-01-01', dateEnd: '2026-12-31' });
  assert.ok(!kept.some(row => row.merch === 'CX9E'), 'tarihi boş satır zaman ufkuna yerleştirilemez');
});

test('v7.26 derlenmiş ve derlenmemiş yol aynı sonucu verir', () => {
  const cases = [
    { groups: [{ conditions: [{ field: 'Buyer Grup (TR)', op: 'notIn', values: ['ELBISE'] }] }] },
    { groups: [{ conditions: [{ field: 'Model Adı', op: 'empty', values: [] }] }] },
    { groups: [{ conditions: [{ field: 'Orijinal Exfactory Merch Tarih', op: 'gte', valueType: 'date', from: '2026-03-01' }] }] },
    { seasons: ['S6'] },
  ];
  for (const horizon of cases) {
    const slow = ROWS.filter(row => horizonFields.matchesHorizon(row, horizon)).length;
    const fast = horizonFields.filterRows(ROWS, horizon).length;
    assert.equal(fast, slow, `iki yol ayrıştı: ${JSON.stringify(horizon)}`);
  }
});

test('v7.26 sunucu satır süzmede ortak modülü kullanıyor', () => {
  const fn = SERVER.slice(SERVER.indexOf('function filterRowsByEffectiveHorizon'), SERVER.indexOf('function pageCacheRuntimeMeta'));
  assert.ok(fn.includes('horizonFields.filterRows'), 'süzme ortak modülden geçmeli');
  assert.ok(!/const seasons=new Set\(/.test(fn), 'eski, yalnız sezon/tarih bilen kopya kalmamalı');
});

test('v7.26 ufuk uçları tanımlı', () => {
  for (const route of ['/api/horizon/fields', '/api/horizon/values', '/api/horizon/preview', '/api/horizon/users', '/api/horizon/from-user/:id']) {
    assert.ok(SERVER.includes(`'${route}'`), `${route} ucu yok`);
  }
  // Değer listesi önce canonical eşleme üzerinden doğrudan database'den gelir;
  // ağ/model erişilemezse kullanıcının yüklü verisi güvenli fallback olarak kalır.
  const values = SERVER.slice(SERVER.indexOf("app.get('/api/horizon/values'"), SERVER.indexOf("app.post('/api/horizon/preview'"));
  assert.ok(values.includes('resolveHorizonValueSource'), 'database alanı canonical eşlemeden çözülmeli');
  assert.ok(values.includes('queryModelDistinctValues'), 'database tekil değer sorgusu kullanılmalı');
  assert.ok(values.includes('cacheForUser(req)'), 'yüklü veri offline fallback olarak korunmalı');
});

/* ------------------------------- 3) SAYFA UFKU EKRANI */

test('v7.81 modül başlığından ufka giden düzenleme yolu YOK', () => {
  /* Eskiden başlıktan çift tıklamayla kişisel ufuk ekranı açılırdı.
     Kullanıcı kararı: "Modüllerin başlarındaki horizon alanını
     kaldıralım." Başlık artık yalnız salt okunur özet taşır. */
  assert.equal(fs.existsSync(path.join(ROOT, 'public', 'horizon-editor.js')), false);
  assert.doesNotMatch(APP, /BLHorizonEditor/);
});




/* ------------------------------- 4) ARAYÜZ SADELEŞTİRMELERİ */

test('v7.26 Sayfa Filtreleri: ad değişti ve panel içeriğin ÖNÜNDE açılıyor', () => {
  assert.ok(KPI.includes("mkLabel('Sayfa Filtreleri','Page Filters')"), 'ad Sayfa Filtreleri olmalı');
  assert.ok(!KPI.includes("'Temel Filtreler','Basic Filters'"), 'eski ad kalmamalı');
  assert.ok(KPI.includes('function positionFltMenu'), 'panel görüntü penceresine sabitlenmeli');
  assert.ok(KPI.includes("menu.style.position='fixed'"), 'kırpılan kutudan çıkmalı');
  assert.ok(!CSS.includes('.pageTitleFilters .fltGroup:hover>.fltGroupMenu'), 'hover ile açılma kalkmalı');
  assert.ok(CSS.includes('.pageTitleFilters .fltGroup.open>.fltGroupMenu'), 'tıklamayla açılma kalmalı');
});

test('v7.26 boyut filtresi panelinin içine tıklamak menüyü kapatmıyor', () => {
  assert.match(KPI, /closest\('\.fltGroupMenu,\.cpDimPanel,\.ordersDimPanel,\.colPanel,\.colFilterPanel'\)/);
});

test('v7.26 arama kutusu ve Kaynak Veri yenileme düğmeleri kaldırıldı', () => {
  assert.ok(!INDEX.includes('headerSearchBtn'), 'başlıktaki arama kutusu kalmamalı');
  assert.ok(!INDEX.includes('global-search.js'), 'genel arama betiği yüklenmemeli');
  assert.ok(!fs.existsSync(path.join(ROOT, 'public', 'global-search.js')), 'kullanılmayan dosya silinmeli');
  assert.ok(!INDEX.includes('id="serverRefreshBtn"'), 'Kaynak Veri yenile düğmesi kalmamalı');
  assert.ok(!INDEX.includes('id="sourceRefreshNowBtn"'), 'Kaynak Veri ortak yenile düğmesi kalmamalı');
  // Dinleyici isteğe bağlı bağlanmalı; düğme yokken hata vermemeli.
  assert.ok(APP.includes("document.getElementById('serverRefreshBtn')?.addEventListener"), 'kalan dinleyici güvenli olmalı');
});

test('v7.26 Güncelleme geçmişi bildirimler penceresinin içinde', () => {
  assert.ok(!INDEX.includes('sourceUpdateNotesBtn'), 'Kaynak Veri şeridindeki bağlantı kalmamalı');
  assert.ok(APP.includes('notificationUpdateHistoryBtn'), 'bildirim penceresinde düğme olmalı');
  assert.ok(APP.includes("modal.querySelector('#notificationUpdateHistoryBtn')?.addEventListener('click',()=>{close();openSourceRefreshHistory();})"),
    'düğme güncelleme geçmişini açmalı');
});

test('v7.26 Yenile menüsü sayfaların son güncellenme saatini gösteriyor', () => {
  const menu = APP.slice(APP.indexOf('function openTopRefreshMenu'), APP.indexOf('// Yenile sürerken aynı düğmeye'));
  // v20260929 — tek yenileme motoru: menüde tek satır; damga en eski sayfanın saatidir.
  assert.ok(menu.includes('const stamp=()=>'), 'yenileme satırı için zaman damgası hesaplanmalı');
  assert.ok(menu.includes('sourceRelativeTime'), 'okunur ifade kullanılmalı');
  assert.ok(menu.includes('toLocaleTimeString'), 'saatin kendisi de yazılmalı');
  assert.ok(menu.includes('topRefreshWhen'), 'menüde ayrı bir alan olmalı');
});

test('v7.26 Field Mapping ekranı arayüzden kaldırıldı, eşleme verisi korundu', () => {
  assert.ok(!APP.includes('_mcOpenMapping\')?.addEventListener'), 'açma düğmesi kalmamalı');
  assert.ok(!INDEX.includes('fieldMappingWarning'), 'uyarı şeridi kalmamalı');
  // Eşleme VERİSİ ve otomatik onarım DURMALI: veri tabanı modunda DAX buna muhtaç.
  const refresh = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'model-refresh.js'), 'utf8');
  assert.ok(refresh.includes('autoMapSchema'), 'otomatik eşleme korunmalı');
  assert.ok(refresh.includes('item.mapping = repairedMapping'), 'bozuk eşleme onarımı korunmalı');
  assert.ok(APP.includes('cpColumns'), 'ASAS\'tan elle sütun ekleme yolu korunmalı');
});

test('v7.81 kaynakta filtre yoksa kişisel ufka DÜŞÜLMEZ', () => {
  /* KARAR TERSİNE ÇEVRİLDİ. Eski kural: "bağlantı yoksa kişisel ufka
     düşülmeli" — çünkü ASAS Excel modunda hiç bağlantı olmayabiliyordu.
     Kullanıcı kişisel katmanı kaldırınca bu geri düşüş, "Veri
     Yönetimi'nde filtre koymadım ama veri yine sınırlı" belirsizliğini
     üretir hale geldi. Ufuk artık TEK kaynaktan gelir; kaynakta yoksa
     yoktur. */
  const fn = SERVER.slice(SERVER.indexOf('function filterRowsByEffectiveHorizon'), SERVER.indexOf('function pageCacheRuntimeMeta'));
  assert.ok(!fn.includes('userPreferences.resolveHorizon('), 'kişisel ufka geri düşüş geri gelmiş');
  assert.ok(!fn.includes('horizonPresetResolver'), 'ön ayar çözümleyicisi kalmamalı');
});


/* ------------------------------- 5) DAX ALAN EŞLEMESİNİ BİLİYOR MU? */

test('v7.26 ufuk koşulu DAX\'ta ALAN EŞLEMESİNDEN çözülür', () => {
  // v7.26 öncesi: koşulun `field` değeri DAX'a olduğu gibi yazılıyordu. Eski
  // ekranda alanlar model şemasından seçildiği için bu doğruydu. Yeni Sayfa
  // Ufku ekranı alanları ASAS BAŞLIĞIYLA sunuyor; modeldeki sütun başka adla
  // duruyorsa başlığı doğrudan yazmak var olmayan bir sütuna filtre koymaktı.
  const horizon = {
    table: 'Siparis',
    groups: [{ conditions: [{ table: 'Siparis', field: 'Merch Alt Grup Kod', op: 'in', valueType: 'text', values: ['CK1E'] }] }],
  };
  const mapping = { 'Merch Alt Grup Kod': { table: 'Siparis', name: 'MAG Kodu', kind: 'column' } };
  assert.match(modelHorizon.buildHorizonFilter(horizon, mapping).expression, /\'Siparis\'\[MAG Kodu\]/);
  // Eşleme yoksa alan adı eskisi gibi doğrudan kullanılır: şemadan seçilmiş
  // eski ufuklar bozulmaz.
  assert.match(modelHorizon.buildHorizonFilter(horizon).expression, /\'Siparis\'\[Merch Alt Grup Kod\]/);
});

test('v7.26 ölçüye eşlenmiş başlık filtreye girmez', () => {
  const horizon = { table: 'Siparis', groups: [{ conditions: [{ table: 'Siparis', field: 'Merch Alt Grup Kod', op: 'in', values: ['CK1E'] }] }] };
  const mapping = { 'Merch Alt Grup Kod': { table: 'Siparis', name: 'Toplam Adet', kind: 'measure' } };
  // Ölçü satır bağlamında filtrelenemez; alan adına düşülmeli, yanlış DAX
  // üretilmemeli.
  assert.match(modelHorizon.buildHorizonFilter(horizon, mapping).expression, /\[Merch Alt Grup Kod\]/);
});

test('v7.26 sorgu üreticileri eşlemeyi filtreye geçiriyor', () => {
  const source = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'modelHorizon.js'), 'utf8');
  for (const fn of ['buildProjectionQuery', 'buildSummarizeQuery', 'buildFactRowQuery']) {
    const block = source.slice(source.indexOf(`function ${fn}(`), source.indexOf(`function ${fn}(`) + 200);
    /* v7.83: üreticiler artık üçüncü argümanla şema tipi çözücüsünü de
       geçiriyor (options.columnType). KORUNAN KUSUR AYNI: eşleme filtreye
       MUTLAKA gitmeli, yoksa WHERE tarafı model sütununu bulamaz. */
    assert.match(block, /buildHorizonFilter\(horizonInput, mapping(?:, options)?\)/, `${fn} eşlemeyi geçirmeli`);
  }
  /* Sayım sorgusu da aynı kuralda: v7.83'ten beri üçüncü argümanla şema tipi
     çözücüsünü alıyor, ama KORUNAN KUSUR yine eşlemenin filtreye gitmesi. */
  assert.match(source, /function buildCountQuery\(horizonInput, mapping = null(?:, options = \{\})?\)/);
  assert.match(SERVER, /buildCountQuery\(aligned\.horizon, mapping(?:, \{ columnType \})?\)/);
});

test('v7.26 sezon ve tarih sütunları da eşlemeden çözülüyor', () => {
  const horizon = { table: 'Siparis', seasons: ['S6'], seasonField: 'Sezon', dateField: 'Orijinal Exfactory Merch Tarih' };
  const mapping = { Sezon: { table: 'Siparis', name: 'Season Code', kind: 'column' } };
  assert.match(modelHorizon.buildHorizonFilter(horizon, mapping).expression, /\[Season Code\]/);
});
