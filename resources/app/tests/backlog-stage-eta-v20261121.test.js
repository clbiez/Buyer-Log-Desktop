'use strict';

// Backlog Teslimat Riski × aşama modeli.
// Gerekçe: yoldaki parsiyelin ETA'sı "Handover + tek kural günü" ile hesaplanınca
// ortalamayı aşmış ürün yetişecek, erken ilerleyen ürün geç görünür. Kayıtlı aşama
// modeli varsa ETA son gerçekleşen kilometre taşından yeniden hesaplanır; Ortalama /
// P80 seçimi kullanıcı ayarıdır; açık aşım ilgili aşamanın gecikme sebebini üretir.

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse.js');
const Engine = require('../public/backlog-delivery-engine.js');
const SM = require('../public/transit-stage-model.js');

const DAY = 86400000;
const now = new Date();
const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
const iso = offset => new Date(todayUtc + offset * DAY).toISOString().slice(0, 10);
const todayOrd = Math.round(todayUtc / DAY);
const ord = value => Engine.defaultOrdinal(value);

// Geçmiş: talep +3 handover +4 cutoff +2 yükleme +38..42 ETA +5 antrepo.
function history() {
  const list = [];
  for (let i = 0; i < 12; i += 1) {
    const s = -200 + i * 4, sea = 38 + (i % 5);
    list.push({ country: 'Hindistan', vehicle: 'Gemi', arrived: true, loadingRequest: iso(s), handover: iso(s + 3), cutOff: iso(s + 7),
      actualLoading: iso(s + 9), eta: iso(s + 9 + sea), summaryDeclaration: iso(s + 10 + sea), warehouseApproval: iso(s + 11 + sea),
      transitDeclaration: iso(s + 12 + sea), warehouseEntry: iso(s + 14 + sea) });
  }
  return SM.buildModel(list, { today: iso(0) });
}

function order() {
  return {
    ocode: 92001, _matchOcode: '92001', model: 'MODEL-S', ccode: 'C1', colour: 'BLACK', qty: 100, kalan: 0, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 5, plm: 'PLM1', ozel: '', manufacturer: 'MF-1', season: '26SS', category: 'CLASS-1', merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1',
    countryRaw: 'HINDISTAN', license: '', productDescription: '', ex: iso(-30), retail: iso(45), mb: iso(60), opd: iso(-90), shipConf: null, buyer: 'B', line: 'L',
  };
}
function partial(fields, status = 'Yolda') {
  const o = order();
  return { ...o, qty: 100, kalan: 0, _status: status, _arr: iso(90), _delType: 'Gemi',
    _iasRow: { handover: fields['HANDOVER Tarihi'] || '', vasita: 'Gemi', _sourceRow: 7, _sourceFields: fields },
    _segmentKind: 'ias', _segmentIndex: 0, _orderQty: 100, _asasKalan: 0, _loadedQty: 100 };
}
const rule = [{ id: 'sea', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];

function rowFor(fields, model = history(), status) {
  const rows = parse.backlogTemplateRowsFromSegments([partial(fields, status)], { transitRules: rule, transitAnalysis: model }, new Map(), []);
  return rows[0];
}

test('yoldaki parsiyel: ETA son gerçekleşen kilometre taşından, IAS tahmini ve tek kural yerine', () => {
  // Fiili yükleme 20 gün önce; ETA planı 20 gün sonra (gemi tarifesi).
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-31), 'HANDOVER Tarihi': iso(-28), 'Cut Off Tarih': iso(-24), 'Fiili Yükleme Tarih': iso(-20), 'ETA Tarih': iso(20) }); // i18n-ignore
  const p = row._backlogExcel.stageProjection;
  assert.ok(p, 'projeksiyon satıra taşınır');
  assert.equal(p.anchor, 'actualLoading');
  assert.equal(p.plan, 'eta');
  assert.equal(p.etaMean, iso(25)); // plan + Kalan(eta)=5
  const a = Engine.analyzeOrder(Engine.projectRow(row), { today: todayOrd, dateOrdinal: ord });
  assert.equal(a.etaSource, 'stage');
  assert.equal(a.eta, ord(iso(25)));
  assert.equal(a.etaStat, 'mean');
  assert.equal(a.confidence, 'HIGH');
  assert.equal(a.deliveryOutcome, 'ON_TRACK'); // retail +45
  // Statik ölçüt yalnız tanımlı kural: Handover (−28) + 70 = +42 → aşama ETA'sı 17 gün erken.
  assert.equal(a.ruleEta, ord(iso(42)));
  assert.equal(a.stageVsRuleDays, 17);
  assert.ok(a.onTimeProbability >= 0.99);
  assert.ok(Array.isArray(a.stageDeviations) && a.stageDeviations.length === SM.STAGES.length);
});

