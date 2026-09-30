'use strict';

/*
 * v7.175 — OTOMASYONLAR: ACEMİ DOSTU KURULUM, ALAN DENETİMİ VE AI ASİSTANI
 *
 * Kullanıcı talebi (birebir):
 *   "Şimdi aynı mantıkla bir de otomasyonları uçtan uca ele al ve revize et.
 *    Otomasyon alanı da buna benzer kolaylıkta olsun, acemiler bile
 *    kolaylıkla kullanabilsin."
 *
 * BU DOSYANIN KORUDUĞU DAVRANIŞLAR
 *  1) Koşuldaki alan veride yoksa sessiz yanlış yok: "Boş" koşulu TÜM satırları,
 *     "eşittir" koşulu HİÇBİR satırı eşleştirirdi. Artık alan kanonik kayıttan
 *     onarılır; onarılamazsa çalıştırma sebebini söyleyerek durur.
 *  2) "Ne yapmak istiyorsunuz?" şablonları gerçek alanlarla, taslak teslimle kurulur.
 *  3) "Bu otomasyon ne yapacak?" düz dille; "Hazır mı?" eksikleri öneriyle listeler.
 *  4) AI ile yaz: yönerge yalnız ADLARI içerir; cevap ayıklanır, düzeltilir,
 *     hatalar düz dille ve öneriyle açıklanır; sözlük örnekleri gerçekten geçerlidir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const A = require('../public/automation-assistant.js');
const fieldCheck = require('../server/lib/automation-field-check.js');
const { filterRows } = require('../server/lib/agent-tool-registry.js');
const language = require('../server/lib/automation-language.js');
const registry = require('../server/lib/ai-capability-registry.js');
const SERVER = read('server/server.js');
const UI = read('public/automations.js');
const AI_UI = read('public/ai-automation-import.js');
const RUNTIME = read('public/perf-runtime.js');
const CSS = read('public/app.css');

const CP_ROWS = [
  { 'Order Code': 'A1', Manufacturer: 'ABC Tekstil', 'Ex-factory': '2026-10-02', Status: 'Üretimde' },
  { 'Order Code': 'A2', Manufacturer: 'XYZ Örme', 'Ex-factory': '', Status: 'Yüklendi' },
];

/* ------------------------------------------------------------------ */
/* 1) ALAN DENETİMİ — sessiz yanlışın kapatılması                      */
/* ------------------------------------------------------------------ */

test('v7.175 · KUSUR KANITI: olmayan alana "Boş" koşulu eskiden TÜM satırları seçerdi', () => {
  // Filtre motoru olmayan alanı boş sayar; denetim olmadan planlı bir e-posta
  // bütün siparişleri taslağa koyardı.
  assert.equal(filterRows(CP_ROWS, [{ field: 'Eski Başlık', operator: 'empty' }]).length, CP_ROWS.length);
  assert.equal(filterRows(CP_ROWS, [{ field: 'Eski Başlık', operator: 'eq', value: 'x' }]).length, 0);
});

test('v7.175 · olmayan koşul alanı çalıştırmayı DURDURUR ve en yakın alanı önerir', () => {
  const recipe = { source: 'cp', purpose: 'email', filters: [{ field: 'Manufacturr', operator: 'empty' }] };
  const check = fieldCheck.inspect(CP_ROWS, recipe);
  assert.equal(check.missing.length, 1);
  assert.equal(check.missing[0].suggestion, 'Manufacturer');
  const error = fieldCheck.blockingError(check);
  assert.equal(error.code, 'AUTOMATION_FIELD_MISSING');
  assert.equal(error.statusCode, 409);
  assert.match(error.message, /“Manufacturr” \(belki “Manufacturer”\?\)/);
});

