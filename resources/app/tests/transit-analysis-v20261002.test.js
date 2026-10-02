'use strict';

// İthalat Yol Süresi Raporu → Yol Süreleri.
// Gerekçe: Global Lojistik pivot Excel'i ülke × dönem × taşıt bazında Yükleme /
// Yol / Gümrük / Uçtan Uca sürelerini taşır. Aynı veri aylık/haftalık ve ana/alt
// süreç pivotlarında TEKRAR eder; çift sayım olmadan ülke-taşıt özetine ve
// mevcut kural motorunun okuduğu transitRules önerisine dönüşmelidir.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-transit-analysis-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const TA = require('../public/transit-analysis');
const BR = require('../public/business-rules');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function filters(vehicle, basisLabel = 'Fiili Yükleme Yıl') {
  return [
    ['Dolum Şekli', 'All'],
    [basisLabel, '2025'],
    ['Vasita Tanim', vehicle],
    ['Final Destination', 'Antrepo'],
    [],
  ];
}

const monthlyMain = {
  name: '1.2.Ant_Yük.Ay_Ana Süreç',
  rows: [
    ...filters('Gemi'),
    [null, null, 'Değerler'],
    ['Fiili Yükleme Yıl Ay', 'Ürün Menşei', 'Yükleme Süresi', 'Fiili Yükleme - ETA', 'Yol Süresi', 'Gümrük Süresi (Antrepo)', 'Uçtan Uca Yol Süresi', 'Yükleme Toplam Adet', 'Antrepo/Depo Kabul Oranı'],
    [202501, 'BANGLADEŞ', 10, 50, 50, 5, 65, 3000, 1],
    [202502, 'BANGLADEŞ', 12, 48, 48, 5, 65, 1000, 1],
    [202503, 'BANGLADEŞ', 14, 54, 54, 7, 75, 1000, 1],
    [202501, 'KAMBOÇYA', 10, 60, 60, 4, 74, 6000, 1],
    [202501, 'MISIR', 11, -2, -2, 8, 17, 90000, 1],
    [202502, 'MISIR', 11, -2, -2, 8, 17, 90000, 1],
    [202503, 'MISIR', 11, -2, -2, 8, 17, 90000, 1],
    [202502, null, null, null, null, null, null, 928],
    ['Genel Toplam', null, 11, 50, 50, 5, 66, 999999, 1],
  ],
};

// Aynı veri haftalık kırılımda: aylık sayfa varken kullanılmamalı.
const weeklyDuplicate = {
  name: '2.1.Ant_Yük.Haft.-Ana Süreç',
  rows: [
    ...filters('Gemi'),
    ['Fiili Yükleme Yıl Hafta', 'Ürün Menşei', 'Yükleme Süresi', 'Yol Süresi', 'Gümrük Süresi (Antrepo)', 'Uçtan Uca Yol Süresi', 'Yükleme Toplam Adet'],
    [202501, 'BANGLADEŞ', 99, 99, 99, 297, 5000],
  ],
};

const weeklySteps = {
  name: '2.2.Ant_Yük.Haft.-Alt Süreç',
  rows: [
    ['ANA SÜREÇLER'],
    ...filters('Gemi'),
    [null, null, null, 'YÜKLEME SÜRESİ', null, null, null, 'YOL SÜRESİ'],
    [null, null, 'Değerler'],
    ['Fiili Yükleme Yıl Hafta', 'Ürün Menşei', '1.2. Yükleme İthalat Onay Tarihi - Yükleme Talep Tarihi', '1. Yükleme Talep - HandOver', '2. Handover Tarihi - CutOff Tarihi', '4. Fiili Yükleme - ETA', '5. Özet Beyan Onay Tarihi-ETA Tarihi', 'Yükleme Süresi', 'Yol Süresi', 'Gümrük Süresi (Antrepo)', 'Uçtan Uca Yol Süresi', 'Yükleme Toplam Adet'],
    [202501, 'BANGLADEŞ', 1, 4, 3, 50, 1, 10, 50, 5, 65, 1000],
    [202502, 'BANGLADEŞ', 1, 2, 3, 50, 1, 10, 50, 5, 65, 3000],
  ],
};

