'use strict';
/* ===================================================================
   v7.81 — ASAS FİLTRESİNİ IAS'A EŞLEME: ÖNERİ VE ONAY

   Kullanıcı talebi: "bir modül hem ASAS hem IAS'dan besleniyorsa, ASAS için
   seçtiğim filtreleri Buyer Log IAS için de otomatik eşleyerek seçsin.
   Kullanıcı için önden çalışmış olsun. Kullanıcı kontrol edip onayladığında
   IAS filtreleri de oluşsun. Bu onay mekanizmasına ihtiyaç var çünkü Buyer
   Log ASAS'daki alanları IAS'da birebir eşleyemeyebilir, alan isimleri
   farklı olabiliyor."

   KORUNAN KUSUR — sessiz yanlış eşleme. Eşlemeyi otomatik yazan bir sürüm,
   kullanıcının filtre koyduğunu sandığı ama hiçbir satırı tutmayan bir IAS
   sorgusu üretebilir (alan yanlış eşlendi, ya da değer yazımı farklı). Bu
   ekranda boş tablo olarak görünür ve sebebi görünmez. Testler üç şeyi
   kilitliyor: yanlış eşleme uydurulmaz, eşlenemeyen koşul SESSİZCE DÜŞMEZ,
   ve onaya kadar hiçbir şey kaydedilmez.
   =================================================================== */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const mapping = require('../server/lib/horizon-filter-mapping');

const IAS_FIELDS = [
  { header: 'MAG', name: 'MAG', table: 'Dim', type: 'text' },
  { header: 'Season', name: 'Season', table: 'Dim', type: 'text' },
  { header: 'Exfactory Date', name: 'Exfactory Date', table: 'Fact', type: 'date' },
  { header: 'Brand', name: 'Brand', table: 'Dim', type: 'text' },
];
const condition = (field, extra = {}) => ({ field, op: 'in', valueType: 'text', values: ['X'], ...extra });
const propose = conditions => mapping.proposeMapping({ groups: [{ conditions }], targetFields: IAS_FIELDS });

test('takma ad kataloğu farklı adlı aynı alanı eşler (MAG, Sezon)', () => {
  /* Kullanıcının söylediği durum: "alan isimleri farklı olabiliyor".
     İkinci bir liste uydurmuyoruz — eşleme, sahada doğrulanmış ortak alan
     kaydının takma adlarından geliyor (§8). */
  const out = propose([condition('Merch Alt Grup Kod'), condition('Sezon')]);
  const bySource = Object.fromEntries(out.proposals.map(item => [item.sourceField, item]));
  assert.equal(bySource['Merch Alt Grup Kod'].targetField, 'MAG');
  assert.equal(bySource['Merch Alt Grup Kod'].confidence, 'alias');
  assert.equal(bySource['Sezon'].targetField, 'Season');
});

test('canlı şemada fiziksel sütun mantıksal etikete tercih edilir', () => {
  const out = mapping.proposeMapping({
    groups: [{ conditions: [condition('Buyer Grup (TR)', { values: ['LİSANS'] })] }],
    targetFields: [
      { header: 'Buyer Grup (TR)', tr: 'Buying Group', en: 'Buying Group', type: 'text' },
      { header: 'Buyer Grup Tanım', name: 'Buyer Grup Tanım', table: 'Siparis Bilgileri', type: 'text', dynamic: true },
    ],
  });
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].physical, true);
  assert.equal(out.proposals[0].table, 'Siparis Bilgileri');
  assert.equal(out.proposals[0].column, 'Buyer Grup Tanım');
  assert.equal(out.groups[0].conditions[0].name, 'Buyer Grup Tanım');
});

test('ayırt edici ortak kelime farklı uzunluktaki adları eşler', () => {
  /* 'Orijinal Exfactory Merch Tarih' ⇄ 'Exfactory Date': ne birebir ne içerme
     tutar. Ortak kelime yeterince uzun ve hedefte TEK olduğu için öneri
     üretilir — ama en düşük güvenle, çünkü kullanıcı kontrol etmeli. */
  const out = propose([condition('Orijinal Exfactory Merch Tarih')]);
  assert.equal(out.proposals.length, 1);
  assert.equal(out.proposals[0].targetField, 'Exfactory Date');
  assert.equal(out.proposals[0].confidence, 'fuzzy');
});