test('Ortalama / P80 seçimi aşama ETA istatistiğini değiştirir', () => {
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-12), 'HANDOVER Tarihi': iso(-9), 'Cut Off Tarih': iso(-5), 'Fiili Yükleme Tarih': iso(-3) }); // i18n-ignore
  const p = row._backlogExcel.stageProjection;
  const mean = Engine.analyzeOrder(Engine.projectRow(row), { today: todayOrd, dateOrdinal: ord });
  const p80 = Engine.analyzeOrder(Engine.projectRow(row), { today: todayOrd, dateOrdinal: ord, settings: { etaStat: 'p80' } });
  assert.equal(mean.eta, ord(p.etaMean));
  assert.equal(p80.eta, ord(p.etaP80));
  assert.ok(p80.eta >= mean.eta);
  assert.equal(p80.etaStat, 'p80');
});

test('ortalamayı aşan açık aşama gecikmeyi erken yakalar; statik kural "yetişiyor" derdi', () => {
  // Talep 25 gün önce, Handover hâlâ yok (ortalama 3 gün) → yükleme aşamasında açık aşım.
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-25) }, undefined, 'Yükleme Operasyonları'); // i18n-ignore
  const p = row._backlogExcel.stageProjection;
  assert.equal(p.currentStage, '1');
  assert.ok(p.openOverrunDays >= 20);
  const a = Engine.analyzeOrder(Engine.projectRow(row), { today: todayOrd, dateOrdinal: ord });
  assert.ok(a.stageOverrunDays >= 20);
  assert.ok(a.eta >= todayOrd + 50, 'ETA en erken bugün + Kalan(handover)');
  assert.notEqual(a.deliveryOutcome, 'ON_TRACK');
  assert.ok(a.riskReasons.includes('LATE_LOADING'));
});

test('model yoksa davranış değişmez: tek kural günü, aşama alanları boş', () => {
  const rows = parse.backlogTemplateRowsFromSegments([partial({ 'Fiili Yükleme Tarih': iso(-20) })], { transitRules: rule }, new Map(), []); // i18n-ignore
  assert.equal(rows[0]._backlogExcel.stageProjection, null);
  const a = Engine.analyzeOrder(Engine.projectRow(rows[0]), { today: todayOrd, dateOrdinal: ord });
  assert.notEqual(a.etaSource, 'stage');
  assert.equal(a.stageAnchor, null);
  assert.equal(a.onTimeProbability, null);
});

test('antrepoya girmiş parsiyelde aşama tahmini yapılmaz', () => {
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-60), 'Fiili Yükleme Tarih': iso(-50), 'Antrepo Giriş Tarih': iso(-2) }); // i18n-ignore
  assert.equal(row._backlogExcel.stageProjection, null);
});

test('toplu analiz aşama sinyallerini sayar ve kırılımı açar', () => {
  const late = rowFor({ 'Yükleme Talep Tarih': iso(-25) }, undefined, 'Yükleme Operasyonları'); // i18n-ignore
  const ok = rowFor({ 'Yükleme Talep Tarih': iso(-31), 'HANDOVER Tarihi': iso(-28), 'Cut Off Tarih': iso(-24), 'Fiili Yükleme Tarih': iso(-20), 'ETA Tarih': iso(20) }); // i18n-ignore
  const model = Engine.analyze([late, ok].map(Engine.projectRow), { today: todayOrd, dateOrdinal: ord });
  assert.equal(model.stagePerformance.projected.rows, 2);
  assert.equal(model.stagePerformance.overrun.rows, 1);
  assert.equal(Engine.selectOrders(model, { k: 'stageSignal', key: 'overrun' }).length, 1);
  assert.deepEqual(Engine.selectOrders(model, { k: 'stageSignal', key: 'bogus' }), []);
  assert.ok(require('../server/lib/read-model/backlog-v3-routes.js').DELIVERY_DRILL_KINDS.has('stageSignal'));
});

test('işçi / okuma modeli yolu: tarih sözlüğü yalnız rowDateValues\'tan kurulduğunda da aşama ETA\'sı kullanılır', () => {
  // backlog-delivery-worker.js ve read-model backlog-v3-model aynı deseni kullanır:
  // dateOrdinal yalnız rowDateValues değerlerinden kurulan sözlükten okunur.
  const row = Engine.projectRow(JSON.parse(JSON.stringify(rowFor({ 'Yükleme Talep Tarih': iso(-31), 'HANDOVER Tarihi': iso(-28), 'Cut Off Tarih': iso(-24), 'Fiili Yükleme Tarih': iso(-20), 'ETA Tarih': iso(20) })))); // i18n-ignore
  const table = new Map();
  for (const value of Engine.rowDateValues(row)) table.set(Engine.dateKey(value), Engine.defaultOrdinal(value));
  const lookup = value => table.get(Engine.dateKey(value)) ?? null;
  for (const etaStat of ['mean', 'p80']) {
    const { model } = Engine.analyzeDataset([row], { settings: { etaStat }, today: todayOrd, dateOrdinal: lookup });
    const order = model.orders[0];
    assert.equal(order.etaSource, 'stage', etaStat);
    assert.equal(order.eta, ord(etaStat === 'p80' ? row._backlogExcel.stageProjection.etaP80 : row._backlogExcel.stageProjection.etaMean));
    assert.equal(model.stagePerformance.projected.rows, 1);
  }
});

