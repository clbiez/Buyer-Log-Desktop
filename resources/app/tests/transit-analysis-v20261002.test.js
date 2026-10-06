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
    'Tahmini Antrepo Giriş Tarihi': '2025-03-20', 'Antrepo Giriş Tarihi': '2025-03-20', 'Yükleme Toplam Adet': 1000,
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
    iasRow({ 'İthalat Dosya No': 'F2', 'Yükleme Toplam Adet': 1000, 'Yükleme Talep Tarih': '2025-01-10', 'ETA Tarih': null, 'Ithalat.ETA Tarih': '2025-03-15', 'Tahmini Antrepo Giriş Tarihi': '2025-04-30', 'Antrepo Giriş Tarihi': '2025-03-30' }),
    // gerçekleşen giriş yok: statü "Depoda" ve tahmini giriş olsa bile analize girmez
    iasRow({ 'İthalat Dosya No': 'F3', 'Tahmini Antrepo Giriş Tarihi': '2025-05-20', 'Antrepo Giriş Tarihi': null }),
    // uçak, başka sipariş/ülke
    iasRow({ 'Sipariş Kod': 2002, 'Ürün Adı': 'MODEL B', 'Vasita Tanim': 'Uçak', 'Yükleme Talep Tarih': '2025-02-01', 'HANDOVER Tarihi': '2025-02-03', 'ETA Tarih': '2025-02-08', 'Tahmini Antrepo Giriş Tarihi': '2025-02-12', 'Antrepo Giriş Tarihi': '2025-02-12' }),
  ], overrides);
  const orders = [
    { ocode: 1001, model: 'MODEL A', ccode: 'C1', colour: 'SIYAH', countryRaw: 'BANGLADEŞ' },
    // aynı IAS satırına bağlanan ikinci ASAS satırı sevkiyatı iki kez saydırmaz
    { ocode: 1001, model: 'MODEL A', ccode: 'C1', colour: 'SIYAH', countryRaw: 'BANGLADEŞ' },
    { ocode: 2002, model: 'MODEL B', ccode: 'C1', colour: 'SIYAH', countryRaw: 'HİNDİSTAN' },
  ];
  // Bu test adet ağırlıklı hesabı sınar (sevkiyat ortalaması ayrı testte).
  const analysis = source.buildLiveAnalysis({ orders, antrepoMap: map, overrides, today: '2026-10-02', weighting: 'qty' });
  assert.equal(analysis.source, 'database');
  assert.deepEqual(analysis.stats, { total: 4, used: 3, notArrived: 1, missingDates: 0, outOfRange: 0, missingVehicle: 0, missingCountry: 0, outOfWindow: 0, otherDestination: 0 });
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
  assert.deepEqual(a.stats, { total: 4, used: 1, notArrived: 1, missingDates: 0, outOfRange: 1, missingVehicle: 0, missingCountry: 1, outOfWindow: 0, otherDestination: 0 });
  const wh = TA.summarize(a, { basis: 'warehouse' }).rows[0];
  assert.equal(wh.loading, 14); // talep → fiili yükleme
  assert.equal(wh.transit, 36); // fiili yükleme → ETA
  assert.deepEqual(wh.steps.map(x => x.code), ['1', '4']); // Excel adım kodları; verisi olmayan adım gösterilmez
  assert.equal(TA.summarize(a, { basis: 'loading' }).rows[0].endToEnd, 59, 'fiili yükleme varsa yükleme bazı da üretilir');
});

