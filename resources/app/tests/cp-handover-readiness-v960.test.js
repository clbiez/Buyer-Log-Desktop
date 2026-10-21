'use strict';

/* v9.60 — CP kanonik Handover uyarısının Readiness / Attention'a taşınması.
 * Korunan kusur: Loading Operations aşamasındaki, yükleme onayı verilmiş ama
 * HANDOVER yapılmamış satır CP Priority'de Handover görünürken delivery engine
 * UNKNOWN döndüğü için Overview'da UNKNOWN kalabiliyordu. Readiness yeni bir
 * handover kuralı yazmaz; business-rules.computePriorityFlags().handoverWarning
 * boolean'ını kullanır ve minimum ACTION_THIS_WEEK uygular.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../public/cp-readiness-engine.js');
const BR = require('../public/business-rules.js');

const F = Engine.FIELDS;
const ord = Engine.defaultOrdinal;
const TODAY = ord('2026-09-06');

function row(overrides) {
  const o = overrides || {};
  return {
    [F.orderCode]: o.orderCode || 'H-1',
    [F.model]: o.model || 'MODEL-H',
    [F.colourCode]: o.colourCode || 'C1',
    [F.status]: o.status || 'Yükleme Operasyonları',
    [F.priority]: o.cpPriority || 'In Time', // String parse edilmemeli.
    [F.orderDate]: o.orderDate || '2026-07-01',
    [F.exFactory]: Object.prototype.hasOwnProperty.call(o, 'exFactory') ? o.exFactory : '2026-09-05',
    [F.handover]: Object.prototype.hasOwnProperty.call(o, 'handover') ? o.handover : '',
    [F.shipConfirmation]: Object.prototype.hasOwnProperty.call(o, 'shipConfirmation') ? o.shipConfirmation : '2026-09-02',
    [F.retail]: Object.prototype.hasOwnProperty.call(o, 'retail') ? o.retail : '2026-12-01',
    [F.inStore]: Object.prototype.hasOwnProperty.call(o, 'inStore') ? o.inStore : '2026-12-20',
    [F.antArrival]: Object.prototype.hasOwnProperty.call(o, 'antArrival') ? o.antArrival : '',
    [F.delType]: o.delType || 'Tır', // Default transit yok => deliveryOutcome UNKNOWN.
    [F.qty]: 100,
    [F.season]: '26SS',
    [F.country]: 'HINDISTAN',
    [F.shortageQty]: Object.prototype.hasOwnProperty.call(o, 'shortageQty') ? o.shortageQty : 0,
    [F.shortageAllInWarehouse]: false,
  };
}

function canonicalFlags(input) {
  const canonicalOrdinal = value => (typeof value === 'number' && Number.isFinite(value) ? value : ord(value));
  return BR.computePriorityFlags({
    exFactory: input[F.exFactory],
    retailDate: input[F.retail],
    inStoreDate: input[F.inStore],
    antArrival: input[F.antArrival],
    handoverDate: input[F.handover],
    shipConfirmationDate: input[F.shipConfirmation],
    status: input[F.status],
    shortage: Number(input[F.shortageQty]) > 0,
    shortageQty: input[F.shortageQty],
    shortageNote: Number(input[F.shortageQty]) > 0 && input[F.shortageAllInWarehouse] === true,
    delType: input[F.delType],
    season: input[F.season],
    country: input[F.country],
    rules: [],
    today: TODAY,
  }, canonicalOrdinal);
}

function analyze(input, settings) {
  return Engine.analyzeOrder(input, {
    today: TODAY,
    dateOrdinal: ord,
    transitRules: [],
    settings: { requireTransitRule: true, ...(settings || {}) },
  });
}

test('v9.60 UNKNOWN + canonical handoverWarning => minimum ACTION_THIS_WEEK ve HANDOVER_PENDING', () => {
  const input = row({ orderCode: 'H-UNKNOWN' });
  assert.equal(canonicalFlags(input).handoverWarning, true, 'CP canonical rule Handover üretmeli');

  const analysis = analyze(input);
  assert.equal(analysis.deliveryOutcome, 'UNKNOWN', 'delivery outcome değiştirilmemeli');
  assert.equal(analysis.handoverWarning, true);
  // v7.0.290: Aksiyon Önceliği yalnız kullanıcı kurallarından gelir; motorun
  // önerisi systemPriority (kural koşulunda [@basePriority]) olarak korunur.
  assert.equal(analysis.systemPriority, 'ACTION_THIS_WEEK');
  assert.equal(analysis.priority, 'ON_TRACK');
  assert.ok(analysis.riskReasons.includes('HANDOVER_PENDING'));
  assert.equal(Engine.RISK_REASON_LABELS.tr.HANDOVER_PENDING, 'Yükleme onayı verildi, Handover bekleniyor');
  assert.equal(Engine.RISK_REASON_LABELS.en.HANDOVER_PENDING, 'Loading confirmed, Handover pending');

  const model = Engine.analyze([input], { today: TODAY, dateOrdinal: ord, transitRules: [], settings: { requireTransitRule: true } });
  assert.equal(Engine.needsAttention(model).length, 0, 'kural yoksa Attention listesine kendiliğinden girmez');
  for (const item of model.orders) item.priority = item.decision.action.priority = item.systemPriority;
  const attention = Engine.needsAttention(model);
  assert.equal(attention.length, 1, 'kural sistem önerisini uygularsa ACTION_THIS_WEEK Attention listesine girer');
  assert.equal(attention[0].priority, 'ACTION_THIS_WEEK');
});

test('v9.60 CP Priority string Handover içermese bile canonical boolean kullanılır', () => {
  const input = row({ cpPriority: 'In Time', shipConfirmation: '2026-09-02' });
  const analysis = analyze(input);
  assert.equal(analysis.cpPriority, 'In Time');
  assert.equal(analysis.handoverWarning, true);
  assert.equal(analysis.systemPriority, 'ACTION_THIS_WEEK');
});

test('v9.60 yükleme onayının üzerinden henüz 3 gün geçmediyse yeni escalation yok', () => {
  const input = row({ shipConfirmation: '2026-09-04' });
  assert.equal(canonicalFlags(input).handoverWarning, false);
  const analysis = analyze(input);
  assert.equal(analysis.handoverWarning, false);
  assert.ok(!analysis.riskReasons.includes('HANDOVER_PENDING'));
  assert.notEqual(analysis.priority, 'ACTION_THIS_WEEK', 'Handover kuralı tek başına yükseltmemeli');
});

test('v9.60 Handover tarihi varsa warning ve reason oluşmaz', () => {
  const input = row({ handover: '2026-09-05' });
  assert.equal(canonicalFlags(input).handoverWarning, false);
  const analysis = analyze(input);
  assert.equal(analysis.handoverWarning, false);
  assert.ok(!analysis.riskReasons.includes('HANDOVER_PENDING'));
});

test('v9.60 üretimdeki sipariş canonical Handover warning üretmiyorsa Readiness de üretmez', () => {
  const input = row({ status: 'Üretimde', shipConfirmation: '2026-09-01' });
  assert.equal(canonicalFlags(input).handoverWarning, false);
  const analysis = analyze(input);
  assert.equal(analysis.handoverWarning, false);
  assert.ok(!analysis.riskReasons.includes('HANDOVER_PENDING'));
});

test('v9.60 DEPODA siparişte canonical Handover warning yoktur', () => {
  const input = row({ status: 'DEPODA', shipConfirmation: '2026-09-01' });
  assert.equal(canonicalFlags(input).handoverWarning, false);
  const analysis = analyze(input);
  assert.equal(analysis.handoverWarning, false);
  assert.ok(!analysis.riskReasons.includes('HANDOVER_PENDING'));
});

test('v9.60 shortage kanonik Handover uyarısını bastırır; Readiness aynı sonucu kullanır', () => {
  const input = row({ shortageQty: 25, shipConfirmation: '2026-09-01' });
  assert.equal(canonicalFlags(input).handoverWarning, false);
  const analysis = analyze(input);
  assert.equal(analysis.handoverWarning, false);
  assert.ok(!analysis.riskReasons.includes('HANDOVER_PENDING'));
});

test('v9.60 daha yüksek CRITICAL priority Handover nedeniyle düşürülmez', () => {
  // Kanonik Handover boolean'ı yalnız DEPODA/üretim/shortage durumlarını dışlar;
  // Yolda satırında da true olabilir. Gerçek antrepo varışı hedefi geçmişse
  // delivery engine ALREADY_LATE => CRITICAL üretir ve minimum-escalation bunu
  // ACTION_THIS_WEEK seviyesine düşürmemelidir.
  const input = row({
    orderCode: 'H-CRITICAL',
    status: 'Yolda',
    delType: 'Gemi',
    exFactory: '2026-08-01',
    antArrival: '2026-09-06',
    retail: '2026-09-05',
    inStore: '2026-09-06',
    shipConfirmation: '2026-09-01',
  });
  assert.equal(canonicalFlags(input).handoverWarning, true);
  const analysis = analyze(input, { requireTransitRule: false });
  assert.equal(analysis.handoverWarning, true);
  assert.equal(analysis.deliveryOutcome, 'ALREADY_LATE');
  assert.equal(analysis.systemPriority, 'CRITICAL');
  assert.ok(analysis.riskReasons.includes('HANDOVER_PENDING'));
});
