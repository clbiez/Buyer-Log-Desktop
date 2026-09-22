'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const catalog=require('../public/collection-status-catalog.js');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');

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

test('legacy unknown row statuses are preserved into the normalized catalog',()=>{
  const normalized=catalog.normalize(undefined,{rowStatuses:['Konsept Onaylı']});
  assert.ok(normalized.some(entry=>entry.name==='Konsept Onaylı'&&entry.builtin===false));
});
