'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const summary=require('../public/overview-collection-summary.js');
const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const DASH=fs.readFileSync(path.join(ROOT,'public','overview-collection-dashboard.js'),'utf8');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

const rows=[
  {modelKod:'M-1',inStoreMonth:'2027-03',durum:'Fiyatlamada',quantity:'1.200',img:'a.png'},
  {modelKod:'M-1',inStoreMonth:'2027-03',durum:'Siparişe Hazır',quantity:'300'},
  {modelKod:'M-2',inStoreMonth:'2027-03',durum:'Fiyatlamada',quantity:'500'},
  {modelKod:'M-3',inStoreMonth:'2027-04',durum:'Siparişe Hazır',quantity:'40',img:'c.png'},
  {modelKod:'M-4',inStoreMonth:'2026-12',durum:'Fiyatlamada',quantity:''},
  {modelKod:'M-5',inStoreMonth:'',durum:'Fiyatlamada',quantity:'7'},
];
const opts={quantityFor:row=>Number(String(row.quantity||'').replace(/\D/g,''))||0,imageFor:row=>row.img||''};

test('monthBuckets groups Collection rows chronologically with quantity, models and status mix',()=>{
  const buckets=summary.monthBuckets(rows,opts);
  assert.deepEqual(buckets.map(b=>b.month),['2027-04','2027-03','2026-12','']);
  const march=buckets[1];
  assert.equal(march.year,2027);assert.equal(march.monthNumber,3);
  assert.equal(march.quantity,2000);
  assert.equal(march.optionCount,3);
  assert.equal(march.modelCount,2);
  assert.deepEqual(march.models.map(m=>[m.label,m.image]),[['M-1','a.png'],['M-2','']]);
  assert.deepEqual(march.statuses.map(s=>[s.status,s.optionCount,s.modelCount,s.quantity]),[['Fiyatlamada',2,2,1700],['Siparişe Hazır',1,1,300]]);
  assert.equal(buckets[3].year,null);
});

test('monthBuckets respects the same scope filters as the KPI summary',()=>{
  const buckets=summary.monthBuckets(rows,{...opts,columnFilters:{durum:['Siparişe Hazır']}});
  assert.deepEqual(buckets.map(b=>[b.month,b.quantity,b.modelCount]),[['2027-04',40,1],['2027-03',300,1]]);
});

test('monthBuckets lists models with images before models without images',()=>{
  const buckets=summary.monthBuckets([
    {modelKod:'A',inStoreMonth:'2027-05',durum:'X'},
    {modelKod:'B',inStoreMonth:'2027-05',durum:'X',img:'b.png'},
  ],opts);
  assert.deepEqual(buckets[0].models.map(m=>m.label),['B','A']);
});