test('Yolda parsiyel: Cut Off / Fiili Yükleme sütunu gelmese de sahte Handover → Cut-off gecikmesi üretilmez', () => {
  // Gerçek sorgu şekli: Talep + Handover + ETA sütunu var (ETA boş), Cut Off / Fiili Yükleme yok.
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-33), 'HANDOVER Tarihi': iso(-30), 'ETA Tarih': '' }); // i18n-ignore
  const p = row._backlogExcel.stageProjection;
  assert.ok(p);
  assert.equal(p.openOverrunDays, 0);
  assert.notEqual(p.currentStage, '2');
  assert.equal(p.etaMean, iso(-30 + 51)); // Handover + Kalan(handover)
  const a = Engine.analyzeOrder(Engine.projectRow(row), { today: todayOrd, dateOrdinal: ord });
  assert.equal(a.stageOverrunDays || 0, 0);
  assert.ok(!a.riskReasons.includes('LATE_LOADING'));
});

// v20261122 — Handover ≠ Cut Off: Handover ürünün depoya teslimidir; ürün sonra
// cut-off'u bekleyebilir, ardından gemiye yüklenir. Gecikme sebebi aşamaya göre.
test('aşama aşımı sebebi: 1 Geç Handover, 2 Cut-off Bekleme, 3 Geç Yükleme; etiketler Handover der', () => {
  // Handover 20 gün önce, Cut Off yok (ortalama 4 gün) → 2. aşamada açık aşım.
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-23), 'HANDOVER Tarihi': iso(-20), 'Cut Off Tarih': '', 'Fiili Yükleme Tarih': '' }, undefined, 'Yükleme Operasyonları'); // i18n-ignore
  const p = row._backlogExcel.stageProjection;
  assert.equal(p.currentStage, '2');
  assert.ok(p.openOverrunDays > 0);
  const a = Engine.analyzeOrder(Engine.projectRow(row), { today: todayOrd, dateOrdinal: ord });
  assert.ok(a.riskReasons.includes('CUTOFF_WAIT'), a.riskReasons.join(','));
  assert.ok(!a.riskReasons.includes('VESSEL_LOADING_DELAY'));
  assert.deepEqual(Engine.STAGE_LOADING_CAUSE, { 1: 'LATE_LOADING', 2: 'CUTOFF_WAIT', 3: 'VESSEL_LOADING_DELAY' });
  assert.equal(Engine.RISK_CAUSE_LABELS.tr.LATE_LOADING, 'Geç Handover');
  assert.equal(Engine.RISK_CAUSE_LABELS.tr.CUTOFF_WAIT, 'Cut-off Bekleme');
  assert.equal(Engine.RISK_CAUSE_LABELS.en.VESSEL_LOADING_DELAY, 'Late Loading');
  assert.equal(Engine.LOADING_LABELS.tr.LOADED_LATE, 'Geç Handover');
  // Otomasyon yönlendirmesi yeni sebepleri tanır; eski LATE_LOADING kaydı korunur.
  const BA = require('../server/lib/backlog-automation.js');
  assert.equal(BA.ownerForCause('CUTOFF_WAIT', null), 'import');
  assert.equal(BA.ownerForCause('LATE_LOADING', null), 'supplier');
});

test('Yükleme Operasyonları: Cut Off / Fiili Yükleme sütunu gelmese de parsiyel yolda (4. aşama) görünmez', () => {
  // Sorgu şekli: Talep + Handover + ETA sütunu (boş); Cut Off / Fiili Yükleme sütunu yok.
  const row = rowFor({ 'Yükleme Talep Tarih': iso(-12), 'HANDOVER Tarihi': iso(-9), 'ETA Tarih': '' }, undefined, 'Yükleme Operasyonları'); // i18n-ignore
  const p = row._backlogExcel.stageProjection;
  assert.equal(p.currentStage, '2', 'Handover sonrası ilk aşama: cut-off bekleme');
  // Fiili Yükleme henüz yok (durum): aralık oraya kadar sayılır, ETA'ya atlamaz.
  assert.deepEqual([p.running.from, p.running.to], ['handover', 'actualLoading']);
  // Handover'dan 9 gün; Handover → Fiili Yükleme ortalaması 6 gün → 3 gün aşım.
  assert.equal(p.openOverrunDays, 3);
  // Yolda durumunda aynı tarihler 4. aşamadır (yükleme geçildi).
  const transit = rowFor({ 'Yükleme Talep Tarih': iso(-12), 'HANDOVER Tarihi': iso(-9), 'ETA Tarih': '' }); // i18n-ignore
  assert.equal(transit._backlogExcel.stageProjection.currentStage, '4');
});
