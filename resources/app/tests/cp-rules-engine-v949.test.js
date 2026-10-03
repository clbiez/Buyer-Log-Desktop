'use strict';

/* v9.49 — CP KURAL MOTORU (öncelik + özel kontrol kuralları)
 *
 * Kullanıcı talebi (birebir): "bu alandaki koşulları kullanıcı dilediği gibi
 * ekle/çıkar yapabilsin". Verilen iki gerçek örnek:
 *   · CP'de KENDİ oluşturduğu hesaplamalı RFID sütununda sipariş yoksa,
 *     yükleme terminine 60 gün kala Bu Hafta Aksiyon uyarısı,
 *   · Hologram siparişi hatırlatması — YALNIZ belirli lisanslar için.
 *
 * Korunan asıl kusurlar:
 * 1) Yanlış yazılmış bir kuralın gerçekten geciken siparişi listeden DÜŞÜRMESİ.
 *    Kurallar yalnız yükseltebilir.
 * 2) Kuralların teslimat riskini/ETA'yı değiştirmesi — o kanonik motorun işi.
 * 3) Boş/okunamayan alandan uyarı üretilmesi.
 * 4) Yerleşik kuralların koda gömülü kalıp görünmemesi.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parse = require('../server/lib/parse.js');
const Engine = require('../public/cp-readiness-engine.js');
const Checklist = require('../public/cp-checklist-engine.js');
const Rules = require('../public/cp-rules-engine.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');
const TRANSIT_RULES = [{ id: 'r-sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

function order(spec) {
  const o = spec || {};
  return {
    ocode: o.ocode || 7001, _matchOcode: String(o.ocode || 7001),
    model: 'MODEL-1', ccode: 'C1', colour: 'SIYAH',
    qty: 1000, kalan: 1000, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 4.82, plm: 'PLM1', ozel: 'S7AB73Z4', manufacturer: 'MF-1', season: '26SS',
    category: 'CL', merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1',
    countryRaw: 'HINDISTAN', license: o.license || 'LIC-A', productDescription: 'T',
    opd: o.opd || null, ex: o.ex || null, retail: o.retail || null, mb: null,
    buyer: 'BUYER-1', line: 'LINE-1',
  };
}
function analyze(orders, extra) {
  const rows = parse.buildCPRowsFromASAS(orders, new Map(), { transitRules: TRANSIT_RULES });
  // Kullanıcının CP'de kendi oluşturduğu hesaplamalı sütunlar satıra
  // __f_<id> anahtarıyla yazılır (public/formula-columns.js columnKey).
  rows.forEach((row, index) => Object.assign(row, (extra && extra[index]) || {}));
  return Engine.analyze(rows, { today: TODAY, dateOrdinal: ord, transitRules: TRANSIT_RULES });
}
/* Yüklemeye 40 gün var, üretimde, 60 günlük sipariş. */
function nearOrder(ocode, license) {
  return order({ ocode: ocode || 7001, license, opd: '2026-07-07', ex: '2026-10-15', retail: '2027-02-01' });
}

test('v9.49 yerleşik tanımlar koda gömülü değil, düzenlenebilir kural olarak duruyor', () => {
  const ids = Rules.DEFAULT_RULES.map(rule => rule.id);
  assert.ok(ids.includes('builtin_critical_late'), 'Kritik tanımı kural olarak görünmeli');
  assert.ok(ids.includes('builtin_action_confirmation'));
  assert.ok(ids.includes('builtin_action_samples'));
  assert.ok(ids.includes('builtin_action_tests'));
  for (const rule of Rules.DEFAULT_RULES) {
    assert.equal(rule.builtIn, true);
    assert.ok(rule.conditions.length, `${rule.id} koşulsuz olamaz`);
    assert.ok(rule.name, `${rule.id} kullanıcıya görünen bir ada sahip olmalı`);
  }
});

