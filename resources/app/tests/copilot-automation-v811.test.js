'use strict';

/*
 * COPILOT — DOĞAL DİLDEN OTOMASYON
 *
 * Kullanıcı isteği: "otomasyon ekranı kullanıcılar için kullanımı zor.
 * otomasyonu manuel oluşturmaktansa yapay zeka asistanına derdini anlatıp
 * otomasyonu asistana hazırlatmasını istiyorum."
 *
 * Bu yolun tehlikesi belli: bir otomasyon, kurulduktan sonra kimse bakmadan
 * HAFTALARCA çalışır. Yanlış kurulmuş bir tarif, yanlış bir cevaptan daha
 * uzun ömürlüdür — hatalı e-posta her hafta yeniden gider ya da beklenen
 * e-posta hiç gitmez. Bu yüzden testlerin tamamı tek bir soruyu sorar:
 * "asistan tahmin ediyor mu, yoksa soruyor mu?"
 *
 * Ayrıca istemci tarafının ürettiği değerlerin sunucunun KABUL ETTİĞİ değerler
 * olduğu doğrulanır. Sessizce varsayılana düşen bir alan, kullanıcıya
 * gösterilen önizlemeyi yalana çevirir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const COPILOT = fs.readFileSync(path.join(ROOT, 'public', 'copilot.js'), 'utf8');
const RECIPE_STORE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'automation-recipe-store.js'), 'utf8');
const actions = require('../public/copilot-actions.js');

const GROUPS = [
  { id: 'mailgrp_1', name: 'LCW' },
  { id: 'mailgrp_2', name: 'İhracat LCW' },
  { id: 'mailgrp_3', name: 'Planlama' },
];

/* copilot.js bir IIFE; tarayıcı olmadan yüklemek için asgari bir global yeter.
   Yükleme anında DOM'a dokunmaz — dokunsaydı bu satır patlardı, ki bu da
   "panel hiçbir açılış işi üstlenmez" kuralının ayrı bir kanıtı olurdu. */