// Vasita = All: taşıt karışık; analizde görünür ama kurala aktarılamaz.
const mixedVehicle = {
  name: '4.1.Ant_DepoHaft_Alt Süreç (2)',
  rows: [
    ...filters('All', 'Tema Depo Giriş Yıl'),
    ['Ürün Menşei', 'Tema Depo Giriş Yıl Hafta', 'Yükleme Süresi', 'Yol Süresi', 'Gümrük Süresi (Antrepo)', 'Uçtan Uca Yol Süresi', 'Yükleme Toplam Adet'],
    ['ÇİN', 202601, 15, 40, 5, 60, 2000],
  ],
};

const explanations = { name: 'Açıklamalar', rows: [['BAŞLIK', 'AÇIKLAMA / FORMÜL'], ['Yükleme Süresi', 'Yükleme Talep Tarih - Fiili Yükleme Tarih']] };

function analysis() {
  return TA.parseWorkbook([monthlyMain, weeklyDuplicate, weeklySteps, mixedVehicle, explanations], { fileName: 'rapor.xlsx', importedAt: '2026-10-02T08:00:00.000Z' });
}

test('pivot sayfaları okunur; tekrar eden haftalık veri aylık varken kullanılmaz', () => {
  const a = analysis();
  assert.ok(a);
  assert.deepEqual(a.parsedSheets, [monthlyMain.name, weeklyDuplicate.name, weeklySteps.name, mixedVehicle.name]);
  const main = a.sources.filter(s => s.role === 'main');
  assert.deepEqual(main.map(s => [s.sheet, s.basis, s.vehicle, s.year, s.granularity]), [
    [monthlyMain.name, 'loading', 'Gemi', '2025', 'month'],
    [mixedVehicle.name, 'warehouse', '', '2026', 'week'],
  ]);
  assert.ok(!a.records.some(r => r.endToEnd === 297), 'haftalık kopya çift sayılmamalı');
  assert.ok(!a.records.some(r => /GENEL TOPLAM/i.test(r.country)), 'Genel Toplam satırı veri değildir');
  assert.ok(!a.records.some(r => r.qty === 928), 'ülkesi boş satır atlanır');
});

test('ülke × taşıt özeti adet ağırlıklı ortalama, P80 ve alt süreçleri üretir', () => {
  const s = TA.summarize(analysis(), { basis: 'loading' });
  assert.equal(s.year, '2025');
  const bd = s.rows.find(r => r.ruleCountry === 'Bangladesh');
  assert.equal(bd.vehicle, 'Gemi');
  assert.equal(bd.qty, 5000);
  assert.equal(bd.periods, 3);
  // (65*3000 + 65*1000 + 75*1000) / 5000 = 67
  assert.equal(bd.endToEnd, 67);
  assert.equal(bd.loading, (10 * 3000 + 12 * 1000 + 14 * 1000) / 5000);
  assert.equal(bd.p80, 65);
  assert.equal(bd.max, 75);
  // Alt süreç: 1. adım adet ağırlıklı (4*1000 + 2*3000)/4000 = 2.5
  assert.equal(bd.producerDays, 2.5);
  assert.deepEqual(bd.steps.map(x => x.code), ['1', '1.2', '2', '4', '5']);
  assert.equal(bd.steps.find(x => x.code === '1.2').informational, true);
  assert.equal(bd.steps.find(x => x.code === '5').group, 'customs');

  const kh = s.rows.find(r => r.ruleCountry === 'Cambodia');
  assert.equal(kh.lowSample, true, 'tek dönem/az adet düşük örneklem sayılır');
  const eg = s.rows.find(r => r.ruleCountry === 'Egypt');
  assert.equal(eg.anomaly, true, 'negatif yol süresi veri tutarsızlığıdır');

  const wh = TA.summarize(analysis(), { basis: 'warehouse' });
  assert.equal(wh.year, '2026', 'varsayılan yıl seçili bazdaki en güncel yıldır');
  assert.equal(wh.rows[0].vehicle, '');
});

