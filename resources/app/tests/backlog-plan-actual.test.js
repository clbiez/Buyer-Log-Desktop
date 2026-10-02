'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../server/lib/backlog-plan-actual');

function order(overrides = {}) {
  return {
    ocode:'1001', model:'MODEL-1', ccode:'01', colour:'Siyah',
    buyer:'Ayşe', buyerGrup:'WOMEN', manufacturer:'SUPPLIER A',
    season:'W26', merch:'M1', ageGroup:'A1', countryRaw:'TR',
    license:'', line:'LINE A', ozel:'X', qty:100, kalan:100,
    ex:new Date('2026-10-05T00:00:00'), _asasEx:new Date('2026-10-05T00:00:00'),
    retail:new Date('2026-11-01T00:00:00'), mb:new Date('2026-11-10T00:00:00'),
    ...overrides,
  };
}
function row(overrides = {}) {
  return {
    'Sezon':'W26','Siparişin Üretildiği Ülke':'Turkey','Buyer':'Ayşe','Buyer Grup (TR)':'WOMEN',
    'Üretici':'SUPPLIER A','Alt Üretici':'SUB A','Line':'LINE A','Sipariş Kod':'1001',
    'Özel Kod 1':'X','Model Adı':'MODEL-1','Renk Kod':'01','Renk':'Siyah',
    'Orijinal Exfactory Merch Tarih':new Date('2026-10-05T00:00:00'),
    'Retail Depo Tarih Yıl Ay Gün':new Date('2026-11-01T00:00:00'),
    'Model Bütçe Tarih Yıl Ay Gün':new Date('2026-11-10T00:00:00'),
    'Net Alım Sipariş Miktarı':100,'Adet':100,
    'Net Gelen Alım Sipariş Miktarı':0,'Gelen Alım Sipariş Miktarı Merkez Sevke Hazır Depo':0,
    'Kalan Alım Sipariş Miktarı':100,'GÜNCEL DURUM\n(STATUS)':'Üretimde',
    'RİSK\n(PRIORITY)':'YOK','ANTREPO GİRİŞ TARİHİ':new Date('2026-10-10T00:00:00'),
    'YÜKLEME TİPİ':'KARA',_backlogExcel:{handoverDate:null},
    ...overrides,
  };
}

test('snapshot projection keeps plan dimensions and aggregates operational state', () => {
  const snapshot = Engine.projectSnapshot([order()], [row()], {capturedAt:'2026-09-28T07:00:00.000Z'});
  assert.equal(snapshot.rows.length, 1);
  const item = snapshot.rows[0];
  assert.equal(item.planExFactory, '2026-10-05');
  assert.equal(item.buyer, 'Ayşe');
  assert.equal(item.buyingGroup, 'WOMEN');
  assert.equal(item.mag, 'M1');
  assert.deepEqual(item.statuses, {'Üretimde':100});
  assert.deepEqual(item.etaDates, {'2026-10-10':100});
});

test('snapshot excludes raw orders outside canonical Backlog and uses Backlog-computed remaining qty', () => {
  const visible = order({kalan:999});
  const outside = order({ocode:'9999',model:'OUTSIDE',ccode:'09',qty:500,kalan:500});
  const snapshot = Engine.projectSnapshot([visible,outside], [row({'Kalan Alım Sipariş Miktarı':40})], {capturedAt:'2026-09-28T07:00:00.000Z'});
  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].orderCode, '1001');
  assert.equal(snapshot.rows[0].remainingQty, 40);
});

test('plan vs actual diff detects ex-factory drift, ETA drift, status and late actual load', () => {
  const start = Engine.projectSnapshot([order()], [row()], {capturedAt:'2026-09-28T07:00:00.000Z'});
  const endOrder = order({ex:new Date('2026-10-07T00:00:00'), kalan:0});
  const endRow = row({
    'Kalan Alım Sipariş Miktarı':0,
    'Net Gelen Alım Sipariş Miktarı':100,
    'GÜNCEL DURUM\n(STATUS)':'Yükleme Operasyonları',
    'ANTREPO GİRİŞ TARİHİ':new Date('2026-10-15T00:00:00'),
    _backlogExcel:{handoverDate:new Date('2026-10-08T00:00:00')},
  });
  const end = Engine.projectSnapshot([endOrder], [endRow], {capturedAt:'2026-10-12T07:00:00.000Z'});
  const result = Engine.compareSnapshots(start.rows, end.rows, {
    from:'2026-09-28T07:00:00.000Z', to:'2026-10-12T07:00:00.000Z', activity:[],
  });
  assert.equal(result.changes.length, 1);
  assert.equal(result.summary.exFactoryDelayed, 1);
  assert.equal(result.summary.statusChanged, 1);
  assert.equal(result.summary.etaDelayed, 1);
  assert.equal(result.summary.plannedQty, 100);
  assert.equal(result.summary.realizedPlannedQty, 100);
  assert.equal(result.summary.lateLoadedQty, 100);
  assert.ok(result.changes[0].fields.some(field => field.label === 'Planlanan Ex-Factory' && field.days === 2));
  assert.ok(result.changes[0].fields.some(field => field.category === 'eta' && field.days === 5));
});