test('Overview Collection summary renders a 3-row revolver of month rows',()=>{
  assert.match(INDEX,/id="ovCollectionSummaryMonths"/);
  assert.match(INDEX,/id="ovCollectionSummaryLegend"/);
  assert.match(DASH,/VISIBLE_ROWS=3/);
  assert.match(DASH,/monthBuckets\(/);
  assert.match(DASH,/function snapRevolver/);
  assert.match(DASH,/Math\.round\(/);
  assert.match(DASH,/addEventListener\('wheel'/);
  assert.match(DASH,/addEventListener\('pointerup'/);
  /* Tambur görünümü kaldırıldı: satırlar düz ve aynı hizada. */
  assert.doesNotMatch(DASH,/rotateX\(/);
  assert.match(DASH,/function showSegmentTip/);
  assert.match(DASH,/en\?'Models':'Model'/);
  assert.match(DASH,/en\?'Quantity':'Adet'/);
  assert.match(DASH,/\[data-month-open\]'\)\?\.addEventListener\('click',function\(\)\{drill\(\{month:month\}\)/);
  assert.doesNotMatch(INDEX,/Aylık Özet|id="ovCollectionSummaryIntro"/);
  assert.match(CSS,/@container ovmonths/);
  assert.match(DASH,/ovCollectionMonthMore/);
  assert.match(DASH,/ctx\.drill\(Object\.assign\(\{scopeColumn:scoped\.column\.k,scopeValues:scoped\.selected\},extra\)\)/);
  assert.match(DASH,/drill\(\{month:month,status:button\.dataset\.monthStatus\}\)/);
  assert.match(APP,/quantityFor:overviewCollectionSummaryQuantity/);
  assert.match(APP,/imageFor:overviewCollectionSummaryImage/);
  assert.match(CSS,/\.ovCollectionRevolver\{/);
  assert.match(CSS,/prefers-reduced-motion[^}]*\.ovCollectionMonthRow/);
});

test('Collection month names from Turkish and English inputs stay chronological, newest first',()=>{
  const source=[
    {modelKod:'May',inStoreMonth:'MAYIS 2027',durum:'X'},
    {modelKod:'Jun',inStoreMonth:'HAZİRAN 2027',durum:'X'},
    {modelKod:'Jul',inStoreMonth:'JULY 2027',durum:'X'},
    {modelKod:'Jan',inStoreMonth:'2028-01',durum:'X'},
    {modelKod:'Invalid',inStoreMonth:'Unknown 2027',durum:'X'},
    {modelKod:'Empty',inStoreMonth:'',durum:'X'},
  ];
  const buckets=summary.monthBuckets(source,opts);
  assert.deepEqual(buckets.map(b=>b.month),['2028-01','JULY 2027','HAZİRAN 2027','MAYIS 2027','Unknown 2027','']);
  assert.deepEqual(buckets.slice(0,4).map(b=>[b.year,b.monthNumber]),[[2028,1],[2027,7],[2027,6],[2027,5]]);
  const scope=summary.availableColumns(source,{columns:[{k:'inStoreMonth',label:'Model Budget Month'}]});
  assert.deepEqual(scope[0].values,['2028-01','JULY 2027','HAZİRAN 2027','MAYIS 2027','Unknown 2027']);
  const selected=summary.defaultFilters(source,{now:new Date('2027-06-15T12:00:00Z')});
  assert.deepEqual(selected.months,['HAZİRAN 2027']);
});

test('Collection month parsing rejects invalid months and supports numerical and abbreviated formats',()=>{
  const source=[
    {modelKod:'A',inStoreMonth:'2027-13',durum:'X'},
    {modelKod:'B',inStoreMonth:'2027-07-01',durum:'X'},
    {modelKod:'C',inStoreMonth:'Ağustos 2027',durum:'X'},
    {modelKod:'D',inStoreMonth:'Sep 2027',durum:'X'},
    {modelKod:'E',inStoreMonth:'07/2027',durum:'X'},
  ];
  const buckets=summary.monthBuckets(source,opts);
  assert.deepEqual(buckets.map(b=>b.month),['Sep 2027','Ağustos 2027','07/2027','2027-07-01','2027-13']);
  assert.equal(buckets[4].year,null);
});

test('Overview localized Collection labels follow the chosen language without overwriting custom titles',()=>{
  const vm=require('node:vm');
  const sandbox={globalThis:{},Date,Intl};
  vm.runInNewContext(DASH,sandbox,{filename:'overview-collection-dashboard.js'});
  const ui=sandbox.globalThis.BLOverviewCollectionDashboard;
  const bucket={month:'JULY 2027',year:2027,monthNumber:7};
  assert.equal(ui.monthLabel(bucket,'tr-TR',false),'Temmuz 2027');
  assert.equal(ui.monthLabel(bucket,'en-GB',true),'July 2027');
  assert.equal(ui.scopeColumnLabel({language:'tr',label:value=>value},{k:'inStoreMonth',label:'Model Budget Month'}),'Model Bütçe Ayı');
  assert.equal(ui.scopeColumnLabel({language:'en',label:value=>value},{k:'inStoreMonth',label:'Model Bütçe Ayı'}),'Model Budget Month');
  assert.equal(ui.scopeColumnLabel({language:'tr',label:value=>value},{k:'inStoreMonth',label:'MB Özel'}),'MB Özel');
  assert.match(DASH,/if\(start<0\)start=0/);
  assert.doesNotMatch(DASH,/Math\.abs\(bucket\.year\*12\+bucket\.monthNumber-current\)/);
});

