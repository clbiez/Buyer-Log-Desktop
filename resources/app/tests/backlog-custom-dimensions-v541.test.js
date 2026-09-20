'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const parse = require('../server/lib/parse');

const overrides = { notesmap:{}, submap:{}, suppfobmap:{}, suppfobmetamap:{}, delmap:{}, licensormap:{}, datemap:{}, pricingRules:[], transitRules:[] };

function order(extra={}) {
  return {
    ocode:1001, model:'MODEL', ccode:'01', colour:'SİYAH', season:'S7', countryRaw:'TÜRKİYE',
    manufacturer:'ÜRETİCİ', category:'KAZAK', merch:'12', ageGroup:'A1', buyer:'BUYER', buyerGrup:'KIDS',
    line:'LINE', qty:100, kalan:100, opd:new Date(2026,0,1), ex:new Date(2026,1,1),
    retail:new Date(2026,2,1), mb:new Date(2026,1,15), merkezSevkeHazirKalan:0,
    ...extra,
  };
}

test('ASAS ham başlığı dinamik gruplama boyutu olur', () => {
  const orders=[order({_sourceFields:{'Planlama Takımı':'Takım A','Özel Not':'Kontrol'}})];
  const first=parse.buildBacklogGrouped(orders,{},overrides,{groupBy:[]});
  const dimension=first.customDimensions.find(item=>item.source==='asas'&&item.header==='Planlama Takımı');
  assert.ok(dimension, 'ASAS başlığı seçeneklerde bulunmalı');
  const grouped=parse.buildBacklogGrouped(orders,{},overrides,{groupBy:[dimension.id]});
  assert.strictEqual(grouped.tree[0].label,'Takım A');
  assert.deepStrictEqual(grouped.dimValues[dimension.id],['Takım A']);
});

test('Antrepo ham başlığı dinamik gruplama boyutu olur', () => {
  const orders=[order()];
  const map=parse.parseAntrepoRows([{
    'Sipariş Kod':'1001','Ürün Ad':'MODEL','Renk Kod':'01','Supplier Portal Statü':'Depoda',
    'Yükleme Toplam Adet':100,'Net Alım Sipariş Miktarı':100,'Operasyon Sorumlusu':'Ayşe',
  }]);
  const first=parse.buildBacklogGrouped(orders,map,overrides,{groupBy:[]});
  const dimension=first.customDimensions.find(item=>item.source==='antrepo'&&item.header==='Operasyon Sorumlusu');
  assert.ok(dimension, 'Antrepo başlığı seçeneklerde bulunmalı');
  const grouped=parse.buildBacklogGrouped(orders,map,overrides,{groupBy:[dimension.id]});
  assert.strictEqual(grouped.tree[0].label,'Ayşe');
});

test('Ekle düğmesi ve kaynak/başlık seçicisi arayüzde bulunur', () => {
  const js=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'..','public','app.css'),'utf8');
  assert.match(js,/data-backlog-dim-add/);
  assert.match(js,/data-source/);
  assert.match(js,/data-header/);
  assert.match(js,/backlogGroupBy\.push\(dim\)/);
  assert.match(css,/\.backlogDimAddDialog/);
});
