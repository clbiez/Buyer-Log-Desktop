'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse.js');
const formulas = require('../public/backlog-excel-formulas.js');
const Engine = require('../public/backlog-delivery-engine.js');

function baseOrder(overrides = {}) {
  return {
    ocode: 91001, _matchOcode: '91001', model: 'MODEL-1', ccode: 'C1', colour: 'BLACK',
    qty: 100, kalan: 0, antrepo: 0, merkezSevkeHazirKalan: 0,
    fob: 5, plm: 'PLM1', ozel: '', manufacturer: 'MF-1', season: '26SS', category: 'CLASS-1',
    merch: 'MAG-1', ageGroup: 'MMYG-1', buyerGrup: 'BG-1', countryRaw: 'HINDISTAN',
    license: '', productDescription: '', ex: '2020-01-01', retail: '2091-01-01', mb: '2091-02-01',
    opd: '2019-11-01', shipConf: null, buyer: 'BUYER-1', line: 'LINE-1',
    ...overrides,
  };
}

function partial(order, overrides = {}) {
  return {
    ...order,
    qty: 100,
    kalan: 0,
    _status: 'Yolda',
    _arr: '2090-01-01',
    _delType: 'Gemi',
    _iasRow: { handover: '2020-01-01' },
    _segmentKind: 'ias',
    _segmentIndex: 0,
    _orderQty: 100,
    _asasKalan: 0,
    _loadedQty: 100,
    ...overrides,
  };
}

const shortRule = [{ id: 'sea-70', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 70 }];
const longRule = [{ id: 'sea-long', exfStart: '', exfEnd: '', seasons: [], countries: [], delType: 'Gemi', days: 99999 }];

test('post-production transit: yükleme + plan süresi aşıldı ve ürün depoda değilse Risk VAR olur', () => {
  const rows = parse.backlogTemplateRowsFromSegments([partial(baseOrder())], { transitRules: shortRule }, new Map(), []);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row['RİSK\n(PRIORITY)'], 'VAR');
  assert.equal(row._backlogExcel.transitOverdue, true);
  assert.ok(row._backlogExcel.transitOverdueDays > 0);
  // Transit gecikmesi Risk'i VAR'a yükseltir ama Risk/Priority hücresine
  // "Transit Overdue" gibi bir alt-tip etiketi yazılmaz.
  assert.equal(Object.prototype.hasOwnProperty.call(row._backlogExcel,'priority'), false);
  // IAS Tahmini Antrepo tarihi geleceğe alınmış olsa bile gecikme gizlenmemeli.
  const arrival = row['ANTREPO GİRİŞ TARİHİ'];
  assert.equal(arrival.getFullYear(), 2090);
  assert.equal(arrival.getMonth(), 0);
  assert.equal(arrival.getDate(), 1);
});

test('post-production transit: depoya ulaşmış satır yeni override nedeniyle Risk VAR olmaz', () => {
  const rows = parse.backlogTemplateRowsFromSegments([
    partial(baseOrder(), { _status: 'Depoda' })
  ], { transitRules: shortRule }, new Map(), []);
  const row = rows[0];
  assert.equal(row._backlogExcel.transitOverdue, false);
  assert.equal(Object.prototype.hasOwnProperty.call(row._backlogExcel,'priority'), false);
  assert.equal(row['RİSK\n(PRIORITY)'], 'YOK');
});

test('post-production transit: parsiyelde kullanıcı tanımlı transit kuralı gerçekten uygulanır', () => {
  const rows = parse.backlogTemplateRowsFromSegments([partial(baseOrder())], { transitRules: longRule }, new Map(), []);
  const row = rows[0];
  assert.equal(row._backlogExcel.transitDays, 99999);
  assert.equal(row._backlogExcel.transitRule.id, undefined); // exported rule metadata intentionally omits id
  assert.equal(row._backlogExcel.transitOverdue, false);
  assert.equal(row['RİSK\n(PRIORITY)'], 'YOK');
});

test('Backlog Excel risk formula transit overdue helperını OR ile dikkate alır', () => {
  const headers = [
    'GÜNCEL DURUM\n(STATUS)', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)', 'ANTREPO GİRİŞ TARİHİ',
    'YÜKLEME TİPİ', 'Retail Depo Tarih Yıl Ay Gün', 'Model Bütçe Tarih Yıl Ay Gün',
    'ANTREPO-RETAIL', 'RİSK\n(PRIORITY)',
  ];
  const row = {
    'GÜNCEL DURUM\n(STATUS)': 'Yolda',
    'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': '2020-01-01',
    'YÜKLEME TİPİ': 'Gemi',
    'ANTREPO-RETAIL': -10,
    _backlogExcel: { transitDays: 70, originalDelType: 'Gemi', transitOverdue: true },
  };
  const plan = formulas.formulaPlan(headers, row, 2);
  assert.equal(plan.formulas['RİSK\n(PRIORITY)'].cached, 'VAR');
  assert.match(plan.formulas['RİSK\n(PRIORITY)'].formula, /_BL_TRANSIT_OVERDUE|OR\(/);
  assert.equal(plan.helperCells._BL_TRANSIT_OVERDUE.cached, true);
  assert.match(plan.helperCells._BL_TRANSIT_OVERDUE.formula, /TODAY\(\)>/);
});

test('Teslimat Analizi hedef hâlâ geniş görünse bile transit overdue satırı ON_TRACK bırakmaz', () => {
  const row = parse.backlogTemplateRowsFromSegments([partial(baseOrder())], { transitRules: shortRule }, new Map(), [])[0];
  const today = Engine.defaultOrdinal('2026-09-06');
  const analysis = Engine.analyzeOrder(row, { today, dateOrdinal: Engine.defaultOrdinal, settings: { requireTransitRule: true } });
  assert.equal(analysis.postProductionTransitOverdue, true);
  assert.notEqual(analysis.deliveryOutcome, 'ON_TRACK');
  assert.ok(analysis.riskReasons.includes('TRANSIT_DELAY'));
});
