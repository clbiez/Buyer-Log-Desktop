'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const summary=require('../public/overview-collection-summary.js');
require('../public/overview-collection-dashboard.js');
const widget=globalThis.BLOverviewCollectionDashboard;
const row=(month,id)=>({inStoreMonth:month,modelKod:id,durum:'Fiyatlamada'});

test('Collection month parser supports Turkish/English names and numeric stored formats',()=>{
  const equivalent=['2027-06','202706','06/2027','JUNE 2027','JUN 2027','HAZİRAN 2027','HAZ 2027','2027 Haziran'];
  equivalent.forEach(value=>assert.deepEqual(summary.monthParts(value),{year:2027,month:6},value));
  assert.deepEqual(summary.monthParts('AĞUSTOS 2026'),{year:2026,month:8});
  assert.deepEqual(summary.monthParts('Ekim 2026'),{year:2026,month:10});
  assert.deepEqual(summary.monthParts('SEPTEMBER 2027'),{year:2027,month:9});
  ['','2027-13','2027-00','2027-W06','RANDOM 2027','2027-99','2027'].forEach(value=>assert.equal(summary.monthParts(value),null,value));
});

test('Collection widget sorts latest valid month first, unknown months last',()=>{
  const data=[row('JUNE 2027','M1'),row('2026-11','M2'),row('HAZİRAN 2026','M3'),row('2027-07','M4'),row('','M5'),row('JULY 2028','M6'),row('2027-13','M7')];
  assert.deepEqual(summary.monthBuckets(data,{sort:'desc'}).map(b=>b.month),['JULY 2028','2027-07','JUNE 2027','2026-11','HAZİRAN 2026','','2027-13']);
  assert.deepEqual(summary.monthBuckets(data).slice(0,3).map(b=>b.month),['HAZİRAN 2026','2026-11','JUNE 2027']);
});

test('Collection widget labels month according to active language without altering raw drill keys',()=>{
  const months=[row('JUNE 2027','M1'),row('HAZİRAN 2027','M2'),row('2027-06','M3')];
  const scoped=widget.scopeState({
    rows:months,columns:[{k:'inStoreMonth',label:'Model Budget Month'}],summary,
    saved:{scopeColumn:'inStoreMonth'},language:'tr',columnValue:(row,key)=>row[key],
  });
  assert.deepEqual(scoped.values,['2027-06','HAZİRAN 2027','JUNE 2027'].sort((a,b)=>a.localeCompare(b,'tr-TR',{numeric:true})));
  months.forEach(r=>{
    const parts=summary.monthParts(r.inStoreMonth);
    assert.equal(widget.monthLabel({month:r.inStoreMonth,year:parts.year,monthNumber:parts.month},'tr-TR',false),'Haziran 2027');
    assert.equal(widget.monthLabel({month:r.inStoreMonth,year:parts.year,monthNumber:parts.month},'en-GB',true),'June 2027');
  });
  assert.equal(scoped.result.kpi.total,3);
});