test('v7.175 · başlığı değişmiş alan KANONİK kayıttan onarılır ("Sipariş Kodu" → "Order Code")', () => {
  const recipe = { source: 'cp', purpose: 'analysis', filters: [{ field: 'Sipariş Kodu', operator: 'eq', value: 'A1' }] };
  const check = fieldCheck.inspect(CP_ROWS, recipe);
  assert.deepEqual(check.missing, []);
  assert.deepEqual(check.remapped, [{ from: 'Sipariş Kodu', to: 'Order Code', where: 'filter' }]);
  assert.equal(check.filters[0].field, 'Order Code');
  assert.equal(filterRows(CP_ROWS, check.filters).length, 1, 'onarılan koşul doğru satırı seçer');
  assert.equal(recipe.filters[0].field, 'Sipariş Kodu', 'kayıtlı tarif değiştirilmez');
  assert.equal(fieldCheck.blockingError(check), null);
});

test('v7.175 · büyük/küçük harf farkı hata sayılmaz; alıcı alanı da denetlenir', () => {
  const recipe = { source: 'cp', purpose: 'email', filters: [{ field: 'manufacturer', operator: 'not_empty' }], email: { recipientMode: 'field', recipientField: 'Üretici Adı' } };
  const check = fieldCheck.inspect(CP_ROWS, recipe);
  assert.equal(check.filters[0].field, 'Manufacturer');
  assert.equal(check.missing.length, 1);
  assert.equal(check.missing[0].where, 'recipient');
  assert.ok(fieldCheck.blockingError(check), 'alıcı alanı yoksa e-posta kimseye gitmez; durmalı');
});

test('v7.175 · veri yoksa denetim yapılmaz (alanın varlığı bilinemez)', () => {
  const check = fieldCheck.inspect([], { source: 'cp', filters: [{ field: 'Herhangi', operator: 'eq', value: '1' }] });
  assert.equal(check.checked, false);
  assert.equal(fieldCheck.blockingError(check), null);
});

test('v7.175 · sunucu: denetim filtre uygulanmadan ÖNCE çalışır, önizleme sonucu bildirir', () => {
  const start = SERVER.indexOf('async function automationDataset(');
  const body = SERVER.slice(start, SERVER.indexOf('const AUTOMATION_EMAIL_RE', start));
  assert.ok(body.indexOf('automationFieldCheck.inspect(rows,recipe') < body.indexOf('automationApplyFilters(rows,checkedRecipe'), 'denetim önce');
  assert.match(body, /if\(fieldError\)throw fieldError;/);
  assert.match(body, /fieldCheck:\{remapped:fieldCheck\.remapped,missing:fieldCheck\.missing\}/);
  assert.match(SERVER, /if\(data\.fieldCheck\)result\.fieldCheck=data\.fieldCheck;/);
  assert.match(UI, /function fieldCheckHtml\(check\)/);
});

/* ------------------------------------------------------------------ */
/* 2) ŞABLONLAR                                                        */
/* ------------------------------------------------------------------ */

test('v7.175 · şablonlar gerçek işlere karşılık gelir ve hiçbiri gerçek gönderim kurmaz', () => {
  assert.ok(A.TEMPLATES.length >= 6);
  for (const template of A.TEMPLATES) {
    assert.ok(template.tr && template.en && template.descTr && template.descEn && template.icon, `${template.id} eksik`);
    assert.ok(['email', 'analysis', 'browser', 'app', 'mixed'].includes(template.purpose), template.id);
    const email = template.patch.email || {};
    assert.notEqual(email.deliveryMode, 'outlook_send', `${template.id} gerçek gönderim kurmamalı`);
    for (const rule of template.patch.filters || []) {
      assert.ok(['eq', 'neq', 'contains', 'starts_with', 'in', 'empty', 'not_empty', 'changed', 'gt', 'gte', 'lt', 'lte'].includes(rule.operator), `${template.id} operatörü`);
    }
    if (template.patch.schedule && template.patch.schedule.enabled) assert.equal(template.purpose, 'email', 'planlama yalnız e-posta işinde');
  }
});

