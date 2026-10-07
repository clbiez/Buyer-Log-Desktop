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
  assert.deepEqual(buckets.map(b=>b.month),['2026-12','2027-03','2027-04','']);
  const march=buckets[1];
  assert.equal(march.year,2027);assert.equal(march.monthNumber,3);
  assert.equal(march.quantity,2000);
  assert.equal(march.optionCount,3);
  assert.equal(march.modelCount,2);
  assert.deepEqual(march.models.map(m=>[m.label,m.image]),[['M-1','a.png'],['M-2','']]);
  assert.deepEqual(march.statuses.map(s=>[s.status,s.optionCount]),[['Fiyatlamada',2],['Siparişe Hazır',1]]);
  assert.equal(buckets[3].year,null);
});

test('monthBuckets respects the same scope filters as the KPI summary',()=>{
  const buckets=summary.monthBuckets(rows,{...opts,columnFilters:{durum:['Siparişe Hazır']}});
  assert.deepEqual(buckets.map(b=>[b.month,b.quantity,b.modelCount]),[['2027-03',300,1],['2027-04',40,1]]);
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
  assert.match(DASH,/rotateX\(/);
  assert.match(DASH,/ovCollectionMonthMore/);
  assert.match(DASH,/ctx\.drill\(Object\.assign\(\{scopeColumn:scoped\.column\.k,scopeValues:scoped\.selected\},extra\)\)/);
  assert.match(DASH,/drill\(\{month:month,status:button\.dataset\.monthStatus\}\)/);
  assert.match(APP,/quantityFor:overviewCollectionSummaryQuantity/);
  assert.match(APP,/imageFor:overviewCollectionSummaryImage/);
  assert.match(CSS,/\.ovCollectionRevolver\{/);
  assert.match(CSS,/prefers-reduced-motion[^}]*\.ovCollectionMonthRow/);
});