test('predefined checklist soruları kural editöründe yerleşik kurallar olarak görünür', () => {
  assert.deepEqual(Rules.DEFAULT_CHECKLIST_RULE_IDS, Checklist.ITEMS.map(item => item.id));
  for (const item of Checklist.ITEMS) {
    const rule = Rules.DEFAULT_RULES.find(candidate => candidate.id === item.id);
    assert.ok(rule, `${item.id} kural listesinde görünmeli`);
    assert.equal(rule.kind, 'checklist');
    assert.equal(rule.builtIn, true);
    assert.equal(rule.questionTr, item.questionTr);
    assert.equal(rule.questionEn, item.questionEn);
  }
});

test('v9.49 Kritik tanımı: yükleme geçmiş VE hedef tarihe yetişmiyor', () => {
  const rule = Rules.DEFAULT_RULES.find(item => item.id === 'builtin_critical_late');
  assert.equal(rule.target, 'CRITICAL');
  assert.equal(rule.match, 'all', 'iki koşul birlikte sağlanmalı');
  const fields = rule.conditions.map(condition => `${condition.field}${condition.operator}`);
  assert.ok(fields.includes('@daysToLoadlt'), 'yükleme tarihi geçmiş koşulu');
  assert.ok(rule.conditions.some(condition => condition.field === '@deliveryOutcome'
    && condition.value.includes('EXPECTED_LATE') && condition.value.includes('ALREADY_LATE')),
    'hedefe yetişmeme koşulu');

  // Yükleme geçmiş ama hedefe yetişiyor: Kritik OLMAMALI.
  const model = analyze([order({ ocode: 7101, opd: '2026-05-01', ex: '2026-08-20', retail: '2028-01-01' })]);
  const analysis = model.orders[0];
  assert.ok(analysis.daysToLoad < 0);
  const facts = Rules.factsFor(analysis, {});
  assert.equal(Rules.matchesRule(rule, facts), analysis.deliveryOutcome === 'EXPECTED_LATE' || analysis.deliveryOutcome === 'ALREADY_LATE');
});

test('v9.49 Bu Hafta Aksiyon: gelecek hafta yükleme + teyit/numune/test işaretsiz', () => {
  const model = analyze([order({ ocode: 7201, opd: '2026-06-01', ex: '2026-09-12', retail: '2027-03-01' })]);
  const analysis = model.orders[0];
  assert.equal(analysis.daysToLoad, 7);
  const settings = Checklist.normalizeSettings(null);
  const stateOpen = Checklist.stateFor(analysis, { settings, answers: {} });
  assert.equal(stateOpen.supplierConfirmation, 'open', 'ön koşul: teyit sorusu açık');

  const applied = Rules.applyPriorityRules(analysis, Rules.DEFAULT_RULES, stateOpen);
  assert.equal(applied.priority, 'ACTION_THIS_WEEK');
  assert.ok(applied.matched.some(rule => rule.id === 'builtin_action_confirmation'));

  // İşaretlendiğinde o kural artık eşleşmemeli.
  const answers = {};
  for (const id of ['supplierConfirmation', 'pps', 'tests']) {
    answers[Checklist.answerKey(analysis.orderKey, id)] = Checklist.makeAnswer('done', analysis, {});
  }
  const stateDone = Checklist.stateFor(analysis, { settings, answers });
  const after = Rules.applyPriorityRules(analysis, Rules.DEFAULT_RULES, stateDone);
  assert.deepEqual(after.matched.map(rule => rule.id), [], 'işaretlenen kontroller kural üretmemeli');
});

test('v9.49 kurallar önceliği YALNIZ yükseltir, asla düşürmez', () => {
  const model = analyze([order({ ocode: 7301, opd: '2026-05-01', ex: '2026-08-20', retail: '2026-10-01' })]);
  const analysis = model.orders[0];
  assert.equal(analysis.priority, 'CRITICAL', 'ön koşul');
  const downgrade = [Rules.normalizeRule({ kind: 'priority', target: 'WATCH', name: 'düşür', conditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }] })];
  const applied = Rules.applyPriorityRules(analysis, downgrade, {});
  assert.equal(applied.priority, 'CRITICAL', 'kural önceliği düşüremez');
  assert.equal(applied.matched.length, 1, 'eşleşme yine de raporlanır');
});