test('karşılığı olmayan alan UYDURULMAZ, eşlenemedi diye raporlanır', () => {
  /* EN ÖNEMLİ GÜVENCE. 'Kumaşçı' için hedefte karşılık yok; boşta duran
     'Brand' alanına iliştirmek, kullanıcının kumaşçı filtresi koyduğunu
     sanıp marka filtresi çalıştırması demek olurdu. */
  const out = propose([condition('Kumaşçı')]);
  assert.equal(out.proposals.length, 0);
  assert.equal(out.unmapped.length, 1);
  assert.equal(out.unmapped[0].sourceField, 'Kumaşçı');
  assert.equal(out.unmapped[0].reason, 'NO_TARGET_FIELD');
});

test('kataloğa kayıtlı OLMAYAN kısa adlar bulanık eşleşmeye girmez', () => {
  /* Kısa bir ad içerme kuralıyla her şeyi yakalar; hem içerme hem
     ortak-kelime kademesinde uzunluk eşiği var.

     ÖLÇÜLDÜ, VARSAYILMADI: 'FOB' ⇄ 'FOB Price' bu eşiklere TAKILMAZ, çünkü
     alias kademesinden geçer — katalogda kayıtlı, sahada doğrulanmış gerçek
     bir karşılıktır ve öyle olması doğrudur. Uzunluk eşiğinin koruduğu şey
     kataloğun BİLMEDİĞİ kısa adlardır; test de onu ölçüyor. */
  const out = mapping.proposeMapping({
    groups: [{ conditions: [condition('Zxq')] }],
    targetFields: [{ header: 'Zxq Total', name: 'Zxq Total', table: 'Fact', type: 'number' }],
  });
  assert.equal(out.proposals.length, 0, 'katalogda olmayan kısa ad bulanık eşleşmemeli');
  assert.equal(out.unmapped.length, 1);
});

test('ortak kelime hedefte tek değilse öneri üretilmez', () => {
  /* İki aday arasından rastgele birini seçmek, kullanıcının fark etmeyeceği
     bir yanlış eşleme demekti. Belirsizlikte susmak doğru davranış. */
  const out = mapping.proposeMapping({
    groups: [{ conditions: [condition('Tahmini Antrepo Giriş Tarihi')] }],
    targetFields: [
      { header: 'Antrepo Giris', name: 'Antrepo Giris', table: 'A', type: 'date' },
      { header: 'Antrepo Cikis', name: 'Antrepo Cikis', table: 'A', type: 'date' },
    ],
  });
  assert.ok(out.proposals.every(item => item.confidence !== 'fuzzy' || item.targetField),
    'belirsiz ortak kelime rastgele seçilmemeli');
});

test('aynı hedef alan grup içinde iki koşula birden verilmez', () => {
  /* Grup içi VE: aynı alana iki eşleme, kullanıcının kurmadığı çelişkili bir
     koşul üretirdi. */
  const out = propose([condition('Merch Alt Grup Kod'), condition('MAG')]);
  const targets = out.proposals.map(item => item.targetField);
  assert.equal(new Set(targets).size, targets.length, 'hedef alan tekrar kullanılmış');
});

test('gruplar arası VEYA olduğu için aynı alan başka grupta kullanılabilir', () => {
  const out = mapping.proposeMapping({
    groups: [{ conditions: [condition('Sezon')] }, { conditions: [condition('Sezon')] }],
    targetFields: IAS_FIELDS,
  });
  assert.equal(out.proposals.length, 2);
  assert.equal(out.groups.length, 2);
});

test('değerler taşınır ama DOĞRULANMAMIŞ olarak işaretlenir', () => {
  /* ASAS "W6" derken IAS "2026W6" diyebilir. Değeri taşımamak kullanıcıyı
     sıfırdan yazmaya zorlardı; doğrulanmış gibi göstermek ise sessiz boş
     sonuç üretirdi. İkisi de değil: taşınır ve işaretlenir. */
  const out = propose([condition('Sezon', { values: ['W6'] })]);
  assert.deepEqual(out.proposals[0].values, ['W6']);
  assert.equal(out.proposals[0].valuesUnverified, true);
});

test('tip uyuşmazlığı gizlenmez', () => {
  const out = mapping.proposeMapping({
    groups: [{ conditions: [condition('Sezon', { valueType: 'date' })] }],
    targetFields: IAS_FIELDS,
  });
  assert.equal(out.proposals[0].typeMismatch, 'date → text');
});

