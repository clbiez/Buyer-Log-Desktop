'use strict';

/* BİRİNCİL LOJİSTİK SEGMENT — TEK KURAL (2026-11-28; ADR-0003 §6M / §6O.c, ürün sahibi kararı A–D)
 *
 * Kural:
 *  A) Miktarı 0 olan parsiyel tek başına üretim bakiyesi değildir; gerçek kalan üretim miktarı esastır.
 *  B) Eksik Yükleme (kıtlık) ayrı istisnadır; ana durum/tarih kaynağı olarak seçilmez, üretime ya da
 *     lojistik aşamaya dönüştürülmez.
 *  C) Üretim bakiyesi yoksa, yolda + depoda karışık parsiyelde tamamlanmamış lojistik aşama esastır.
 *  D) Ana STATUS = operasyonel olarak en geride kalan tamamlanmamış aşama.
 * Del. Type / Ant. Arrival / HANDOVER, Siparişler'in (parse.js) mevcut anlamıyla ana STATUS'u veren
 * segmentten okunur. IAS kaynak segmentleri (vasıta/varış/handover) değişmez.
 *
 * Önceki durum (kaçış nedeni): seçim iki yerde farklıydı. parse.js ilk kıtlık-dışı segmenti (dizi sırası),
 * okuma modeli hazırlığı ve istemci partials[0]'ı alıyordu → üretim bakiyesi süren satır CP'de "Depoda/Yolda"
 * görünüp üretim gecikme denetiminden çıkıyordu. Paritenin tabanı aynı fonksiyonla kurulduğu için fark
 * görünmüyordu.
 *
 * Bu testteki BEKLENEN DEĞERLER ELLE HESAPLANMIŞTIR (kod çalıştırılarak üretilmedi):
 *   Ex-factory + transit kuralı (Gemi 70 gün, Uçak 15 gün); IAS değerleri kaynaktan aynen.
 * Üç yol aynı beklenen değere karşı denetlenir: tam kurulum (parse.js → Siparişler/ham projeksiyon),
 * okuma modeli hazırlığı (overview-row-prep → CP okuma modeli) ve istemci (app-main rebuildCpLogisticCaches).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse');
const prep = require('../server/lib/read-model/overview-row-prep');
const BR = require('../public/business-rules');
const CRE = require('../public/cp-readiness-engine');
const { loadAppMainFunctions } = require('./helpers/app-main-functions');

const ROOT = path.join(__dirname, '..');
const day = value => {
  if (value == null || value === '') return null;
  // İstemci fonksiyonları ayrı vm bağlamında çalışır: Date başka bir realm'den gelir (instanceof tutmaz).
  if (typeof value === 'object' && typeof value.getFullYear === 'function') {
    const p = n => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${p(value.getMonth() + 1)}-${p(value.getDate())}`;
  }
  return String(value).slice(0, 10);
};
const ordinal = value => {
  const text = day(value);
  if (!text) return null;
  const [y, m, d] = text.split('-').map(Number);
  return Math.trunc(Date.UTC(y, m - 1, d) / 86400000);
};
const TRANSIT_RULES = [
  { id: 'r-gemi', delType: 'Gemi', days: 70 },
  { id: 'r-ucak', delType: 'Uçak', days: 15 },
];
const overrides = () => ({ antrepoMatchConfig: parse.defaultAntrepoMatchConfig(), submap: {}, delmap: {}, suppfobmap: {}, suppfobmetamap: {}, notesmap: {}, licensormap: {}, pricingRules: [], transitRules: TRANSIT_RULES, datemap: {} });
const asas = (extra = {}) => ({ 'Sipariş Kod': '4100001', 'Model Adı': 'MODEL-1', 'Renk Kod': 'C01', 'Renk': 'SİYAH', 'Net Alım Sipariş Miktarı': 10000, 'Kalan Alım Sipariş Miktarı': 3000, 'FOB Fiyatı': 5, 'Üretici': 'SUPPLIER', 'Sezon': 'W6', 'Buyer Grup (TR)': 'BG', 'Siparişin Üretildiği Ülke': 'BANGLADES', 'Orijinal Exfactory Merch Tarih': '2026-11-01', 'Retail Depo Tarih Yıl Ay Gün': '2027-06-01', 'Model Bütçe Tarih Yıl Ay Gün': '2027-06-15', ...extra });
let iasSeq = 0;
const ias = (status, qty, arrival, vehicle, handover, extra = {}) => {
  iasSeq += 1;
  return { 'Sipariş Kod': '4100001', 'Ürün Ad': 'MODEL-1', 'Renk Kod': 'C01', 'Renk Tanım': 'SİYAH', 'Supplier Portal Statü': status, 'Tahmini Antrepo Giriş Tarihi': arrival, 'HANDOVER Tarihi': handover || '', 'Vasita Tanim': vehicle, 'Yükleme Toplam Adet': qty, 'Net Alım Sipariş Miktarı': 10000, 'İthalat Dosya No': `IMP-${iasSeq}`, 'Konteyner No': `CONT-${iasSeq}`, 'Gemi Ad': `VESSEL-${iasSeq}`, ...extra };
};

// Tam kurulum: kaynak + override'lardan sunucunun ürettiği satır (artımlı yol yok).
function fullBuild({ order = {}, iasRows = [] } = {}) {
  const ov = overrides();
  const orders = parse.parseASASRows([asas(order)], ov.antrepoMatchConfig).orders;
  const map = iasRows.length ? parse.parseAntrepoRows(iasRows, ov.antrepoMatchConfig) : {};
  const rows = parse.buildCPRowsFromASAS(parse.applyDateOverrides(orders, ov), map, ov);
  assert.equal(rows.length, 1);
  return rows[0];
}

// İstemci: app-main.js'in GERÇEK fonksiyonları (kaynaktan çıkarılır, stub yok).
const client = loadAppMainFunctions(
  ['norm', 'toNum', 'turknorm', 'makeDateOnly', 'dateOnlyFromDateObject', 'excelSerialToDateOnly', 'coerceDateLoose', 'normalizeTransitDelType', 'cpLogisticSegments', 'rebuildCpLogisticCaches'],
  { BLBusinessRules: BR, ISO_DAY_CACHE_MAX: 20000, _isoDayCache: new Map() },
);

const shown = row => ({ STATUS: row.STATUS, delType: row['Del. Type'], arrival: day(row['Ant. Arrival']), handover: day(row['HANDOVER Tarihi']) });
function threePaths(spec) {
  const built = fullBuild(spec);
  const readModel = JSON.parse(JSON.stringify(built));
  prep.prepareCpRows([readModel]);
  const browser = JSON.parse(JSON.stringify(built));
  client.rebuildCpLogisticCaches(browser);
  return { built, readModel, browser };
}
function assertAllPaths(spec, expected, label) {
  const { built, readModel, browser } = threePaths(spec);
  assert.deepEqual(shown(built), expected, `${label}: tam kurulum (Siparişler / ham projeksiyon)`);
  assert.deepEqual(shown(readModel), expected, `${label}: CP okuma modeli hazırlığı`);
  assert.deepEqual(shown(browser), expected, `${label}: istemci rebuildCpLogisticCaches`);
  return { built, readModel, browser };
}
const sourceSegments = row => (row._logisticSegments || []).map(s => [s.kind, s.status, s.delType, day(s.arrival), day(s.handover), s.quantity]);

// ---------- kategoriler (elle hesaplanmış beklenen değerler) ----------

test('yalnız üretim: Üretimde · Gemi · Ex-factory + 70 (01.11 → 10.01)', () => {
  assertAllPaths({}, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2027-01-10', handover: null }, 'yalnız üretim');
});

test('üretim bakiyesi + yolda parsiyel: üretim en geride → Üretimde · Gemi · 10.01 · Handover yok', () => {
  // 10.000 − 3.000 = 7.000 üretimde (> %10) → üretim segmenti; parsiyel Uçak 04.12.
  const iasRows = [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '2026-11-20')];
  const { readModel } = assertAllPaths({ iasRows }, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2027-01-10', handover: null }, 'üretim + yolda');
  assert.deepEqual(sourceSegments(readModel).filter(s => s[0] === 'partial'), [['partial', 'Yol Operasyonları', 'Uçak', '2026-12-04', '2026-11-20', 3000]], 'IAS kaynak segmenti değişmez');
});

test('üretim bakiyesi + depoda parsiyel (4100023/L02 deseni): Üretimde · Gemi · 10.01 · Handover yok', () => {
  const iasRows = [ias('Depoda', 4000, '2026-11-15', 'Uçak', '2026-10-30')];
  const { readModel } = assertAllPaths({ iasRows }, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2027-01-10', handover: null }, 'üretim + depoda');
  assert.deepEqual(sourceSegments(readModel).filter(s => s[0] === 'partial'), [['partial', 'Depoda', 'Uçak', '2026-11-15', '2026-10-30', 4000]]);
});

test('A · miktarı 0 "Üretimde" parsiyel + gerçek üretim bakiyesi: tarih ve vasıta üretim bakiyesinden', () => {
  // Parsiyel 0 adet (TIR 03.12, kendi tarihi daha erken); üretim 10.000 adet Gemi 10.01.
  const iasRows = [ias('Üretimde', 0, '2026-12-03', 'TIR', '')];
  assertAllPaths({ iasRows }, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2027-01-10', handover: null }, 'miktar-0 parsiyel + üretim');
});

test('A · miktarı 0 "Üretimde" parsiyel, üretim bakiyesi yok: parsiyel üretim sayılmaz → yoldaki parsiyel', () => {
  // 10.000 − 9.800 = 200 (%2 < %5 tolerans) → bakiye segmenti yok.
  const iasRows = [ias('Üretimde', 0, '2026-12-01', 'TIR', ''), ias('Yol Operasyonları', 9800, '2026-12-15', 'Uçak', '2026-12-01')];
  assertAllPaths({ iasRows }, { STATUS: 'Yol Operasyonları', delType: 'Uçak', arrival: '2026-12-15', handover: '2026-12-01' }, 'miktar-0 parsiyel, üretimsiz');
});

test('B · kıtlık + yolda: kıtlık seçilmez, aşamaya dönüştürülmez → yoldaki parsiyel', () => {
  // 10.000 − 9.300 = 700 (%7: ≥ %5 ve ≤ %10) → Eksik Yükleme segmenti.
  const iasRows = [ias('Yol Operasyonları', 9300, '2027-01-03', 'Uçak', '2026-12-20')];
  const { readModel } = assertAllPaths({ iasRows }, { STATUS: 'Yol Operasyonları', delType: 'Uçak', arrival: '2027-01-03', handover: '2026-12-20' }, 'kıtlık + yolda');
  const shortage = readModel._logisticSegments.filter(s => s.kind === 'shortage');
  assert.deepEqual(shortage.map(s => [s.status, s.quantity]), [['Eksik Yükleme', 700]], 'kıtlık istisnası ayrı segment olarak korunur');
  assert.equal(readModel._logisticShortageQty, 700);
});

test('B · kıtlık + depoda: Depoda · parsiyelin vasıtası/tarihi; kıtlık "Depoda - Eksik Yükleme" olarak korunur', () => {
  const iasRows = [ias('Depoda', 9300, '2026-11-10', 'Uçak', '2026-10-28')];
  const { readModel } = assertAllPaths({ iasRows }, { STATUS: 'Depoda', delType: 'Uçak', arrival: '2026-11-10', handover: '2026-10-28' }, 'kıtlık + depoda');
  assert.deepEqual(readModel._logisticSegments.filter(s => s.kind === 'shortage').map(s => s.status), ['Depoda - Eksik Yükleme']);
});

test('C · üretimsiz yolda + depoda karışık: tamamlanmamış lojistik aşama (yolda) esastır', () => {
  // 10.000 − (5.000 + 4.800) = 200 (%2) → bakiye segmenti yok.
  const iasRows = [ias('Yol Operasyonları', 5000, '2026-12-20', 'Gemi', '2026-12-01'), ias('Depoda', 4800, '2026-11-10', 'Uçak', '2026-10-25')];
  assertAllPaths({ iasRows }, { STATUS: 'Yol Operasyonları', delType: 'Gemi', arrival: '2026-12-20', handover: '2026-12-01' }, 'yolda + depoda');
});

test('D · çoklu tamamlanmamış aşama + üretim bakiyesi: en geride kalan üretim', () => {
  // 10.000 − (3.000 + 3.000 + 2.000) = 2.000 (%20) → üretim.
  const iasRows = [
    ias('Yükleme Operasyonları', 3000, '2027-01-05', 'TIR', ''),
    ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '2026-11-20'),
    ias('Depoda', 2000, '2026-11-10', 'Uçak', '2026-10-25'),
  ];
  assertAllPaths({ iasRows }, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2027-01-10', handover: null }, 'üretim + yükleme + yolda + depoda');
});

test('D · üretim bakiyesi yok, yükleme + yolda: ana STATUS en geride kalan aşama (Yükleme Operasyonları)', () => {
  // 10.000 − (4.900 + 4.900) = 200 (%2) → bakiye segmenti yok. Yükleme parsiyelinin varışı daha geç.
  const iasRows = [ias('Yükleme Operasyonları', 4900, '2027-01-10', 'TIR', ''), ias('Yol Operasyonları', 4900, '2026-12-04', 'Gemi', '2026-11-20')];
  const { built, readModel, browser } = threePaths({ iasRows });
  for (const [label, row] of [['tam kurulum', built], ['okuma modeli', readModel], ['istemci', browser]]) assert.equal(row.STATUS, 'Yükleme Operasyonları', label);
});
test('D · üretim bakiyesi yok, çoklu aşama: tarih / vasıta / handover STATUS\'u veren parsiyelden (ürün sahibi kararı 1a)', () => {
  // Yükleme TIR 10.01 (handover yok) + Yol Gemi 04.12 (HO 20.11). Bugüne kadar Siparişler ve CP en erken varışı
  // (Yol · Gemi · 04.12 · 20.11) gösteriyordu; artık dört alan aynı (en geride kalan) parsiyelden gelir.
  const iasRows = [ias('Yükleme Operasyonları', 4900, '2027-01-10', 'TIR', ''), ias('Yol Operasyonları', 4900, '2026-12-04', 'Gemi', '2026-11-20')];
  assertAllPaths({ iasRows }, { STATUS: 'Yükleme Operasyonları', delType: 'TIR', arrival: '2027-01-10', handover: null }, 'yükleme + yolda');
});

test('D · aynı aşamada iki parsiyel: mevcut seçim korunur (en erken varış)', () => {
  const iasRows = [ias('Yol Operasyonları', 4900, '2027-01-10', 'Uçak', '2026-12-28'), ias('Yol Operasyonları', 4900, '2026-12-04', 'Gemi', '2026-11-20')];
  assertAllPaths({ iasRows }, { STATUS: 'Yol Operasyonları', delType: 'Gemi', arrival: '2026-12-04', handover: '2026-11-20' }, 'iki yolda');
});

// ---------- Priority / risk: üretim bakiyesinin gecikmesi CP'de denetlenir ----------

const TODAY = '2026-11-28';
function decide(row) {
  return CRE.analyzeOrder(row, { transitRules: TRANSIT_RULES, today: ordinal(TODAY), dateOrdinal: ordinal });
}

test('Priority · gecikmiş üretim bakiyesi + depoda parsiyel: CP kararı üretim gecikmesini görür (Siparişler ile aynı)', () => {
  // Ex-factory 01.10 (geçmiş), bugün 28.11 → gecikme tabanı bugün; 28.11 + 70 = 06.02.2027 > Retail 15.01.2027.
  const order = { 'Orijinal Exfactory Merch Tarih': '2026-10-01', 'Retail Depo Tarih Yıl Ay Gün': '2027-01-15', 'Model Bütçe Tarih Yıl Ay Gün': '2027-01-20' };
  const iasRows = [ias('Depoda', 4000, '2026-11-15', 'Uçak', '2026-10-30')];
  const { built, readModel, browser } = assertAllPaths({ order, iasRows }, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2026-12-10', handover: null }, 'gecikmiş üretim + depoda');
  for (const [label, row] of [['tam kurulum', built], ['okuma modeli', readModel], ['istemci', browser]]) {
    const result = decide(row);
    assert.equal(result.stage, 'PRODUCTION', label);
    assert.equal(result.deliveryOutcome, 'EXPECTED_LATE', label);
    assert.ok(result.riskReasons.includes('EX_FACTORY_OVERDUE'), `${label}: ${result.riskReasons}`);
  }
});

test('Priority · gecikmiş üretim bakiyesi + yolda parsiyel: CP kararı üretim gecikmesini görür', () => {
  const order = { 'Orijinal Exfactory Merch Tarih': '2026-10-01', 'Retail Depo Tarih Yıl Ay Gün': '2027-01-15', 'Model Bütçe Tarih Yıl Ay Gün': '2027-01-20' };
  const iasRows = [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '2026-11-20')];
  const { readModel, browser } = threePaths({ order, iasRows });
  for (const [label, row] of [['okuma modeli', readModel], ['istemci', browser]]) {
    const result = decide(row);
    assert.equal(result.deliveryOutcome, 'EXPECTED_LATE', label);
    assert.ok(result.riskReasons.includes('EX_FACTORY_OVERDUE'), label);
  }
});

test('Priority · gecikmesiz üretim bakiyesi + depoda parsiyel: üretim denetlenir, gecikme yok', () => {
  // Ex-factory 10.01.2027 (gelecek) + 70 = 21.03.2027 ≤ Retail 01.06.2027.
  const order = { 'Orijinal Exfactory Merch Tarih': '2027-01-10' };
  const iasRows = [ias('Depoda', 4000, '2026-11-15', 'Uçak', '2026-10-30')];
  const { readModel, browser } = assertAllPaths({ order, iasRows }, { STATUS: 'Üretimde', delType: 'Gemi', arrival: '2027-03-21', handover: null }, 'gecikmesiz üretim + depoda');
  for (const [label, row] of [['okuma modeli', readModel], ['istemci', browser]]) {
    const result = decide(row);
    assert.equal(result.stage, 'PRODUCTION', label);
    assert.equal(result.deliveryOutcome, 'ON_TRACK', label);
    assert.ok(!result.riskReasons.includes('EX_FACTORY_OVERDUE'), label);
  }
});

// ---------- 2a: segment riskleri birincil seçimden bağımsız (ürün sahibi kararı) ----------
// Satır artık "Üretimde" görünse de yoldaki parsiyelin bugünkü uyarıları kaybolmaz. Yüklem bugünküyle aynıdır,
// yalnız satırın görünen segmenti yerine ilgili her segmentte değerlendirilir.

const signalCodes = result => (result.signals || []).map(signal => signal.code);
// Yükleme onayı 10.11 (bugün 28.11 → 18 gün ≥ 3). Onay Ex-factory'yi 10.11'e çeker (otomatik revizyon).
const APPROVED = { 'Buying Son Onay Tarihi': '20261110' };

test('HANDOVER_PENDING · üretim bakiyesi + handover\'ı eksik yoldaki parsiyel (2.588 satırlık kategori): uyarı korunur', () => {
  const iasRows = [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '')];
  const { built, readModel, browser } = threePaths({ order: APPROVED, iasRows });
  for (const [label, row] of [['tam kurulum', built], ['okuma modeli', readModel], ['istemci', browser]]) {
    assert.equal(row.STATUS, 'Üretimde', label);
    const result = decide(row);
    assert.ok(result.riskReasons.includes('HANDOVER_PENDING'), `${label}: ${result.riskReasons}`);
    assert.ok(signalCodes(result).includes('HANDOVER_PENDING'), label);
    assert.equal(result.handoverWarning, true, label);
  }
});

test('HANDOVER_PENDING · handover\'ı olan yoldaki parsiyel, depodaki parsiyel ya da yalnız üretim: uyarı yok (bugünkü gibi)', () => {
  const cases = [
    [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '2026-11-20')],
    [ias('Depoda', 3000, '2026-11-15', 'Uçak', '')],
    [],
  ];
  for (const iasRows of cases) {
    const { readModel } = threePaths({ order: APPROVED, iasRows });
    const result = decide(readModel);
    assert.ok(!result.riskReasons.includes('HANDOVER_PENDING'), JSON.stringify(iasRows.map(r => r['Supplier Portal Statü'])));
    assert.ok(!signalCodes(result).includes('HANDOVER_PENDING'));
  }
});

test('HANDOVER_PENDING · yükleme onayı 3 günden yeni: uyarı yok (bugünkü eşik)', () => {
  const iasRows = [ias('Yol Operasyonları', 3000, '2026-12-04', 'Uçak', '')];
  const { readModel } = threePaths({ order: { 'Buying Son Onay Tarihi': '20261127' }, iasRows });
  assert.ok(!decide(readModel).riskReasons.includes('HANDOVER_PENDING'));
});

test('ANTREPO_DELAY · üretim bakiyesi (projeksiyon ileride) + antrepo tarihi geçmiş yoldaki parsiyel: sinyal korunur', () => {
  // Ex-factory 10.01.2027 + 70 = 21.03.2027 (ileride); parsiyel varışı 20.11 < bugün 28.11, depoda değil.
  const order = { 'Orijinal Exfactory Merch Tarih': '2027-01-10' };
  const late = threePaths({ order, iasRows: [ias('Yol Operasyonları', 3000, '2026-11-20', 'Uçak', '2026-11-01')] });
  for (const [label, row] of [['okuma modeli', late.readModel], ['istemci', late.browser]]) {
    assert.equal(row.STATUS, 'Üretimde', label);
    assert.ok(signalCodes(decide(row)).includes('ANTREPO_DELAY'), label);
  }
  // Kontrol: parsiyelin varışı ileride → sinyal yok; depodaki parsiyelin geçmiş varışı sinyal üretmez (bugünkü gibi).
  const onTime = threePaths({ order, iasRows: [ias('Yol Operasyonları', 3000, '2026-12-10', 'Uçak', '2026-11-20')] });
  assert.ok(!signalCodes(decide(onTime.readModel)).includes('ANTREPO_DELAY'));
  const warehouse = threePaths({ order, iasRows: [ias('Depoda', 3000, '2026-11-20', 'Uçak', '2026-11-01')] });
  assert.ok(!signalCodes(decide(warehouse.readModel)).includes('ANTREPO_DELAY'));
});

test('ANTREPO_DELAY · 0 adetlik Üretimde parsiyelin geçmiş IAS varışı (üretim bakiyesi ileride): bugünkü sinyal korunur', () => {
  const order = { 'Orijinal Exfactory Merch Tarih': '2027-01-10' };
  const { readModel, browser } = threePaths({ order, iasRows: [ias('Üretimde', 0, '2026-11-15', 'TIR', '')] });
  for (const [label, row] of [['okuma modeli', readModel], ['istemci', browser]]) {
    assert.equal(row['Del. Type'], 'Gemi', `${label}: A — tarih/vasıta üretim bakiyesinden`);
    assert.ok(signalCodes(decide(row)).includes('ANTREPO_DELAY'), label);
  }
});

// ---------- tek tanım: aynı fonksiyon, sıra bağımsızlığı ----------

const seg = (kind, status, quantity, arrival, extra = {}) => ({ kind, status, quantity, arrival, delType: extra.delType || 'Gemi', handover: extra.handover || null, partialNo: kind === 'partial' ? (extra.no || 1) : null, ...extra });

test('tek fonksiyon: BLBusinessRules.selectPrimaryLogisticSegment segment dizisi sırasından bağımsızdır', () => {
  assert.equal(typeof BR.selectPrimaryLogisticSegment, 'function');
  const production = seg('production', 'Üretimde', 2400, '2026-12-30');
  const zero = seg('partial', 'Üretimde', 0, '2026-12-03', { delType: 'TIR', no: 1 });
  const transit = seg('partial', 'Yol Operasyonları', 500, '2026-12-01', { no: 2 });
  const warehouse = seg('partial', 'Depoda', 800, '2026-11-01', { no: 3 });
  const shortage = seg('shortage', 'Eksik Yükleme', 300, '2026-11-20');
  const all = [zero, transit, warehouse, shortage, production];
  for (const order of [all, all.slice().reverse(), [shortage, warehouse, production, transit, zero]]) {
    assert.equal(BR.selectPrimaryLogisticSegment(order), production);
  }
  assert.equal(BR.selectPrimaryLogisticSegment([warehouse, shortage, transit]), transit, 'C: yolda depodan geride');
  assert.equal(BR.selectPrimaryLogisticSegment([zero, warehouse]), warehouse, 'A: 0 adet üretim bakiyesi değil');
  assert.equal(BR.selectPrimaryLogisticSegment([shortage, warehouse]), warehouse, 'B: kıtlık seçilmez');
  assert.equal(BR.selectPrimaryLogisticSegment([shortage]), shortage, 'yalnız kıtlık varsa (başka segment yok) kıtlık');
  assert.equal(BR.selectPrimaryLogisticSegment([zero]), zero, 'tek segment 0 adetse yine o');
  assert.equal(BR.selectPrimaryLogisticSegment([]), null);
  const loading = seg('partial', 'Yükleme Operasyonları', 400, '2027-01-10', { no: 4 });
  const customs = seg('partial', 'Gümrük-Liman Operasyonları', 400, '2026-11-25', { no: 5 });
  assert.equal(BR.selectPrimaryLogisticSegment([customs, transit, loading]), loading, 'D: yükleme < yol < gümrük');
  assert.equal(BR.selectPrimaryLogisticSegment([customs, transit]), transit);
  // Aynı aşamada bugünkü kural korunur: en erken varış.
  const transitLate = seg('partial', 'Yol Operasyonları', 500, '2026-12-20', { no: 6 });
  assert.equal(BR.selectPrimaryLogisticSegment([transitLate, transit]), transit);
});

test('tek tanım: parse.js, okuma modeli hazırlığı ve istemci aynı fonksiyonu çağırır; partials[0] yolu kalmaz', () => {
  const parseSource = fs.readFileSync(path.join(ROOT, 'server/lib/parse.js'), 'utf8');
  const prepSource = fs.readFileSync(path.join(ROOT, 'server/lib/read-model/overview-row-prep.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(ROOT, 'public/app-main.js'), 'utf8');
  assert.match(parseSource, /BLBusinessRules\.selectPrimaryLogisticSegment\(/);
  assert.match(prepSource, /rules\.selectPrimaryLogisticSegment\(/);
  const clientBody = appSource.slice(appSource.indexOf('function rebuildCpLogisticCaches('), appSource.indexOf('function syncCpProductionLogisticSegment('));
  assert.match(clientBody, /BLBusinessRules\.selectPrimaryLogisticSegment\(/);
  for (const [name, text] of [['overview-row-prep.js', prepSource], ['app-main.js rebuildCpLogisticCaches', clientBody]]) {
    assert.doesNotMatch(text, /partials\[0\]\s*\|\|/, `${name}: paralel birincil seçim kaldırılmalı`);
  }
});