test('v9.49 kurallar teslimat sonucunu ve ETA\'yı DEĞİŞTİRMEZ', () => {
  const model = analyze([nearOrder(7401)]);
  const analysis = model.orders[0];
  const before = { outcome: analysis.deliveryOutcome, eta: analysis.eta, buffer: analysis.scheduleBufferDays, reasons: analysis.riskReasons.join(',') };
  Rules.applyPriorityRules(analysis, [Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: 'x', conditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }] })], {});
  assert.equal(analysis.deliveryOutcome, before.outcome);
  assert.equal(analysis.eta, before.eta);
  assert.equal(analysis.scheduleBufferDays, before.buffer);
  assert.equal(analysis.riskReasons.join(','), before.reasons);
});

/* KULLANICININ BİRİNCİ ÖRNEĞİ: kendi oluşturduğu hesaplamalı RFID sütunu. */
test('v9.49 kullanıcının kendi hesaplamalı sütunu koşulda kullanılabiliyor (RFID örneği)', () => {
  const model = analyze([nearOrder(7501), nearOrder(7502)], [{ __f_rfid: '' }, { __f_rfid: 'RFID-123' }]);
  const rule = Rules.normalizeRule({
    kind: 'priority', target: 'ACTION_THIS_WEEK', name: 'RFID siparişi yok',
    match: 'all',
    conditions: [
      { field: '@daysToLoad', operator: 'lte', value: 60 },
      { field: '__f_rfid', operator: 'empty' },
    ],
  });
  const missing = Rules.applyPriorityRules(model.orders[0], [rule], {});
  const present = Rules.applyPriorityRules(model.orders[1], [rule], {});
  assert.equal(missing.priority, 'ACTION_THIS_WEEK', 'RFID boş olan uyarı vermeli');
  assert.equal(present.matched.length, 0, 'RFID dolu olan uyarı vermemeli');

  // Alan listesi hesaplamalı sütunu KULLANICININ VERDİĞİ ADLA göstermeli.
  const catalog = Rules.fieldCatalog([model.orders[0].sourceRow], { formulaColumns: [{ id: 'rfid', name: 'RFID' }], checklistItems: Checklist.ITEMS });
  const entry = catalog.columns.find(item => item.id === '__f_rfid');
  assert.ok(entry, 'hesaplamalı sütun alan listesinde olmalı');
  assert.equal(entry.tr, 'RFID');
  assert.ok(catalog.columns.some(item => item.id === 'Order Code'), 'gerçek CP sütunları da listede olmalı');
  assert.ok(!catalog.columns.some(item => item.id.startsWith('_asas')), 'iç alanlar listeye sızmamalı');
});

