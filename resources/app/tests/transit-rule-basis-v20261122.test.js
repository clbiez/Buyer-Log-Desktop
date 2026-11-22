'use strict';

// Yol süresi kuralının bazı.
// Gerçek talep: "Yol Sürelerinde uçtan uca süre hesabını kurallara aktarıyorum.
// Kuralları neye göre çekmişsem ona göre gelmeli hesap." Uçtan Uca (Yükleme Talep →
// Antrepo) ölçüsünden aktarılan gün Handover'a eklenince Yükleme Talep → Handover
// aralığı hesap dışı kalıyordu. Kural bazını saklar; sevk edilmiş parsiyelde
// planlanan ETA = baz tarihi + kural günü.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BR = require('../public/business-rules.js');
const TA = require('../public/transit-analysis.js');
const parse = require('../server/lib/parse.js');
const SM = require('../public/transit-stage-model.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const DAY = 86400000;
const now = new Date();
const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const iso = offset => new Date(todayUtc + offset * DAY).toISOString().slice(0, 10);
const e2eRule = [{ id: 'e2e', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 60, basis: 'loadingRequest' }];

test('resolveTransitDays: Uçtan Uca kural Handover\'a eklenirken Talep → Handover kadar kısalır', () => {
  const base = { delType: 'Gemi', exFactory: iso(-40), season: '26SS', country: 'Hindistan', status: 'Yolda', rules: e2eRule, forceRules: true };
  const shifted = BR.resolveTransitDays({ ...base, anchor: 'handover', milestones: { handover: iso(-40), loadingRequest: iso(-59) } });
  assert.equal(shifted.days, 41, 'Handover + 41 = Talep + 60');
  assert.equal(shifted.basis, 'loadingRequest');
  assert.equal(shifted.basisShift, 19);
  // Tembel milestones fonksiyonu da çalışır.
  assert.equal(BR.resolveTransitDays({ ...base, anchor: 'handover', milestones: m => ({ handover: iso(-40), loadingRequest: iso(-59) })[m] }).days, 41);
  // Baz tarihi yoksa gün düzeltilmez, işaretlenir.
  const missing = BR.resolveTransitDays({ ...base, anchor: 'handover', milestones: { handover: iso(-40) } });
  assert.equal(missing.days, 60);
  assert.equal(missing.basisMissing, true);
  // Anchor yoksa (üretim: Ex-Factory + gün) davranış aynı.
  assert.equal(BR.resolveTransitDays(base).days, 60);
  // Eski / Handover bazlı kural değişmez; geçersiz baz Handover sayılır.
  assert.equal(BR.transitRuleBasis({}), 'handover');
  assert.equal(BR.transitRuleBasis({ basis: 'x' }), 'handover');
  const legacy = BR.resolveTransitDays({ ...base, rules: [{ ...e2eRule[0], basis: undefined }], anchor: 'handover', milestones: { handover: iso(-40), loadingRequest: iso(-59) } });
  assert.equal(legacy.days, 60);
  // Fiili Yükleme bazlı kural: Handover + (Fiili − Handover) + gün.
  const loading = BR.resolveTransitDays({ ...base, rules: [{ ...e2eRule[0], basis: 'actualLoading', days: 45 }], anchor: 'handover', milestones: { handover: iso(-40), actualLoading: iso(-33) } });
  assert.equal(loading.days, 52);
});

test('Yol Süresi Analizi aktarımı ölçüyü kural bazı olarak yazar; yalnız baz değişse de güncellenir', () => {
  const suggestion = [{ delType: 'Gemi', country: 'Bangladesh', days: 60 }];
  const added = TA.applySuggestions([], suggestion, 'endToEnd');
  assert.equal(added.added, 1);
  assert.equal(added.rules[0].basis, 'loadingRequest');
  const again = TA.applySuggestions(added.rules, suggestion, 'handoverToWarehouse');
  assert.equal(again.updated, 1, 'gün aynı, baz farklı → güncellendi');
  assert.equal(again.rules[0].basis, 'handover');
  assert.equal(TA.applySuggestions(again.rules, suggestion, 'handoverToWarehouse').unchanged, 1);
  assert.deepEqual(TA.METRIC_BASIS, { endToEnd: 'loadingRequest', handoverToWarehouse: 'handover', loadingToWarehouse: 'actualLoading' });
});

test('kural kaydı bazı korur; yalnız baz değişikliği birleştirmede kaybolmaz', () => {
  const svc = require('../server/lib/resource-rule-service.js');
  const [rule] = svc.normalizeTransitRules([{ id: 'r1', delType: 'Gemi', days: 60, countries: ['Bangladesh'], basis: 'loadingRequest' }]);
  assert.equal(rule.basis, 'loadingRequest');
  assert.equal(svc.normalizeTransitRules([{ id: 'r2', delType: 'Gemi', days: 60 }])[0].basis, 'handover');
  const db = read('server/db.js');
  assert.match(db, /basis: rule\.basis \|\| 'handover',/);
  assert.match(read('public/app-main.js'), /days,basis:BLBusinessRules\.transitRuleBasis\(r\)\}\);/);
});

function order(over = {}) {
  return { ocode: 94001, _matchOcode: '94001', model: 'MODEL-B', ccode: 'C1', colour: 'BLACK', qty: 100, kalan: 0, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 5, plm: '', ozel: '', manufacturer: 'MF', season: '26SS', category: 'K', merch: 'M', ageGroup: 'A', buyerGrup: 'BG', countryRaw: 'HINDISTAN',
    license: '', productDescription: '', ex: iso(-45), retail: iso(60), mb: iso(75), opd: iso(-90), shipConf: null, buyer: 'B', line: 'L', ...over };
}
function partial(fields, status = 'Yolda') {
  return { ...order(), _status: status, _arr: iso(40), _delType: 'Gemi',
    _iasRow: { handover: fields['HANDOVER Tarihi'] || '', vasita: 'Gemi', _sourceRow: 3, _sourceFields: fields },
    _segmentKind: 'ias', _segmentIndex: 0, _orderQty: 100, _asasKalan: 0, _loadedQty: 100 };
}

