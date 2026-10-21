'use strict';

/* v9.57 — Orders Requiring Attention sadeleştirmesi.
 * Kullanıcı üç yüksek-seviye CP risk kuralını kaldırdı:
 * AT_RISK_FOR_TARGET, IN_STORE_PASSED, RETAIL_PASSED.
 * Kanonik deliveryOutcome hesaplanmaya devam eder; yalnız bu üç sonuç artık
 * CP readiness risk sebebi / öncelik yükseltme nedeni değildir.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/cp-readiness-engine.js');

const F = Engine.FIELDS;
const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-05');

function row(overrides) {
  const o = overrides || {};
  return {
    [F.orderCode]: o.orderCode || 'R-1',
    [F.model]: 'MODEL-1',
    [F.colourCode]: 'C1',
    [F.status]: o.status || 'Üretimde',
    [F.orderDate]: o.orderDate || '2026-08-20',
    [F.exFactory]: o.exFactory || '2026-09-20',
    [F.handover]: o.handover || '',
    [F.retail]: o.retail || '2026-11-30',
    [F.inStore]: o.inStore || '2027-01-01',
    [F.antArrival]: o.antArrival || '',
    [F.delType]: 'Gemi',
    [F.qty]: 100,
    [F.season]: '26SS',
    [F.country]: 'HINDISTAN',
  };
}

function analyzeOne(input, extraSettings) {
  return Engine.analyzeOrder(input, {
    today: TODAY,
    dateOrdinal: ord,
    transitRules: [],
    // Bu test risk kuralını izole eder; Gemi'nin kanonik 70 günlük fallback'i
    // kullanılır, ayrıca tanımlı kural gereksinimi test konusu değildir.
    settings: { requireTransitRule: false, ...(extraSettings || {}) },
  });
}

test('v9.57 kaldırılan üç risk kodu registry ve label haritasında artık yok', () => {
  for (const code of ['AT_RISK_FOR_TARGET', 'IN_STORE_PASSED', 'RETAIL_PASSED']) {
    assert.ok(!Engine.RISK_REASONS.includes(code), `${code} registry'den kaldırılmalı`);
    assert.equal(Engine.RISK_REASON_LABELS.tr[code], undefined, `${code} TR label kalmamalı`);
    assert.equal(Engine.RISK_REASON_LABELS.en[code], undefined, `${code} EN label kalmamalı`);
  }
});

test('v9.57 deliveryOutcome AT_RISK tek başına Attention önceliği üretmez', () => {
  // Ex-Factory + 70 gün ETA, Retail'e yalnız 1 gün tampon bırakıyor =>
  // kanonik teslimat motoru AT_RISK. Yüklemeye 15 gün olduğundan ayrı bir
  // loading-window aksiyonu da yok.
  const analysis = analyzeOne(row({
    orderCode: 'R-AT-RISK',
    orderDate: '2026-08-20',
    exFactory: '2026-09-20',
    retail: '2026-11-30',
  }));
  assert.equal(analysis.deliveryOutcome, 'AT_RISK', 'teslimat sonucu hesaplanmaya devam etmeli');
  assert.equal(analysis.priority, 'ON_TRACK', 'AT_RISK tek başına ACTION_THIS_WEEK üretmemeli');
  assert.deepEqual(analysis.riskReasons, [], 'AT_RISK_FOR_TARGET nedeni artık üretilmemeli');

  const model = Engine.analyze([row({
    orderCode: 'R-AT-RISK',
    orderDate: '2026-08-20',
    exFactory: '2026-09-20',
    retail: '2026-11-30',
  })], { today: TODAY, dateOrdinal: ord, transitRules: [], settings: { requireTransitRule: false } });
  assert.equal(Engine.needsAttention(model).length, 0, 'başka sinyal yoksa Attention listesine girmemeli');
});

test('v9.57 Retail ve In Store tarihinin geçmiş olması tek başına risk nedeni üretmez', () => {
  // Ürün depoya hedeflerden önce girmiş; bugün her iki hedef tarihi de geçmiş.
  // Eskiden yalnız takvim geçmiş diye IN_STORE_PASSED / RETAIL_PASSED eklenirdi.
  const input = row({
    orderCode: 'R-ARRIVED',
    status: 'DEPODA',
    orderDate: '2026-01-01',
    exFactory: '2026-05-01',
    handover: '2026-05-01',
    antArrival: '2026-07-20',
    retail: '2026-08-01',
    inStore: '2026-08-15',
  });

  const retail = analyzeOne(input, { targetType: 'retail' });
  assert.equal(retail.deliveryOutcome, 'ON_TRACK');
  assert.equal(retail.priority, 'ON_TRACK');
  assert.ok(!retail.riskReasons.includes('RETAIL_PASSED'));
  assert.ok(!retail.riskReasons.includes('IN_STORE_PASSED'));

  const inStore = analyzeOne(input, { targetType: 'inStore' });
  assert.equal(inStore.deliveryOutcome, 'ON_TRACK');
  assert.equal(inStore.priority, 'ON_TRACK');
  assert.ok(!inStore.riskReasons.includes('RETAIL_PASSED'));
  assert.ok(!inStore.riskReasons.includes('IN_STORE_PASSED'));
});

test('v9.57 gerçek gecikme kuralları korunur: EXPECTED_LATE yine aksiyon üretir', () => {
  const analysis = analyzeOne(row({
    orderCode: 'R-LATE',
    orderDate: '2026-08-20',
    exFactory: '2026-09-20',
    retail: '2026-11-25',
  }));
  assert.equal(analysis.deliveryOutcome, 'EXPECTED_LATE');
  assert.ok(analysis.riskReasons.includes('EXPECTED_LATE_FOR_TARGET'));
  // v7.0.290: öneri korunur, Aksiyon Önceliğini yalnız kullanıcı kuralı yükseltir.
  assert.equal(analysis.systemPriority, 'ACTION_TODAY');
  assert.equal(analysis.priority, 'ON_TRACK');
});