/* KULLANICININ İKİNCİ ÖRNEĞİ: yalnız belirli lisanslara sorulan Hologram kontrolü. */
test('v9.49 özel kontrol sorusu yalnız KAPSAMDAKİ siparişlere sorulur (Hologram / lisans örneği)', () => {
  const model = analyze([nearOrder(7601, 'LIC-A'), nearOrder(7602, 'LIC-B')]);
  const rule = Rules.normalizeRule({
    id: 'hologram', kind: 'checklist', name: 'Hologram siparişi',
    questionTr: 'Hologram siparişi verildi mi?', questionEn: 'Has the hologram been ordered?',
    match: 'all',
    conditions: [
      { field: 'License', operator: 'in', value: ['LIC-A'] },
      { field: '@daysToLoad', operator: 'lte', value: 60 },
    ],
  });
  const inScope = Rules.customChecklistItems(model.orders[0], [rule], {});
  const outScope = Rules.customChecklistItems(model.orders[1], [rule], {});
  assert.equal(inScope.length, 1, 'kapsamdaki lisansa sorulmalı');
  assert.equal(inScope[0].questionTr, 'Hologram siparişi verildi mi?');
  assert.equal(outScope.length, 0, 'kapsam dışı lisansa SORULMAMALI');

  // Soru kontrol listesine girmeli ve işaretlenince susmalı.
  const settings = Checklist.normalizeSettings(null);
  const open = Checklist.openItems(model.orders[0], { settings, answers: {}, customItems: inScope });
  assert.ok(open.some(item => item.id === 'hologram'));
  const answers = { [Checklist.answerKey(model.orders[0].orderKey, 'hologram')]: Checklist.makeAnswer('done', model.orders[0], {}) };
  const after = Checklist.openItems(model.orders[0], { settings, answers, customItems: inScope });
  assert.ok(!after.some(item => item.id === 'hologram'), 'işaretlenen özel soru tekrar sorulmamalı');
});

test('v9.49 boş/okunamayan değer sayısal koşulda ASLA eşleşmez', () => {
  const model = analyze([order({ ocode: 7701, opd: null, ex: null, retail: null })]);
  const analysis = model.orders[0];
  assert.equal(analysis.daysToLoad, null);
  for (const operator of ['lt', 'lte', 'gt', 'gte']) {
    const rule = Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: operator, conditions: [{ field: '@daysToLoad', operator, value: 0 }] });
    assert.equal(Rules.applyPriorityRules(analysis, [rule], {}).matched.length, 0,
      `${operator}: veri yokluğundan uyarı üretilemez`);
  }
});

test('v9.49 "hepsi" ve "biri" eşleşme kipleri ayrı çalışır', () => {
  const model = analyze([nearOrder(7801)]);
  const analysis = model.orders[0];
  const conditions = [
    { field: '@stage', operator: 'eq', value: 'PRODUCTION' },
    { field: '@stage', operator: 'eq', value: 'IN_WAREHOUSE' },
  ];
  const all = Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: 'all', match: 'all', conditions });
  const any = Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: 'any', match: 'any', conditions });
  assert.equal(Rules.applyPriorityRules(analysis, [all], {}).matched.length, 0);
  assert.equal(Rules.applyPriorityRules(analysis, [any], {}).matched.length, 1);
});

test('v9.49 kapalı kural ve koşulsuz kural hiçbir siparişe uygulanmaz', () => {
  const model = analyze([nearOrder(7901)]);
  const disabled = Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: 'off', enabled: false, conditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }] });
  const empty = Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: 'boş', conditions: [] });
  assert.equal(Rules.applyPriorityRules(model.orders[0], [disabled, empty], {}).matched.length, 0);
});

test('v9.49 kaydedilmiş kurallar yerleşiklerle birleşir; yeni yerleşik kaybolmaz', () => {
  // Kullanıcı bir yerleşiği kapatmış ve kendi kuralını eklemiş.
  const saved = [
    { ...JSON.parse(JSON.stringify(Rules.DEFAULT_RULES[0])), enabled: false },
    Rules.normalizeRule({ id: 'mine', kind: 'priority', target: 'CRITICAL', name: 'benim', conditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }] }),
  ];
  const merged = Rules.mergeWithDefaults(saved);
  assert.equal(merged.find(rule => rule.id === 'builtin_critical_late').enabled, false, 'kullanıcının kararı kazanmalı');
  assert.ok(merged.some(rule => rule.id === 'mine'), 'kullanıcı kuralı korunmalı');
  for (const rule of Rules.DEFAULT_RULES) {
    assert.ok(merged.some(item => item.id === rule.id), `${rule.id} kaybolmamalı`);
  }
  // Silinen yerleşikler tombstone ile yeniden eklenmemeli.
  const deleted = Rules.mergeWithDefaults(saved, ['builtin_critical_late', 'pps']);
  assert.ok(!deleted.some(rule => rule.id === 'builtin_critical_late'));
  assert.ok(!deleted.some(rule => rule.id === 'pps'));

  // Aynı id iki kez kaydedilmişse tek kalmalı.
  assert.equal(Rules.normalizeRules([{ id: 'x', conditions: [] }, { id: 'x', conditions: [] }]).length, 1);
});