test('v7.175 · gecikme şablonu dilden bağımsız KOD alanıyla eşleşir ve üreticiye böler', () => {
  const template = A.TEMPLATES.find(item => item.id === 'late_suppliers');
  assert.equal(template.patch.source, 'backlog');
  assert.equal(template.patch.email.recipientMode, 'field');
  assert.equal(template.patch.email.recipientField, 'Üretici');
  assert.match(read('server/lib/backlog-automation.js'), /outcomeCode: 'Teslimat Sonucu Kodu'/, 'alan sunucuda bu adla üretiliyor');
  const rows = [{ 'Teslimat Sonucu Kodu': 'AT_RISK' }, { 'Teslimat Sonucu Kodu': 'ON_TRACK' }, { 'Teslimat Sonucu Kodu': 'ALREADY_LATE' }];
  assert.equal(filterRows(rows, template.patch.filters).length, 2);
});

test('v7.175 · CP şablon alanları sunucunun ürettiği alanlardır', () => {
  const cp = read('server/lib/cp-automation.js');
  assert.match(cp, /priorityCode: 'Aksiyon Önceliği Kodu'/);
  assert.match(read('public/cp-readiness-engine.js'), /CRITICAL: 'Kritik', ACTION_TODAY: 'Bugün Aksiyon'/);
});

/* ------------------------------------------------------------------ */
/* 3) DÜZ DİLLE ÖZET ve "HAZIR MI?"                                    */
/* ------------------------------------------------------------------ */