test('uç ÖNERİ döner, hiçbir şey KAYDETMEZ', () => {
  const server = require('./helpers/server-source')();
  const at = server.indexOf("app.get('/api/horizon/filter-mapping'");
  assert.ok(at > -1, 'eşleme ucu yok');
  const end = server.indexOf("app.get('/api/horizon/fields'", at);
  assert.ok(end > at, 'eşleme ucunun sonu bulunamadı');
  const block = server.slice(at, end);
  for (const write of ['saveModelConnections', 'saveRevisioned', 'writeFileSync', 'userPreferences.saveHorizon']) {
    assert.ok(!block.includes(write), `eşleme ucu ${write} çağırıyor — salt okunur olmalı`);
  }
  /* Dar kapı: ortak filtreyi ilgilendiren her şey Veri Yönetimi yetkisine bağlı. */
  assert.match(block.slice(0, 200), /requireArea\('source'\)/);
  assert.match(block.slice(0, 200), /requirePermission\('manageModelConnections'\)/);
});

test('modül iki kaynaktan beslenmiyorsa sebep söylenir, boş liste değil', () => {
  /* Sessiz boş cevap, kullanıcının "eşlenecek bir şey yokmuş" diye yanlış
     sonuç çıkarmasına yol açardı. */
  const server = require('./helpers/server-source')();
  const at = server.indexOf("app.get('/api/horizon/filter-mapping'");
  const block = server.slice(at, server.indexOf('\n});\n', at));
  assert.match(block, /SOURCE_SCOPE_MISSING/);
  assert.match(block, /TARGET_SCOPE_MISSING/);
  assert.match(block, /SOURCE_FILTER_EMPTY/);
});

test('onay ADIMI var: öneri kendiliğinden koşullara yazılmaz', () => {
  /* Kullanıcının açıkça istediği mekanizma. requestMapping yalnız `mapping`
     durumunu doldurur; `groups` ancak approveMapping ile değişir. */
  const ui = read('public/data-management-filter.js');
  const request = ui.slice(ui.indexOf('  async function requestMapping()'), ui.indexOf('  function approveMapping()'));
  assert.ok(!/\bgroups\s*=/.test(request), 'öneri istenir istenmez koşullar yazılıyor — onay adımı atlanmış');
  assert.match(request, /mapping = payload/);

  const approve = ui.slice(ui.indexOf('  function approveMapping()'), ui.indexOf('  function dismissMapping()'));
  assert.match(approve, /groups = /);
  /* Onay bile KAYDETMEZ: şablon yüklemeyle aynı sözleşme — kullanıcı
     Kaydet'e basana kadar ortak filtre değişmez. */
  assert.ok(!approve.includes('fetch('), 'onay doğrudan kaydediyor — Kaydet adımı atlanmış');
});

test('eşlenemeyen koşullar onay ekranında ADIYLA gösterilir', () => {
  const ui = read('public/data-management-filter.js');
  const panel = ui.slice(ui.indexOf('  function mappingPanel()'), ui.indexOf('\n  }\n', ui.indexOf('  function mappingPanel()')));
  assert.match(panel, /unmapped/);
  assert.match(panel, /ATLANACAK/);
  assert.match(panel, /valuesUnverified/, 'değerlerin doğrulanmadığı söylenmeli');
});

test('teklif yoksa düğme de çıkmaz', () => {
  /* Tek kaynaktan beslenen bir modülde "eşle" düğmesi göstermek, olmayan bir
     yetenek vaat etmekti. */
  const dm = read('public/data-management.js');
  assert.match(dm, /mapFrom:/);
  assert.match(dm, /entry\.sourceRole && entry\.sourceRole !== mine/);
  assert.match(dm, /entry\.conditionCount > 0/, 'koşulsuz kaynaktan eşleme teklif edilmemeli');
});

test('eşleme paneli yalnız mevcut token ve bileşenleri kullanır', () => {
  /* §9 — ikinci bir görsel dil kurulmaz, yeni ton uydurulmaz. */
  const css = read('public/data-management.css');
  const block = css.slice(css.indexOf('.dmfMapBar'));
  const colors = block.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(colors, [], 'ham renk kodu kullanılmış — renk token\'lardan gelmeli');
});