test('unchanged backlog rows are not returned', () => {
  const snap = Engine.projectSnapshot([order()], [row()], {capturedAt:'2026-09-28T07:00:00.000Z'});
  const result = Engine.compareSnapshots(snap.rows, snap.rows, {activity:[]});
  assert.equal(result.summary.changedOrders, 0);
  assert.deepEqual(result.changes, []);
});

test('missed planned load is visible even when source fields did not otherwise change', () => {
  const snap = Engine.projectSnapshot([order()], [row()], {capturedAt:'2026-09-28T07:00:00.000Z'});
  const result = Engine.compareSnapshots(snap.rows, snap.rows, {
    from:'2026-09-28T07:00:00.000Z', to:'2026-10-12T07:00:00.000Z', activity:[],
  });
  assert.equal(result.summary.plannedQty, 100);
  assert.equal(result.summary.planGapQty, 100);
  assert.equal(result.changes.length, 1);
  assert.ok(result.changes[0].fields.some(field => field.label === 'Planlanan yükleme gerçekleşmesi'));
});

test('refresh history preserves repeated and reverted changes even when net value returns', () => {
  const details = [
    {field:'Ex-Factory',before:'05.10.2026',after:'07.10.2026'},
    {field:'Ex-Factory',before:'07.10.2026',after:'09.10.2026'},
    {field:'Ex-Factory',before:'09.10.2026',after:'05.10.2026'},
  ];
  const items = details.map((detail,index)=>({
    createdAt:`2026-10-0${6+index}T07:00:00.000Z`,
    details:[{source:'ASAS',ocode:'1001',modelName:'MODEL-1',colourCode:'01',buyer:'Ayşe',buyingGroup:'WOMEN',manufacturer:'SUPPLIER A',season:'W26',...detail}],
  }));
  const result = Engine.collapseHistory(items,'2026-10-05T00:00:00.000Z','2026-10-10T00:00:00.000Z');
  assert.equal(result.activity.length, 1);
  assert.equal(result.activity[0].eventCount, 3);
  assert.equal(result.activity[0].repeated, true);
  assert.equal(result.activity[0].reverted, true);
  assert.equal(result.activity[0].category, 'exfactory');
});

test('delta archive resolves requested boundaries without duplicating unchanged rows', () => {
  const base = Engine.projectSnapshot([order()], [row()], {capturedAt:'2026-09-28T07:00:00.000Z'});
  const changed = Engine.projectSnapshot([order({ex:new Date('2026-10-06T00:00:00')})], [row()], {capturedAt:'2026-10-05T07:00:00.000Z'});
  const delta = Engine._test.deltaBetween(base.rows, changed.rows);
  assert.equal(delta.upserts.length, 1);
  assert.equal(delta.removed.length, 0);
  const archive = {
    schemaVersion:1,
    base:{capturedAt:base.capturedAt,sourceGenerationId:'a',rows:base.rows},
    deltas:[
      {capturedAt:'2026-10-01T07:00:00.000Z',sourceGenerationId:'b',upserts:[],removed:[]},
      {capturedAt:changed.capturedAt,sourceGenerationId:'c',...delta},
    ],
  };
  const resolved = Engine.resolveRange(archive,'2026-09-29T07:00:00.000Z','2026-10-05T08:00:00.000Z');
  assert.equal(resolved.start.capturedAt,'2026-09-28T07:00:00.000Z');
  assert.equal(resolved.end.capturedAt,'2026-10-05T07:00:00.000Z');
  assert.equal(resolved.coverage.snapshotCount,3);
  assert.equal(resolved.end.rows[0].planExFactory,'2026-10-06');
});

function planLine(code, exIso, rowOverrides = {}, orderOverrides = {}) {
  return {
    order: order({ ocode:code, ex:new Date(exIso + 'T00:00:00'), _asasEx:new Date(exIso + 'T00:00:00'), ...orderOverrides }),
    row: row({ 'Sipariş Kod':code, ...rowOverrides }),
  };
}
function loaded(dateIso, extra = {}) {
  return {
    'Net Gelen Alım Sipariş Miktarı':100,
    'GÜNCEL DURUM\n(STATUS)':'Yolda',
    _backlogExcel:{handoverDate:null, actualLoadDate:new Date(dateIso + 'T00:00:00')},
    ...extra,
  };
}