test('v7.175 · özet otomasyonu düz cümleyle anlatır; göreli tarih okunur', () => {
  const recipe = {
    purpose: 'email', source: 'cp', limit: 50,
    filters: [{ field: 'Ex-factory', operator: 'lte', value: '@today+7d' }, { field: 'Status', operator: 'neq', value: 'Yüklendi' }],
    email: { recipientMode: 'group', groupId: 'g1', deliveryMode: 'draft' },
    schedule: { enabled: true, mode: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
  };
  const text = A.summarize(recipe, { lang: 'tr', sourceLabel: () => 'CP', groupName: () => 'Merch Ekibi' }).map(line => line.text).join(' | ');
  assert.match(text, /Her iş günü 09:00’da/);
  assert.match(text, /“Ex-factory” en fazla \/ o gün ya da önce “bugünden 7 gün sonra”/);
  assert.match(text, / VE /);
  assert.match(text, /“Merch Ekibi” grubuna tek e-posta TASLAK olarak hazırlanır/);
  assert.equal(A.valueLabel('@today-3d', 'en'), '3 days before today');
});

test('v7.175 · "Hazır mı?" eksikleri ve yanlış yazılmış alanı öneriyle bulur', () => {
  const recipe = {
    name: '', purpose: 'email', source: 'cp',
    filters: [{ field: 'Manufaturer', operator: 'eq', value: '' }, { field: '', operator: 'changed', value: '' }],
    email: { recipientMode: 'group', groupId: '', subject: '' },
    schedule: { enabled: true, mode: 'weekly', weekdays: [] },
  };
  const issues = A.readiness(recipe, { fields: ['Manufacturer', 'Order Code'], fieldsLoaded: true, groups: [] });
  const text = issues.map(item => `${item.level}:${item.tr}`).join('\n');
  assert.match(text, /error:Otomasyona bir ad verin/);
  assert.match(text, /error:1\. koşuldaki “Manufaturer” alanı bu veride yok/);
  assert.equal(issues.find(item => item.field === 'Manufaturer').suggestion, 'Manufacturer');
  assert.match(text, /error:1\. koşulda değer boş/);
  assert.match(text, /error:2\. koşulda alan seçilmedi/);
  assert.match(text, /error:E-postanın gideceği grubu seçin/);
  assert.match(text, /warn:E-posta konusu boş/);
  assert.match(text, /error:Haftalık çalışma için en az bir gün seçin/);
});

test('v7.175 · hazır bir otomasyonda HATA yoktur; planlama yalnız e-postada', () => {
  const ready = { name: 'X', purpose: 'email', source: 'cp', enabled: true, filters: [{ field: 'Manufacturer', operator: 'eq', value: 'ABC' }], email: { recipientMode: 'group', groupId: 'g1', subject: 'S' }, schedule: { enabled: false } };
  assert.deepEqual(A.readiness(ready, { fields: ['Manufacturer'], fieldsLoaded: true, groups: [{ id: 'g1', name: 'G' }] }).filter(item => item.level === 'error'), []);
  const scheduledAnalysis = { name: 'Y', purpose: 'analysis', source: 'cp', filters: [], schedule: { enabled: true, mode: 'daily' } };
  assert.ok(A.readiness(scheduledAnalysis, {}).some(item => /yalnız E-posta/.test(item.tr)), 'sunucu kuralıyla aynı');
});

/* ------------------------------------------------------------------ */
/* 4) AI ASİSTANI ve SÖZLÜK                                            */
/* ------------------------------------------------------------------ */

test('v7.175 · sözlükteki örnek kod ve her koşul örneği sunucu doğrulamasından GEÇER', () => {
  const model = registry.getCapabilityModel();
  assert.deepEqual(language.validate(language.parse(A.DSL_EXAMPLE), model).errors, []);
  const conditions = A.DSL_DICTIONARY.find(section => section.cat === 'condition').items;
  for (const item of conditions) {
    const code = A.DSL_EXAMPLE.replace(/WHEN\n[\s\S]*?\nEND/, `WHEN\n  ${item.syntax}\nEND`);
    assert.deepEqual(language.validate(language.parse(code), model).errors, [], item.syntax);
  }
  for (const item of A.DSL_DICTIONARY.find(section => section.cat === 'trigger').items) {
    const code = A.DSL_EXAMPLE.replace(/TRIGGER\n[\s\S]*?\nEND/, `TRIGGER\n  ${item.syntax}\nEND`);
    assert.doesNotThrow(() => language.parse(code), item.syntax);
  }
});

test('v7.175 · AI cevabından kod ayıklanır; açıklama ve kıvrık tırnak sorun olmaz', () => {
  const answer = `Elbette! İşte otomasyon:\n\`\`\`text\n${A.DSL_EXAMPLE.replace('"cp"', '“cp”').replace('BUYERLOG_AUTOMATION 1.0', 'BUYERLOG_AUTOMATION 1')}\n\`\`\`\nBu kod her pazartesi çalışır.`;
  const extracted = A.extractAutomationCode(answer);
  assert.match(extracted, /^BUYERLOG_AUTOMATION/);
  assert.match(extracted, /END$/);
  const fixed = A.autoFixCode(extracted, { version: '1.0' });
  assert.ok(fixed.fixes.length >= 2);
  assert.deepEqual(language.validate(language.parse(fixed.code), registry.getCapabilityModel()).errors, []);
  // Kod bloğu olmayan cevapta da BUYERLOG_AUTOMATION → son END aralığı alınır.
  const bare = `Şöyle yazabilirsin:\n${A.DSL_EXAMPLE}\nUmarım işine yarar.`;
  assert.equal(A.extractAutomationCode(bare), A.DSL_EXAMPLE);
});

test('v7.175 · sunucu hataları düz dille ve öneriyle açıklanır', () => {
  const model = registry.getCapabilityModel();
  const field = A.explainDslError('Bilinmeyen alan: Uretci', { model, source: 'cp' });
  assert.equal(field.suggestion, 'Üretici');
  assert.match(field.hintTr, /Bunu mu demek istediniz: \[Üretici\]/);
  assert.match(A.explainDslError('Bilinmeyen dataset: backlogs', { model }).hintTr, /"backlog"/);
  assert.match(A.explainDslError('Desteklenmeyen action: SEND_MAIL', { model }).hintTr, /SEND_EMAIL/);
  assert.match(A.explainDslError('ACTIONS END eksik.', { model }).tr, /END satırı eksik/);
  assert.match(A.explainDslError('Geçersiz TRIGGER: EVERY MONDAY', { model }).hintTr, /WEEKLY ON MONDAY AT 09:00/);
  // Gerçek sunucu mesajı biçimleri — sözleşme kırılmasın.
  assert.throws(() => language.parse('BUYERLOG_AUTOMATION 1.0\nNAME "x"\nTRIGGER\n  EVERY MONDAY\nEND'), /Geçersiz TRIGGER: EVERY MONDAY/);
  const ast = language.parse(A.DSL_EXAMPLE.replace('[Durum]', '[Uretci]'));
  assert.match(language.validate(ast, model).errors.join(' '), /Bilinmeyen alan: Uretci/);
});

test('v7.175 · AI yönergesi kuralları, alan ADLARINI ve isteği içerir; şirket verisi içermez', () => {
  const model = registry.getCapabilityModel();
  const prompt = A.buildAutomationPrompt({ lang: 'tr', model, source: 'cp', request: 'Riskli siparişleri pazartesi gönder' });
  assert.match(prompt, /BUYERLOG_AUTOMATION 1\.0/);
  assert.match(prompt, /RECIPIENT_GROUP ASK_USER/);
  assert.match(prompt, /- \[Üretici\] — text/);
  assert.match(prompt, /- \[Ex-Factory\] — date/);
  assert.match(prompt, /Riskli siparişleri pazartesi gönder/);
  assert.doesNotMatch(prompt, /@[a-z0-9.-]+\.[a-z]{2,}/i, 'e-posta adresi yok');
  assert.match(A.buildAutomationPrompt({ lang: 'en', model, source: 'cp' }), /RULES/);
});

/* ------------------------------------------------------------------ */
/* 5) EKRAN SÖZLEŞMESİ                                                 */
/* ------------------------------------------------------------------ */

test('v7.175 · "Yeni Otomasyon" hazır senaryolarla açılır; eski yollar ikincil olarak durur', () => {
  assert.match(UI, /Ne yapmak istiyorsunuz\?/);
  assert.match(UI, /data-create-template=/);
  assert.match(UI, /data-create-path="ai"/);
  assert.match(UI, /async function applyTemplate\(id\)/);
  assert.match(RUNTIME, /automations:\['automation-assistant\.js','automations\.js','ai-automation-import\.js'\]/);
});

test('v7.175 · editörde özet + "Hazır mı?" paneli var; HATA varken Çalıştır başlamaz', () => {
  assert.match(UI, /id="autoGuide"/);
  assert.match(UI, /function renderGuide\(\)/);
  assert.match(UI, /function markDirty\(v=true\)\{dirty=Boolean\(v\);renderSaveState\(\);renderGuide\(\);\}/);
  assert.match(UI, /async function runDraft\(\)\{const blocking=readinessIssues\(\)\.filter\(item=>item\.level==='error'\);if\(blocking\.length\)/);
  assert.match(CSS, /\.autoGuide\{display:grid;/);
});

test('v7.175 · koşullarda tarih kısayolları ve bağlanan ikinci kaynağın alanları var', () => {
  assert.match(UI, /data-filter-date="\$\{token\}"/);
  assert.match(UI, /\['@today\+7d',tr\('7 gün sonra','in 7 days'\)\]/);
  assert.match(UI, /data-filter-fix=/);
  assert.match(UI, /host\.innerHTML=fieldListHtml\(fieldKey,listId\)/, 'zincirlenen kaynağın alanları da listede olmalı');
  assert.match(UI, /<details class="autoAdvanced"/);
});

test('v7.175 · AI ile oluşturulan taslak listede hemen açılır (olayı dinleyen yoktu)', () => {
  assert.match(AI_UI, /dispatchEvent\(new CustomEvent\('buyerlog:automation-ai-imported'/);
  assert.match(UI, /addEventListener\('buyerlog:automation-ai-imported'/);
});

test('v7.175 · AI penceresi: yaz → yönergeyi kopyala → yapıştır; kod ayıklanıp denetlenir', () => {
  assert.match(AI_UI, /data-ai-request/);
  assert.match(AI_UI, /data-ai-copy/);
  assert.match(AI_UI, /A\.extractAutomationCode\(raw\)/);
  assert.match(AI_UI, /A\.explainDslError\(message/);
  assert.match(AI_UI, /data-ai-dict/);
  assert.match(AI_UI, /window\.BLAiAutomationImport = \{ open: openModal \}/);
  assert.match(AI_UI, /hiçbir sipariş, fiyat, tedarikçi ya da e-posta adresi eklenmez/);
});
