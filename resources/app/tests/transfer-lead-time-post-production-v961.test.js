'use strict';

/* v9.61 — Transfer Lead Time Rules post-production parity.
 *
 * Korunan kusur: business-rules.resolveTransitDays() legacy olarak non-production
 * status'te rule lookup yapmadan default süreye düşer. Bu global davranış eski
 * hesaplar için korunur; CP Readiness ve Backlog gibi rule metadata'sına ihtiyaç
 * duyan çağrı noktaları forceRules:true ile merkezi registry'yi zorlar.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const BR = require('../public/business-rules.js');
const CP = require('../public/cp-readiness-engine.js');
const parse = require('../server/lib/parse.js');

const F = CP.FIELDS;
const ord = CP.defaultOrdinal;
const TODAY = ord('2026-09-06');

const INDIA_RULE = {
  id: 'india-sea-60', delType: 'Gemi', days: 60,
  countries: ['India'], seasons: [], exfStart: '', exfEnd: '',
};
const BANGLADESH_RULE = {
  id: 'bangladesh-sea-79', delType: 'Gemi', days: 79,
  countries: ['Bangladesh'], seasons: [], exfStart: '', exfEnd: '',
};

function cpRow(overrides = {}) {
  return {
    [F.orderCode]: overrides.orderCode || 'TLT-1',
    [F.model]: 'MODEL-TLT',
    [F.colourCode]: 'C1',
    [F.status]: overrides.status || 'Yol Operasyonları',
    [F.priority]: '',
    [F.orderDate]: '2026-06-01',
    [F.exFactory]: overrides.exFactory || '2026-08-01',
    [F.handover]: overrides.handover || '2026-08-02',
    [F.shipConfirmation]: overrides.shipConfirmation || '2026-07-30',
    [F.retail]: overrides.retail || '2026-12-20',
    [F.inStore]: overrides.inStore || '2027-01-10',
    [F.antArrival]: Object.prototype.hasOwnProperty.call(overrides, 'antArrival') ? overrides.antArrival : '',
    [F.delType]: overrides.delType || 'Gemi',
    [F.qty]: 100,
    [F.season]: overrides.season || '26SS',
    [F.country]: overrides.country || 'HINDISTAN',
    [F.shortageQty]: 0,
    [F.shortageAllInWarehouse]: false,
  };
}

function analyzeCp(row, rules) {
  return CP.analyzeOrder(row, {
    today: TODAY,
    dateOrdinal: ord,
    transitRules: rules,
    settings: { requireTransitRule: true },
  });
}

function baseOrder(overrides = {}) {
  return {
    ocode: 96101, _matchOcode: '96101', model: 'MODEL-TLT', ccode: 'C1', colour: 'BLACK',
    qty: 100, kalan: 0, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 5, plm: 'PLM1', ozel: '', manufacturer: 'MF-1', season: '26SS', category: 'CLASS-1',
    merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1', countryRaw: 'HINDISTAN',
    license: '', productDescription: '', ex: '2026-08-01', retail: '2026-12-20', mb: '2027-01-10',
    opd: '2026-06-01', shipConf: '2026-07-30', buyer: 'BUYER-1', line: 'LINE-1',
    ...overrides,
  };
}

function partial(order, overrides = {}) {
  return {
    ...order,
    qty: 100,
    kalan: 0,
    _status: 'Yol Operasyonları',
    _arr: '',
    _delType: 'Gemi',
    _iasRow: { handover: '2026-08-02' },
    _segmentKind: 'ias',
    _segmentIndex: 0,
    _orderQty: 100,
    _asasKalan: 0,
    _loadedQty: 100,
    ...overrides,
  };
}

test('v9.61 merkezi resolver legacy non-production guard davranışını global olarak korur', () => {
  const direct = BR.resolveTransitDays({
    delType: 'Gemi', exFactory: '2026-08-01', season: '26SS', country: 'HINDISTAN',
    status: 'Yol Operasyonları', rules: [INDIA_RULE],
  });
  assert.equal(direct.days, 70);
  assert.equal(direct.rule, null);
  assert.equal(direct.dynamic, false);
});

test('v9.61 CP Readiness post-production India + Sea rule 60 gün kullanır; missing üretmez', () => {
  const analysis = analyzeCp(cpRow({ status: 'Yol Operasyonları', country: 'HINDISTAN' }), [INDIA_RULE]);
  assert.equal(analysis.transitDays, 60);
  assert.equal(analysis.transitRuleDefined, true);
  assert.equal(analysis.transitRuleMissing, false);
  assert.ok(!analysis.riskReasons.includes('MISSING_TRANSIT_RULE'));
});

test('v9.61 CP Readiness Loading Operations Bangladesh + Sea rule 79 gün kullanır', () => {
  const analysis = analyzeCp(cpRow({
    orderCode: 'TLT-BD', status: 'Yükleme Operasyonları', country: 'BANGLADES', handover: '2026-08-02',
  }), [BANGLADESH_RULE]);
  assert.equal(analysis.transitDays, 79);
  assert.equal(analysis.transitRuleDefined, true);
  assert.equal(analysis.transitRuleMissing, false);
});

test('v9.61 configured post-production rule CP ve Backlog tarafında aynı gün sayısını üretir', () => {
  const cpAnalysis = analyzeCp(cpRow({ country: 'HINDISTAN' }), [INDIA_RULE]);
  const backlogRow = parse.backlogTemplateRowsFromSegments(
    [partial(baseOrder({ countryRaw: 'HINDISTAN' }))],
    { transitRules: [INDIA_RULE] }, new Map(), [],
  )[0];

  assert.equal(cpAnalysis.transitDays, 60);
  assert.equal(backlogRow._backlogExcel.transitDays, 60);
  assert.ok(backlogRow._backlogExcel.transitRule, 'Backlog rule metadata kaybolmamalı');
  assert.equal(backlogRow._backlogExcel.transitRule.days, 60);
});

test('v9.61 Backlog post-production Bangladesh Sea 79 transit overdue hesabında default 70 kullanmaz', () => {
  const row = parse.backlogTemplateRowsFromSegments(
    [partial(baseOrder({ countryRaw: 'BANGLADES', ex: '2026-06-01' }), {
      _iasRow: { handover: '2026-06-01' },
    })],
    { transitRules: [BANGLADESH_RULE] }, new Map(), [],
  )[0];

  assert.equal(row._backlogExcel.transitDays, 79);
  assert.equal(row._backlogExcel.transitRule.days, 79);
  const expected = row._backlogExcel.expectedTransitArrival;
  assert.ok(expected instanceof Date);
  /* toISOString() UTC okur; bu tarihler YEREL gece yarisi tutuluyor, bu yuzden
     UTC+3'te bir gun geri kayardi ve test Turkiye'deki her makinede kirilirdi.
     Uygulama bu tarihleri yerel olarak kullaniyor; iddia da oyle okumali. */
  const localDate = expected.getFullYear() + '-'
    + String(expected.getMonth() + 1).padStart(2, '0') + '-'
    + String(expected.getDate()).padStart(2, '0');
  assert.equal(localDate, '2026-08-19');
});

test('v9.61 gerçek matching rule yoksa CP requireTransitRule missing davranışını korur', () => {
  const analysis = analyzeCp(cpRow({ country: 'BILINMEYEN ULKE' }), [INDIA_RULE]);
  assert.equal(analysis.transitDays, 70, 'fallback gün metadata olarak korunabilir');
  assert.equal(analysis.transitRuleDefined, false);
  assert.equal(analysis.transitRuleMissing, true);
  assert.ok(analysis.riskReasons.includes('MISSING_TRANSIT_RULE'));
});
