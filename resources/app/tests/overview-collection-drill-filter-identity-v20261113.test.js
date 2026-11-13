'use strict';
// Genel Bakış → Koleksiyon drill: ay/statü kimliği Koleksiyon tablo filtresinin
// değeriyle (columnValue = kolFilterValue) aynı olmalı. Ham değer ("JUNE 2027" /
// "Haziran 2027") gönderilince tablo filtresi ("202706") eşleşmiyor, tablo boş kalıyordu.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const summary=require('../public/overview-collection-summary.js');

const MONTH={'JUNE 2027':'202706','Haziran 2027':'202706','2027-05':'202705'};
const rows=[
  {modelKod:'M-1',inStoreMonth:'JUNE 2027',durum:'Pending File',quantity:10},
  {modelKod:'M-2',inStoreMonth:'Haziran 2027',durum:'Order Placed',quantity:5},
  {modelKod:'M-3',inStoreMonth:'2027-05',durum:'  Order Placed ',quantity:1,groupStatus:'Pending File'},
];
// Koleksiyon tablosunun filtre değeri: ay kodu ve model grubu etkin statüsü.
const columnValue=(row,key)=>key==='inStoreMonth'?MONTH[row.inStoreMonth]:key==='durum'?(row.groupStatus||row.durum).trim():String(row[key]??'');
const fields={month:'inStoreMonth',status:'durum',model:'modelKod'};

test('monthBuckets keys months and statuses by the Collection filter value',()=>{
  const buckets=summary.monthBuckets(rows,{columnValue,fields,quantityFor:r=>r.quantity,sort:'desc'});
  assert.deepEqual(buckets.map(b=>[b.month,b.year,b.monthNumber,b.quantity]),[['202706',2027,6,15],['202705',2027,5,1]]);
  assert.deepEqual(buckets[1].statuses.map(s=>s.status),['Pending File']);
  // Drill'in göndereceği kimlik tablo filtresiyle birebir eşleşmeli.
  const drilled=rows.filter(r=>columnValue(r,'inStoreMonth')===buckets[0].month&&columnValue(r,'durum')==='Pending File');
  assert.equal(drilled.length,1);
});

test('build status rows use the Collection filter value',()=>{
  const result=summary.build(rows,{columnValue,fields});
  assert.deepEqual(result.rows.map(r=>[r.status,r.modelCount]),[['Order Placed',1],['Pending File',2]]);
});

test('without columnValue the raw field values stay the identity',()=>{
  const buckets=summary.monthBuckets(rows,{fields});
  assert.deepEqual(buckets.map(b=>b.month).sort(),['2027-05','Haziran 2027','JUNE 2027']);
});

test('dashboard drill sends bucket identities, not display labels',()=>{
  const dash=fs.readFileSync(path.join(__dirname,'..','public','overview-collection-dashboard.js'),'utf8');
  assert.match(dash,/drill\(\{month:month\}\)/);
  assert.match(dash,/data-month="'\+esc\(bucket\.month\)/);
});