function loadCopilot(overrides = {}) {
  const context = {
    console,
    setTimeout,
    document: { addEventListener() {} },
    fetch: () => Promise.reject(new Error('bu testte ağ çağrısı beklenmiyor')),
    BLCopilotActions: actions,
    ...overrides,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(COPILOT, context, { filename: 'copilot.js' });
  return context.BLCopilot._test;
}

const copilot = loadCopilot();

/* vm bağlamındaki diziler farklı bir realm'e ait; deepStrictEqual prototip
   kimliğine bakar. JSON'a indirgemek yapıyı karşılaştırmayı sürdürürken bu
   yanlış negatifi kaldırır. */
const plain = value => JSON.parse(JSON.stringify(value));

/* -------------------------------------------------------- NİYET ÇÖZÜMLEME */

test('otomasyon olmayan soru otomasyon yoluna girmez', () => {
  // Fiyat sorusu yanlışlıkla tarif oluşturma akışına düşerse, kullanıcı
  // beklediği cevabı değil bir onay kutusu görürdü.
  for (const question of ['S7 T-Shirt için en uygun üretici kim?', 'ORD 12345 not: acele']) {
    assert.equal(copilot.parseAutomationIntent(question, GROUPS), null, question);
  }
});

test('tam cümle doğru gün, kaynak, grup ve filtreye çözülür', () => {
  const intent = copilot.parseAutomationIntent(
    'her pazartesi 09:00 ihracat lcw mail grubuna cpdeki tarihi geçmiş siparişler için hatırlatma maili taslağı oluştur',
    GROUPS);
  assert.equal(intent.day.index, 1);
  assert.equal(intent.source, 'cp');
  assert.equal(intent.group.id, 'mailgrp_2');
  assert.equal(intent.overdue, true);
  assert.equal(intent.time, '09:00');
});

test('grup adı eşleşmesinde EN UZUN ad kazanır', () => {
  /* "İhracat LCW" cümlesi "LCW" grubunu da içerir. Kısa eşleşme kazansaydı,
     hatırlatma her hafta YANLIŞ ekibe giderdi ve kimse fark etmezdi. */
  const intent = copilot.parseAutomationIntent('her cuma ihracat lcw grubuna cp raporu gönder', GROUPS);
  assert.equal(intent.group.name, 'İhracat LCW');
});

test('kayıtlı olmayan bir grup UYDURULMAZ', () => {
  const intent = copilot.parseAutomationIntent('her salı satınalma ekibine cp raporu at', GROUPS);
  assert.equal(intent.group, undefined, 'eşleşmeyen grup için tahmin üretilmemeli');
});

test('gün ya da kaynak söylenmediyse boş bırakılır, varsayılan atanmaz', () => {
  const noDay = copilot.parseAutomationIntent('otomasyon kur, lcw grubuna cp raporu', GROUPS);
  assert.equal(noDay.day, undefined);
  const noSource = copilot.parseAutomationIntent('her pazartesi lcw grubuna hatırlatma', GROUPS);
  assert.equal(noSource.source, '');
});

test('iki ekran adı geçiyorsa hiçbiri seçilmez', () => {
  /* "cp ve backlog" diyen cümlede birini tutmak, kullanıcının hangisini
     kastettiğini bilmeden karar vermektir; otomasyon her hafta yanlış
     tablodan rapor üretirdi. */
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp ve backlog raporu gönder', GROUPS);
  assert.equal(intent.source, '');
});

test('genel isimler ekran adı sayılmaz', () => {
  /* "siparişler" bir ekran adı değil, satırların ne olduğudur. Ekran adı
     sayılsaydı "cpdeki geciken siparişler" cümlesi orders ekranını seçerdi. */
  assert.equal(copilot.parseAutomationIntent('her pazartesi lcw grubuna geciken siparişleri hatırlat', GROUPS).source, '');
  assert.equal(copilot.parseAutomationIntent('her pazartesi lcw grubuna siparişler ekranından rapor gönder', GROUPS).source,
    'orders', 'ekran açıkça söylendiğinde tanınmalı');
});

test('Türkçe ek almış ekran adları tanınır', () => {
  for (const question of ['cpdeki', "cp'deki", 'cpden', 'cp']) {
    assert.equal(copilot.parseAutomationIntent(`her pazartesi lcw grubuna ${question} raporu gönder`, GROUPS).source,
      'cp', question);
  }
});

test('saat verilmediyse 09:00 kullanılır, uydurulmuş bir saat değil', () => {
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  assert.equal(intent.time, '');
  assert.equal(copilot.automationRecipePayload(intent).time, '09:00');
});

test('geçersiz saat okunmaz; sunucunun reddedeceği bir değer önizlenmez', () => {
  /* Sunucu 29:00'ı sessizce 09:00'a düşürür. Önizleme 29:00 deseydi,
     kullanıcı görmediği bir şeyi onaylamış olurdu. */
  const intent = copilot.parseAutomationIntent('her pazartesi 29:00 lcw grubuna cp raporu', GROUPS);
  assert.equal(intent.time, '');
});

/* ------------------------------------------------------------- TESLİMAT */

test('teslimat varsayılanı TASLAK', () => {
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp hatırlatması', GROUPS);
  assert.equal(intent.deliveryMode, 'draft');
});

test('otomatik gönderim yalnız açıkça istendiğinde seçilir', () => {
  const send = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  assert.equal(send.deliveryMode, 'outlook_send');
  const draft = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu taslağı gönder', GROUPS);
  assert.equal(draft.deliveryMode, 'draft', 'taslak denmişse gönderim seçilmemeli');
});

test('üretilen deliveryMode değerlerini sunucu GERÇEKTEN tanır', () => {
  /* Sunucu tanımadığı değeri sessizce "draft"a düşürür. İstemci 'send'
     üretseydi, "GÖNDERİLİR" yazan önizlemenin ardından taslak oluşurdu —
     yani kullanıcıya yalan söylenmiş olurdu. Bu test iki tarafın sabitlerini
     birbirine bağlar; biri değişirse burası kırılır. */
  const allowed = /\['draft','([a-z_]+)'\]\.includes\(clean\(item\.deliveryMode\)\)/.exec(RECIPE_STORE);
  assert.ok(allowed, 'sunucudaki teslimat sabitleri okunabilmeli');
  assert.match(COPILOT, new RegExp(`'${allowed[1]}':'draft'`),
    `istemci sunucunun tanıdığı '${allowed[1]}' değerini üretmeli`);
});

/* --------------------------------------------------------------- TARİF */

test('geciken filtresi SABİT TARİH GÖMMEZ', () => {
  /* Kurulum günü değere gömülseydi, haftalık çalışan hatırlatma o günden
     sonra geciken siparişleri hiç görmezdi: rapor her hafta biraz daha
     eksilir, hatalı e-posta değil EKSİK e-posta gider. */
  const intent = copilot.parseAutomationIntent(
    'her pazartesi lcw grubuna cpdeki tarihi geçmiş siparişleri hatırlat', GROUPS);
  const payload = copilot.automationRecipePayload(intent);
  assert.deepEqual(plain(payload.filters), [{ field: 'Retail Date', operator: 'lt', value: '@today' }]);
  assert.doesNotMatch(JSON.stringify(payload), /\d{4}-\d{2}-\d{2}/, 'takvim tarihi gömülmemeli');
});

test('geciken denmediyse filtre eklenmez', () => {
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  assert.deepEqual(plain(copilot.automationRecipePayload(intent).filters), []);
});

test('Pazar (index 0) geçerli bir gündür ve eksik alan sayılmaz', () => {
  /* weekday sayı olarak taşınsaydı 0 "boş" gibi görünür ve öneri
     "eksik alan" diye reddedilirdi. */
  const intent = copilot.parseAutomationIntent('her pazar lcw grubuna cp raporu gönder', GROUPS);
  const payload = copilot.automationRecipePayload(intent);
  assert.equal(payload.weekday, '0');
  assert.equal(actions.propose({ type: 'automation.recipe.create', payload }, { hasArea: () => true }).ok, true);
});

/* ------------------------------------------------------ ÖNERİ VE ONAY */

test('eksik grup ile öneri üretilemez', () => {
  const payload = { name: 'x', source: 'cp', emailGroupId: '', weekday: '1', time: '09:00' };
  const proposal = actions.propose({ type: 'automation.recipe.create', payload }, { hasArea: () => true });
  assert.equal(proposal.ok, false);
  assert.deepEqual(proposal.missing, ['emailGroupId']);
});

test('automations yetkisi olmayan kullanıcı otomasyon öneremez', () => {
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  const proposal = actions.propose(
    { type: 'automation.recipe.create', payload: copilot.automationRecipePayload(intent) },
    { hasArea: area => area !== 'automations' });
  assert.equal(proposal.ok, false);
  assert.equal(proposal.area, 'automations');
});

test('ONAY OLMADAN hiçbir tarif oluşturulmaz', async () => {
  let called = false;
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  const proposal = actions.propose(
    { type: 'automation.recipe.create', payload: copilot.automationRecipePayload(intent) },
    { hasArea: () => true });
  const result = await actions.apply(proposal, { proposalId: proposal.proposalId, confirmed: false },
    { writers: { 'automation.recipe.create': async () => { called = true; } } });
  assert.equal(result.status, actions.STATUS.REJECTED);
  assert.equal(called, false, 'onaylanmayan öneri kayıt yoluna HİÇ ulaşmamalı');
});

test('başka bir öneriye verilen onay kabul edilmez', async () => {
  let called = false;
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  const proposal = actions.propose(
    { type: 'automation.recipe.create', payload: copilot.automationRecipePayload(intent) },
    { hasArea: () => true });
  const result = await actions.apply(proposal, { proposalId: 'başka-öneri', confirmed: true },
    { writers: { 'automation.recipe.create': async () => { called = true; } } });
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

/* ------------------------------------------------------------ KAYIT */

test('onaylanan tarif mevcut otomasyon ucuna kaydedilir', async () => {
  /* Ayrı bir kayıt yolu açılsaydı zamanlayıcı, gecikmiş tetik koruması ve
     audit atlanırdı. Bu test isteğin gerçekten var olan uca gittiğini ve
     alanların yolda kaybolmadığını doğrular. */
  let sent = null;
  const scoped = loadCopilot({
    fetch: (url, options) => {
      sent = { url, body: JSON.parse(options.body) };
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, recipe: { id: 'recipe_1' } }) });
    },
  });
  const intent = copilot.parseAutomationIntent(
    'her pazartesi 08:30 ihracat lcw grubuna cpdeki tarihi geçmiş siparişleri hatırlat', GROUPS);
  const payload = copilot.automationRecipePayload(intent);
  const proposal = actions.propose({ type: 'automation.recipe.create', payload }, { hasArea: () => true });

  const applied = await actions.apply(
    proposal, { proposalId: proposal.proposalId, confirmed: true },
    { writers: loadWriters(scoped) });

  assert.equal(applied.ok, true, applied.reason || '');
  assert.equal(sent.url, '/api/automations/recipes');
  assert.equal(sent.body.purpose, 'email');
  assert.equal(sent.body.source, 'cp');
  assert.equal(sent.body.email.groupId, 'mailgrp_2');
  assert.equal(sent.body.email.deliveryMode, 'draft');
  assert.equal(sent.body.schedule.mode, 'weekly');
  assert.deepEqual(sent.body.schedule.weekdays, [1]);
  assert.equal(sent.body.schedule.time, '08:30');
  assert.equal(sent.body.schedule.enabled, true);
  assert.deepEqual(sent.body.filters, [{ field: 'Retail Date', operator: 'lt', value: '@today' }]);
});

