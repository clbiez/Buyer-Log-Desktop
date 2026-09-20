'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const engine=require('../public/collection-analytics-engine.js');

const asasRows=[
  {rowId:1,modelKey:'A',classification:'Tee',manufacturer:'M1',season:'S7',customAsasTitle:'Segment A',price:10,currency:'USD',quantity:1},
  {rowId:2,modelKey:'B',classification:'Tee',manufacturer:'M2',season:'S7',customAsasTitle:'Segment B',price:20,currency:'USD',quantity:1},
  {rowId:3,modelKey:'C',classification:'Dress',manufacturer:'M1',season:'S8',customAsasTitle:'Segment A',price:30,currency:'USD',quantity:1},
];

test('ASAS kaynağındaki özel başlıklar analiz boyutu olarak kullanılabilir',()=>{
  const available=engine.availableDimensions(asasRows,['classification','manufacturer']);
  assert.ok(available.includes('customAsasTitle'));
  const result=engine.supplierIntelligence(asasRows,{dimensions:['customAsasTitle','manufacturer'],metric:'average',includeOutliers:true,minSample:1});
  assert.ok(result.rows.some(row=>row.path.join('/')==='Segment A/M1'));
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/\.filter\(key=>!String\(key\)\.startsWith\('_'\)\)/);
});

test('heatmap renklendirme formülü her sütunun kendi fiyat aralığını kullanır',()=>{
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/columnRanges/);
  assert.match(ui,/columnRange\.max>columnRange\.min/);
  assert.match(ui,/cell\.value-columnRange\.min/);
  assert.doesNotMatch(ui,/const min=Math\.min\(\.\.\.values\),max=Math\.max\(\.\.\.values\)/);
});

test('Price & Supplier Analysis okunabilirlik ölçeğini genel olarak büyütür',()=>{
  const css=read('public/collection-analytics.css');
  assert.match(css,/\.priceSupplierAnalysis\{font-size:14px\}/);
  assert.match(css,/\.paV2Virtual table,\.paV2Heatmap table,\.paV2Comparison table,\.priceAnalysisDrillBody table\{font-size:12px\}/);
  assert.match(css,/\.paV2Heatmap th\{font-size:13px\}/);
});