test('öneriler yalnız tarihsiz/sezonsuz ülke-taşıt kuralını ekler/günceller ve motor tarafından okunur', () => {
  const s = TA.summarize(analysis(), { basis: 'loading' });
  const suggestions = TA.suggestRules(s, { metric: 'endToEnd', stat: 'mean' });
  assert.deepEqual(suggestions.map(x => [x.delType, x.country, x.days]).sort(), [
    ['Gemi', 'Bangladesh', 67], ['Gemi', 'Cambodia', 74], ['Gemi', 'Egypt', 17],
  ]);
  assert.equal(TA.suggestRules(s, { metric: 'handoverToWarehouse' }).find(x => x.country === 'Bangladesh').days, Math.round(67 - 2.5));
  assert.equal(TA.suggestRules(s, { metric: 'loadingToWarehouse' }).find(x => x.country === 'Bangladesh').days, 56); // (55*3000+53*1000+61*1000)/5000 = 55.8

  const existing = [
    { id: 'manual-bd', exfStart: '', exfEnd: '', seasons: [], countries: ['Bangladesh'], delType: 'Gemi', days: 70 },
    { id: 'dated-bd', exfStart: '2026-01-01', exfEnd: '2026-03-31', seasons: [], countries: ['Bangladesh'], delType: 'Gemi', days: 90 },
    { id: 'air-bd', exfStart: '', exfEnd: '', seasons: [], countries: ['Bangladesh'], delType: 'Uçak', days: 15 },
  ];
  const result = TA.applySuggestions(existing, suggestions);
  assert.equal(result.updated, 1);
  assert.equal(result.added, 2);
  assert.equal(result.rules.find(r => r.id === 'manual-bd').days, 67, 'aynı kapsamlı kural güncellenir, kimliği korunur');
  assert.equal(result.rules.find(r => r.id === 'dated-bd').days, 90, 'tarih kısıtlı özel kurala dokunulmaz');
  assert.equal(result.rules.find(r => r.id === 'air-bd').days, 15, 'başka taşıt tipine dokunulmaz');
  assert.equal(existing[0].days, 70, 'girdi dizisi mutasyona uğramaz');

  // Kural motoru CP'deki İngilizce ve Excel'deki Türkçe ülke adını aynı kabul eder.
  for (const country of ['Cambodia', 'KAMBOÇYA']) {
    const hit = BR.findTransitRule(result.rules, '2026-05-01', 'SS26', country, 'Gemi');
    assert.equal(hit && hit.days, 74, country);
  }
  assert.equal(BR.transitCountryKey('RUANDA'), BR.transitCountryKey('Rwanda'));
  assert.equal(BR.transitCountryKey('PAKİSTAN'), BR.transitCountryKey('Pakistan'));
  assert.equal(TA.applySuggestions(result.rules, suggestions).unchanged, 3, 'tekrar aktarım idempotenttir');
});

test('normalizeAnalysis bozuk girdiyi reddeder ve kalıcı şekli sınırlar', () => {
  assert.equal(TA.normalizeAnalysis(null), null);
  assert.equal(TA.normalizeAnalysis({ records: [{ basis: 'x', period: '202501', country: 'A', endToEnd: 5 }] }), null);
  const clean = TA.normalizeAnalysis({ records: [{ basis: 'loading', granularity: 'month', period: '202501', country: '<b>X</b>', vehicle: 'SEA', endToEnd: '12,5', loading: 99999 }] });
  assert.equal(clean.records[0].vehicle, 'Gemi');
  assert.equal(clean.records[0].endToEnd, 12.5);
  assert.equal(clean.records[0].loading, null, 'makul olmayan gün değeri atılır');
  assert.equal(TA.parseWorkbook([explanations]), null, 'pivot olmayan Excel tanınmaz');
});

test('analiz sunucuda revizyonlu tek merkezde saklanır', () => {
  const db = require('../server/db');
  assert.equal(db.loadOverrides().transitAnalysis, null);
  const first = db.replaceTransitAnalysis(analysis(), 0);
  assert.equal(first.revision, 1);
  assert.equal(first.analysis.records.length, analysis().records.length);
  assert.deepEqual(db.loadOverrides().transitAnalysis, first.analysis);
  assert.throws(() => db.replaceTransitAnalysis(null, 0), err => err.code === 'REVISION_CONFLICT' && err.revisionKey === 'transitAnalysis');
  const cleared = db.replaceTransitAnalysis(null, 1);
  assert.equal(cleared.analysis, null);
  assert.equal(cleared.revision, 2);
});