test('canlı uç nokta: Backlog filtresi kapsamı Backlog ile aynı süzmeyi kullanır; panel varsayılanı modülün kendi IAS ufkudur', () => {
  const server = read('server/server.js');
  const ui = read('public/transit-analysis-ui.js');
  assert.match(server, /app\.get\('\/api\/transit-analysis\/live', userAccess\.requireAnyArea\('source', 'backlog'\)/);
  assert.match(server, /filterRowsByScope\(req\.currentUser, filterRowsByEffectiveHorizon\(req\.currentUser, 'backlog', ordersForTarget\(active, 'backlog', overrides\)\)\)/);
  assert.match(read('server/lib/transit-analysis-source.js'), /parseLib\.findAntrepoHits\(antrepoMap, order, \{ rule: overrides \}\)/);
  assert.match(ui, /const view = \{ source: 'database', scope: 'company', window: 'y1'/);
  // v2 görünüm kaydı: eski "filtered" tercihi bir kez modülün kendi ufkuna döner.
  assert.match(ui, /if \(saved\.v !== VIEW_VERSION\) view\.scope = 'company';/);
  assert.match(ui, /fetch\('\/api\/transit-analysis\/live\?'\s*\+\s*qs\.toString\(\)/);
});

// Kapsam (mevcut filtre / şirket geneli) ve tarih penceresi (son N hafta/ay/yıl).
test('tarih penceresi son N hafta/ay/yıl olarak hesaplanır; kısa pencerede haftalık kırılım', () => {
  assert.deepEqual(TA.windowRange('w4', '2026-10-02'), { key: 'w4', from: '2026-09-05', to: '2026-10-02', granularity: 'week' });
  assert.deepEqual(TA.windowRange('m3', '2026-10-02'), { key: 'm3', from: '2026-07-03', to: '2026-10-02', granularity: 'month' });
  assert.deepEqual(TA.windowRange('y1', '2026-10-02'), { key: 'y1', from: '2025-10-03', to: '2026-10-02', granularity: 'month' });
  assert.equal(TA.windowRange('bogus', '2026-10-02').key, 'all');
  assert.equal(TA.windowLabel('w6'), 'Son 6 hafta');
  assert.equal(TA.windowLabel('m1', 'en'), 'Last 1 month');
  assert.equal(TA.isoWeekOf('2026-01-01'), '202601');
  assert.equal(TA.isoWeekOf('2024-12-30'), '202501', 'ISO hafta yılı takvim yılından farklı olabilir');

  const ship = entry => ({ country: 'ÇİN', vehicle: 'Gemi', qty: 100, arrived: true, loadingRequest: '2026-07-01', handover: '2026-07-05', eta: '2026-08-20', ...entry });
  const range = TA.windowRange('w4', '2026-10-02');
  const a = TA.buildFromShipments([
    ship({ warehouseEntry: '2026-09-10' }),
    ship({ warehouseEntry: '2026-09-28' }),
    ship({ warehouseEntry: '2026-08-01' }), // pencere dışı
  ], { today: '2026-10-02', fromDate: range.from, toDate: range.to, granularity: range.granularity, window: range.key, scope: 'company' });
  assert.equal(a.stats.used, 2);
  assert.equal(a.stats.outOfWindow, 1);
  assert.deepEqual(a.window, { key: 'w4', from: '2026-09-05', to: '2026-10-02', granularity: 'week' });
  assert.equal(a.scope, 'company');
  const row = TA.summarize(a, { basis: 'warehouse', year: '*' }).rows[0];
  assert.equal(row.granularity, 'week');
  assert.deepEqual(row.series.map(x => x.period), ['202637', '202640']);
});

test('şirket geneli: kapsamdaki siparişe bağlanmayan IAS parsiyelleri de sayılır, ülke IAS Ürün Menşei sütunundan gelir', () => {
  const parse = require('../server/lib/parse');
  const source = require('../server/lib/transit-analysis-source');
  const overrides = require('../server/db').defaultOverrides();
  const map = parse.parseAntrepoRows([
    iasRow({ 'Ürün Menşei': 'BANGLADEŞ' }),
    // Buyer Log'da ASAS siparişi olmayan başka bir birimin parsiyeli
    iasRow({ 'Sipariş Kod': 9009, 'Ürün Adı': 'MODEL Z', 'İthalat Dosya No': 'F9', 'Ürün Menşei': 'PAKİSTAN' }),
    // IAS'ta menşei yok, ASAS eşleşmesinden gelir
    iasRow({ 'Sipariş Kod': 2002, 'Ürün Adı': 'MODEL B', 'İthalat Dosya No': 'F8' }),
    // ne IAS menşei ne ASAS eşleşmesi: ülkesiz
    iasRow({ 'Sipariş Kod': 7007, 'Ürün Adı': 'MODEL Y', 'İthalat Dosya No': 'F7' }),
  ], overrides);
  const scopedOrders = [{ ocode: 1001, model: 'MODEL A', ccode: 'C1', colour: 'SIYAH', countryRaw: 'BANGLADEŞ' }];
  const allOrders = [...scopedOrders, { ocode: 2002, model: 'MODEL B', ccode: 'C1', colour: 'SIYAH', countryRaw: 'HİNDİSTAN' }];

  const filtered = source.buildLiveAnalysis({ orders: scopedOrders, antrepoMap: map, overrides, today: '2026-10-02', scope: 'filtered' });
  assert.equal(filtered.stats.total, 1, 'mevcut filtre: yalnız kapsamdaki siparişe bağlı parsiyel');
  assert.equal(filtered.scope, 'filtered');

  const company = source.buildLiveAnalysis({ orders: allOrders, antrepoMap: map, overrides, today: '2026-10-02', scope: 'company' });
  assert.equal(company.stats.total, 4);
  assert.equal(company.stats.missingCountry, 1);
  const countries = TA.summarize(company, { basis: 'warehouse', year: '*' }).rows.map(r => r.ruleCountry).sort();
  assert.deepEqual(countries, ['Bangladesh', 'India', 'Pakistan']);
});

test('şirket sorgusu bağlantının kopyasında ufku tarih penceresiyle değiştirir, ek sütunları şemadan bulur', async () => {
  const source = require('../server/lib/transit-analysis-source');
  const modelFields = require('../server/lib/model-fields');
  const item = {
    id: 'ias', role: 'antrepo', server: 's', catalog: 'c', mode: 'auto',
    horizon: { table: 'Fact_Ithalat', seasons: ['SS26'], groups: [{ conditions: [{ field: 'Sezon', op: 'in', values: ['SS26'] }] }] },
    mapping: { 'Tahmini Antrepo Giriş Tarihi': { table: 'Fact_Ithalat', name: 'Tahmini Antrepo Giriş Tarihi', kind: 'column' } },
  };
  const before = JSON.stringify(item);
  let captured = null;
  const result = await source.queryCompanyIasRows({
    item, matchRule: null, fromDate: '2026-07-03', toDate: '2026-10-02',
    deps: {
      normalizeMappingEntry: modelFields.normalizeMappingEntry,
      discoverSchema: async () => ({ columns: [
        { table: 'Dim_Urun', name: 'Ürün Menşei' },
        { table: 'Fact_Ithalat', name: 'Ürün Menşei' },
        { table: 'Fact_Ithalat', name: 'Fiili Yükleme Tarihi' },
      ], measures: [] }),
      queryConnectionRows: async clone => { captured = clone; return { rows: [{ a: 1 }] }; },
    },
  });
  assert.equal(JSON.stringify(item), before, 'kalıcı bağlantı ayarı değişmez');
  assert.deepEqual(result.rows, [{ a: 1 }]);
  assert.deepEqual(result.addedFields, ['Ürün Menşei', 'Fiili Yükleme Tarih']);
  assert.equal(captured.mapping['Ürün Menşei'].table, 'Fact_Ithalat', 'IAS fact tablosundaki sütun tercih edilir');
  assert.deepEqual(captured.horizon.seasons, [], 'kullanıcı ufku (sezon vb.) uygulanmaz');
  assert.equal(captured.horizon.table, 'Fact_Ithalat', 'filtre tarih sütununun tablosunda çalışır');
  assert.deepEqual(captured.horizon.groups[0].conditions, [{
    table: 'Fact_Ithalat', field: 'Tahmini Antrepo Giriş Tarihi', name: 'Tahmini Antrepo Giriş Tarihi', valueType: 'date',
    op: 'between', from: '2026-07-03', to: '2026-10-02',
  }]);
  await assert.rejects(() => source.queryCompanyIasRows({ item: { ...item, mode: 'manual' }, deps: {} }), err => err.code === 'TRANSIT_COMPANY_MANUAL_QUERY');
  await assert.rejects(() => source.queryCompanyIasRows({ item: null, deps: {} }), err => err.code === 'TRANSIT_COMPANY_NO_CONNECTION');
});

test('IAS database kapsamı varsayılandır, iş kuralı yetkisi ister ve Backlog runtime\'ına bağlı değildir', () => {
  const server = read('server/server.js');
  assert.match(server, /const scope = req\.query\.scope === 'filtered' \? 'filtered' : 'company';/);
  assert.match(server, /if \(scope === 'company' && !userAccess\.hasPermission\(req\.currentUser, 'manageBusinessRules'\)\)/);
  // IAS bağlantısı varsa kaynak modu ne olursa olsun kendi sorgusu çalışır; Yenile önbelleği atlar.
  assert.match(server, /const antrepoItem = modelRefresh\.selectRefreshConnections\(/);
  assert.match(server, /if \(force \|\| !cached \|\| Date\.now\(\) - cached\.at > TRANSIT_COMPANY_CACHE_MS\)/);
  assert.match(server, /BLTransitAnalysis\.WINDOW_KEYS\.includes\(String\(req\.query\.window/);
  assert.match(server, /transitAnalysisSource\.queryCompanyIasRows\(/);
});

test('Yol Süreleri penceresi: kompakt düzenleyici, aranabilir seçiciler, liste filtresi ve iki dilli metinler', () => {
  const app = read('public/app-main.js');
  const start = app.indexOf('function openTransitRulesModal(){');
  const modal = app.slice(start, app.indexOf('const COUNTRY_MAP = {', start));
  assert.ok(start > 0 && modal.length > 1000);
  for (const id of ['_transitEditor', '_transitType', '_transitCountryPick', '_transitSeasonPick', '_transitSearch', '_transitTypeFilter', '_transitCount', '_transitAnalysisMount', '_transitSave']) {
    assert.match(modal, new RegExp(`id="${id}"`), id);
  }
  assert.match(modal, /function makePicker\(root,\{allLabel,itemLabel,optionsFn,keyFn\}\)/);
  assert.match(modal, /listFilter=\{q:'',type:'\*'\}/);
  assert.match(modal, /persistTransitRules\(working\)/, 'kalıcılık yalnız Kuralları Kaydet ile');
  assert.match(modal, /function transitTypeOptions\(\)/, 'taşıt seçici IAS tipleriyle dinamik olmalı');
  assert.match(modal, /setVehicleTypes:types=>/, 'analizdeki taşıt sözlüğü kural düzenleyicisine aktarılmalı');
  assert.doesNotMatch(modal, /pricingRuleSeasonPanel|pricingRuleGrid/, 'eski form bileşenleri kaldırıldı');
  assert.match(read('public/app.css'), /\.trxCheck\{width:14px!important;height:14px!important;/, 'seçici onay kutuları sabit boyutlu');
  const ui = read('public/transit-analysis-ui.js');
  // Kontroller her durumda çizilir; hata/boş durum yalnız gövdeyi değiştirir.
  assert.match(ui, /<div class="trxCardBody">\$\{bodyHtml\(analysis\)\}<\/div>/);
  assert.match(ui, /q\('\[data-ta-refresh\]'\)\?\.addEventListener\('click', \(\) => reloadLive\(true\)\)/);
});


// v7.0.216 regresyon: kapsam (scope) ufkuyla kurulu bağlantıda IAS database
// sorgusu yanlış satır tablosundan kuruluyor ve "hesaplanamadı" ile düşüyordu.
const IAS_F = 'Fact_Ithalat', IAS_D = 'Dim_Siparis';
const iasCol = (table, name) => ({ table, name, kind: 'column' });
function scopedIasItem() {
  return {
    id: 'ias', role: 'antrepo', server: 's', catalog: 'c', mode: 'auto', name: 'IAS', horizon: {},
    scopes: [{ id: 'sc1', enabled: true, targets: ['cp', 'orders', 'backlog'], horizon: { table: IAS_D, groups: [{ conditions: [{ table: IAS_D, field: 'Sezon', name: 'Sezon', op: 'in', values: ['SS26'] }] }] } }],
    mapping: {
      'İthalat Dosya No': iasCol(IAS_F, 'İthalat Dosya No'), 'Konteyner No': iasCol(IAS_F, 'Konteyner No'),
      'Sipariş Kod': iasCol(IAS_D, 'Sipariş Kod'), 'Model Adı': iasCol(IAS_D, 'Ürün Adı'), 'Renk Kod': iasCol(IAS_D, 'Renk Kod'),
      'Supplier Portal Statü': iasCol(IAS_F, 'Supplier Portal Statü'), 'Tahmini Antrepo Giriş Tarihi': iasCol(IAS_F, 'Tahmini Antrepo Giriş Tarihi'),
      'Yükleme Toplam Adet': iasCol(IAS_F, 'Yükleme Toplam Adet'), 'Vasita Tanim': iasCol(IAS_F, 'Vasita Tanim'),
      'Yükleme Talep Tarih': iasCol(IAS_F, 'Yükleme Talep Tarih'), 'ETA Tarih': iasCol(IAS_F, 'ETA Tarih'), 'Sezon': iasCol(IAS_D, 'Sezon'),
    },
  };
}
function realQueryDeps(schema, onQuery) {
  const modelRefresh = require('../server/lib/model-refresh');
  const modelFields = require('../server/lib/model-fields');
  return {
    normalizeMappingEntry: modelFields.normalizeMappingEntry,
    antrepoGrainTable: modelRefresh.antrepoGrainTable,
    discoverSchema: async () => schema,
    queryConnectionRows: (clone, opts) => modelRefresh.queryConnectionRows(clone, {
      ...opts, discoverSchema: async () => schema,
      runModelRows: async q => onQuery(q.query),
    }),
  };
}

test('IAS database sorgusu kapsam ufkuyla kurulu bağlantıda fact satır tablosundan ve tarih penceresiyle kurulur', async () => {
  const source = require('../server/lib/transit-analysis-source');
  const item = scopedIasItem();
  // Regresyon: bazı SSAS kurulumları tarih hiyerarşisini metadata'da WSTR
  // (130/text) raporluyor; gerçek DAX sütunu Date. Modül ufku buna rağmen
  // DATE(...) literal üretmeli ve Date-vs-Text hatasına düşmemeli.
  const schema = { columns: [
    ...Object.values(item.mapping).map(entry => entry.name === 'Tahmini Antrepo Giriş Tarihi' ? { ...entry, dataType: '130' } : entry),
    iasCol(IAS_F, 'Ürün Menşei'),
  ], measures: [] };
  let dax = '';
  const result = await source.queryCompanyIasRows({ item, matchRule: null, fromDate: '2026-07-01', toDate: '2026-10-03',
    deps: realQueryDeps(schema, query => { dax = query; return { rows: [] }; }) });
  assert.deepEqual(result.addedFields, ['Ürün Menşei']);
  assert.match(dax, /SELECTCOLUMNS\(\s*CALCULATETABLE\(\s*'Fact_Ithalat',\s*FILTER\(\s*'Fact_Ithalat',/, 'satır ve filtre tablosu IAS fact tablosu');
  assert.match(dax, /'Fact_Ithalat'\[Tahmini Antrepo Giriş Tarihi\] >= DATE\(2026, 7, 1\) && 'Fact_Ithalat'\[Tahmini Antrepo Giriş Tarihi\] <= DATE\(2026, 10, 3\)/);
  assert.doesNotMatch(dax, /Tahmini Antrepo Giriş Tarihi[^\n]*>=\s*"2026-07-01"/, 'modül ufku tarih literalini text üretmez');
  assert.match(dax, /"İthalat Dosya No", 'Fact_Ithalat'\[İthalat Dosya No\]/, 'fact sütunları doğrudan okunur');
  assert.match(dax, /"Ürün Menşei", 'Fact_Ithalat'\[Ürün Menşei\]/);
  assert.doesNotMatch(dax, /Sezon|SS26/, 'kullanıcı/sezon ufku uygulanmaz');
  assert.equal(source.baseHorizonForCompany(item).table, IAS_D, 'temel ufuk Backlog kapsamından');
});

test('ek sütunla IAS sorgusu düşerse ek sütunsuz yeniden denenir; ikinci hata gerçek mesajla yükselir', async () => {
  const source = require('../server/lib/transit-analysis-source');
  const item = scopedIasItem();
  const schema = { columns: [...Object.values(item.mapping), iasCol('Dim_Urun', 'Ürün Menşei')], measures: [] };
  const queries = [];
  const result = await source.queryCompanyIasRows({ item, matchRule: null, fromDate: '2026-07-01', toDate: '2026-10-03',
    deps: realQueryDeps(schema, query => {
      queries.push(query);
      if (/Ürün Menşei/.test(query)) throw new Error("Column 'Ürün Menşei' cannot be determined");
      return { rows: [{ ok: 1 }] };
    }) });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /Ürün Menşei/);
  assert.doesNotMatch(queries[1], /Ürün Menşei/, 'yeniden deneme ek sütunsuz');
  assert.ok(Array.isArray(result.rows));
  assert.deepEqual(result.addedFields, []);
  assert.match(result.warnings.join(' '), /ek sütunsuz yeniden denendi: Column 'Ürün Menşei' cannot be determined/);

  await assert.rejects(() => source.queryCompanyIasRows({ item, matchRule: null, fromDate: '2026-07-01', toDate: '2026-10-03',
    deps: realQueryDeps(schema, () => { throw new Error('Sunucuya bağlanılamadı'); }) }),
  err => err.code === 'TRANSIT_COMPANY_QUERY_FAILED' && err.statusCode === 502 && /Sunucuya bağlanılamadı/.test(err.detail));
});

test('canlı uç nokta gerçek hatayı iki dilde iletir; IAS sorgusu düşerse Buyer Log IAS satırlarıyla sürer', () => {
  const server = read('server/server.js');
  const start = server.indexOf("app.get('/api/transit-analysis/live'");
  const route = server.slice(start, server.indexOf("app.put('/api/transit-analysis', ", start));
  assert.doesNotMatch(route, /apiError\(res, err, 'Yol süresi analizi hesaplanamadı\.'\);\s*\}\s*\}\);\s*$/, 'genel yedek metin gerçek nedeni gizlemez');
  assert.match(route, /error: `Yol süresi analizi hesaplanamadı: \$\{detail\}`, errorEn: `Lead time analysis could not be calculated: \$\{detail\}`/);
  assert.match(route, /error: `IAS database sorgusu başarısız: \$\{detail\}`, errorEn: `IAS database query failed: \$\{detail\}`/);
  assert.match(route, /const fallbackMap = active \? antrepoForTarget\(active, 'backlog'\) : \{\};/);
  assert.match(route, /antrepoGrainTable: modelRefresh\.antrepoGrainTable/);
  assert.match(read('server/lib/model-refresh.js'), /const grainTable = String\(item && item\._grainTable \|\| ''\)\.trim\(\)\s*\|\| antrepoGrainTable\(mapping, aligned\.horizon\.table, aligned\.horizon\.table\);/);
});


// v7.0.218 — Global Lojistik raporuyla tutarlılık. Gerekçe: Buyer Log tahmini
// antrepo girişini, adet ağırlıklı ortalamayı ve ETA sınırını kullandığı için
// rapordan (sevkiyat ortalaması, gerçekleşen giriş, Özet Beyan sınırı) 10–30 gün
// uzun sonuç veriyordu.
test('varsayılan sevkiyat ortalaması raporla aynı; adet ağırlıklı ayrı seçenek', () => {
  const ship = (days, qty, entry) => ({ country: 'BANGLADEŞ', vehicle: 'Gemi', qty, arrived: true, loadingRequest: '2026-08-01',
    warehouseEntry: new Date(Date.UTC(2026, 7, 1 + days)).toISOString().slice(0, 10) });
  const list = [ship(50, 9000), ship(70, 100), ship(60, 100)];
  const byShipment = TA.buildFromShipments(list, { today: '2026-12-31' });
  assert.equal(byShipment.weighting, 'shipment');
  assert.equal(TA.summarize(byShipment, { basis: 'warehouse', year: '*' }).rows[0].endToEnd, 60, '(50+70+60)/3');
  const byQty = TA.buildFromShipments(list, { today: '2026-12-31', weighting: 'qty' });
  assert.equal(byQty.weighting, 'qty');
  assert.equal(TA.summarize(byQty, { basis: 'warehouse', year: '*' }).rows[0].endToEnd, 50.3, '(50*9000+70*100+60*100)/9200 = 50.33');
  // Dönemler arası özet de sevkiyat sayısıyla tartılır.
  const twoMonths = TA.buildFromShipments([ship(40, 1), { ...ship(80, 1000000), warehouseEntry: '2026-10-20', loadingRequest: '2026-08-01' }, { ...ship(80, 1000000), warehouseEntry: '2026-10-20', loadingRequest: '2026-08-01' }], { today: '2026-12-31' });
  const row = TA.summarize(twoMonths, { basis: 'warehouse', year: '*' }).rows[0];
  assert.equal(row.shipments, 3);
});

test('Excel tanımları: Yol = fiili yükleme → ETA (4), Gümrük = ETA → gerçekleşen antrepo girişi (5–8)', () => {
  const a = TA.buildFromShipments([{ country: 'HİNDİSTAN', vehicle: 'Gemi', qty: 10, arrived: true,
    loadingRequest: '2026-07-01', handover: '2026-07-05', actualLoading: '2026-07-12', eta: '2026-08-02', summaryDeclaration: '2026-08-03', warehouseEntry: '2026-08-10' }], { today: '2026-12-31' });
  const r = TA.summarize(a, { basis: 'warehouse', year: '*' }).rows[0];
  assert.equal(r.loading, 11);
  assert.equal(r.transit, 21);
  assert.equal(r.customs, 8);
  assert.equal(r.endToEnd, 40);
  assert.equal(r.steps.find(x => x.code === '5').days, 1, '5: ETA → Özet Beyan Onay');
});

test('yalnız gerçekleşen giriş sayılır; canlı IAS analizi Final Destination ayırmadan direkt rotaları da tutar', () => {
  const parse = require('../server/lib/parse');
  const source = require('../server/lib/transit-analysis-source');
  const overrides = require('../server/db').defaultOverrides();
  // Gerçekleşen giriş sütunu hiç yoksa (yalnız tahmini) hiçbir parsiyel hesaba girmez.
  const onlyEstimated = parse.parseAntrepoRows([iasRow({ 'Antrepo Giriş Tarihi': undefined, 'Ürün Menşei': 'BANGLADEŞ' })], overrides);
  const none = source.buildLiveAnalysis({ orders: [], antrepoMap: onlyEstimated, overrides, today: '2026-10-02', scope: 'company' });
  assert.equal(none.stats.used, 0);
  assert.equal(none.stats.notArrived, 1);
  assert.equal(none.columns.actualEntry, false);
  // Tema Depo Giriş de gerçekleşen giriştir.
  const tema = parse.parseAntrepoRows([iasRow({ 'Antrepo Giriş Tarihi': undefined, 'Tema Depo Giriş Tarih': '2025-03-18', 'Ürün Menşei': 'BANGLADEŞ' })], overrides);
  const t = source.buildLiveAnalysis({ orders: [], antrepoMap: tema, overrides, today: '2026-10-02', scope: 'company' });
  assert.equal(t.stats.used, 1);
  assert.equal(TA.summarize(t, { basis: 'warehouse', year: '*' }).rows[0].endToEnd, 76);
  // Türkiye direkt sevkiyat Final Destination=Depo olsa da canlı IAS analizinde kalır.
  const direct = parse.parseAntrepoRows([iasRow({
    'Sipariş Kod': 3003, 'Ürün Menşei': 'TÜRKİYE', 'Vasita Tanim': 'Direkt Sevkiyat',
    'Final Destination': 'Depo', 'Yükleme Talep Tarih': '2025-02-01',
    'Antrepo Giriş Tarihi': undefined, 'Tema Depo Giriş Tarih': '2025-02-06',
  })], overrides);
  const directAnalysis = source.buildLiveAnalysis({ orders: [], antrepoMap: direct, overrides, today: '2026-10-02', scope: 'company' });
  assert.equal(directAnalysis.stats.used, 1);
  assert.equal(directAnalysis.stats.otherDestination, 0);
  const directRow = TA.summarize(directAnalysis, { basis: 'warehouse', year: '*' }).rows[0];
  assert.equal(directRow.ruleCountry, 'Turkey');
  assert.equal(directRow.vehicle, 'Direkt Sevkiyat');
  const list = [
    { entryIsActual: true, arrived: true, warehouseEntry: '2026-09-01', finalDestination: 'Antrepo' },
    { entryIsActual: true, arrived: true, warehouseEntry: '2026-09-02', finalDestination: 'Depo' },
  ];
  assert.deepEqual(source.applyReportRules(list), { hasActualEntry: true, hasDestination: true });
  assert.equal(list[1].otherDestination, true);
  const unfiltered = list.map(item => ({ ...item }));
  assert.deepEqual(source.applyReportRules(unfiltered, { excludeOtherDestinations: false }), { hasActualEntry: true, hasDestination: true });
  assert.ok(unfiltered.every(item => !item.otherDestination), 'canlı IAS modu hedefe göre satır elemez');
  assert.ok(!list[0].otherDestination && list[0].arrived);
  const legacy = [{ entryIsActual: true, arrived: true, warehouseEntry: '2026-09-20', finalDestination: '' }];
  assert.deepEqual(source.applyReportRules(legacy), { hasActualEntry: true, hasDestination: false });
  assert.ok(!legacy[0].otherDestination, 'Final Destination sütunu yoksa rota süzülmez');
  assert.equal(TA.buildFromShipments([{ ...list[1], country: 'X', vehicle: 'Gemi', loadingRequest: '2026-08-01' }], { today: '2026-12-31' }).stats.otherDestination, 1);
});

test('şirket sorgusu raporun gerçekleşen tarih sütunlarını ekler; tahmini girişe eşlenmiş sütunu ikinci kez seçmez', async () => {
  const source = require('../server/lib/transit-analysis-source');
  const modelFields = require('../server/lib/model-fields');
  const run = async (columns, tahminiName) => {
    let captured = null;
    const item = { id: 'ias', role: 'antrepo', server: 's', catalog: 'c', mode: 'auto', horizon: { table: 'Fact_Ithalat' },
      mapping: { 'Tahmini Antrepo Giriş Tarihi': { table: 'Fact_Ithalat', name: tahminiName, kind: 'column' } } };
    const result = await source.queryCompanyIasRows({ item, matchRule: null, fromDate: '2026-07-01', toDate: '2026-10-03', deps: {
      normalizeMappingEntry: modelFields.normalizeMappingEntry,
      discoverSchema: async () => ({ columns: columns.map(name => ({ table: 'Fact_Ithalat', name })), measures: [] }),
      queryConnectionRows: async clone => { captured = clone; return { rows: [] }; },
    } });
    return { result, captured };
  };
  const full = await run(['Tahmini Antrepo Giriş Tarihi', 'Antrepo Giriş Tarihi', 'Fiili Yükleme Tarihi', 'Özet Beyan Onay Tarihi', 'Final Destination', 'Ürün Menşei'], 'Tahmini Antrepo Giriş Tarihi');
  assert.deepEqual(full.result.addedFields, ['Ürün Menşei', 'Fiili Yükleme Tarih', 'Antrepo Giriş Tarih', 'Özet Beyan Onay Tarih', 'Final Destination']);
  // Tahmini giriş modelde "Antrepo Giriş Tarihi" adlı sütuna eşliyse o sütun gerçekleşen giriş sayılmaz.
  const same = await run(['Antrepo Giriş Tarihi', 'Fiili Yükleme Tarihi'], 'Antrepo Giriş Tarihi');
  assert.deepEqual(same.result.addedFields, ['Fiili Yükleme Tarih']);
  assert.equal(same.captured.mapping['Antrepo Giriş Tarih'], undefined);
});

test('database\'deki bütün taşıt tipleri ayrı satırdır ve tamamı kendi tipiyle kurala aktarılır', () => {
  const ship = (vehicle, days) => ({ country: 'ÇİN', vehicle, qty: 10, arrived: true, loadingRequest: '2026-07-01', warehouseEntry: `2026-07-${String(1 + days).padStart(2, '0')}` });
  const a = TA.buildFromShipments([ship('GEMİ', 25), ship('Tır', 9), ship('Uçak+Tır', 12), ship('Kurye', 4), ship('SEA + AIR', 18), ship('', 20)], { today: '2026-12-31' });
  assert.equal(a.stats.used, 6);
  assert.equal(a.stats.missingVehicle, 1);
  const rows = TA.summarize(a, { basis: 'warehouse', year: '*' }).rows;
  assert.deepEqual(rows.map(r => [r.vehicle, r.ruleType]), [
    ['Gemi', 'Gemi'], ['Gemi+Uçak', 'Gemi+Uçak'], ['Kurye', 'Kurye'], ['Tır', 'Tır'], ['Uçak+Tır', 'Uçak+Tır'], ['', ''],
  ]);
  assert.deepEqual(TA.suggestRules({ rows }).map(s => [s.vehicle, s.delType, s.days]), [
    ['Gemi', 'Gemi', 25], ['Gemi+Uçak', 'Gemi+Uçak', 18], ['Kurye', 'Kurye', 4], ['Tır', 'Tır', 9], ['Uçak+Tır', 'Uçak+Tır', 12],
  ]);
  assert.equal(TA.ruleVehicle('Uçak+Tır'), 'Uçak+Tır');
  assert.equal(TA.ruleVehicle('gemi+tır'), 'Gemi+Tır');
  // Kayıtlı analiz yeniden okunurken database taşıt adı korunur.
  assert.equal(TA.normalizeAnalysis(a).records.find(r => r.vehicle === 'Uçak+Tır').vehicle, 'Uçak+Tır');
});

test('Buffer hesaplanan güne önce yüzde sonra gün olarak eklenir ve kurallara buffer\'lı aktarılır', () => {
  assert.equal(TA.applyBuffer(50, { bufferDays: 5, bufferPct: 10 }), 60);
  assert.equal(TA.applyBuffer(50, {}), 50);
  assert.deepEqual(TA.normalizeBuffer({ bufferDays: '-3', bufferPct: '999' }), { days: 0, pct: TA.MAX_BUFFER_PCT });
  assert.deepEqual(TA.normalizeBuffer({ bufferDays: 9999 }), { days: TA.MAX_BUFFER_DAYS, pct: 0 });
  const rows = [{ vehicle: 'Gemi', ruleType: 'Gemi', ruleCountry: 'India', countryKey: 'INDIA', endToEnd: 47.7, p80: 55 }];
  const [s] = TA.suggestRules({ rows }, { metric: 'endToEnd', stat: 'mean', bufferDays: 7, bufferPct: 0 });
  assert.equal(s.baseDays, 48);
  assert.equal(s.days, 55);
  const applied = TA.applySuggestions([], [s]);
  assert.equal(applied.rules[0].days, 55);
  assert.equal(applied.rules[0].delType, 'Gemi');
  const ui = read('public/transit-analysis-ui.js');
  assert.match(ui, /data-ta-buffer="bufferDays"/);
  assert.match(ui, /data-ta-buffer="bufferPct"/);
  assert.match(ui, /const canSelect = !!row\.ruleType && !!s;/);
  assert.match(ui, /currentRuleDays\(rules, row\.ruleType, row\.ruleCountry\)/);
});