test('plan window classifies on-time, late, overdue, pending, partial and removed lines', () => {
  const startLines = [
    planLine('A', '2026-10-01'),
    planLine('B', '2026-10-01'),
    planLine('C', '2026-10-02'),
    planLine('D', '2026-10-09'),
    planLine('E', '2026-10-03'),
    planLine('F', '2026-10-04'),
    planLine('Z', '2026-11-20'),
  ];
  const endLines = [
    planLine('A', '2026-10-01', loaded('2026-09-30')),
    planLine('B', '2026-10-01', loaded('2026-10-04')),
    planLine('C', '2026-10-02'),
    planLine('D', '2026-10-09'),
    { order:order({ ocode:'E', ex:new Date('2026-10-03T00:00:00') }), rows:[
      row({ 'Sipariş Kod':'E', 'Adet':40, ...loaded('2026-10-03', { 'Net Gelen Alım Sipariş Miktarı':40 }) }),
      row({ 'Sipariş Kod':'E', 'Adet':60 }),
    ] },
    planLine('Z', '2026-11-20'),
  ];
  const start = Engine.projectSnapshot(startLines.map(x => x.order), startLines.map(x => x.row), { capturedAt:'2026-09-28T07:00:00.000Z' });
  const end = Engine.projectSnapshot(endLines.map(x => x.order), endLines.flatMap(x => x.rows || [x.row]), { capturedAt:'2026-10-06T07:00:00.000Z' });
  const result = Engine.compareSnapshots(start.rows, end.rows, {
    from:'2026-09-28T07:00:00.000Z', to:'2026-10-06T07:00:00.000Z',
    planFrom:'2026-10-01', planTo:'2026-10-10', asOf:'2026-10-06', activity:[],
  });
  const byCode = Object.fromEntries(result.plan.rows.map(item => [item.orderCode, item]));
  assert.deepEqual(Object.keys(byCode).sort(), ['A','B','C','D','E','F']);
  assert.equal(byCode.A.outcome, 'onTime');
  assert.equal(byCode.A.onTimeQty, 100);
  assert.equal(byCode.B.outcome, 'late');
  assert.equal(byCode.B.lateDays, 3);
  assert.equal(byCode.C.outcome, 'notLoaded');
  assert.equal(byCode.C.overdue, true);
  assert.equal(byCode.C.overdueDays, 4);
  assert.equal(byCode.D.outcome, 'pending');
  assert.equal(byCode.D.overdue, false);
  assert.equal(byCode.E.outcome, 'partial');
  assert.equal(byCode.E.loadedQty, 40);
  assert.equal(byCode.E.openQty, 60);
  assert.equal(byCode.F.outcome, 'removed');
  assert.equal(result.plan.window.from, '2026-10-01');
  assert.equal(result.plan.summary.plannedQty, 600);
  assert.equal(result.plan.summary.loadedQty, 240);
  assert.equal(result.plan.summary.overdueOpenQty, 160);
  assert.equal(result.plan.summary.pendingOpenQty, 100);
  const outside = result.changes.find(change => change.orderCode === 'Z');
  assert.equal(outside, undefined, 'unchanged line outside the plan window stays hidden');
  assert.ok(result.changes.filter(change => change.inPlanWindow).every(change => change.orderCode !== 'Z'));
});

test('IAS load without handover date still realises the plan through the actual load date', () => {
  const start = Engine.projectSnapshot([order()], [row()], { capturedAt:'2026-09-28T07:00:00.000Z' });
  const end = Engine.projectSnapshot([order()], [row(loaded('2026-10-05'))], { capturedAt:'2026-10-06T07:00:00.000Z' });
  const result = Engine.compareSnapshots(start.rows, end.rows, {
    from:'2026-09-28T07:00:00.000Z', to:'2026-10-06T07:00:00.000Z', activity:[],
  });
  assert.equal(result.summary.realizedPlannedQty, 100);
  assert.equal(result.plan.rows[0].outcome, 'onTime');
  assert.ok(!result.changes[0].fields.some(field => field.label === 'Planlanan yükleme gerçekleşmesi'));
});

test('legacy start snapshot without loadDates does not count existing loads as new', () => {
  const start = Engine.projectSnapshot([order()], [row(loaded('2026-09-20'))], { capturedAt:'2026-09-28T07:00:00.000Z' });
  delete start.rows[0].loadDates;
  const end = Engine.projectSnapshot([order()], [row(loaded('2026-09-20'))], { capturedAt:'2026-10-06T07:00:00.000Z' });
  const loads = Engine._test.periodLoads(start.rows[0], end.rows[0]);
  assert.equal(loads.loadedQty, 0);
  assert.deepEqual(loads.dated, []);
});

test('re-dating an existing partial is not counted as a new load', () => {
  const start = Engine.projectSnapshot([order()], [row(loaded('2026-10-01'))], { capturedAt:'2026-09-28T07:00:00.000Z' });
  const end = Engine.projectSnapshot([order()], [row(loaded('2026-10-03'))], { capturedAt:'2026-10-06T07:00:00.000Z' });
  const loads = Engine._test.periodLoads(start.rows[0], end.rows[0]);
  assert.equal(loads.loadedQty, 0);
});