test('Yol Süreleri penceresi analizi lazy yükler; sunucu uçları ve senkron alanı bağlıdır', () => {
  const app = read('public/app-main.js');
  const perf = read('public/perf-runtime.js');
  const server = read('server/server.js');
  const policy = read('server/lib/shared-sync-policy.js');
  const ui = read('public/transit-analysis-ui.js');
  assert.match(app, /id="_transitAnalysisMount"/);
  assert.match(app, /ensureFeature\?\.\('transitAnalysis'\)/);
  assert.match(app, /BLTransitAnalysisUI\.mount\(analysisMount,\{getRules:\(\)=>working,applyRules:/);
  assert.match(perf, /transitAnalysis:\['transit-analysis\.js','transit-analysis-ui\.js'\]/);
  assert.doesNotMatch(read('public/index.html'), /transit-analysis/, 'pencere açılmadan yüklenmez');
  assert.match(server, /app\.get\('\/api\/transit-analysis'/);
  assert.match(server, /app\.put\('\/api\/transit-analysis', userAccess\.requireArea\('source'\), userAccess\.requirePermission\('manageBusinessRules'\)/);
  assert.match(server, /publishSharedMasterChange\('transitAnalysis', req\)/);
  assert.match(policy, /'transitAnalysis'/);
  // Panel kuralları kendisi kaydetmez; mevcut "Kuralları Kaydet" akışı kullanılır.
  assert.doesNotMatch(ui, /\/api\/transit-rules/);
});

// Excel'siz yol: süreler Buyer Log'un zaten okuduğu ASAS + IAS verisinden gelir.
function iasRow(over) {
  return {
    'Sipariş Kod': 1001, 'Ürün Adı': 'MODEL A', 'Renk Kod': 'C1', 'Renk Tanım': 'SIYAH',
    'Supplier Portal Statü': 'Depoda', 'Vasita Tanim': 'Gemi', 'İthalat Dosya No': 'F1',
    'Yükleme Talep Tarih': '2025-01-01', 'HANDOVER Tarihi': '2025-01-05', 'ETA Tarih': '2025-03-10',
    'Tahmini Antrepo Giriş Tarihi': '2025-03-20', 'Yükleme Toplam Adet': 1000,
    ...over,
  };
}

test('IAS parsiyellerinden ülke × taşıt süreleri Excel olmadan hesaplanır', () => {
  const parse = require('../server/lib/parse');
  const source = require('../server/lib/transit-analysis-source');
  const overrides = require('../server/db').defaultOverrides();
  const map = parse.parseAntrepoRows([
    iasRow({ 'Yükleme Toplam Adet': 3000 }),
    // aynı sipariş, ikinci parsiyel: Ithalat. önekli Dashboard başlığı da tanınır
    iasRow({ 'İthalat Dosya No': 'F2', 'Yükleme Toplam Adet': 1000, 'Yükleme Talep Tarih': '2025-01-10', 'ETA Tarih': null, 'Ithalat.ETA Tarih': '2025-03-15', 'Tahmini Antrepo Giriş Tarihi': '2025-03-30' }),
    // henüz yolda: antrepo girişi tahmindir, analize girmez
    iasRow({ 'İthalat Dosya No': 'F3', 'Supplier Portal Statü': 'Yol Operasyonları', 'Tahmini Antrepo Giriş Tarihi': '2025-05-20' }),
    // uçak, başka sipariş/ülke
    iasRow({ 'Sipariş Kod': 2002, 'Ürün Adı': 'MODEL B', 'Vasita Tanim': 'Uçak', 'Yükleme Talep Tarih': '2025-02-01', 'HANDOVER Tarihi': '2025-02-03', 'ETA Tarih': '2025-02-08', 'Tahmini Antrepo Giriş Tarihi': '2025-02-12' }),
  ], overrides);
  const orders = [
    { ocode: 1001, model: 'MODEL A', ccode: 'C1', colour: 'SIYAH', countryRaw: 'BANGLADEŞ' },
    // aynı IAS satırına bağlanan ikinci ASAS satırı sevkiyatı iki kez saydırmaz
    { ocode: 1001, model: 'MODEL A', ccode: 'C1', colour: 'SIYAH', countryRaw: 'BANGLADEŞ' },
    { ocode: 2002, model: 'MODEL B', ccode: 'C1', colour: 'SIYAH', countryRaw: 'HİNDİSTAN' },
  ];
  const analysis = source.buildLiveAnalysis({ orders, antrepoMap: map, overrides, today: '2026-10-02' });
  assert.equal(analysis.source, 'database');
  assert.deepEqual(analysis.stats, { total: 4, used: 3, notArrived: 1, missingDates: 0, outOfRange: 0, missingVehicle: 0, missingCountry: 0 });
  assert.equal(analysis.columns.actualLoading, false);

  const s = TA.summarize(analysis, { basis: 'warehouse' });
  const sea = s.rows.find(r => r.vehicle === 'Gemi' && r.ruleCountry === 'Bangladesh');
  assert.equal(sea.shipments, 2);
  assert.equal(sea.qty, 4000);
  // uçtan uca: (78*3000 + 79*1000)/4000 = 78.25 → 78.3
  assert.equal(sea.endToEnd, 78.3);
  assert.equal(sea.customs, 11.3); // ETA → giriş: (10*3000 + 15*1000)/4000 = 11.25
  assert.equal(sea.producerDays, 1.8); // talep → handover: (4*3000 + (-5)*1000)/4000 = 1.75
  assert.equal(sea.lowSample, true, '5 sevkiyattan az');
  const air = s.rows.find(r => r.vehicle === 'Uçak');
  assert.equal(air.ruleCountry, 'India');
  assert.equal(air.endToEnd, 11);
  assert.deepEqual(TA.suggestRules(s).map(x => [x.delType, x.country, x.days]).sort(), [['Gemi', 'Bangladesh', 78], ['Uçak', 'India', 11]]);
  assert.equal(TA.metricLabels(analysis).endToEnd, 'Yükleme Talep → Antrepo Giriş');
});

test('IAS kaynağında gerçekleşen tarih sütunları varsa tahminin önüne geçer; tutarsız/gelecek kayıt atılır', () => {
  const a = TA.buildFromShipments([
    { country: 'ÇİN', vehicle: 'Gemi', qty: 10, arrived: true, loadingRequest: '2025-01-01', handover: '2025-01-05', actualLoading: '2025-01-15', eta: '2025-02-20', warehouseEntry: '2025-03-01' },
    { country: 'ÇİN', vehicle: 'Gemi', qty: 10, arrived: true, loadingRequest: '2025-04-01', warehouseEntry: '2025-03-01' },
    { country: 'ÇİN', vehicle: 'Gemi', qty: 10, arrived: true, loadingRequest: '2026-09-01', warehouseEntry: '2026-12-01' },
    { country: '', vehicle: 'Gemi', qty: 10, arrived: true, loadingRequest: '2025-01-01', warehouseEntry: '2025-03-01' },
  ], { today: '2026-10-02' });
  assert.deepEqual(a.stats, { total: 4, used: 1, notArrived: 1, missingDates: 0, outOfRange: 1, missingVehicle: 0, missingCountry: 1 });
  const wh = TA.summarize(a, { basis: 'warehouse' }).rows[0];
  assert.equal(wh.loading, 14); // talep → fiili yükleme
  assert.equal(wh.transit, 36); // fiili yükleme → ETA
  assert.deepEqual(wh.steps.map(x => x.code), ['1', '2', '2.1', '2.2', '3']);
  assert.equal(TA.summarize(a, { basis: 'loading' }).rows[0].endToEnd, 59, 'fiili yükleme varsa yükleme bazı da üretilir');
});

test('canlı uç nokta Backlog ile aynı kapsam ve eşleştirmeyi kullanır; panel varsayılanı Buyer Log verisidir', () => {
  const server = read('server/server.js');
  const ui = read('public/transit-analysis-ui.js');
  assert.match(server, /app\.get\('\/api\/transit-analysis\/live', userAccess\.requireAnyArea\('source', 'backlog'\)/);
  assert.match(server, /filterRowsByScope\(req\.currentUser, filterRowsByEffectiveHorizon\(req\.currentUser, 'backlog', ordersForTarget\(active, 'backlog', overrides\)\)\)/);
  assert.match(read('server/lib/transit-analysis-source.js'), /parseLib\.findAntrepoHits\(antrepoMap, order, \{ rule: overrides \}\)/);
  assert.match(ui, /const view = \{ source: 'database'/);
  assert.match(ui, /fetch\('\/api\/transit-analysis\/live'/);
});
