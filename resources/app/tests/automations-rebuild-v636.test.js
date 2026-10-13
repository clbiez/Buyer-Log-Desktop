'use strict';

/* v6.36 — Agents kaldırma, alıcı çözümleme, adres defteri birleşimi ve
 * kaçırılan tetikler.
 *
 * En kritik iki madde:
 * (1) Adres defteri iki kaynağın birleşimi. Eskiden yalnız çalışma alanındaki
 *     üretici e-postaları okunuyordu; kullanıcının elle eklediği adresler
 *     (lcw.prodstatus.mails.*) görünmüyordu. Oraya kurulan planlı bir otomasyon
 *     alıcıyı bulamayıp SESSİZCE boş alıcıyla kalırdı.
 * (2) Kaçırılan tetikler. Eski davranış tutarsızdı: aynı gün geç açılışta tetik
 *     sessizce geç çalışıyor, farklı gün açılışta sessizce kayboluyordu.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const STORE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'automation-recipe-store.js'), 'utf8');
const EMAIL = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'automation-email.js'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'automations.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const recipeStore = require(path.join(ROOT, 'server', 'lib', 'automation-recipe-store.js'));

function bodyOf(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  let paren = 0, i = source.indexOf('(', start);
  for (; i < source.length; i++) {
    if (source[i] === '(') paren++;
    else if (source[i] === ')' && --paren === 0) break;
  }
  const open = source.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}' && --depth === 0) return source.slice(open + 1, j);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

/* ------------------------------------------------------ 1) AGENTS KALDIRILDI */

test('v6.36 Agents arayüzü tamamen kaldırıldı', () => {
  assert.doesNotMatch(INDEX, /data-tab="agents"/);
  assert.doesNotMatch(INDEX, /id="view-agents"/);
  assert.doesNotMatch(INDEX, /agent-workflows\.js/);
  assert.equal(fs.existsSync(path.join(ROOT, 'public', 'agent-workflows.js')), false);
});

test('v6.36 tarayıcı motoru KORUNDU — PLM ve terminal ona bağlı', () => {
  // Agents ile birlikte silinseydi PLM köprü/görsel akışı da giderdi.
  assert.ok(fs.existsSync(path.join(ROOT, 'server', 'lib', 'agent-browser-connector.js')));
  assert.ok(fs.existsSync(path.join(ROOT, 'server', 'lib', 'portable-web-engine.js')));
  for (const route of ['/api/automations/browser/status', '/api/automations/browser/open']) {
    assert.ok(SERVER.includes(route), route);
  }
});

/* -------------------------------------------------- 2) ADRES DEFTERİ BİRLEŞİMİ */

test('v6.36 adres defteri iki kaynağı birleştiriyor', () => {
  const block = bodyOf(SERVER, 'automationAddressBookEntries');
  assert.match(block, /workspace&&workspace\.manufacturers/, 'çalışma alanı kaynağı');
  assert.match(block, /lcw\.prodstatus\.mails\./, 'tercihlerdeki adresler');
  // Aynı ad iki kaynakta varsa çalışma alanı kazanmalı: ilk ekleyen kazanır ve
  // çalışma alanı önce işlenir.
  assert.match(block, /if\(out\.has\(key\)\)return;/);
  const wsAt = block.indexOf('workspace.manufacturers');
  const prefAt = block.indexOf('lcw.prodstatus.mails.');
  assert.ok(wsAt >= 0 && prefAt > wsAt, 'çalışma alanı önce okunmalı');
  // Kaydın nereden geldiği taşınmalı; teşhis için gerekli.
  assert.match(block, /origin/);
});

