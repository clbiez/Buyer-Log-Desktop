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
});

