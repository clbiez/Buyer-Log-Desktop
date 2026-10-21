'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const OD = require('../public/order-decision-engine.js');
const BR = require('../public/business-rules.js');
const CP = require('../public/cp-readiness-engine.js');
const Rules = require('../public/cp-rules-engine.js');
const Backlog = require('../public/backlog-delivery-engine.js');
const Excel = require('../public/backlog-excel-formulas.js');
const parse = require('../server/lib/parse.js');

const ord = CP.defaultOrdinal;
const TODAY = ord('2026-09-06');

test('unified registry: UNKNOWN is calculation status, not action severity', () => {
  assert.deepEqual(OD.ACTION_PRIORITIES, ['CRITICAL','ACTION_TODAY','ACTION_THIS_WEEK','WATCH','ON_TRACK']);
  assert.equal(OD.ACTION_PRIORITY.UNKNOWN, undefined);
  const out = OD.resolveActionPriority({ deliveryOutcome: 'UNKNOWN' });
  assert.equal(out.calculationStatus, 'UNKNOWN');
  assert.equal(out.priority, 'WATCH');
});

test('AT_RISK alone does not escalate action priority', () => {
  const out = OD.resolveActionPriority({ deliveryOutcome: 'AT_RISK', preLoad: false, reasons: [] });
  assert.equal(out.calculationStatus, 'KNOWN');
  assert.equal(out.priority, 'ON_TRACK');
});

test('HANDOVER_PENDING gives minimum ACTION_THIS_WEEK even if delivery is UNKNOWN', () => {
  const out = OD.resolveActionPriority({ deliveryOutcome: 'UNKNOWN', reasons: ['HANDOVER_PENDING'] });
  assert.equal(out.calculationStatus, 'UNKNOWN');
  assert.equal(out.priority, 'ACTION_THIS_WEEK');
});

test('business rules expose structured signals without legacy CP Priority text', () => {
  const flags = BR.computePriorityFlags({
    exFactory: '2026-09-05', retailDate: '2026-12-01', inStoreDate: '2026-12-20',
    handoverDate: '', shipConfirmationDate: '2026-09-02', status: 'Yükleme Operasyonları',
    delType: 'Tır', season: '26SS', country: 'HINDISTAN', rules: [], today: '2026-09-06',
  });
  assert.equal(flags.handoverWarning, true);
  assert.equal(Object.prototype.hasOwnProperty.call(flags,'priority'), false);
  assert.ok(flags.signals.some(s => s.code === 'HANDOVER_PENDING'));
});

test('CP keeps UNKNOWN calculation status but action is never UNKNOWN', () => {
  const F = CP.FIELDS;
  const row = {
    [F.orderCode]:'U-1',[F.model]:'M',[F.colourCode]:'C',[F.status]:'Yükleme Operasyonları',
    [F.priority]:'In Time',[F.orderDate]:'2026-07-01',[F.exFactory]:'2026-09-05',
    [F.handover]:'',[F.shipConfirmation]:'2026-09-02',[F.retail]:'2026-12-01',[F.inStore]:'2026-12-20',
    [F.antArrival]:'',[F.delType]:'Tır',[F.qty]:100,[F.season]:'26SS',[F.country]:'HINDISTAN',
    [F.shortageQty]:0,[F.shortageAllInWarehouse]:false,
  };
  const a = CP.analyzeOrder(row,{today:TODAY,dateOrdinal:ord,transitRules:[],settings:{requireTransitRule:true}});
  assert.equal(a.deliveryOutcome,'UNKNOWN');
  assert.equal(a.calculationStatus,'UNKNOWN');
  // v7.0.290: önceliği yalnız kullanıcı kuralları yükseltir; öneri systemPriority'dedir.
  assert.equal(a.systemPriority,'ACTION_THIS_WEEK');
  assert.equal(a.priority,'ON_TRACK');
  assert.notEqual(a.priority,'UNKNOWN');
  assert.equal(a.decision.action.priority,'ON_TRACK');
});

test('DATE_SYNC_MISMATCH is action-visible through shared policy', () => {
  const F = CP.FIELDS;
  const row = {
    [F.orderCode]:'SYNC-1',[F.model]:'M',[F.colourCode]:'C',[F.status]:'Yolda',
    [F.orderDate]:'2026-07-01',[F.exFactory]:'2026-08-01',[F.asasExFactory]:'2026-08-02',
    [F.retail]:'2026-12-01',[F.asasRetail]:'2026-12-01',[F.inStore]:'2026-12-20',[F.asasInStore]:'2026-12-20',
    [F.antArrival]:'2026-09-20',[F.delType]:'Gemi',[F.qty]:100,[F.season]:'26SS',[F.country]:'HINDISTAN',
  };
  const a = CP.analyzeOrder(row,{today:TODAY,dateOrdinal:ord,transitRules:[],settings:{requireTransitRule:false}});
  assert.ok(a.riskReasons.includes('DATE_SYNC_MISMATCH'));
  assert.notEqual(a.systemPriority,'ON_TRACK');
});