test('v6.36 geçersiz e-posta ve boş ad adres defterine girmiyor', () => {
  const add = new Function('AUTOMATION_EMAIL_RE', `
    const out=new Map();
    const automationEmailGroupId=(n,e)=>n+'|'+e;
    ${bodyOf(SERVER, 'automationAddressBookEntries').match(/const add=[\s\S]*?\n  \};/)[0]}
    return {add,out};
  `)(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  add.add('Üretici A', 'a@x.com', 'workspace');
  add.add('', 'b@x.com', 'workspace');          // ad yok
  add.add('Üretici C', 'bozuk-adres', 'workspace'); // e-posta geçersiz
  add.add('Üretici A', 'baska@x.com', 'preferences'); // aynı ad, ikinci kaynak
  assert.equal(add.out.size, 1);
  assert.equal(add.out.get('üretici a').to[0], 'a@x.com', 'ilk kaynak kazanmalı');
});

/* ---------------------------------------------------- 3) ALICI ÇÖZÜMLEME KİPİ */

test('v6.36 tarif şeması alıcı kipini taşıyor', () => {
  const recipe = recipeStore.normalizeRecipe({
    purpose: 'email',
    email: { recipientMode: 'field', recipientField: 'Üretici', groupId: 'g1' },
  }, 'owner');
  assert.equal(recipe.email.recipientMode, 'field');
  assert.equal(recipe.email.recipientField, 'Üretici');
  // Varsayılan eski davranış olmalı; kayıtlı tarifler bozulmamalı.
  const legacy = recipeStore.normalizeRecipe({ purpose: 'email', email: { groupId: 'g1' } }, 'owner');
  assert.equal(legacy.email.recipientMode, 'group');
  // Tanınmayan kip sessizce güvenli tarafa düşmeli.
  const bogus = recipeStore.normalizeRecipe({ purpose: 'email', email: { recipientMode: 'sacma' } }, 'owner');
  assert.equal(bogus.email.recipientMode, 'group');
});

test('v6.36 alana göre bölme çözülemeyen değerleri ATMIYOR', () => {
  // v4.09 dersi: bu zincirde hatalar sessiz. Karşılığı bulunamayan üretici/ülke
  // sessizce düşerse kullanıcı e-posta gitmediğini hiç fark etmez.
  const block = bodyOf(SERVER, 'automationSplitRecipients');
  assert.match(block, /unresolved\.push/);
  assert.match(block, /return \{field,resolved,unresolved\}/);
  // Hiçbiri çözülemezse gönderim tamamen kesilmeli.
  assert.match(fs.readFileSync(path.join(ROOT,'server','lib','automation-execution-service.js'),'utf8'), /AUTOMATION_RECIPIENTS_UNRESOLVED/);
  // Çözülemeyenler sonuca taşınmalı.
  assert.match(fs.readFileSync(path.join(ROOT,'server','lib','automation-execution-service.js'),'utf8'), /result\.unresolvedRecipients=split\.unresolved/);
});

test('v6.36 iki alıcı kipi de tek gönderim yolundan geçiyor', () => {
  // İki alıcı kipi farklı taslak yollarına ayrışırsa biri sessizce farklı davranır.
  const executor=fs.readFileSync(path.join(ROOT,'server','lib','automation-execution-service.js'),'utf8');
  assert.match(SERVER,/createAutomationExecutor/);
  const block=executor.slice(executor.indexOf("if(['email','mixed'].includes(purpose)){"));
  // v9.47: imzaya dil satırları eklendi (subjectBase/langRows) ama gönderimi
  // yürüten TEK fonksiyon olma özelliği korunuyor — asıl korunan kusur bu.
  assert.match(block, /const deliver=async\(group,subjectBase,mailRows,langRows\)=>\{/);
  assert.equal((block.match(/automationEmail\.createDraft\(/g) || []).length, 1, 'taslak oluşturma tek yerde kalmalı');
  assert.match(block, /if\(email\.recipientMode==='field'\)\{/);
  assert.match(block, /result\.emails=messages/);
});

test('v6.36 alıcısı eksik otomasyon KAYDEDİLEMİYOR', () => {
  // Eksiklik kayıtta kesilmezse hata ancak planlı saatte, e-posta gelmeyince
  // fark edilir.
  assert.match(SERVER,/automationDefinition\.normalize/);
  const definition=fs.readFileSync(path.join(ROOT,'server','lib','automation-definition-service.js'),'utf8');
  const block=bodyOf(definition,'automationNormalizePayload');
  assert.match(block, /AUTOMATION_RECIPIENT_FIELD_REQUIRED/);
  assert.match(block, /AUTOMATION_EMAIL_GROUP_REQUIRED/);
});

test('v6.36 alıcı kipi arayüzden seçilebiliyor', () => {
  assert.match(UI, /data-email-recipient-mode/);
  assert.match(UI, /data-email-recipient-field/);
  // Kip değişince bölüm yeniden çizilmeli: grup seçici ile alan seçici yer değiştirir.
  assert.match(UI, /data-email-recipient-mode.*renderEditorPreserveScroll\(\)/s);
});

/* ------------------------------------------------------ 4) KAÇIRILAN TETİKLER */

test('v6.36 gecikmiş tetik tolerans penceresine göre sınıflanıyor', () => {
  const fn=require('../server/lib/automation-schedule-service');
  const recipe = { enabled: true, purpose: 'email', schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1] } };
  // 2026-08-24 bir Pazartesi. Saatler YEREL kurulur; test saat dilimine bağlı olmamalı.
  const onTime = fn.automationDueOccurrence(recipe, new Date(2026, 7, 24, 9, 30));
  assert.equal(fn.automationDueOccurrence({...recipe,purpose:'analysis'}, new Date(2026, 7, 24, 9, 30)),null);
  assert.ok(fn.automationDueOccurrence({...recipe,purpose:'analysis'}, new Date(2026, 7, 24, 9, 30),{}));
  assert.equal(fn.automationDueOccurrence({...recipe,purpose:'mixed',steps:[{action:'script'}]}, new Date(2026, 7, 24, 9, 30)),null);
  assert.equal(fn.automationIsWithinGrace(onTime), true, '30 dk gecikme tolerans içinde');
  const late = fn.automationDueOccurrence(recipe, new Date(2026, 7, 24, 14, 0));
  assert.equal(fn.automationIsWithinGrace(late), false, '5 saat gecikme kaçırılmış sayılmalı');
  // Farklı gün açılışta Pazartesi'nin tetiği hâlâ BULUNMALI — eskiden sessizce kaybolurdu.
  const nextDays = fn.automationDueOccurrence(recipe, new Date(2026, 7, 26, 10, 0));
  assert.ok(nextDays, 'geriye dönük tarama Pazartesi tetiğini bulmalı');
  assert.equal(nextDays.dueAt.getDate(), 24);
  assert.equal(fn.automationIsWithinGrace(nextDays), false);
});

test('v6.36 zamanlayıcı tolerans dışındaki tetiği sessizce çalıştırmıyor', () => {
  const block = bodyOf(SERVER, 'runScheduledAutomations');
  assert.match(block, /if\(occurrence\?\.key===key&&!automationIsWithinGrace\(occurrence\)\)continue;/);
});

test('v6.36 kaçırılan tetik uçları var ve tetik önce işaretleniyor', () => {
  for (const route of [
    "app.get('/api/automations/pending-triggers'",
    "app.post('/api/automations/pending-triggers/run'",
    "app.post('/api/automations/pending-triggers/skip'",
  ]) assert.ok(SERVER.includes(route), route);
  const runBlock = SERVER.slice(SERVER.indexOf("app.post('/api/automations/pending-triggers/run'"));
  assert.match(runBlock,/automationScheduledRunner\(req\.currentUser,recipe,item\.key/);
  const runner=fs.readFileSync(path.join(ROOT,'server','lib','automation-scheduled-runner.js'),'utf8');
  const markAt = runner.indexOf('store.markSchedule');
  const execAt = runner.indexOf('await execute');
  // Tetik ÖNCE işaretlenmeli: çalışma hata verse bile aynı tetik döngüye girip
  // tekrar tekrar denenmemeli.
  assert.ok(markAt >= 0 && execAt > markAt, 'tetik çalıştırmadan önce işaretlenmeli');
});

test('v6.36 kaçırılan çalışma geçmişte manuel görünmüyor', () => {
  // normalizeRun trigger listesi 'missed' içermezse kullanıcı onayıyla çalışan
  // kaçırılmış otomasyon geçmişte ELLE çalıştırılmış gibi görünürdü.
  assert.match(STORE, /\['manual','schedule','missed'\]\.includes\(clean\(item\.trigger\)\)/);
  const run = recipeStore.normalizeRun({ trigger: 'missed' });
  assert.equal(run.trigger, 'missed');
});

test('v6.36 kaçırılan tetikler kullanıcıya soruluyor', () => {
  assert.match(UI, /autoPendingBanner/);
  assert.match(UI, /pending-triggers\/run/);
  assert.match(UI, /pending-triggers\/skip/);
  assert.match(UI, /data-pending-run/);
  assert.match(UI, /data-pending-skip/);
  // Açılışta yüklenmeli, yoksa kullanıcı bekleyeni hiç görmez.
  assert.match(UI, /renderAll\(\);loadPendingTriggers\(\);/);
});

/* ------------------------------------------------------------- 5) ZAMANLAMA B */

test('v6.36 tek tur kipi işini bitirince kendi kapanıyor', () => {
  // Zamanlayıcı betiğinin süre tahmin edip süreci dışarıdan öldürmesi kırılgandı.
  assert.match(SERVER, /process\.env\.BL_AUTOMATION_RUN === '1'/);
  const block = SERVER.slice(SERVER.indexOf("process.env.BL_AUTOMATION_RUN === '1'"));
  assert.match(block.slice(0, 900), /runScheduledAutomations\(\)/);
  assert.match(block.slice(0, 900), /process\.exit\(0\)/);
});

test('v6.36 zamanlama uygulama içindeki Node zamanlayıcıyı kullanıyor', () => {
  assert.match(SERVER, /runScheduledAutomations\(\)/);
  assert.match(SERVER, /setInterval\(\(\)=>runScheduledAutomations/);
});

/* ------------------------------------------- 6) v6.37 PANO ve OLUŞTURMA YOLU */

test('v6.37 kaçırılan tetik afişi çalışma zamanında gerçekten üretiliyor', () => {
  // TUZAK: node --check yalnız SÖZDİZİMİNE bakar. Şablon içinde tanımsız bir
  // değişkene ( ${q} gibi ) atıfta bulunmak sözdizimsel olarak geçerlidir ama
  // afiş çizilirken ReferenceError atar ve panel sessizce boş kalır.
  assert.doesNotMatch(UI, /\$\{q\}/);
  const body = bodyOf(UI, 'renderPendingTriggers');
  let html = '';
  const host = { hidden: true, set innerHTML(v) { html = v; }, get innerHTML() { return html; }, querySelector: () => ({ set onclick(_v) {} }) };
  const fn = new Function('esc', 'tr', 'fmtDate', 'pendingTriggers', 'document', 'api', 'state', 'renderAll', 'toast',
    `function renderPendingTriggers(){${body}} return renderPendingTriggers;`);
  fn(v => String(v == null ? '' : v), a => a, v => String(v),
    [{ name: 'Test', dueAt: '2026-08-24T09:00:00Z', lateMinutes: 300 }],
    { getElementById: () => host }, null, null, () => {}, () => {})();
  assert.match(html, /autoPendingCard/);
  assert.match(html, /data-pending-run/);
});

test('v6.37 tarif özeti düz cümleyle kuruluyor', () => {
  const describe = new Function('tr', 'sourceLabel', 'groups', 'WEEKDAY_LABELS_TR', 'WEEKDAY_LABELS_EN',
    `function describeRecipe(item){${bodyOf(UI, 'describeRecipe')}} return describeRecipe;`)(
    (a) => a, (s) => ({ cp: 'CP' }[s] || s), () => [{ id: 'g1', name: 'Mısır İhracat' }],
    ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'], []);

  const split = describe({
    purpose: 'email', source: 'cp', filters: [{}, {}],
    schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1] },
    email: { recipientMode: 'field', recipientField: 'Üretici' },
  });
  assert.match(split, /Her Pazartesi 09:00/);
  assert.match(split, /2 koşula uyan/);
  assert.match(split, /Üretici alanına göre gruplanıp/);

  const fixed = describe({
    purpose: 'email', source: 'cp', filters: [],
    schedule: { enabled: true, mode: 'daily', time: '08:30' }, email: { groupId: 'g1' },
  });
  assert.match(fixed, /Her gün 08:30/);
  assert.match(fixed, /Mısır İhracat grubuna/);

  // Planlı olmayan otomasyon "elle çalıştırıldığında" demeli, boş kalmamalı.
  assert.match(describe({ purpose: 'analysis', source: 'backlog', filters: [{}], schedule: {} }), /Elle çalıştırıldığında/);
});

test('v6.37 sıradaki çalışma ileriye bakıyor', () => {
  const nextRunAt = new Function(`function nextRunAt(item){${bodyOf(UI, 'nextRunAt')}} return nextRunAt;`)();
  const next = nextRunAt({ enabled: true, schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1] } });
  assert.ok(next instanceof Date);
  assert.equal(next.getDay(), 1, 'haftalık tetik Pazartesi olmalı');
  assert.ok(next > new Date(), 'her zaman GELECEKTE bir zaman dönmeli');
  // Kapalı otomasyonun sıradaki çalışması olmamalı.
  assert.equal(nextRunAt({ enabled: false, schedule: { enabled: true, mode: 'daily', time: '09:00' } }), null);
  assert.equal(nextRunAt({ enabled: true, schedule: { enabled: false } }), null);
});

test('v6.37 oluşturma iki yola ayrılıyor ve Terminal moderatöre kilitli', () => {
  assert.match(UI, /function showCreatePicker\(\)/);
  assert.match(UI, /data-create-path="simple"/);
  assert.match(UI, /data-create-path="terminal"/);
  const block = bodyOf(UI, 'showCreatePicker');
  // Yetki kontrolü hem düğmeyi kilitlemeli hem de tıklamayı bağlamamalı;
  // yalnız görsel kilit yeterli değil.
  assert.match(block, /const canTerminal=Boolean\(state&&state\.canConfigure\)/);
  assert.match(block, /if\(canTerminal\)terminalBtn\.onclick=/);
  // Yeni Otomasyon düğmesi artık doğrudan tür seçiciye değil yol seçiciye gitmeli.
  assert.match(UI, /\[data-auto-new\]'\)\.onclick=showCreatePicker/);
});

test('v6.37 pano sayıları son 7 günle sınırlı', () => {
  const stats = new Function('runList', 'recipeList',
    `function dashboardStats(){${bodyOf(UI, 'dashboardStats')}} return dashboardStats;`);
  const now = Date.now();
  const runs = [
    { createdAt: new Date(now - 1000).toISOString(), status: 'completed', result: { email: { messageCount: 3 } } },
    { createdAt: new Date(now - 2 * 24 * 3600 * 1000).toISOString(), status: 'failed', result: {} },
    { createdAt: new Date(now - 30 * 24 * 3600 * 1000).toISOString(), status: 'failed', result: { email: { messageCount: 9 } } },
  ];
  const recipes = [
    { enabled: true, schedule: { enabled: true } },
    { enabled: false, schedule: { enabled: true } },
    { enabled: true, schedule: { enabled: false } },
  ];
  const out = stats(() => runs, () => recipes)();
  assert.equal(out.active, 1, 'yalnız etkin ve planlı olan sayılmalı');
  assert.equal(out.emails, 3, 'bölünmüş gönderimde mesaj sayısı toplanmalı');
  assert.equal(out.failed, 1, '30 gün önceki hata pencereye girmemeli');
});
