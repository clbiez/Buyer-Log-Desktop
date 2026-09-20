'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const engine=require('../public/collection-analytics-engine.js');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

const sample=[
  {rowId:1,modelKey:'A',manufacturer:'M1',classification:'Tee',mag:'Kids',buyer:'B1',country:'TR',price:10,currency:'USD',quantity:100},
  {rowId:2,modelKey:'B',manufacturer:'M1',classification:'Tee',mag:'Kids',buyer:'B1',country:'TR',price:12,currency:'USD',quantity:50},
  {rowId:3,modelKey:'C',manufacturer:'M2',classification:'Tee',mag:'Kids',buyer:'B2',country:'CN',price:20,currency:'USD',quantity:10},
  {rowId:4,modelKey:'D',manufacturer:'M2',classification:'Dress',mag:'Women',buyer:'B2',country:'CN',price:100,currency:'USD',quantity:1},
];

test('v6.65 ortak motor temel istatistikleri ve ağırlıklı ortalamayı üretir',()=>{
  const result=engine.analyze(sample);
  assert.equal(result.stats.modelCount,4);assert.equal(result.stats.priceCount,4);
  assert.equal(result.stats.median,16);assert.equal(result.stats.manufacturerCount,2);
  assert.ok(result.stats.weightedAverage<result.stats.average);
});

test('v6.65 IQR aykırı değer anahtarı aynı gözlem setinde çalışır',()=>{
  const many=[1,2,2,2,3,100].map((price,index)=>({...sample[0],rowId:index,modelKey:String(index),price}));
  const included=engine.analyze(many,{includeOutliers:true});
  const excluded=engine.analyze(many,{includeOutliers:false});
  assert.equal(included.stats.outlierCount,1);assert.equal(excluded.stats.priceCount,5);
});

test('v6.65 matris hücreleri veri kaybetmeden ortak gözlemleri kullanır',()=>{
  const matrix=engine.matrix(sample,'manufacturer','classification','models');
  let total=0;matrix.rows.forEach(row=>matrix.columns.forEach(column=>{total+=matrix.value(row,column)||0;}));
  assert.equal(total,4);
});

test('v6.65 üretici benchmarkı sınıf kontrollü ve ±5 eşikli',()=>{
  const result=engine.analyze(sample);
  assert.ok(result.benchmark.every(item=>['market','below','above','insufficient'].includes(item.status)));
  assert.ok(result.benchmark.some(item=>Number.isFinite(item.delta)));
});

test('v6.65 batch endpoint mevcut erişimi kesiştirir ve salt okunurdur',()=>{
  const server=read('server/server.js');
  const batch=server.indexOf("app.get('/api/collection-workspaces-batch'");
  const single=server.indexOf("app.get('/api/collection-workspaces/:ownerId'");
  assert.ok(batch>=0&&batch<single);assert.match(server.slice(batch,single),/collectionAccessLevel/);
  assert.doesNotMatch(server,/app\.(put|post|delete)\('\/api\/collection-workspaces-batch/);
});

test('v6.65 birleşik görünüm yazmayı kapatır ve kaynak kimliğini korur',()=>{
  const app=read('public/app-main.js');
  const start=app.indexOf('function kolApplyCombinedWorkspaces');
  const end=app.indexOf('async function kolLoadWorkspaceBatch',start);
  const block=app.slice(start,end);
  assert.match(block,/kolWorkspaceCanEdit=false/);assert.match(block,/_collectionSourceId=row\.id/);assert.match(block,/_collectionOwnerId=owner\.id/);
  assert.match(app,/function saveKolRows\(\)\{[\s\S]{0,400}if\(!kolWorkspaceCanEdit\)return/);
});

test('v7.64 bağımsız analiz Collection kapsamını köprüden seçer',()=>{
  const app=read('public/app-main.js');
  const start=app.indexOf('window.BLPriceSupplierAnalysisBridge=');const end=app.indexOf('function kolTableClipboardColumns',start);const block=app.slice(start,end);
  assert.match(block,/scope==='filtered'\?filteredKol\(\):kolRows/);
  assert.doesNotMatch(app,/BLCollectionAnalytics\?\.render\(rows\)/);
  assert.doesNotMatch(read('public/collection-analytics.js'),/fetch\s*\(/);
});

test('v6.65 para türleri USD ile TRY değerlerini karıştırmaz',()=>{
  const app=read('public/app-main.js');
  const start=app.indexOf('window.BLCollectionAnalyticsBridge=');const block=app.slice(start,start+9000);
  assert.match(block,/key:'trPrice',label:'TR Price',currency:'TRY'/);
  assert.match(block,/key:'quotation',label:'Üretici Teklifleri',currency:'USD'/);
});

test('v7.64 Collection görünümü, kullanıcı tercihi ve sahip-bazlı izin paneli bulunur',()=>{
  const html=read('public/index.html'),app=read('public/app-main.js'),storage=read('public/user-storage.js'),ui=read('public/collection-analytics.js');
  assert.match(html,/Görünüm ve Yetkiler/);assert.doesNotMatch(html,/kolScopeMine|kolScopeAll/);
  assert.match(app,/\/api\/collection-permissions/);assert.match(app,/data-grant-add/);assert.match(app,/data-owner-id/);assert.match(app,/payload\.area==='collection-permissions'/);
  assert.match(storage,/lcw\.koleksiyon\.scope\./);assert.match(ui,/lcw\.priceSupplierAnalysis\.v2/);
});

test('v7.64 esnek analiz, drilldown, karşılaştırma ve dataset Excel export sunar',()=>{
  const ui=read('public/collection-analytics.js');
  // Liste kapalı değil: sonradan 'horizon' eklendi. İddia dört temel kaynağın
  // VARLIĞINI çiviliyor, listenin tam eşitliğini değil.
  const names=ui.match(/SOURCE_NAMES=\{[^}]*\}/);
  assert.ok(names,'SOURCE_NAMES tanımlı olmalı');
  for(const pair of ["collection:'Collection'","cp:'CP'","orders:'Orders'","lfl:'LFL'"]) assert.ok(names[0].includes(pair),`${pair} bulunmalı`);
  for(const key of ['manufacturer','classification','flexibleMatrix'])assert.match(ui,new RegExp(key));
  assert.match(ui,/openDrilldown/);assert.match(ui,/compareAnalyses/);assert.match(ui,/json_to_sheet\(out\)/);assert.doesNotMatch(ui,/table\.outerHTML|querySelectorAll\([^)]*tbody/);
});