test('v9.49 kural uygulandıktan sonra öncelik sayımları yeniden kurulur', () => {
  const model = analyze([nearOrder(7951), nearOrder(7952)]);
  const before = model.priorities.find(item => item.name === 'CRITICAL');
  assert.ok(!before || before.rows === 0, 'ön koşul: kritik yok');
  for (const analysis of model.orders) {
    analysis.priority = Rules.applyPriorityRules(analysis,
      [Rules.normalizeRule({ kind: 'priority', target: 'CRITICAL', name: 'hepsi', conditions: [{ field: '@stage', operator: 'eq', value: 'PRODUCTION' }] })], {}).priority;
  }
  const recounted = Engine.recount(model);
  const after = recounted.priorities.find(item => item.name === 'CRITICAL');
  assert.equal(after.rows, 2, 'çipler kural sonrası sayıyı göstermeli');
  // Teslimat sonucu sayımları DEĞİŞMEMELİ.
  assert.deepEqual(recounted.deliveryOutcome, model.deliveryOutcome);
});

test('formula kuralı edit sonrası yeniden derlenir', () => {
  const model = analyze([nearOrder(7961)]);
  const rule = Rules.normalizeRule({
    id: 'formula-recompile', kind: 'checklist', name: 'x', mode: 'formula',
    formula: '=[@daysToLoad]<=60', conditions: [{ field: '@daysToLoad', operator: 'lte', value: 60 }],
  });
  assert.equal(Rules.matchesRule(rule, Rules.factsFor(model.orders[0], {})), true);
  rule.formula = '=[@daysToLoad]<0';
  assert.equal(Rules.matchesRule(rule, Rules.factsFor(model.orders[0], {})), false);
});

test('v9.49 kural motoru saf: DOM, ağ, AI yok', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'cp-rules-engine.js'), 'utf8');
  assert.doesNotMatch(source, /document\.|fetch\(|localStorage/);
  assert.doesNotMatch(source, /\/api\/copilot|BLCopilot|octopus/i);
  // Kullanıcı ifadesi ÇALIŞTIRILMAMALI: koşullar veri, kod değil.
  assert.doesNotMatch(source, /\beval\(|new Function\(/, 'kullanıcı koşulu kod olarak çalıştırılmamalı');
});

test('Rules Field listesi canlı CP metadata etiketlerini ve Formula Columns label alanını kullanır', () => {
  const catalog = Rules.fieldCatalog(
    [{ custom_key: 'A', __f_calc: 'X' }],
    {
      columnCatalog: [
        { key: 'custom_key', label: 'RFID Status', dataType: 'text' },
        { key: '__CPX_db_only', displayName: 'Ürün Tanım', dataType: 'text', modelCustom: true },
      ],
      formulaColumns: [{ id: 'calc', label: 'RFID Order', format: 'text' }],
      checklistItems: Checklist.ITEMS,
    }
  );
  assert.equal(catalog.columns.find(item => item.id === 'custom_key').tr, 'RFID Status');
  assert.equal(catalog.columns.find(item => item.id === '__CPX_db_only').tr, 'Ürün Tanım', 'ilk örnek satırda değer olmasa da canlı CP kataloğundan gelmeli');
  assert.equal(catalog.columns.find(item => item.id === '__f_calc').tr, 'RFID Order', 'formula definition name değil label kullanır');
  assert.ok(catalog.columns.every(item => String(item.tr || '').trim()), 'Field dropdown boş etiket üretmemeli');
});
