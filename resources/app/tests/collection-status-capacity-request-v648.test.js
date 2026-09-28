'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const catalog=require('../public/collection-status-catalog.js');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const DASH=fs.readFileSync(path.join(__dirname,'..','public','overview-collection-dashboard.js'),'utf8');
const STATUS_UI=fs.readFileSync(path.join(__dirname,'..','public','collection-status-ui.js'),'utf8');

test('Collection status catalog seeds the legacy 12-status order including Capacity Request',()=>{
  assert.deepEqual(catalog.seed().map(entry=>entry.name),[
    'Dosya Teslimi Alındı','Pending File','MB Onaya Gönderildi','GTIP','Lisans Tanım','Fiyatlamada','Capacity Request','Siparişe Hazır','Sipariş Onayda','Sipariş Geçildi','Dummy PO Placed','İptal'
  ]);
  const names=catalog.seed().map(entry=>entry.name);
  assert.ok(names.indexOf('Fiyatlamada')<names.indexOf('Capacity Request'));
  assert.ok(names.indexOf('Capacity Request')<names.indexOf('Siparişe Hazır'));
});

test('custom status color resolves to grid and Excel without source-code palette edits',()=>{
  const dynamic=catalog.normalize([...catalog.seed(),{name:'Numune Bekliyor',color:'#123ABC',builtin:false}]);
  assert.equal(catalog.color(dynamic,'Numune Bekliyor'),'#123ABC');
  assert.equal(catalog.toArgb(catalog.color(dynamic,'Numune Bekliyor')),'FF123ABC');
  assert.doesNotMatch(APP,/const KOL_DURUM_OPTS\s*=/);
  assert.doesNotMatch(APP,/const pal = \{'Fiyatlamada'/);
  assert.match(APP,/status:true/);
  assert.match(APP,/kolStatusExcelArgb/);
  assert.match(APP,/kolStatusEntries\(\)/);
});

test('Turkish and English built-in status names resolve to one canonical color identity',()=>{
  const pairs=[
    ['Dosya Teslimi Alındı','File Received'],['Pending File','Pending File'],['MB Onaya Gönderildi','Sent for MB Approval'],
    ['GTIP','HS Code'],['Lisans Tanım','License Definition'],['Fiyatlamada','In Pricing'],['Capacity Request','Capacity Request'],
    ['Siparişe Hazır','Ready for Order'],['Sipariş Onayda','Order in Approval'],['Sipariş Geçildi','Order Placed'],
    ['Dummy PO Placed','Dummy PO Placed'],['İptal','Dropped']
  ];
  const base=catalog.seed();
  pairs.forEach(([tr,en])=>{
    assert.equal(catalog.canonicalName(en),tr);
    assert.equal(catalog.key(en),catalog.key(tr));
    assert.equal(catalog.color(base,en),catalog.color(base,tr));
    assert.equal(catalog.label(tr,'en'),en);
    assert.equal(catalog.label(en,'tr'),tr);
  });
  const normalized=catalog.normalize(base,{rowStatuses:['Ready for Order','Order Placed','Dropped']});
  assert.equal(normalized.filter(entry=>['Ready for Order','Order Placed','Dropped'].includes(entry.name)).length,0,
    'English aliases must not be re-added as gray custom statuses');
});

test('legacy unknown row statuses are preserved into the normalized catalog',()=>{
  const normalized=catalog.normalize(undefined,{rowStatuses:['Konsept Onaylı']});
  assert.ok(normalized.some(entry=>entry.name==='Konsept Onaylı'&&entry.builtin===false));
});


test('Collection dashboard/status scripts remain syntactically valid',()=>{
  assert.doesNotThrow(()=>new Function(APP));
  assert.doesNotThrow(()=>new Function(DASH));
  assert.doesNotThrow(()=>new Function(STATUS_UI));
});
