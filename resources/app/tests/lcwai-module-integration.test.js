'use strict';
/* LCW AI ortak istemcisi (public/lcwai-assistant.js) ve üç modülün
   entegrasyonu: Hesaplanan Sütun, CP Kuralları, Otomasyon. Hepsi AYNI
   motoru kullanır; öneri modülün kendi doğrulayıcısından geçer ve yalnız
   kullanıcı "Uygula" dediğinde mevcut akışa verilir. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const CLIENT = read('public/lcwai-assistant.js');
const FC = read('public/formula-columns.js');
const CPA = read('public/cp-overview-assistant.js');
const AUTO = read('public/ai-automation-import.js');
const MENU = read('public/user-access-ui.js');
const PERF = read('public/perf-runtime.js');

function loadClient(fetchImpl) {
  const window = { appLang: 'tr', fetch: fetchImpl, BLUI: { notify: () => () => {} } };
  const context = vm.createContext({ window, fetch: fetchImpl, AbortController, TextDecoder, TextEncoder, setTimeout, clearTimeout, console, Promise, JSON, Date, Error, Map, Set, encodeURIComponent });
  vm.runInContext(CLIENT, context);
  return window;
}
const ndjson = events => new Response(new ReadableStream({ start(controller) {
  const encoder = new TextEncoder();
  const text = events.map(event => JSON.stringify(event)).join('\n') + '\n';
  // Satırları paket ortasından bölerek gönder: istemci tamponlamalı.
  for (let i = 0; i < text.length; i += 7) controller.enqueue(encoder.encode(text.slice(i, i + 7)));
  controller.close();
} }), { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });

test('BuyerLogAI.ask: NDJSON ilerleme + sonuç; istek gövdesi kaynak/bağlam/rehber taşır', async () => {
  let sent = null;
  const window = loadClient(async (url, init) => {
    assert.equal(url, '/api/lcwai/ask');
    sent = JSON.parse(init.body);
    return ndjson([{ type: 'progress', phase: 'streaming', delta: '{"formula":', chars: 11 }, { type: 'result', result: { text: '{"formula":"[A]-[B]"}', data: { formula: '[A]-[B]', explanation: 'Fark' }, structured: { ok: true }, model: { key: 'gpt-6-sol', label: 'GPT-6 Sol' } } }]);
  });
  const progress = [];
  const result = await window.BuyerLogAI.ask({ source: 'calculated-column', task: 'Margin %', context: { availableColumns: [{ name: 'Retail' }] }, guide: 'KURALLAR', onProgress: event => progress.push(event.chars) });
  assert.equal(result.data.formula, '[A]-[B]');
  assert.deepEqual(progress, [11]);
  assert.equal(sent.source, 'calculated-column');
  assert.equal(sent.task, 'Margin %');
  assert.equal(sent.guide, 'KURALLAR');
  assert.equal(sent.lang, 'tr');
  assert.ok(sent.requestId);
  assert.equal(window.BuyerLogAI.modelLabel, 'GPT-6 Sol');
  assert.equal(window.LCWAI, window.BuyerLogAI, 'LCWAI takma adı aynı motoru gösterir');
});

test('BuyerLogAI.ask: sunucu hatası kodlu ve yerelleştirilmiş; oturum hatası giriş aksiyonu taşır', async () => {
  const window = loadClient(async () => ndjson([{ type: 'error', error: { code: 'LCWAI_SESSION_EXPIRED', action: 'login', message: 'x' } }]));
  await assert.rejects(window.BuyerLogAI.ask({ source: 'rules', task: 'x' }), error => {
    assert.equal(error.code, 'LCWAI_SESSION_EXPIRED');
    assert.equal(error.message, 'LCW AI oturumunuz yenilenmeli.');
    assert.equal(window.BuyerLogAI.needsLogin(error), true);
    return true;
  });
  window.appLang = 'en';
  assert.equal(window.BuyerLogAI.errorText({ code: 'LCWAI_BROWSER_UNAVAILABLE' }), 'The LCW AI session could not be reached. Check the browser connection.');
  assert.equal(window.BuyerLogAI.errorText(new Error('TypeError: x is undefined at line 5')), 'The LCW AI request could not be completed.', 'ham exception gösterilmez');
  const cut = loadClient(async () => ndjson([{ type: 'progress', phase: 'streaming', chars: 3 }]));
  await assert.rejects(cut.BuyerLogAI.ask({ source: 'rules', task: 'x' }), error => error.code === 'LCWAI_STREAM_INTERRUPTED');
});

test('BuyerLogAI.cancel: süren isteği iptal eder (CANCELLED) ve sunucuya iptal bildirir', async () => {
  const calls = [];
  const window = loadClient((url, init) => {
    calls.push(url);
    if (url === '/api/lcwai/cancel') return Promise.resolve(new Response('{"ok":true}'));
    return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  });
  const pending = window.BuyerLogAI.ask({ source: 'automations', task: 'x', requestId: 'r-1' });
  window.BuyerLogAI.cancel('r-1');
  await assert.rejects(pending, error => error.code === 'LCWAI_CANCELLED');
  assert.ok(calls.includes('/api/lcwai/cancel'));
});

test('pickField: sözleşmeli alan → kısmi alan → modülün yedek ayıklayıcısı', () => {
  const { BuyerLogAI } = loadClient(async () => new Response('{}'));
  const engine = require('../public/formula-engine.js');
  const plain = value => JSON.parse(JSON.stringify(value)); // vm realm'inden düz nesneye
  assert.deepEqual(plain(BuyerLogAI.pickField({ data: { formula: ' [A] ' } }, 'formula')), { value: '[A]', structured: true });
  assert.deepEqual(plain(BuyerLogAI.pickField({ data: null, structured: { partial: { formula: '[B]' } } }, 'formula')), { value: '[B]', structured: false });
  const fallback = BuyerLogAI.pickField({ data: null, text: 'Şöyle:\n```\nDAYS([Ex-factory], [Retail Date])\n```\nAçıklama' }, 'formula', engine.extractFormula);
  assert.equal(fallback.value, 'DAYS([Ex-factory], [Retail Date])');
  assert.equal(BuyerLogAI.pickField({ data: null, text: '' }, 'formula', engine.extractFormula).value, '');
});

test('istemci tarayıcıya token taşımaz ve LCW AI\'a doğrudan gitmez', () => {
  assert.doesNotMatch(CLIENT, /mym\.prod\.lcwaikiki\.com|access_token|Authorization|localStorage\.(get|set)Item/);
  for (const source of [FC, CPA, AUTO]) {
    assert.doesNotMatch(source, /\/api\/lcwai\/|mym\.prod\.lcwaikiki\.com|lcwai\.lcwaikiki\.com/, 'modül LCW AI\'a kendi entegrasyonuyla gitmez');
  }
});

test('Hesaplanan Sütun entegrasyonu: ortak panel + formül motoru doğrulaması + Uygula → mevcut Formül kutusu', () => {
  assert.match(FC, /AI\.mountAssistant\(host, \{\s*source: 'calculated-column'/);
  const block = FC.slice(FC.indexOf('function lcwaiContext()'), FC.indexOf('function aiPrompt()'));
  assert.match(block, /guide: aiPrompt\(\)/, 'modül rehberi manuel yolla aynı');
  assert.match(block, /availableColumns: columns\.map/);
  assert.match(block, /sampleRows: rows/, 'LCW AI şirket içi: örnek satırlar bağlama girer');
  assert.match(block, /AI\.pickField\(result, 'formula', E\.extractFormula\)/);
  assert.match(block, /analyzeText\(E\.extractFormula\(picked\.value\)\)/, 'öneri Buyer Log formül motorundan geçer');
  assert.match(block, /ok: analysis\.ok/);
  assert.match(block, /onApply: value => \{\s*builder\.ai\.answer = value\.formula;[\s\S]*renderAiResult\(\);\s*renderPreview\(\);/, 'uygula yalnız taslağa koyar; kayıt Kaydet ile');
  assert.doesNotMatch(block, /save\(|data-fc-save/);
  assert.match(FC, /T\('LCW AI’dan Destek Al', 'Get help from LCW AI'\)/);
  assert.match(FC, /<details class="lcwaiManual">[\s\S]*data-fc-ai-copy/, 'manuel kopyala/yapıştır yolu yedek olarak durur');
});

test('CP Kuralları entegrasyonu: ortak panel + kural motoru doğrulaması + Uygula → applyFormula', () => {
  const block = CPA.slice(CPA.indexOf('function mountRuleLcwAi(row, rule)'), CPA.indexOf('function confirmDelete(rule,'));
  assert.match(block, /AI\.mountAssistant\(host, \{\s*source: 'rules'/);
  assert.match(block, /guide: aiGuideFor\(rule\.kind, rule, text,[\s\S]*draft\.purpose === 'auto'[\s\S]*draft\.autoStatus/);
  assert.match(CPA, /availableFields: fields/);
  assert.match(CPA, /const fields = formulaFieldCatalog\(rule\)\.map/);
  assert.match(block, /Rules\.formulaFromDisplay\(Rules\.extractFormula\(picked\.value\), catalogFor\(rule\)\)/);
  assert.match(block, /Rules\.validateExpression\(formula, \{ fields: formulaFieldIds\(rule\) \}\)/);
  assert.match(block, /rulePreview\(probe\)/, 'canlı eşleşme sayısı önizlenir');
  assert.match(block, /onApply: \(\{ formula, priority \}\) => \{\s*applyAiFormula\(rule, formula, draft\);/);
  assert.match(block, /taskPurpose: draft\.purpose === 'auto' \? 'auto_status_assignment' : 'checklist_question'/);
  assert.match(CPA, /function applyAiFormula\(rule, formula, draft\)[\s\S]*rule\.autoFormula = formula;[\s\S]*else applyFormula\(rule, formula\);/);
  assert.match(CPA, /renderAiResult\(openRow, openRule\); mountRuleLcwAi\(openRow, openRule\);/);
  assert.match(CPA, /L\('LCW AI’dan Destek Al', 'Get help from LCW AI'\)/);
});

test('Otomasyon entegrasyonu: ortak panel + sunucu DSL denetimi + Uygula → mevcut denetle/taslak akışı', () => {
  const block = AUTO.slice(AUTO.indexOf('function mountLcwAi(modal)'), AUTO.indexOf('function install()'));
  assert.match(block, /AI\.mountAssistant\(host, \{\s*source: 'automations'/);
  assert.match(block, /A\.buildAutomationPrompt\(/);
  assert.match(block, /availableTriggers:/);
  assert.match(block, /availableActions:/);
  assert.match(block, /AI\.pickField\(result, 'code'/);
  assert.match(block, /api\('\/api\/automations\/ai\/analyze'/, 'öneri sunucudaki yetkili denetimden geçer');
  assert.doesNotMatch(block, /\/api\/automations\/ai\/import/, 'panel taslak oluşturmaz; kullanıcı "Kapalı taslak oluştur" der');
  assert.match(block, /onApply: code => \{[\s\S]*analyze\(modal\);/);
  assert.match(AUTO, /tr\('LCW AI’dan Destek Al', 'Get help from LCW AI'\)/);
});

test('kullanıcı menüsü: Kurumsal Bağlantılar altında PLM ve LCW AI bağımsız durum gösterir', () => {
  assert.match(MENU, /tr\('Kurumsal Bağlantılar', 'Corporate Connections'\)/);
  assert.match(MENU, /data-lcwai-user-login/);
  assert.match(MENU, /data-lcwai-badge/);
  assert.match(MENU, /data-plm-badge/);
  assert.match(MENU, /tr\('⚠ Oturum Yenilenmeli', '⚠ Session Needs Renewal'\)/);
  assert.match(MENU, /AI\.openConnectionDialog\(\)/);
  assert.match(CLIENT, /L\('LCW AI Girişi Yap', 'Sign in to LCW AI'\)/);
  assert.match(CLIENT, /L\('✓ LCW AI Bağlı', '✓ LCW AI Connected'\)/);
  assert.match(PERF, /deferredUi:\[\s*'lcwai-assistant\.js\?rev=1'/);
});

test('regresyon: LCW AI geçerli JSON ile formülü boş bıraktıysa ham JSON formül sanılmaz, açıklama döner', () => {
  const { BuyerLogAI } = loadClient(async () => new Response('{}'));
  const rules = { extractFormula: text => text }; // canlıdaki gibi: ham metni olduğu gibi döndüren ayıklayıcı
  const result = { text: '{"explanation":"Alan yok","formula":""}', data: null, structured: { ok: false, partial: { explanation: 'Alan yok', formula: '' } } };
  const picked = JSON.parse(JSON.stringify(BuyerLogAI.pickField(result, 'formula', rules.extractFormula)));
  assert.deepEqual(picked, { value: '', structured: true, declined: true, explanation: 'Alan yok' });
  for (const source of [FC, CPA, AUTO]) assert.match(source, /ok: false, explanation: picked\.explanation/);
});

test('Kurallar bağlamı alan ANLAMLARINI, hedef türünü ve seçilebilir öncelikleri taşır; öneri önceliği uygulanır', () => {
  const block = CPA.slice(CPA.indexOf('const DERIVED_MEANINGS'), CPA.indexOf('function confirmDelete(rule,'));
  assert.match(block, /Rules\.DERIVED_FIELDS/);
  const Rules = require('../public/cp-rules-engine.js');
  for (const id of ['@deliveryOutcome', '@scheduleBufferDays', '@stage']) assert.ok(Rules.DERIVED_FIELDS.find(item => item.id === id).meaning.tr, id);
  assert.match(block, /deliveryTarget: state\.settings\.targetType === 'inStore'/);
  assert.match(block, /availablePriorities:/);
  assert.match(block, /entry\.allowedValues = values/);
  assert.match(block, /context: \{\s*\.\.\.lcwaiRuleContext\(rule\)/);
  assert.match(block, /if \(priority && rule\.kind === 'priority'\) rule\.target = priority;/);
});
