'use strict';

/* v9.46 — OTOMATİK VE KULLANICI TANIMLI YORUMLAR
 *
 * Korunan asıl kusur: yorum METNİNDEKİ sayı ile yoruma tıklayınca açılan
 * sipariş listesinin ayrışması. "21 sipariş riskli" yazıp 19 sipariş açan bir
 * rapor, sayının kendisini güvenilmez yapar (§31, §64). Bu yüzden her testte
 * metindeki sayı ile insight.orders içeriği birlikte doğrulanır.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const Engine = require('../public/backlog-delivery-engine.js');
const Insights = require('../public/backlog-delivery-insights.js');

const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');

function row(spec) {
  const o = spec || {};
  return {
    'Sipariş Kod': o.code || '1001', 'Model Adı': o.model || 'M1', 'Renk Kod': o.cc || 'C1',
    'Sezon': o.season || '26SS', 'Siparişin Üretildiği Ülke': o.country || 'India',
    'Buyer': o.buyer || 'BUYER-1', 'Buyer Grup (TR)': o.buyerGroup || 'BG-1',
    'Üretici': o.manufacturer || 'MF-1', 'Alt Üretici': 'SUB-1', 'Line': 'LINE-1', 'Ürün Klasman': 'CLASS-1',
    'GÜNCEL DURUM\n(STATUS)': o.status || 'Üretimde',
    'YÜKLEME TİPİ': o.delType === undefined ? 'Gemi' : o.delType,
    'Retail Depo Tarih Yıl Ay Gün': o.retail === undefined ? '2026-12-01' : o.retail,
    'Model Bütçe Tarih Yıl Ay Gün': null,
    'Orijinal Exfactory Merch Tarih': o.plannedLoad === undefined ? null : o.plannedLoad,
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': o.revisedLoad === undefined ? null : o.revisedLoad,
    'ANTREPO GİRİŞ TARİHİ': null,
    'Adet': o.qty === undefined ? 100 : o.qty,
    _backlogExcel: {
      transitDays: o.transitDays === undefined ? 70 : o.transitDays,
      // Kural TANIMLI kabul edilir: motor varsayılan olarak kuralsız satırda
      // hesap yapmaz (bkz. requireTransitRule). Kuralsız senaryo ayrıca test edilir.
      transitRule: o.transitRule === undefined ? { delType: 'Gemi', days: 70 } : o.transitRule,
      handoverDate: o.handover === undefined ? null : o.handover,
      actualAntrepoDate: o.actualAntrepo === undefined ? null : o.actualAntrepo,
      priority: '', mag: o.mag || 'MAG-1', mmyg: o.mmyg || 'MMYG-1',
    },
  };
}
const build = rows => Engine.analyze(rows, { today: TODAY, dateOrdinal: ord });

test('v9.46 transit gecikmesi yorumu: metindeki sayı ile açılan sipariş listesi AYNI', () => {
  const rows = [
    // Zamanında yüklendi, transit aşıldı, hedef yakın → riskli
    row({ code: 'T1', status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-25', retail: '2026-08-28' }),
    row({ code: 'T2', status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-25', retail: '2026-08-28' }),
    // Zamanında yüklendi, transit normal → yorumda sayılmamalı
    row({ code: 'OK1', status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-12-30' }),
  ];
  const model = build(rows);
  const list = Insights.generate(model, { lang: 'tr' });
  const transit = list.find(item => item.type === 'transitDelay');
  assert.ok(transit, 'transit gecikmesi yorumu üretilmeli');
  assert.equal(transit.orderCount, 2);
  assert.equal(transit.orders.length, 2);
  assert.deepEqual(transit.orders.map(order => order.orderCode).sort(), ['T1', 'T2']);
  assert.match(transit.message, /2 sipariş/);
});

test('v9.46 kullanıcı yorum tiplerini kapatabilir', () => {
  const model = build([row({ code: 'L1', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-08-20' })]);
  const withDefault = Insights.generate(model, { lang: 'tr' });
  assert.ok(withDefault.some(item => item.type === 'deliveryOutcome'));

  const disabled = Insights.generate(model, { lang: 'tr', preferences: { deliveryOutcome: false } });
  assert.ok(!disabled.some(item => item.type === 'deliveryOutcome'), 'kapatılan tip üretilmemeli');
});

test('v9.46 olumlu özet varsayılan KAPALI, açılınca üretiliyor', () => {
  const model = build([row({ code: 'S1', status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-12-30' })]);
  assert.ok(!Insights.generate(model, {}).some(item => item.type === 'positiveSummary'));
  const on = Insights.generate(model, { preferences: { positiveSummary: true } });
  assert.ok(on.some(item => item.type === 'positiveSummary'));
});

test('v9.46 yoğunlaşma yorumu yalnız GERÇEKTEN orantısızsa üretilir', () => {
  // İki üretici eşit paylı ve eşit riskli: bu bir bulgu değil, gürültü.
  const balanced = build([
    row({ code: 'A1', manufacturer: 'MF-A', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' }),
    row({ code: 'B1', manufacturer: 'MF-B', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' }),
  ]);
  assert.ok(!Insights.generate(balanced, {}).some(item => item.type === 'supplierConcentration'),
    'dengeli dağılımda yoğunlaşma yorumu üretilmemeli');

  // Tek üretici riskin tamamını taşıyor ama toplamın küçük bir kısmı.
  const skewed = build([
    row({ code: 'R1', manufacturer: 'MF-RISK', qty: 300, status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' }),
    row({ code: 'H1', manufacturer: 'MF-OK', qty: 700, status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-12-30' }),
  ]);
  const insight = Insights.generate(skewed, { lang: 'tr' }).find(item => item.type === 'supplierConcentration');
  assert.ok(insight, 'orantısız yoğunlaşmada yorum üretilmeli');
  assert.match(insight.message, /MF-RISK/);
  assert.equal(insight.orders.length, 1);
});

test('v9.46 özel kural: koşullar VE ile birleşir, sonuç yetkili veriyle sınırlı kalır', () => {
  const rows = [
    row({ code: 'X1', status: 'Yolda', delType: 'Gemi', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-25', retail: '2026-08-28' }),
    row({ code: 'X2', status: 'Yolda', delType: 'Uçak', transitDays: 15, plannedLoad: '2026-08-01', handover: '2026-08-01', actualAntrepo: '2026-08-25', retail: '2026-08-28' }),
    row({ code: 'X3', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' }),
  ];
  const model = build(rows);
  const rules = [{
    id: 'r1', name: 'Transit Delay — Critical Retail', severity: 'critical', measure: 'orders', groupBy: 'manufacturer', showTop: 5,
    messageTemplate: '{count} sipariş planlanan transit süresini aşmış durumda.',
    conditions: [
      { field: 'stage', operator: 'eq', value: 'IN_TRANSIT' },
      { field: 'loadingType', operator: 'eq', value: 'Gemi' },
      { field: 'transitVarianceDays', operator: 'gt', value: 5 },
    ],
  }];
  const custom = Insights.evaluateCustom(model, rules, { lang: 'tr' });
  assert.equal(custom.length, 1);
  assert.equal(custom[0].severity, 'critical');
  assert.equal(custom[0].orderCount, 1);
  assert.equal(custom[0].orders[0].orderCode, 'X1');
  assert.equal(custom[0].message, '1 sipariş planlanan transit süresini aşmış durumda.');
  assert.equal(custom[0].custom, true);
});

test('v9.46 özel kural: eksik sayısal veri koşulu KARŞILAMAZ (sahte eşleşme yok)', () => {
  const model = build([row({ code: 'N1', status: 'Üretimde', revisedLoad: '2026-09-10', plannedLoad: '2026-09-10', retail: '2027-02-01' })]);
  // Üretimdeki sipariş henüz yüklenmedi: transitVarianceDays null.
  const custom = Insights.evaluateCustom(model, [{
    id: 'r2', name: 'Bogus', conditions: [{ field: 'transitVarianceDays', operator: 'gt', value: -9999 }],
  }], {});
  assert.equal(custom.length, 0, 'null sayısal alan hiçbir karşılaştırmayı geçmemeli');
});

test('v9.46 özel kural: geçersiz alan/operatör sessizce düşürülür', () => {
  const model = build([row({ code: 'Z1', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-10-01' })]);
  const normalized = Insights.normalizeRule({ name: 'bad', conditions: [
    { field: 'gizliAlan', operator: 'eq', value: 'x' },
    { field: 'stage', operator: 'regex', value: '.*' },
    { field: 'stage', operator: 'eq', value: 'PRODUCTION' },
  ] }, 0);
  assert.equal(normalized.conditions.length, 1);
  assert.equal(normalized.conditions[0].field, 'stage');
  assert.equal(Insights.evaluateCustom(model, [normalized], {}).length, 1);
});

test('v9.46 yorumlar önem sırasına göre sıralanır', () => {
  const model = build([
    row({ code: 'C1', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-08-20' }),
    row({ code: 'C2', status: 'Yolda', plannedLoad: '2026-06-01', handover: '2026-06-01', actualAntrepo: '2026-08-10', retail: '2026-12-30' }),
  ]);
  const list = Insights.build(model, { preferences: { positiveSummary: true } });
  const ranks = list.map(item => Insights.SEVERITY_RANK[item.severity]);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), 'critical → positive sırası korunmalı');
});

test('v9.46 İngilizce yorum üretimi TR ile aynı sayıyı verir', () => {
  const model = build([row({ code: 'E1', status: 'Üretimde', revisedLoad: '2026-08-01', plannedLoad: '2026-08-01', retail: '2026-08-20' })]);
  const tr = Insights.generate(model, { lang: 'tr' }).find(item => item.type === 'deliveryOutcome');
  const en = Insights.generate(model, { lang: 'en' }).find(item => item.type === 'deliveryOutcome');
  assert.equal(tr.orderCount, en.orderCount);
  assert.match(en.message, /orders/);
  assert.match(tr.message, /sipariş/);
});