test('sunucu hatası BAŞARI olarak gösterilmez', async () => {
  const scoped = loadCopilot({
    fetch: () => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: 'E-posta grubu seçin.', code: 'AUTOMATION_EMAIL_GROUP_REQUIRED' }),
    }),
  });
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  const proposal = actions.propose(
    { type: 'automation.recipe.create', payload: copilot.automationRecipePayload(intent) },
    { hasArea: () => true });
  const applied = await actions.apply(proposal, { proposalId: proposal.proposalId, confirmed: true },
    { writers: loadWriters(scoped) });
  assert.equal(applied.ok, false);
  assert.equal(applied.status, actions.STATUS.FAILED);
  assert.match(applied.reason, /E-posta grubu/);
});

/* ------------------------------------------------------------ ÖNİZLEME */

test('önizleme grubu, günü, saati ve teslimat kipini AÇIKÇA yazar', () => {
  const intent = copilot.parseAutomationIntent(
    'her pazartesi 09:00 ihracat lcw grubuna cpdeki tarihi geçmiş siparişleri hatırlat', GROUPS);
  const proposal = actions.propose(
    { type: 'automation.recipe.create', payload: copilot.automationRecipePayload(intent) },
    { hasArea: () => true });
  const html = copilot.renderProposal(proposal);
  assert.match(html, /İhracat LCW/);
  assert.match(html, /Pazartesi/);
  assert.match(html, /09:00/);
  assert.match(html, /gönderilmez/, 'taslak kipinde e-posta gitmeyeceği yazmalı');
  assert.match(html, /data-bcp-confirm/, 'onay düğmesi olmalı');
});

test('otomatik gönderim önizlemede saklanmaz', () => {
  const intent = copilot.parseAutomationIntent('her pazartesi lcw grubuna cp raporu gönder', GROUPS);
  const proposal = actions.propose(
    { type: 'automation.recipe.create', payload: copilot.automationRecipePayload(intent) },
    { hasArea: () => true });
  assert.match(copilot.renderProposal(proposal), /OTOMATİK GÖNDERİLİR/);
});

/* Kayıt yolunun KENDİSİ çalıştırılır; teste bir kopyası yazılmaz. Kopya
   yazılsaydı test, uygulamanın gerçekte gönderdiği isteği değil kendi
   varsayımını doğrulardı. */
function loadWriters(scoped) {
  return { 'automation.recipe.create': payload => scoped.automationWriter(payload) };
}
