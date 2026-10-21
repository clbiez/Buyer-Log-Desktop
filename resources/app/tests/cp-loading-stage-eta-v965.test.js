'use strict';

/* v9.65 — CP Loading Operations UNKNOWN düzeltmesi.
 * İki kök kusuru birlikte kilitler:
 * 1) İngilizce/adetli/composite CP status'larının canonical stage'e çevrilmesi.
 * 2) LOADING aşamasında Handover yoksa ETA yolunun bulunmaması.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const BR = require('../public/business-rules.js');
const Delivery = require('../public/backlog-delivery-engine.js');
const Readiness = require('../public/cp-readiness-engine.js');

const ord = Delivery.defaultOrdinal;
const TODAY = ord('2026-09-07');

function deliveryRow(overrides) {
  const o = overrides || {};
  return {
    'Sipariş Kod': o.code || 'L-1',
    'Model Adı': 'MODEL-L',
    'Renk Kod': 'C1',
    'GÜNCEL DURUM\n(STATUS)': o.status || 'Loading Operations 5.003',
    'YÜKLEME TİPİ': 'Gemi',
    'Retail Depo Tarih Yıl Ay Gün': o.retail || '2027-01-31',
    'Model Bütçe Tarih Yıl Ay Gün': o.inStore || '2027-02-20',
    'Orijinal Exfactory Merch Tarih': o.plannedLoad || o.revisedLoad || '2026-08-20',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': o.revisedLoad || '2026-08-20',
    'ANTREPO GİRİŞ TARİHİ': o.antrepo || null,
    'Adet': 100,
    _backlogExcel: {
      transitDays: 70,
      transitRule: { id: 'sea-70', delType: 'Gemi', days: 70 },
      handoverDate: Object.prototype.hasOwnProperty.call(o, 'handover') ? o.handover : null,
      actualAntrepoDate: Object.prototype.hasOwnProperty.call(o, 'actualAntrepo') ? o.actualAntrepo : null,
    },
  };
}

function analyzeDelivery(overrides) {
  return Delivery.analyzeOrder(deliveryRow(overrides), { today: TODAY, dateOrdinal: ord });
}

test('v9.65 canonical stage parser İngilizce, quantity suffix ve composite statusları tanır', () => {
  const cases = new Map([
    ['Loading Operations', 'LOADING'],
    ['Loading Operations 773', 'LOADING'],
    ['Loading Operations 5.003', 'LOADING'],
    ['Loading Operations 5,003', 'LOADING'],
    ['Loading Operations 12 500', 'LOADING'],
    ['Yükleme Operasyonları 773', 'LOADING'],
    ['In Transit', 'IN_TRANSIT'],
    ['In Transit 1.390', 'IN_TRANSIT'],
    ['Depoda 5.018', 'IN_WAREHOUSE'],
    ['In Warehouse 5,018', 'IN_WAREHOUSE'],
    ['Production 4.500', 'PRODUCTION'],
    ['Loading Operations 773 | In Transit 1.390', 'IN_TRANSIT'],
    ['Loading Operations 773 | Awaiting Retail Transfer 1.632', 'AWAITING_RETAIL_TRANSFER'],
  ]);
  for (const [status, expected] of cases) {
    assert.equal(BR.operationalStageOf(status), expected, status);
    assert.equal(Delivery.stageOf(status), expected, `Delivery stage: ${status}`);
  }
  assert.equal(Delivery.stageOf('Custom External State XYZ'), 'UNKNOWN');
});

test('v9.65 LOADING + Handover yok + geçmiş Ex-Factory => ETA bugünden başlar', () => {
  const analysis = analyzeDelivery({ status: 'Loading Operations 5.003', revisedLoad: '2026-08-20', handover: null });
  assert.equal(analysis.stage, 'LOADING');
  assert.equal(analysis.etaSource, 'calculated');
  assert.equal(analysis.eta, TODAY + 70);
  assert.notEqual(analysis.deliveryOutcome, 'UNKNOWN');
});

test('v9.65 LOADING + gelecekte Ex-Factory => ETA gelecekteki Ex-Factory + transit', () => {
  const exFactory = ord('2026-09-20');
  const analysis = analyzeDelivery({ status: 'Loading Operations 773', revisedLoad: '2026-09-20', handover: null });
  assert.equal(analysis.stage, 'LOADING');
  assert.equal(analysis.eta, exFactory + 70);
  assert.notEqual(analysis.deliveryOutcome, 'UNKNOWN');
});

test('v9.65 LOADING + Handover mevcut => ETA actual Handover + transit', () => {
  const handover = ord('2026-09-05');
  const analysis = analyzeDelivery({ status: 'Loading Operations 773', revisedLoad: '2026-09-20', handover: '2026-09-05' });
  assert.equal(analysis.stage, 'LOADING');
  assert.equal(analysis.eta, handover + 70);
  assert.equal(analysis.etaSource, 'calculated');
});

test('v9.65 CP Loading Operations + canonical Handover pending artık UNKNOWN değildir ama ACTION_THIS_WEEK kalır', () => {
  const F = Readiness.FIELDS;
  const row = {
    [F.orderCode]: 'CP-L-1',
    [F.model]: 'MODEL-L',
    [F.colourCode]: 'C1',
    [F.status]: 'Loading Operations 5.003',
    [F.priority]: 'In Time',
    [F.orderDate]: '2026-07-01',
    [F.exFactory]: '2026-09-20',
    [F.handover]: '',
    [F.shipConfirmation]: '2026-09-02',
    [F.retail]: '2027-01-31',
    [F.inStore]: '2027-02-20',
    [F.antArrival]: '',
    [F.delType]: 'Gemi',
    [F.qty]: 5003,
    [F.season]: '26SS',
    [F.country]: 'HINDISTAN',
    [F.shortageQty]: 0,
    [F.shortageAllInWarehouse]: false,
  };
  const rules = [{ id: 'sea-70', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];
  const analysis = Readiness.analyzeOrder(row, { today: TODAY, dateOrdinal: ord, transitRules: rules });

  assert.equal(analysis.stage, 'LOADING');
  assert.equal(analysis.transitRuleMissing, false);
  assert.notEqual(analysis.eta, null);
  assert.notEqual(analysis.deliveryOutcome, 'UNKNOWN');
  assert.equal(analysis.calculationStatus, 'KNOWN');
  assert.equal(analysis.handoverWarning, true);
  assert.equal(analysis.systemPriority, 'ACTION_THIS_WEEK');
  assert.equal(analysis.priority, 'ON_TRACK', 'v7.0.290: yalnız kurallar yükseltir');
  assert.ok(analysis.riskReasons.includes('HANDOVER_PENDING'));
});

test('v9.65 gerçek veri eksikliği korunur: transit rule yoksa LOADING hâlâ UNKNOWN olabilir', () => {
  const F = Readiness.FIELDS;
  const row = {
    [F.orderCode]: 'CP-L-NO-RULE', [F.model]: 'M', [F.colourCode]: 'C',
    [F.status]: 'Loading Operations 773', [F.orderDate]: '2026-07-01',
    [F.exFactory]: '2026-08-20', [F.handover]: '', [F.shipConfirmation]: '2026-09-02',
    [F.retail]: '2027-01-31', [F.inStore]: '2027-02-20', [F.antArrival]: '',
    [F.delType]: 'Gemi', [F.qty]: 773, [F.season]: '26SS', [F.country]: 'HINDISTAN',
    [F.shortageQty]: 0, [F.shortageAllInWarehouse]: false,
  };
  const analysis = Readiness.analyzeOrder(row, { today: TODAY, dateOrdinal: ord, transitRules: [] });
  assert.equal(analysis.stage, 'LOADING');
  assert.equal(analysis.transitRuleMissing, true);
  assert.equal(analysis.deliveryOutcome, 'UNKNOWN');
  assert.equal(analysis.calculationStatus, 'UNKNOWN');
});
