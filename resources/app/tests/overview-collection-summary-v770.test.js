'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const summary=require('../public/overview-collection-summary.js');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const DASH=fs.readFileSync(path.join(ROOT,'public','overview-collection-dashboard.js'),'utf8');
const STORAGE=fs.readFileSync(path.join(ROOT,'public','user-storage.js'),'utf8');

const rows=[
  {modelKod:'M-100',inStoreMonth:'2026-08',season:'7S',durum:'Fiyatlamada',pricing:{ACME:'4.5'},confirmedManufacturer:'ACME'},
  {modelKod:'M-100',inStoreMonth:'2026-08',season:'7S',durum:'Fiyatlamada',pricing:{},confirmedManufacturer:''},
  {modelKod:'M-200',inStoreMonth:'2026-08',season:'7S',durum:'Siparişe Hazır',pricing:{},confirmedManufacturer:''},
  {modelKod:'M-300',inStoreMonth:'2026-09',season:'8S',durum:'Siparişe Hazır',pricing:{ACME:'3'},confirmedManufacturer:'ACME'},
];

test('Collection Summary filters intersect and KPI counts distinct models',()=>{
  const result=summary.build(rows,{months:['2026-08'],statuses:['Fiyatlamada','Siparişe Hazır'],confirmation:'all',isConfirmed:row=>Boolean(row.confirmedManufacturer&&row.pricing[row.confirmedManufacturer])});
  assert.deepEqual(result.kpi,{total:2,optionCount:3,confirmed:1,notConfirmed:1});
  assert.deepEqual(result.rows.map(row=>[row.status,row.modelCount,row.optionCount,row.confirmed,row.notConfirmed]),[
    ['Fiyatlamada',1,2,1,0],['Siparişe Hazır',1,1,0,1]
  ]);
});

test('Collection Summary confirmation filter uses existing confirmation callback',()=>{
  const result=summary.build(rows,{months:['2026-08'],statuses:['Fiyatlamada'],confirmation:'confirmed',isConfirmed:row=>row.modelKod==='M-100'&&row.confirmedManufacturer==='ACME'});
  assert.equal(result.kpi.total,1);
  assert.deepEqual(result.rows[0],{status:'Fiyatlamada',modelCount:1,optionCount:1,confirmed:1,notConfirmed:0});
});

test('Collection Summary arbitrary-column scope supports multiple selected values',()=>{
  const result=summary.build(rows,{columnFilters:{inStoreMonth:['2026-08','2026-09']},isConfirmed:row=>Boolean(row.confirmedManufacturer)});
  assert.deepEqual(result.kpi,{total:3,optionCount:4,confirmed:2,notConfirmed:1});
});

test('advanced multi-level pivot remains available only as secondary data view',()=>{
  const result=summary.build(rows,{pivot:{rows:['season','durum'],columns:['confirmation'],values:['modelCount','optionCount']},isConfirmed:row=>Boolean(row.confirmedManufacturer)});
  assert.ok(result.pivotRows.length>=2);
  assert.ok(result.pivotColumns.length>=1);
});

test('Overview Collection widget keeps identity but main surface is visual dashboard, not pivot table',()=>{
  assert.match(INDEX,/id="ovCollectionSummary"/);
  assert.match(INDEX,/data-overview-widget="collectionSummary"/);
  /* v2026-10-07: tablonun (aylık revolver) üstündeki genel KPI özeti kaldırıldı. */
  assert.doesNotMatch(INDEX,/id="ovCollectionSummaryKpi"/);
  /* v2026-10-07: tek dağılım çubuğu + status kartları yerini aylık revolver
     satırlarına (ay · adet · görseller · status çubuğu) bıraktı. */
  assert.match(INDEX,/id="ovCollectionSummaryMonths"/);
  assert.match(INDEX,/id="ovCollectionSummaryLegend"/);
  assert.match(INDEX,/id="ovCollectionSummaryScope"/);
  assert.match(INDEX,/id="ovCollectionSummaryScopeLabel"/);
  assert.match(INDEX,/id="ovCollectionSummaryScopeTrigger"/);
  assert.match(INDEX,/id="ovCollectionSummaryScopePopover"/);
  assert.doesNotMatch(INDEX,/id="ovCollectionSummarySettingsBtn"/);
  assert.doesNotMatch(INDEX,/id="ovCollectionSummaryTable"/);
  assert.doesNotMatch(DASH,/ovCollectionKpiCard/);
  assert.match(DASH,/ovCollectionMonthRow/);
  assert.match(DASH,/scopeColumn/);
  assert.match(DASH,/scopeValues/);
  assert.match(DASH,/inStoreMonth/);
  assert.match(DASH,/openColumnDrawer/);
  assert.doesNotMatch(DASH,/openSettings/);
  assert.match(APP,/overviewCollectionSummaryDashboardContext/);
  assert.match(STORAGE,/buyerlog\.overview\.collectionSummary\./);
});

test('Overview KPI drill maps dynamic scope and confirmation to Collection filters',()=>{
  assert.match(APP,/const KOL_CONFIRMATION_FILTER_KEY = '__confirmation__'/);
  assert.match(APP,/scopeColumn,scopeValues/);
  assert.match(APP,/kolColFilters\[scopeColumn\]=new Set\(scopedValues\)/);
  assert.match(APP,/kpi==='confirmed'.*KOL_CONFIRMATION_FILTER_KEY/s);
  assert.match(APP,/kpi==='notConfirmed'.*KOL_CONFIRMATION_FILTER_KEY/s);
  assert.match(APP,/kolConfirmedPricing\(row\)\?'confirmed':'notConfirmed'/);
});

test('Status distribution uses option counts so segments form a real 100% distribution',()=>{
  assert.match(DASH,/pct\(entry\.optionCount,bucket\.optionCount\)/);
  assert.match(DASH,/flex-grow:'\+entry\.optionCount/);
  assert.doesNotMatch(DASH,/pct\(row\.modelCount,total\)/);
});
