'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const summary=require('../public/overview-collection-summary.js');
const ROOT=path.join(__dirname,'..');
const DASH=fs.readFileSync(path.join(ROOT,'public','overview-collection-dashboard.js'),'utf8');
const PREMIUM=fs.readFileSync(path.join(ROOT,'public','overview-premium.js'),'utf8');

test('Collection filter heading stays in the selected language but custom names are preserved',()=>{
  const sandbox={};
  vm.runInNewContext(DASH,sandbox,{filename:'overview-collection-dashboard.js'});
  const ui=sandbox.BLOverviewCollectionDashboard;
  assert.equal(ui.scopeColumnLabel({language:'tr',label:s=>s},{k:'inStoreMonth',label:'Model Budget Month'}),'Model Bütçe Ayı');
  assert.equal(ui.scopeColumnLabel({language:'en',label:s=>s},{k:'inStoreMonth',label:'Model Bütçe Ayı'}),'Model Budget Month');
  assert.equal(ui.scopeColumnLabel({language:'tr',label:s=>s},{k:'inStoreMonth',label:'Özel MB'}),'Özel MB');
  assert.equal(ui.scopeColumnLabel({language:'tr',label:s=>s},{k:'season',label:'Season'}),'Season');
});

test('Collection Showcase uses structured dates and localized option text without altering raw filter keys',()=>{
  const rows=[
    {modelKod:'January',inStoreMonth:'2027-01',durum:'X'},
    {modelKod:'June',inStoreMonth:'HAZİRAN 2027',durum:'X'},
    {modelKod:'July',inStoreMonth:'JULY 2027',durum:'X'},
  ];
  const buckets=summary.monthBuckets(rows);
  assert.deepEqual(buckets.map(b=>[b.year,b.monthNumber]),[[2027,1],[2027,6],[2027,7]]);
  const current=2027*12+5;
  const dated=buckets.filter(b=>b.year&&b.monthNumber);
  const selected=dated.find(b=>b.year*12+b.monthNumber>=current)||dated[dated.length-1]||buckets[0];
  assert.equal(selected.month,'HAZİRAN 2027');
  assert.match(PREMIUM,/dated\.find\(b=>b\.year\*12\+b\.monthNumber>=current\)/);
  assert.match(PREMIUM,/esc\(monthLabel\(b\)\)/);
  assert.doesNotMatch(PREMIUM,/b\.month>=new Date\(\)\.toISOString/);
});
