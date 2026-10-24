'use strict';

/* v9.47 — BACKLOG OTOMASYON VERİ KATMANI
 *
 * Korunan asıl kusur: otomasyonun teslimat riskini KENDİ hesaplaması. O an
 * ekranda görünen risk ile üreticiye giden maildeki risk ayrışır ve kimse
 * fark etmez. Bu yüzden buradaki testler zenginleştirilmiş alanın motorun
 * kendi çıktısıyla BİREBİR aynı olduğunu ölçer; "makul görünüyor" yetmez.
 *
 * Satırlar elle yazılmaz: gerçek üretici (parse.backlogTemplateRowsFromSegments)
 * çağrılır — alan adı sunucuda değişirse test kırılsın (v9.46 deseni).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const parse = require('../server/lib/parse.js');
const Engine = require('../public/backlog-delivery-engine.js');
const BA = require('../server/lib/backlog-automation.js');
const store = require('../server/lib/automation-recipe-store.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');
const TRANSIT_RULES = [{ id: 'r-sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

function order(spec) {
  const o = spec || {};
  return {
    ocode: o.ocode || 1001, _matchOcode: String(o.ocode || 1001),
    model: o.model || 'MODEL-1', ccode: o.ccode || 'C1', colour: o.colour || 'SIYAH',
    qty: o.qty == null ? 1000 : o.qty, kalan: 0, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 4.82, plm: 'PLM1', ozel: 'S7AB73Z4',
    manufacturer: o.manufacturer || 'MF-1', season: o.season || '26SS',
    category: 'CLASS-1', merch: 'MAG-1', ageGroup: 'MMYG-1',
    buyerGrup: 'BG-1', countryRaw: o.countryRaw || 'HINDISTAN',
    license: 'LIC', productDescription: 'TISORT',
    ex: o.ex || null, retail: o.retail || null, mb: o.mb || null,
    opd: null, shipConf: null, buyer: 'BUYER-1', line: 'LINE-1',
  };
}
function segment(base, spec) {
  const o = spec || {};
  return {
    ...base,
    qty: o.qty == null ? base.qty : o.qty,
    _status: o.status, _arr: o.arr || null, _delType: o.delType || 'Gemi',
    _iasRow: o.ias || null, _segmentKind: o.kind || 'ias', _segmentIndex: 0,
    _orderQty: base.qty, _asasKalan: 0, _loadedQty: o.kind === 'ias' ? (o.qty == null ? base.qty : o.qty) : 0,
    _subManufacturer: 'SUB-1',
  };
}
function templateRows(segments, rules) {
  return parse.backlogTemplateRowsFromSegments(segments, { transitRules: rules === undefined ? TRANSIT_RULES : rules }, new Map(), []);
}

test('v9.47 zenginleştirme motorun ÇIKTISINI taşır, yeniden hesaplamaz', () => {
  const rows = templateRows([
    segment(order({ ocode: 5001, ex: '2026-08-01', retail: '2026-08-20' }), { status: 'Üretimde', kind: 'production' }),
    segment(order({ ocode: 5002, ex: '2026-06-01', retail: '2026-12-30' }), { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } }),
  ]);
  const enriched = BA.enrichRows(rows, { today: TODAY });
  assert.equal(enriched.length, rows.length);
  rows.forEach((row, index) => {
    // Kanonik kaynak: motorun kendi analizi. Alanlar birebir ondan gelmeli.
    const analysis = Engine.analyzeOrder(row, { today: TODAY, dateOrdinal: ord, settings: {} });
    assert.equal(enriched[index][BA.FIELDS.outcomeCode], analysis.deliveryOutcome);
    assert.equal(enriched[index][BA.FIELDS.riskCauseCode], analysis.riskCause || '');
    assert.equal(enriched[index][BA.FIELDS.stageCode], analysis.stage);
    assert.equal(enriched[index][BA.FIELDS.eta], BA.ordinalToISO(analysis.eta));
    assert.equal(enriched[index][BA.FIELDS.buffer], analysis.scheduleBufferDays == null ? '' : analysis.scheduleBufferDays);
  });
});

test('v9.47 kaynak satır DEĞİŞMEZ ve mevcut anahtarın üstüne yazılmaz', () => {
  const rows = templateRows([segment(order({ ocode: 5003, ex: '2026-06-01', retail: '2026-09-30' }), { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } })]);
  rows[0][BA.FIELDS.outcome] = 'ELLE GİRİLMİŞ';
  const before = JSON.stringify(rows[0]);
  const enriched = BA.enrichRows(rows, { today: TODAY });
  assert.equal(JSON.stringify(rows[0]), before, 'kaynak satır mutasyona uğramamalı');
  assert.equal(enriched[0][BA.FIELDS.outcome], 'ELLE GİRİLMİŞ', 'var olan sütunun üstüne yazılmamalı');
  assert.ok(enriched[0][BA.FIELDS.outcomeCode], 'yeni alanlar yine de eklenmeli');
});

test('v9.47 hesaplanamayan sipariş ZORLA risk kategorisine sokulmaz', () => {
  // Yol süresi kuralı tanımsız: motor hesaplamayı reddeder → UNKNOWN kalır.
  const rows = templateRows([segment(order({ ocode: 5004, ex: '2026-08-01', retail: '2026-10-20' }), { status: 'Üretimde', kind: 'production' })], []);
  const enriched = BA.enrichRows(rows, { today: TODAY });
  assert.equal(enriched[0][BA.FIELDS.outcomeCode], 'UNKNOWN');
  assert.equal(enriched[0][BA.FIELDS.transitRuleMissing], 'Evet');
  assert.equal(enriched[0][BA.FIELDS.owner], '', 'hesaplanamayan sipariş için sorumlu atanmamalı');
});

test('v9.47 planlanan transit süresi aşılmış post-production sipariş artık riskli yönlendirilir', () => {
  const onTrack = BA.enrichRows(templateRows([segment(order({ ocode: 5005, ex: '2026-06-01', retail: '2027-06-30' }), { status: 'Yolda', arr: '2026-12-10', kind: 'ias', ias: { handover: '2026-06-01' } })]), { today: TODAY })[0];
  // Hedef tarih çok ileride olsa bile 70 günlük plan 05.09.2026 itibarıyla
  // aşılmış ve ürün hâlâ depoya girmemiştir. Yeni Backlog kuralı bunu Risk Var
  // sayar; otomasyon da aynı kanonik motoru izleyerek sorumlu atamalıdır.
  assert.equal(onTrack[BA.FIELDS.outcomeCode], 'AT_RISK');
  assert.equal(onTrack[BA.FIELDS.riskCauseCode], 'TRANSIT_DELAY');
  assert.ok(onTrack[BA.FIELDS.owner]);

  const late = BA.enrichRows(templateRows([segment(order({ ocode: 5006, ex: '2026-08-01', retail: '2026-08-20' }), { status: 'Üretimde', kind: 'production' })]), { today: TODAY })[0];
  assert.notEqual(late[BA.FIELDS.outcomeCode], 'ON_TRACK');
  assert.ok(late[BA.FIELDS.owner], 'riskli siparişin bir sorumlusu olmalı');
});

test('v9.47 yönlendirme tablosu ezilebilir; bilinmeyen sebep varsayılana düşer', () => {
  assert.equal(BA.ownerForCause('LATE_LOADING', null), 'supplier');
  assert.equal(BA.ownerForCause('LATE_LOADING', { ...BA.DEFAULT_OWNER_ROUTING, LATE_LOADING: 'merchandiser' }), 'merchandiser');
  assert.equal(BA.ownerForCause('BOYLE_BIR_SEBEP_YOK', null), 'none');
});

test('v9.47 yazışma dili TEK yerde belirlenir: üretim ülkesi Türkiye ise TR', () => {
  const tr = templateRows([segment(order({ ocode: 5007, countryRaw: 'TÜRKİYE', ex: '2026-06-01', retail: '2026-09-30' }), { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } })])[0];
  const other = templateRows([segment(order({ ocode: 5008, countryRaw: 'HINDISTAN', ex: '2026-06-01', retail: '2026-09-30' }), { status: 'Yolda', arr: '2026-08-10', kind: 'ias', ias: { handover: '2026-06-01' } })])[0];
  assert.equal(BA.resolveCommunicationLanguage(tr), 'tr');
  assert.equal(BA.resolveCommunicationLanguage(other), 'en');
  assert.equal(BA.enrichRows([tr], { today: TODAY })[0][BA.FIELDS.language], 'tr');
  assert.equal(BA.enrichRows([other], { today: TODAY })[0][BA.FIELDS.language], 'en');
});

test('v9.47 hedef tipi ayarı motora geçer (Retail Depo ↔ In Store)', () => {
  const rows = templateRows([segment(order({ ocode: 5009, ex: '2026-06-01', retail: '2026-09-10', mb: '2027-03-01' }), { status: 'Üretimde', kind: 'production' })]);
  const retail = BA.enrichRows(rows, { today: TODAY, settings: { targetType: 'retail' } })[0];
  const inStore = BA.enrichRows(rows, { today: TODAY, settings: { targetType: 'inStore' } })[0];
  assert.equal(retail[BA.FIELDS.targetType], 'Retail Depo');
  assert.equal(inStore[BA.FIELDS.targetType], 'In Store');
  assert.notEqual(retail[BA.FIELDS.targetDate], inStore[BA.FIELDS.targetDate]);
});

test('v9.47 tarif ayarları: uydurma sebep/sorumlu SESSİZCE atılır', () => {
  const recipe = store.normalizeRecipe({
    source: 'backlog', purpose: 'email',
    backlog: { targetType: 'inStore', requireTransitRule: false, routing: { late_loading: 'MERCHANDISER', UYDURMA_SEBEP: 'supplier', TRANSIT_DELAY: 'kimse' } },
  }, 'u1');
  assert.equal(recipe.backlog.targetType, 'inStore');
  assert.equal(recipe.backlog.requireTransitRule, false);
  assert.deepEqual(recipe.backlog.routing, { LATE_LOADING: 'merchandiser' },
    'yalnız bilinen sebep+sorumlu çifti kalmalı — yanlış yönlendirme yanlış kişiye giden mail demektir');
});

test('v9.47 tarif ayarları varsayılanı: Retail Depo ve yol süresi kuralı ZORUNLU', () => {
  const recipe = store.normalizeRecipe({ source: 'backlog' }, 'u1');
  assert.equal(recipe.backlog.targetType, 'retail');
  assert.equal(recipe.backlog.requireTransitRule, true);
  assert.deepEqual(recipe.backlog.routing, {});
});

test('v9.47 e-posta dili tarifle taşınır; varsayılan TR ve sabit', () => {
  const auto = store.normalizeRecipe({ source: 'backlog', purpose: 'email', email: { languageMode: 'auto', subjectEn: 'Delivery follow-up', bodyEn: 'Dear supplier' } }, 'u1');
  assert.equal(auto.email.languageMode, 'auto');
  assert.equal(auto.email.subjectEn, 'Delivery follow-up');
  assert.equal(store.normalizeRecipe({ source: 'backlog' }, 'u1').email.languageMode, 'tr');
  assert.equal(store.normalizeRecipe({ email: { languageMode: 'klingon' } }, 'u1').email.languageMode, 'tr');
});

test('v9.47 sunucu bağlantısı: alan seçici ile çalıştırma AYNI satır üreticisinden geçer', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  assert.match(server, /async function automationSourceRows\(ownerId, profile, source, recipe, assertAuthority=null\)/);
  assert.match(server, /if \(source !== 'backlog'\) return list;/);
  // dataset-fields ve dataset-values artık ham agentPlatformDataset'i DEĞİL,
  // zenginleştirilmiş yolu kullanmalı; yoksa kullanıcı filtre kurabildiği ama
  // çalıştırmada olmayan bir alan görürdü (ya da tersi).
  const fieldsRoute = server.slice(server.indexOf("app.get('/api/automations/dataset-fields'"), server.indexOf("app.get('/api/automations/dataset-values'"));
  assert.doesNotMatch(fieldsRoute, /agentPlatformDataset/);
  assert.match(fieldsRoute, /automationSourceRows/);
  const valuesRoute = server.slice(server.indexOf("app.get('/api/automations/dataset-values'"), server.indexOf("app.get('/api/automations/dataset-values'") + 1200);
  assert.doesNotMatch(valuesRoute, /agentPlatformDataset/);
});

test('v9.47 sunucu bağlantısı: mail dili grup bazında seçilir, EN metni yoksa TR\'ye düşer', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'automation-execution-service.js'), 'utf8');
  assert.match(server, /const groupLanguage=mailRows=>/);
  assert.match(server, /backlogAutomation\.resolveCommunicationLanguage\(row\)/);
  // EN metni tanımlı değilse Türkçesi kullanılmalı.
  assert.match(server, /useEn=lang==='en'&&\(email\.subjectEn\|\|email\.bodyEn\)/);
  assert.match(server, /body=useEn&&email\.bodyEn\?email\.bodyEn:email\.body/);
});

test('v9.47 arayüz: Backlog ayar bölümü görünür bir kapsayıcıda ve yalnız backlog kaynağında', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'automations.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
  assert.match(view, /\$\{source==='backlog'\?renderBacklogSection\(\):''\}/);
  assert.match(view, /function renderBacklogSection\(\)/);
  // CLAUDE.md §4: <section> kendisine display veren bir kural bulamazsa
  // SESSİZCE kaybolur. Kullanılan sınıf display vermeli.
  assert.match(view, /renderBacklogSection\(\)\{[^]*?<section class="autoSection">/);
  assert.match(css, /\.autoSection\{display:/);
  // Ayarlar gerçekten taslağa yazılmalı, yoksa ekran çalışır görünüp kaydetmez.
  for (const needle of ['data-backlog-target', 'data-backlog-require-rule', 'data-backlog-route']) {
    assert.ok((view.match(new RegExp(needle, 'g')) || []).length >= 2, `${needle} hem çizilmeli hem bağlanmalı`);
  }
});

test('v9.47 arayüz: İngilizce metin alanları yalnız gerektiğinde gösterilir ve taslağa yazılır', () => {
  const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'automations.js'), 'utf8');
  assert.match(view, /e\.languageMode==='auto'\|\|e\.languageMode==='en'\?/);
  for (const needle of ['data-email-language', 'data-email-subject-en', 'data-email-body-en']) {
    assert.ok((view.match(new RegExp(needle, 'g')) || []).length >= 2, `${needle} hem çizilmeli hem bağlanmalı`);
  }
  assert.match(view, /languageMode:'tr'/, 'yeni otomasyonun varsayılan dili sabit TR olmalı');
});

test('v9.47 otomasyon katmanında AI yok ve kendi risk eşiği tanımlı değil', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'lib', 'backlog-automation.js'), 'utf8');
  assert.doesNotMatch(source, /copilot|octopus|BLCopilot/i, 'AI çağrısı içermemeli');
  // Kendi sınıflandırmasını yazmamalı: sonuç adları yalnız motordan okunur.
  assert.doesNotMatch(source, /deliveryOutcome\s*=\s*['"]/, 'sonuç sınıflandırması burada üretilmemeli');
  assert.match(source, /Engine\.analyzeOrder\(/);
});
