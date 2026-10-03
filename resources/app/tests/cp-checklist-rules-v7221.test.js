'use strict';

/* v7.221 — Checklist ve Rules uçtan uca.
   Kullanıcı talebi (özet):
     · Rules'da yalnız öncelik kuralları; checklist soruları Checklist Settings'te.
     · Kural/checklist oluşturmak basit olsun; formül için AI rehberi (.md).
     · Durumlar: Not Required / Approved / Rejected / Pending.
     · Checklist başlıkları Rules'a, Rules başlıkları checklist koşuluna CANLI
       aksın; silinenler görünmesin; bağlı olanı silerken uyarı verilsin.
     · CP'deki checklist alanlarına elle yazı yazılamasın.
     · Kurallar ve checklist'ler kişiye özel; Ön Ayar Paylaşımı ile paylaşılsın. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const Checklist = require('../public/cp-checklist-engine.js');
const Rules = require('../public/cp-rules-engine.js');
const SYNC = require('../public/checklist-supplier-sync.js');
const { mergeValue, SHARE_ITEMS } = require('../server/lib/preset-share');

function analysis(spec) {
  const o = spec || {};
  return {
    orderKey: o.orderKey || 'O1', orderCode: 'O1', modelName: 'M', plannedLoadDate: 20000,
    daysToLoad: o.daysToLoad == null ? 10 : o.daysToLoad, orderAgeDays: 40, stage: o.stage || 'PRODUCTION',
    priority: 'ON_TRACK', deliveryOutcome: 'ON_TRACK', qty: 100, sourceRow: o.row || { License: 'Minecraft' },
  };
}
const rule = raw => Rules.normalizeRule({ expressionVersion: Rules.EXPRESSION_VERSION, ...raw });

test('dört durum: Pending (open) · Approved · Rejected · Not Required; eski "done" Approved okunur', () => {
  assert.deepEqual([...Checklist.STATUS_IDS], ['open', 'approved', 'rejected', 'notRequired']);
  assert.equal(Checklist.normalizeStatus('done'), 'approved');
  assert.equal(Checklist.normalizeStatus('Tamamlandı'), 'approved');
  assert.equal(Checklist.normalizeStatus('Reddedildi'), 'rejected');
  assert.equal(Checklist.normalizeStatus('Not Required'), 'notRequired');
  assert.equal(Checklist.normalizeStatus('Pending'), 'open');
  assert.equal(Checklist.normalizeStatus('???'), '');
  assert.equal(Checklist.statusLabel('rejected', 'en'), 'Rejected');
  assert.equal(Checklist.statusLabel('open', 'tr'), 'Bekliyor');
  assert.equal(Checklist.makeAnswer('done', analysis()).state, 'approved');
});

test('Reddedildi soruyu AÇIK tutar ve işaretler; Onaylandı / Gerekmiyor kapatır; özet hepsini sayar', () => {
  const a = analysis();
  const items = [{ id: 'fabric', tr: 'Kumaş', en: 'Fabric', questionTr: 'Kumaş?', questionEn: 'Fabric?' }];
  const ctx = answers => ({ settings: Checklist.normalizeSettings(null), answers, customItems: items, managedItemIds: Checklist.ITEMS.map(item => item.id) });
  const key = Checklist.answerKey(a.orderKey, 'fabric');

  const rejected = Checklist.openItems(a, ctx({ [key]: Checklist.makeAnswer('rejected', a) }));
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].status, 'rejected');
  assert.equal(rejected[0].rejected, true);
  assert.equal(Checklist.stateFor(a, ctx({ [key]: Checklist.makeAnswer('rejected', a) })).fabric, 'rejected');

  for (const state of ['approved', 'notRequired']) {
    assert.deepEqual(Checklist.openItems(a, ctx({ [key]: Checklist.makeAnswer(state, a) })), [], `${state} soruyu kapatır`);
    assert.equal(Checklist.stateFor(a, ctx({ [key]: Checklist.makeAnswer(state, a) })).fabric, state);
  }
  assert.equal(Checklist.stateFor(a, ctx({})).fabric, 'open', 'cevapsız = Pending');

  const summary = Checklist.summarize([a, analysis({ orderKey: 'O2' })], {
    settings: Checklist.normalizeSettings(null),
    answers: { [key]: Checklist.makeAnswer('rejected', a), [Checklist.answerKey('O2', 'fabric')]: Checklist.makeAnswer('approved', a) },
    customItemsFor: () => items, managedItemIds: Checklist.ITEMS.map(item => item.id),
  });
  assert.equal(summary.items[0].rows, 1);
  assert.equal(summary.items[0].rejected, 1);
  assert.equal(summary.rejectedTotal, 1);
  assert.equal(summary.answeredTotal, 1, 'özel (kural yönetimli) sorular da tamamlanan sayımına girer');
});

test('eski kayıtlı kurallar yeni durumlara kayıpsız taşınır: "open" = Pending ya da Reddedildi', () => {
  const legacy = Rules.normalizeRule({
    kind: 'priority', name: 'x', target: 'ACTION_TODAY',
    conditions: [{ field: '@checklist:pps', operator: 'eq', value: 'open' }, { field: '@checklist:tests', operator: 'ne', value: 'answered' }],
  });
  assert.equal(legacy.expressionVersion, Rules.EXPRESSION_VERSION);
  assert.equal(legacy.conditions[0].operator, 'in');
  assert.deepEqual(legacy.conditions[0].right.value, ['open', 'rejected']);
  assert.equal(legacy.conditions[1].operator, 'notIn');
  assert.deepEqual(legacy.conditions[1].right.value, ['approved', 'notRequired']);

  const formula = Rules.normalizeRule({ kind: 'priority', name: 'f', mode: 'formula', formula: '=AND([@checklist:pps]="open",[@daysToLoad]<=7)' });
  assert.equal(formula.formula, '=AND(IN([@checklist:pps],"open","rejected"),[@daysToLoad]<=7)');
  assert.equal(Rules.validateExpression(formula.formula).valid, true);

  // Yeni sürümle kaydedilmiş kural tekrar dönüştürülmez: kullanıcı yalnız
  // "Bekliyor" seçtiyse yalnız Bekliyor kalır.
  const current = rule({ kind: 'priority', name: 'y', conditions: [{ field: '@checklist:pps', operator: 'eq', value: 'open' }] });
  assert.equal(Rules.normalizeRule(current).conditions[0].operator, 'eq');
});

test('checklist ↔ öncelik kuralı birbirine koşul olarak bağlanır ve sipariş başına doğru sırayla çözülür', () => {
  const a = analysis({ daysToLoad: 5 });
  const soon = rule({ id: 'soon', kind: 'priority', name: 'Soon', target: 'ACTION_TODAY', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 7 }] });
  const fabric = rule({ id: 'fabric', kind: 'checklist', name: 'Fabric', conditions: [{ field: '@rule:soon', operator: 'eq', value: 'matched' }] });
  const rejectedFabric = rule({ id: 'fabricRejected', kind: 'priority', name: 'Fabric rejected', target: 'CRITICAL', conditions: [{ field: '@checklist:fabric', operator: 'eq', value: 'rejected' }] });
  const rules = [rejectedFabric, fabric, soon];

  let result = Rules.evaluateOrder(a, { rules, answers: {} });
  assert.deepEqual(result.customItems.map(item => item.id), ['fabric'], 'kurala bağlı checklist sorusu sorulur');
  assert.equal(result.checklistState.fabric, 'open');
  assert.equal(result.priority, 'ACTION_TODAY');
  assert.equal(result.ruleState.soon, 'matched');

  result = Rules.evaluateOrder(a, { rules, answers: { [Checklist.answerKey('O1', 'fabric')]: Checklist.makeAnswer('rejected', a) } });
  assert.equal(result.checklistState.fabric, 'rejected');
  assert.equal(result.priority, 'CRITICAL', 'reddedilen checklist öncelik kuralını tetikler');

  const far = Rules.evaluateOrder(analysis({ daysToLoad: 40 }), { rules, answers: {} });
  assert.deepEqual(far.customItems, [], 'kural eşleşmeyince soru sorulmaz');
  assert.equal(far.checklistState.fabric, 'notApplicable');

  const off = Rules.evaluateOrder(a, { rules, answers: {}, checklistEnabled: false });
  assert.deepEqual(off.customItems, [], 'checklist kapalıyken soru yok');
});

test('döngüsel bağlantı güvenle durur ve editörde gösterilir', () => {
  const a = rule({ id: 'a', kind: 'checklist', name: 'A', conditions: [{ field: '@checklist:b', operator: 'eq', value: 'open' }] });
  const b = rule({ id: 'b', kind: 'checklist', name: 'B', conditions: [{ field: '@checklist:a', operator: 'eq', value: 'open' }] });
  const result = Rules.evaluateOrder(analysis(), { rules: [a, b], answers: {} });
  assert.equal(result.checklistState.a, 'notApplicable');
  assert.equal(result.checklistState.b, 'notApplicable');
  assert.deepEqual(Rules.findCycle(a, [a, b]).map(item => item.id).sort(), ['a', 'b']);
});

test('alan kataloğu canlıdır: yalnız mevcut checklist/kural başlıkları, düzenlenen kural hariç', () => {
  const catalog = Rules.fieldCatalog([], {
    checklistItems: [{ id: 'fabric', tr: 'Kumaş Testi', en: 'Fabric Test' }, { id: 'gs', tr: 'GS', en: 'GS' }],
    priorityRules: [{ id: 'soon', kind: 'priority', name: 'Soon' }],
    excludeId: 'gs',
  });
  assert.deepEqual(catalog.checklist.map(item => item.id), ['@checklist:fabric']);
  assert.equal(catalog.checklist[0].en, 'Check: Fabric Test');
  assert.deepEqual(catalog.rules.map(item => item.id), ['@rule:soon']);
  assert.ok(!catalog.checklist.some(item => item.id === '@checklist:pps'), 'silinmiş/var olmayan yerleşik başlık görünmez');
});

test('bağımlılık: bağlı kural bulunur, silinmiş başlığa bağlı koşul raporlanır', () => {
  const fabric = rule({ id: 'fabric', kind: 'checklist', name: 'Fabric', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 30 }] });
  const user = rule({ id: 'user', kind: 'priority', name: 'Uses fabric', conditions: [{ field: '@checklist:fabric', operator: 'in', value: ['open'] }] });
  const formulaUser = rule({ id: 'formulaUser', kind: 'priority', name: 'Formula', mode: 'formula', formula: '=[@checklist:fabric]="rejected"' });
  assert.deepEqual(Rules.dependentsOf(fabric, [fabric, user, formulaUser]).map(item => item.id), ['user', 'formulaUser']);
  assert.deepEqual(Rules.danglingReferences(user, [user]), ['@checklist:fabric']);
  assert.deepEqual(Rules.danglingReferences(user, [fabric, user]), []);
});

test('formül görünen adlarla yazılır, kimlikle saklanır; AI rehberi satır verisi içermez', () => {
  const catalog = Rules.fieldCatalog([{ License: 'GIZLI-LISANS', 'Order Code': 'SECRET-123' }], {
    checklistItems: [{ id: 'fabric', tr: 'Kumaş Testi', en: 'Fabric Test' }],
  });
  const stored = '=AND([@daysToLoad]<=14,IN([@checklist:fabric],"open","rejected"),[License]="[x]")';
  const shown = Rules.formulaToDisplay(stored, catalog, 'en');
  assert.equal(shown, '=AND([Days to load]<=14,IN([Check: Fabric Test],"open","rejected"),[License]="[x]")');
  assert.equal(Rules.formulaFromDisplay(shown, catalog), stored);
  assert.equal(Rules.formulaFromDisplay('=[Yüklemeye kalan gün]<=3', catalog), '=[@daysToLoad]<=3', 'Türkçe ad da çözülür');

  assert.equal(Rules.extractFormula('Sure:\n```formula\n=AND([Days to load]<=7)\n```\nExplanation'), '=AND([Days to load]<=7)');
  assert.equal(Rules.extractFormula('Use `=[Days to load]<=7` here'), '=[Days to load]<=7');

  const guide = Rules.buildAiGuide({ lang: 'en', kind: 'checklist', fields: catalog, request: 'ask fabric' });
  assert.match(guide, /^# Buyer Log — Rule Formula Guide for AI/);
  assert.match(guide, /\[Check: Fabric Test\]/);
  assert.match(guide, /"rejected"/);
  assert.match(guide, /ask fabric/);
  assert.doesNotMatch(guide, /GIZLI-LISANS|SECRET-123/, 'rehber yalnız alan ADLARINI içerir');
});

test('Excel / CP köprüsü dört durumu kullanır ve CP hücresi serbest metin değildir', () => {
  assert.deepEqual(SYNC.statusOptions(), ['Bekliyor', 'Onaylandı', 'Reddedildi', 'Gerekmiyor']);
  const bridge = read('public/checklist-supplier-sync.js');
  assert.match(bridge, /type: 'checklistStatus'/);
  assert.doesNotMatch(bridge, /group: 'Checklist',\s*type: 'text'/);
  assert.match(bridge, /assistant\.setChecklistAnswer\(analysis, itemId, status\)/);
  // Kişisel tanımlar: sunucudaki ortak liste her açılışta üzerine yazılmaz.
  assert.doesNotMatch(bridge, /post\('\/definitions'/);
  assert.match(bridge, /adoptSharedChecklistDefinitions/);

  const app = read('public/app-main.js');
  const start = app.indexOf("case 'checklistStatus': {");
  assert.ok(start > 0, 'checklistStatus hücre tipi çizilmeli');
  const cell = app.slice(start, app.indexOf("case 'priority':", start));
  assert.match(cell, /class="clStatusTrigger/);
  assert.doesNotMatch(cell, /<input/, 'checklist hücresine yazı yazılamaz');
  assert.doesNotMatch(cell, /editCell/, 'genel düzenleme yolu (row[key] = metin) devreye girmemeli');
});

test('sunucu deposu dört durumu kanonik saklar', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-checklist-v7221-'));
  try {
    const storePath = path.join(ROOT, 'server', 'lib', 'checklist-supplier-store.js');
    const script = [
      `const store=require(${JSON.stringify(storePath)});`,
      "const out=['Completed','Approved','Reddedildi','Not Required','Pending','x'].map(store.normalizeState);",
      "const r=store.applyEntries([{orderKey:'O1',itemId:'gs',state:'rejected',at:'2026-10-03T10:00:00.000Z'}],{id:'u'},{});",
      "process.stdout.write(JSON.stringify({out,state:store.publicPayload().answers['O1::gs'].state,updated:r.updated}));",
    ].join('');
    const result = JSON.parse(childProcess.execFileSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      env: { ...process.env, BUYER_LOG_SERVER_DATA_ROOT: dataRoot, BUYER_LOG_LOCAL_DATA_ROOT: path.join(dataRoot, 'local') },
    }));
    assert.deepEqual(result.out, ['approved', 'approved', 'rejected', 'notRequired', 'open', '']);
    assert.equal(result.state, 'rejected');
    assert.equal(result.updated, 1);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('kurallar kişiye özel anahtarlarda durur, hesapla taşınır ve Ön Ayar Paylaşımı ile alınır', () => {
  const storage = read('public/user-storage.js');
  assert.equal((storage.match(/'lcw\.cp\.rules\.'/g) || []).length, 2, 'scoped + SYNCED listelerinde');
  assert.match(read('server/lib/user-preferences.js'), /rules: Object\.freeze\(\['lcw\.cp\.rules\.'\]\)/);
  const ids = SHARE_ITEMS.map(item => item.id);
  assert.ok(ids.includes('cpPriorityRules') && ids.includes('cpChecklistQuestions'));
  const priority = SHARE_ITEMS.find(item => item.id === 'cpPriorityRules');
  assert.deepEqual(priority.prefixes, ['lcw.cp.rules.priority.']);

  const target = JSON.stringify({ version: 1, rules: [{ id: 'own' }, { id: 'same', name: 'old' }], deletedRuleIds: ['builtin_x', 'builtin_y'] });
  const source = JSON.stringify({ version: 1, rules: [{ id: 'same', name: 'new' }, { id: 'builtin_x' }], deletedRuleIds: [] });
  const merged = JSON.parse(mergeValue('lcw.cp.rules.priority.v1', target, source));
  assert.deepEqual(merged.rules.map(item => item.id), ['same', 'builtin_x', 'own']);
  assert.equal(merged.rules[0].name, 'new');
  assert.deepEqual(merged.deletedRuleIds, ['builtin_y'], 'kaynakta olan yerleşik kural geri gelir; diğer silmeler korunur');
});

test('Rules yalnız öncelik kurallarını, Checklist Settings yalnız checklist sorularını açar; silme bağımlılık uyarır', () => {
  const view = read('public/cp-overview-assistant.js');
  assert.match(view, /function openRules\(\) \{ openRuleManager\('priority'\); \}/);
  assert.match(view, /function openSettings\(\) \{ openRuleManager\('checklist'\); \}/);
  assert.match(view, /const visible = rulesFor\(activeTab\);/);
  assert.match(view, /function confirmDelete\(rule\)/);
  assert.match(view, /Rules\.dependentsOf\(rule, state\.rules\)/);
  assert.match(view, /if \(!confirmDelete\(rule\)\) return;/);
  // Sade düzenleyici: şablon, aranabilir alan seçici, canlı önizleme, AI rehberi.
  for (const hook of ['data-cpa-template', 'data-cpa-field-picker', 'data-cpa-rule-preview', 'data-cpa-ai-copy', 'data-cpa-ai-download', 'data-cpa-ai-answer', 'data-cpa-cond-choice']) {
    assert.ok((view.match(new RegExp(hook, 'g')) || []).length >= 2, `${hook} çizilmeli ve bağlanmalı`);
  }
  // AI cevabı çalıştırılmaz; Buyer Log ayrıştırıcısıyla doğrulanır.
  assert.match(view, /Rules\.extractFormula\(answer\)/);
  assert.match(view, /Rules\.validateExpression\(formula, \{ fields: formulaFieldIds\(rule\) \}\)/);
  assert.doesNotMatch(view, /new Function\(|\beval\(/);
});