test('custom priority rule emits stable CUSTOM_RULE signal and only escalates', () => {
  const analysis = { priority:'WATCH', daysToLoad:20, orderAgeDays:10, stage:'IN_TRANSIT', deliveryOutcome:'ON_TRACK', scheduleBufferDays:20, transitRuleMissing:false, qty:1, sourceRow:{STATUS:'Retaile Aktarım Bekleniyor'} };
  const rule = Rules.normalizeRule({ id:'rule-x', kind:'priority', name:'Retail wait', target:'ACTION_THIS_WEEK', reasonTr:'Retail aktarımı bekliyor', reasonEn:'Awaiting retail transfer', conditions:[{field:'STATUS',operator:'eq',value:'Retaile Aktarım Bekleniyor'}] });
  const applied = Rules.applyPriorityRules(analysis,[rule],{});
  assert.equal(applied.priority,'ACTION_THIS_WEEK');
  assert.equal(applied.signals[0].code,'CUSTOM_RULE:rule-x');
  assert.equal(applied.signals[0].textEn,'Awaiting retail transfer');

  const alreadyCritical = { ...analysis, priority:'CRITICAL' };
  assert.equal(Rules.applyPriorityRules(alreadyCritical,[rule],{}).priority,'CRITICAL');
});

test('Backlog decision does not parse legacy Priority display string for risk cause', () => {
  const F = Backlog.FIELDS;
  const row = {
    [F.status]:'Yolda',[F.revisedLoad]:'2026-08-01',[F.plannedLoad]:'2026-08-01',
    [F.antrepo]:'2026-09-10',[F.delType]:'Gemi',[F.retail]:'2026-09-12',[F.inStore]:'2026-10-01',
    [F.qty]:10,[F.orderCode]:'B-1',[F.model]:'M',[F.colourCode]:'C',
    _backlogExcel:{transitDays:40,transitRule:{days:40},priority:'Ant. Delay',signals:[],handoverDate:'2026-08-01'}
  };
  const a = Backlog.analyzeOrder(row,{today:TODAY,dateOrdinal:ord,settings:{requireTransitRule:true}});
  assert.equal(a.deliveryOutcome,'AT_RISK');
  assert.ok(!a.riskReasons.includes('RETAIL_TRANSFER_DELAY'),'legacy text must not create a signal');
  assert.equal(a.actionPriority,'ON_TRACK','AT_RISK alone must not escalate');
});

test('Backlog structured ANTREPO_DELAY signal is machine-readable', () => {
  const F = Backlog.FIELDS;
  const row = {
    [F.status]:'Yolda',[F.revisedLoad]:'2026-08-01',[F.plannedLoad]:'2026-08-01',
    [F.antrepo]:'2026-09-10',[F.delType]:'Gemi',[F.retail]:'2026-09-12',[F.inStore]:'2026-10-01',
    [F.qty]:10,[F.orderCode]:'B-2',[F.model]:'M',[F.colourCode]:'C',
    _backlogExcel:{transitDays:40,transitRule:{days:40},priority:'In Time',signals:[{code:'ANTREPO_DELAY'}],handoverDate:'2026-08-01'}
  };
  const a = Backlog.analyzeOrder(row,{today:TODAY,dateOrdinal:ord,settings:{requireTransitRule:true}});
  assert.ok(a.riskReasons.includes('RETAIL_TRANSFER_DELAY'));
  assert.ok(a.signals.some(s=>s.code==='ANTREPO_DELAY'));
});

test('Backlog needsAttention exposes canonical keys and legacy aliases', () => {
  const orders = [
    {actionPriority:'CRITICAL',scheduleBufferDays:-2,qty:10},
    {actionPriority:'ACTION_TODAY',scheduleBufferDays:0,qty:10},
    {actionPriority:'ACTION_THIS_WEEK',scheduleBufferDays:3,qty:10},
    {actionPriority:'WATCH',scheduleBufferDays:5,qty:10},
    {actionPriority:'ON_TRACK',scheduleBufferDays:20,qty:10},
  ];
  const model={}; Object.defineProperty(model,'orders',{value:orders});
  const groups=Backlog.needsAttention(model,{limit:50});
  assert.equal(groups.CRITICAL.length,1);
  assert.equal(groups.ACTION_TODAY.length,1);
  assert.equal(groups.ACTION_THIS_WEEK.length,1);
  assert.equal(groups.ACT_TODAY.length, groups.CRITICAL.length + groups.ACTION_TODAY.length);
  assert.equal(groups.ACT_THIS_WEEK,groups.ACTION_THIS_WEEK);
});

test('Backlog runtime risk helper is signal-based', () => {
  assert.equal(parse.backlogRiskFromSignals([],false),'YOK');
  assert.equal(parse.backlogRiskFromSignals([{code:'HANDOVER_PENDING'}],false),'VAR');
  assert.equal(parse.backlogRiskFromSignals([],true),'VAR');
});

test('Excel Risk formula references canonical helper flags rather than ANTREPO-RETAIL threshold', () => {
  const headers = [...Excel.DEFAULT_VISIBLE_HEADERS];
  const row = { 'RİSK\n(PRIORITY)':'VAR', 'YÜKLEME TİPİ':'Gemi', _backlogExcel:{transitDays:70,transitOverdue:false,originalDelType:'Gemi'} };
  const plan = Excel.formulaPlan(headers, row, 2, {});
  const formula = plan.formulas['RİSK\n(PRIORITY)'].formula;
  assert.match(formula, /_BL_DELAY|[A-Z]+2/); // generated cell refs, no hard threshold dependency
  assert.ok(!formula.includes('>5'),'Risk must not reintroduce independent ANTREPO-RETAIL > 5 logic');
  assert.equal(plan.formulas['RİSK\n(PRIORITY)'].cached,'VAR');
});
