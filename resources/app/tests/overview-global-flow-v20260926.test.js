'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const flow=require('../public/overview-global-flow.js');

const ROOT=path.join(__dirname,'..');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','overview-global-flow.css'),'utf8');
const LAYOUT=require('../public/overview-layout.js');

test('Global Flow taşıma tipi Gemi, Uçak, Tır ve Gemi+Uçak değerlerini ayırır',()=>{
  assert.equal(flow.detectMode('GEMİ'),'sea');
  assert.equal(flow.detectMode('Uçak'),'air');
  assert.equal(flow.detectMode('TIR'),'road');
  assert.equal(flow.detectMode('Gemi + Uçak'),'sea-air');
});

test('Global Flow temel operasyon durumlarını map state sözleşmesine çevirir',()=>{
  assert.equal(flow.classifyState('Üretimde','unknown',{}),'production');
  assert.equal(flow.classifyState('Sevke Hazır','unknown',{}),'ready');
  assert.equal(flow.classifyState('Yükleme Operasyonları','sea',{}),'transit');
  assert.equal(flow.classifyState('Antrepo Giriş','road',{}),'arrived');
});

test('Global Flow satır adaptörü Backlog alanlarını ortak kayda dönüştürür',()=>{
  const rec=flow.normalizeRecord({
    'Sipariş Kod':'1001','Model Adı':'MODEL-1','Renk Kod':'01','Sezon':'W26',
    'Buyer':'Ayşe','Buyer Grup (TR)':'WOMEN','Üretici':'SUPPLIER A',
    'Siparişin Üretildiği Ülke':'Bangladesh','GÜNCEL DURUM\n(STATUS)':'Yükleme Operasyonları',
    'YÜKLEME TİPİ':'GEMİ','Adet':'24.600','RİSK\n(PRIORITY)':'CRITICAL'
  },'backlog',0);
  assert.equal(rec.orderCode,'1001');
  assert.equal(rec.qty,24600);
  assert.equal(rec.mode,'sea');
  assert.equal(rec.state,'transit');
  assert.equal(rec.origin.name,'Bangladesh');
  assert.equal(rec.risk,'high');
});

test('Combined görünüm aynı siparişi Backlog > Orders > CP önceliğiyle tekilleştirir',()=>{
  const base={orderCode:'1001',model:'M',colourCode:'01'};
  const rows=[
    {...base,id:'cp:1',source:'cp',qty:10},
    {...base,id:'orders:1',source:'orders',qty:20},
    {...base,id:'backlog:1',source:'backlog',qty:30},
  ];
  const result=flow.dedupeRecords(rows);
  assert.equal(result.length,1);
  assert.equal(result[0].source,'backlog');
  assert.equal(result[0].qty,30);
});

test('Global Flow ülke merkezi ve grup toplaması rotayı çizmek için yeterli meta üretir',()=>{
  assert.equal(flow.countryCoordinate('Türkiye').name,'İstanbul');
  assert.equal(flow.countryCoordinate('India').name,'India');
  const rows=[
    flow.normalizeRecord({'Sipariş Kod':'1','Country':'India','Status':'In Transit','Shipment Mode':'Air','Qty':'100'},'orders',0),
    flow.normalizeRecord({'Sipariş Kod':'2','Country':'India','Status':'In Transit','Shipment Mode':'Air','Qty':'50'},'orders',1),
  ];
  const groups=flow.aggregateRecords(rows);
  assert.equal(groups.length,1);
  assert.equal(groups[0].orders,2);
  assert.equal(groups[0].qty,150);
});

test('Overview Global Flow widget, assets, 2D/3D canvas and detail drawer are wired',()=>{
  assert.match(INDEX,/data-overview-widget="globalFlowMap"/);
  assert.match(INDEX,/id="globalFlowCanvas"/);
  assert.match(INDEX,/id="globalFlowDrawer"/);
  assert.match(INDEX,/overview-global-flow\.js/);
  assert.match(INDEX,/overview-global-flow\.css/);
  assert.match(CSS,/\.globalFlowMapWidget\.is-fullscreen/);
  assert.ok(LAYOUT.widgets.includes('globalFlowMap'));
  assert.equal(LAYOUT.defaults().widths.globalFlowMap,'full');
});