test('Backlog: Uçtan Uca kural Yükleme Talep\'ten sayılır (yol aşımı ve ETA)', () => {
  // Talep −80, Handover −61 (19 gün), kural 60 gün Talep'ten → planlanan varış −20: aşılmış.
  const fields = { 'Yükleme Talep Tarih': iso(-80), 'HANDOVER Tarihi': iso(-61) }; // i18n-ignore
  const [row] = parse.backlogTemplateRowsFromSegments([partial(fields)], { transitRules: e2eRule }, new Map(), []);
  const meta = row._backlogExcel;
  assert.equal(meta.transitDays, 41, 'Handover + 41 = Talep + 60');
  assert.equal(meta.transitOverdue, true);
  assert.equal(meta.transitOverdueDays, 20);
  // Aynı gün Handover bazlı kuralda: Handover + 60 = −1 → 1 gün aşım.
  const [legacy] = parse.backlogTemplateRowsFromSegments([partial(fields)], { transitRules: [{ ...e2eRule[0], basis: 'handover' }] }, new Map(), []);
  assert.equal(legacy._backlogExcel.transitDays, 60);
  assert.equal(legacy._backlogExcel.transitOverdueDays, 1);
});

function model() {
  const list = [];
  for (let i = 0; i < 12; i += 1) {
    const s = -260 + i * 4;
    list.push({ country: 'Hindistan', vehicle: 'Gemi', arrived: true, loadingRequest: iso(s), handover: iso(s + 3), cutOff: iso(s + 7),
      actualLoading: iso(s + 9), eta: iso(s + 49), summaryDeclaration: iso(s + 50), warehouseApproval: iso(s + 51), transitDeclaration: iso(s + 52), warehouseEntry: iso(s + 54) });
  }
  return SM.buildModel(list, { today: iso(0) });
}

test('CP: planlanan ETA kuralın bazından; fark kalemleri baz → Handover süresini içerir ve toplamı farka eşit', () => {
  const ov = { ...require('../server/db').defaultOverrides(), transitRules: e2eRule, transitAnalysis: model() };
  const ias = { 'Sipariş Kod': 94001, 'Ürün Adı': 'MODEL-B', 'Renk Kod': 'C1', 'Renk Tanım': 'BLACK', 'Supplier Portal Statü': 'Yolda', 'Vasita Tanim': 'Gemi', // i18n-ignore
    'Yükleme Toplam Adet': 100, 'İthalat Dosya No': 'F1', 'Tahmini Antrepo Giriş Tarihi': iso(30), // i18n-ignore
    'Yükleme Talep Tarih': iso(-40), 'HANDOVER Tarihi': iso(-21), 'Fiili Yükleme Tarih': iso(-12), 'ETA Tarih': '' }; // i18n-ignore
  const map = parse.parseAntrepoRows([ias], ov);
  const row = parse.buildCPRowsFromASAS([order({ qty: 100, kalan: 100 })], map, ov)[0];
  const seg = row._logisticSegments.find(s => s.stage);
  assert.ok(seg, 'aşama özeti');
  const st = seg.stage;
  assert.equal(st.why.basis, 'loadingRequest');
  assert.equal(st.why.basisDate, iso(-40));
  assert.equal(st.why.basisToHandover, 19);
  assert.equal(st.why.ruleEta, iso(20), 'Talep + 60');
  const late = st.why.basisToHandover + st.why.base - st.why.ruleDays + st.why.items.reduce((a, i) => a + i.days, 0);
  assert.equal(late, -st.vsRule);
  // Segment ve satır baz tarihlerini taşır (istemci gerçekleşen süre ve CP teslimat motoru için).
  assert.deepEqual(seg.basisDates, { loadingRequest: iso(-40), actualLoading: iso(-12) });
  assert.deepEqual(row._ruleBasisDates, { loadingRequest: iso(-40), actualLoading: iso(-12) });
  // Handover bazlı kuralda baz tarihleri hiç okunmaz.
  const ov2 = { ...ov, transitRules: [{ ...e2eRule[0], basis: 'handover' }] };
  const row2 = parse.buildCPRowsFromASAS([order({ qty: 100, kalan: 100 })], parse.parseAntrepoRows([ias], ov2), ov2)[0];
  assert.equal(row2._ruleBasisDates, null);
  assert.equal(row2._logisticSegments.find(s => s.stage).stage.why.basis, 'handover');
});

test('istemci: gerçekleşen süre kuralın bazından; Planlanan ETA terimi; kural düzenleyicide baz', () => {
  const app = read('public/app-main.js');
  assert.match(app, /const basisDate=ruleBasis==='handover'\?segment\.handover:\(segment\.basisDates&&segment\.basisDates\[ruleBasis\]\)\|\|null;/);
  assert.match(app, /Planlanan ETA: \$\{ms\(basis\)\}/);
  assert.doesNotMatch(app, /'Statik ETA|Statik ETA:/);
  assert.match(app, /<select class="trxSelect" id="_transitBasis">/);
  const bda = read('public/backlog-delivery-analysis.js');
  assert.match(bda, /Planlanan ETA\\'dan geç/);
  assert.doesNotMatch(bda, /Statik ETA/);
  assert.match(read('public/cp-readiness-engine.js'), /anchor: handoverValue && basisDates \? 'handover' : null,/);
  assert.match(read('public/overview-global-flow.js'), /anchor:basis\?'handover':null,milestones:basis/);
});
