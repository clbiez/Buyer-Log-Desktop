'use strict';

/* v9.46 — BACKLOG TESLİMAT RİSKİ MOTORU
 *
 * Kullanıcı talebinin §62'deki senaryoları (A–H) burada birebir çivilenir.
 * Korunan asıl kusur: teslimat sınıflandırmasının kod tabanındaki KANONİK
 * gecikme kuralından (BLBusinessRules.computePriorityFlags) sessizce ayrışması.
 * Bu yüzden son test motorun ETA'sını kanonik motorun estimatedAntrepo
 * değeriyle karşılaştırır — ikisi ayrışırsa iki farklı "gecikme" tanımı doğar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const Engine = require('../public/backlog-delivery-engine.js');
const BR = require('../public/business-rules.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');

function row(spec) {
  const o = spec || {};
  return {
    'Sipariş Kod': o.code || '1001',
    'Model Adı': o.model || 'MODEL-1',
    'Renk Kod': o.cc || 'C1',
    'Sezon': o.season || '26SS',
    'Siparişin Üretildiği Ülke': o.country || 'India',
    'Buyer': o.buyer || 'BUYER-1',
    'Buyer Grup (TR)': o.buyerGroup || 'BG-1',
    'Üretici': o.manufacturer || 'MF-1',
    'Alt Üretici': o.subManufacturer || 'SUB-1',
    'Line': o.line || 'LINE-1',
    'Ürün Klasman': o.category || 'CLASS-1',
    'GÜNCEL DURUM\n(STATUS)': o.status || 'Üretimde',
    'YÜKLEME TİPİ': o.delType === undefined ? 'Gemi' : o.delType,
    'Retail Depo Tarih Yıl Ay Gün': o.retail === undefined ? '2026-12-01' : o.retail,
    'Model Bütçe Tarih Yıl Ay Gün': o.inStore === undefined ? null : o.inStore,
    'Orijinal Exfactory Merch Tarih': o.plannedLoad === undefined ? null : o.plannedLoad,
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': o.revisedLoad === undefined ? null : o.revisedLoad,
    'ANTREPO GİRİŞ TARİHİ': o.antrepo === undefined ? null : o.antrepo,
    'Adet': o.qty === undefined ? 100 : o.qty,
    _backlogExcel: {
      transitDays: o.transitDays === undefined ? 70 : o.transitDays,
      // Kural TANIMLI kabul edilir: motor varsayılan olarak kuralsız satırda
      // hesap yapmaz (bkz. requireTransitRule). Kuralsız senaryo ayrıca test edilir.
      transitRule: o.transitRule === undefined ? { delType: 'Gemi', days: 70 } : o.transitRule,
      handoverDate: o.handover === undefined ? null : o.handover,
      actualAntrepoDate: o.actualAntrepo === undefined ? null : o.actualAntrepo,
      priority: o.priority || '',
      mag: o.mag || 'MAG-1',
      mmyg: o.mmyg || 'MMYG-1',
    },
  };
}
const analyze = (spec, settings) => Engine.analyzeOrder(row(spec), { today: TODAY, dateOrdinal: ord, settings });

test('v9.46 A — zamanında yüklendi, transit plan içinde, hedefe bol süre: ON TRACK', () => {
  const a = analyze({ status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-09-30' });
  assert.equal(a.deliveryOutcome, 'ON_TRACK');
  assert.equal(a.loadingPerformance, 'LOADED_ON_TIME');
  assert.equal(a.etaSource, 'ias');
  assert.equal(a.scheduleBufferDays, 51);
  assert.equal(a.riskCause, null);
});

test('v9.46 B — zamanında yüklendi AMA transit planı aştı: risk sebebi TRANSIT_DELAY', () => {
  // Plan 70 gün; gerçek 85 gün. Yükleme zamanında olduğu için bu ayrı bir kategori (§10).
  const a = analyze({ status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-25', retail: '2026-08-28' });
  assert.equal(a.loadingPerformance, 'LOADED_ON_TIME');
  assert.equal(a.actualTransitDays, 85);
  assert.equal(a.transitVarianceDays, 15);
  assert.equal(a.deliveryOutcome, 'AT_RISK');
  assert.ok(a.riskReasons.includes('TRANSIT_DELAY'), `TRANSIT_DELAY bekleniyordu: ${a.riskReasons}`);
});

test('v9.46 C — henüz yüklenmedi ama güvenli yükleme tarihine daha çok var: ON TRACK', () => {
  const a = analyze({ status: 'Üretimde', revisedLoad: '2026-09-10', plannedLoad: '2026-09-10', retail: '2027-02-01' });
  assert.equal(a.deliveryOutcome, 'ON_TRACK');
  assert.equal(a.loadingPerformance, 'NOT_LOADED_SAFE');
  assert.equal(a.etaSource, 'calculated');
});

test('v9.46 D — son güvenli yükleme tarihi geçti: EXPECTED LATE + yetersiz transit', () => {
  // Ex-Factory geçmişte; kanonik kural geçmiş tarihi BUGÜNE taşır (geçmişte yüklenemez).
  const a = analyze({ status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' });
  assert.equal(a.deliveryOutcome, 'EXPECTED_LATE');
  assert.equal(a.eta, TODAY + 70, 'ETA bugünden itibaren hesaplanmalı');
  assert.equal(a.loadingPerformance, 'NOT_LOADED_EXPECTED_LATE');
  assert.ok(a.riskReasons.includes('INSUFFICIENT_TRANSIT_BUFFER'), a.riskReasons.join(','));
});

test('v9.46 E — geç yüklendi ama hâlâ yetişebilir: AT RISK + LATE_LOADING', () => {
  const a = analyze({ status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-20', actualAntrepo: '2026-08-29', retail: '2026-09-02' });
  assert.equal(a.loadingPerformance, 'LOADED_LATE');
  assert.equal(a.loadingVarianceDays, 19);
  assert.equal(a.deliveryOutcome, 'AT_RISK');
  assert.ok(a.riskReasons.includes('LATE_LOADING'), a.riskReasons.join(','));
});

test('v9.46 F — gümrük/liman aşamasında ve hedef yakın: CUSTOMS_DELAY', () => {
  const a = analyze({ status: 'Gümrük-Liman Operasyonları', plannedLoad: '2026-07-01', handover: '2026-07-01', actualAntrepo: '2026-09-08', retail: '2026-09-10' });
  assert.equal(a.stage, 'CUSTOMS');
  assert.equal(a.deliveryOutcome, 'AT_RISK');
  assert.ok(a.riskReasons.includes('CUSTOMS_DELAY'), a.riskReasons.join(','));
});

test('v9.46 G — depoya ulaştı, retaile aktarım bekliyor, hedef yakın: RETAIL_TRANSFER_DELAY', () => {
  const a = analyze({ status: 'Retaile Aktarım Bekleniyor', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-09-01', retail: '2026-09-04' });
  assert.equal(a.stage, 'AWAITING_RETAIL_TRANSFER');
  assert.equal(a.deliveryOutcome, 'AT_RISK');
  assert.ok(a.riskReasons.includes('RETAIL_TRANSFER_DELAY'), a.riskReasons.join(','));
});

test('v9.46 H — eksik veri UYDURULMAZ: UNKNOWN kalır', () => {
  const noTarget = analyze({ status: 'Üretimde', revisedLoad: '2026-09-10', retail: null });
  assert.equal(noTarget.deliveryOutcome, 'UNKNOWN');
  assert.equal(noTarget.riskCause, 'MISSING_DATE');

  const noTransit = analyze({ status: 'Üretimde', revisedLoad: '2026-09-10', transitDays: null, delType: '' });
  assert.equal(noTransit.deliveryOutcome, 'UNKNOWN');
  assert.equal(noTransit.riskCause, 'MISSING_TRANSIT_RULE');
  assert.equal(noTransit.eta, null, 'transit süresi yoksa sahte ETA üretilmemeli');
});

test('v9.46 hedef tarih geçmiş ve sipariş hâlâ varmamışsa ALREADY_LATE', () => {
  const a = analyze({ status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-08-20' });
  assert.equal(a.deliveryOutcome, 'ALREADY_LATE');
  assert.ok(a.riskReasons.includes('TARGET_DATE_PASSED'), a.riskReasons.join(','));
});

test('v9.46 In Store hedefi kanonik 14 günlük tamponu uygular', () => {
  const spec = { status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-09-20', retail: '2026-12-01', inStore: '2026-10-01' };
  const retailTarget = analyze(spec, { targetType: 'retail' });
  const inStoreTarget = analyze(spec, { targetType: 'inStore' });
  assert.equal(retailTarget.requiredBuffer, 0);
  assert.equal(inStoreTarget.requiredBuffer, 14);
  // In Store'a 11 gün var: 14 günlük kanonik gerekliliğin altında.
  assert.equal(inStoreTarget.scheduleBufferDays, 11);
  assert.equal(inStoreTarget.deliveryOutcome, 'EXPECTED_LATE');
  assert.equal(retailTarget.deliveryOutcome, 'ON_TRACK');
});

test('v9.46 KANONİK TUTARLILIK — motorun ETA\'sı computePriorityFlags ile birebir aynı', () => {
  const cases = [
    { status: 'Üretimde', revisedLoad: '2026-08-01', retail: '2026-10-01' },   // geçmiş Ex-Factory → bugüne taşınır
    { status: 'Üretimde', revisedLoad: '2026-10-20', retail: '2027-02-01' },   // gelecek Ex-Factory
    { status: 'Eksik Yükleme', revisedLoad: '2026-08-01', retail: '2026-11-01' }, // shortage → taşınmaz
    { status: 'Yolda', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-09-30' }, // gerçek varış
  ];
  for (const spec of cases) {
    const engineResult = analyze(spec);
    const canonical = BR.computePriorityFlags({
      exFactory: spec.revisedLoad || null,
      retailDate: spec.retail || null,
      antArrival: spec.actualAntrepo || null,
      status: spec.status,
      delType: 'Gemi',
      today: '2026-09-05',
      rules: [],
    }, ord);
    assert.equal(engineResult.eta, canonical.estimatedAntrepo,
      `ETA ayrıştı (${spec.status}): motor ${engineResult.eta} vs kanonik ${canonical.estimatedAntrepo}`);
    if (canonical.retailGap != null) {
      assert.equal(engineResult.scheduleBufferDays, canonical.retailGap, `tampon ayrıştı (${spec.status})`);
    }
  }
});

test('v9.46 toplulaştırma: adet toplanır, sipariş kimliği TEKİLLEŞTİRİLİR', () => {
  // Aynı sipariş+model+renk iki parsiyel → 1 sipariş, 2 satır, 300 adet.
  const rows = [
    row({ code: '1001', qty: 100, status: 'Yolda', handover: '2026-06-01', plannedLoad: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-09-30' }),
    row({ code: '1001', qty: 200, status: 'Yolda', handover: '2026-06-01', plannedLoad: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-09-30' }),
    row({ code: '2002', qty: 50, status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' }),
  ];
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  assert.equal(model.totals.qty, 350);
  assert.equal(model.totals.orders, 2);
  assert.equal(model.totals.rows, 3);
  assert.equal(model.deliveryOutcome.ON_TRACK.qty, 300);
  assert.equal(model.deliveryOutcome.ON_TRACK.orders, 1);
  assert.equal(model.deliveryOutcome.EXPECTED_LATE.qty, 50);

  const buyerDim = model.dimensions.buyer;
  assert.equal(buyerDim.length, 1);
  assert.equal(buyerDim[0].total.qty, 350);
  assert.equal(buyerDim[0].outcomes.EXPECTED_LATE.qty, 50);

  const magDim = model.dimensions.mag;
  assert.equal(magDim[0].name, 'MAG-1', 'MAG kırılımı _backlogExcel.mag alanından gelmeli');

  const stageKeys = model.stages.map(item => item.key);
  assert.ok(stageKeys.includes('IN_TRANSIT') && stageKeys.includes('PRODUCTION'));
});

test('v9.46 Needs Attention: gecikenler bugünkü listeye, sağlıklılar ON_TRACK grubuna', () => {
  const rows = [
    row({ code: 'L1', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-08-20' }), // ALREADY_LATE
    row({ code: 'S1', status: 'Yolda', handover: '2026-06-01', plannedLoad: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-12-30' }), // ON_TRACK
  ];
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  const groups = Engine.needsAttention(model);
  assert.equal(groups.ACT_TODAY.length, 1);
  assert.equal(groups.ACT_TODAY[0].orderCode, 'L1');
  assert.equal(groups.ON_TRACK.length, 1);
  assert.equal(groups.ON_TRACK[0].orderCode, 'S1');
});

test('v9.46 veri kalitesi: eksik alanlar sayılır, Unknown ayrı raporlanır', () => {
  const rows = [
    row({ code: 'A', retail: null }),
    row({ code: 'B', delType: '', transitDays: null }),
    row({ code: 'C', status: 'Yolda', handover: '2026-06-01', plannedLoad: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-12-30' }),
  ];
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  assert.equal(model.dataQuality.unknown.rows, 2);
  const fields = model.dataQuality.missing.map(item => item.field);
  assert.ok(fields.includes('Retail Depo Tarih Yıl Ay Gün'));
  assert.ok(fields.includes('transitDays'));
});

test('v9.46 yol süresi kuralı TANIMSIZSA hesap yapılmaz, eksik bilgi olarak raporlanır', () => {
  // Kullanıcı talebi: "Nakliye Tipine Göre Ülke Bazlı Yol Süreleri" ayarlanmamışsa
  // otomatik hesap yapma, bilgi eksik uyarısı ver.
  const a = analyze({ status: 'Üretimde', revisedLoad: '2026-09-10', plannedLoad: '2026-09-10', retail: '2027-02-01', transitRule: null });
  assert.equal(a.transitRuleMissing, true);
  assert.equal(a.plannedTransitDays, null, 'kural yokken varsayılan süreyle hesap yapılmamalı');
  assert.equal(a.eta, null);
  assert.equal(a.deliveryOutcome, 'UNKNOWN');
  assert.equal(a.riskCause, 'MISSING_TRANSIT_RULE');
  assert.ok(a.missingFields.includes('transitRule'));
  // Kanonik varsayılan yine de referans olarak taşınır (uyarıda gösterilebilir).
  assert.equal(a.fallbackTransitDays, 70);
});

test('v9.46 kural yoksa bile GERÇEKTEN varmış sipariş hesaplanabilir', () => {
  // Antrepo girişi gerçekleşmişse ETA için transit süresine ihtiyaç yoktur.
  const a = analyze({ status: 'Depoda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-09-30', transitRule: null });
  assert.equal(a.transitRuleMissing, true);
  assert.equal(a.etaSource, 'ias');
  assert.equal(a.deliveryOutcome, 'ON_TRACK', 'gerçek varış tarihi varken kural eksikliği sonucu engellememeli');
});

test('v9.46 kural eksikliği ülke + yükleme tipi kombinasyonuyla raporlanır', () => {
  const rows = [
    row({ code: 'A', country: 'India', delType: 'Gemi', transitRule: null }),
    row({ code: 'B', country: 'India', delType: 'Gemi', transitRule: null }),
    row({ code: 'C', country: 'Turkey', delType: 'Uçak', transitRule: null }),
  ];
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  const info = model.dataQuality.transitRule;
  assert.equal(info.rows, 3);
  assert.equal(info.combos.length, 2, 'iki farklı ülke+tip kombinasyonu ayrı raporlanmalı');
  assert.equal(info.combos[0].rows, 2);
  assert.equal(info.combos[0].country, 'India');
});

test('v9.46 requireTransitRule kapatılırsa kanonik varsayılan süreyle hesap yapılır', () => {
  const a = analyze({ status: 'Üretimde', revisedLoad: '2026-09-10', plannedLoad: '2026-09-10', retail: '2027-02-01', transitRule: null },
    { requireTransitRule: false });
  assert.equal(a.plannedTransitDays, 70);
  assert.equal(a.deliveryOutcome, 'ON_TRACK');
});

test('v9.46 Needs Attention SAYILARI liste kısıtından etkilenmez', () => {
  const rows = Array.from({ length: 250 }, (_, index) =>
    row({ code: `L${index}`, status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-08-20' }));
  const model = Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });
  const groups = Engine.needsAttention(model, { limit: 50 });
  assert.equal(groups.ACT_TODAY.length, 50, 'liste kısıtlanır');
  assert.equal(groups.counts.ACT_TODAY, 250, 'SAYI tam kümeden gelmeli');
  assert.equal(groups.quantities.ACT_TODAY, 25000);
});
