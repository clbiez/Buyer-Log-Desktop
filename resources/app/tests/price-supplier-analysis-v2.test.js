'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const engine=require('../public/collection-analytics-engine.js');

const sample=[
  {rowId:1,modelKey:'A1',orderKey:'O1',classification:'Tee',manufacturer:'Alpha',country:'TR',price:10,currency:'USD',quantity:100},
  {rowId:2,modelKey:'A2',orderKey:'O2',classification:'Tee',manufacturer:'Alpha',country:'TR',price:12,currency:'USD',quantity:100},
  {rowId:3,modelKey:'B1',orderKey:'O3',classification:'Tee',manufacturer:'Beta',country:'CN',price:20,currency:'USD',quantity:50},
  {rowId:4,modelKey:'B2',orderKey:'O4',classification:'Tee',manufacturer:'Beta',country:'CN',price:22,currency:'USD',quantity:50},
  {rowId:5,modelKey:'C1',orderKey:'O5',classification:'Dress',manufacturer:'Gamma',country:'TR',price:30,currency:'USD',quantity:25},
  {rowId:6,modelKey:'C2',orderKey:'O6',classification:'Dress',manufacturer:'Gamma',country:'TR',price:32,currency:'USD',quantity:25},
];

test('V2 supplier intelligence parent kırılım ortalamasını ve fiyat pozisyonunu hesaplar',()=>{
  const result=engine.supplierIntelligence(sample,{
    dimensions:['classification','manufacturer'],metric:'average',includeOutliers:true,minSample:2,
    thresholds:{below:-5,above:5},
  });
  const alpha=result.rows.find(row=>row.path.join('/')==='Tee/Alpha');
  const beta=result.rows.find(row=>row.path.join('/')==='Tee/Beta');
  assert.equal(alpha.values.average.value,11);
  assert.equal(alpha.parentBenchmark.value,16);
  assert.equal(alpha.difference,-5);
  assert.equal(alpha.differencePct,-31.25);
  assert.equal(alpha.lowestDifferencePct,0);
  assert.equal(alpha.pricePosition,'below');
  assert.equal(beta.pricePosition,'above');
  assert.equal(beta.lowestDifferencePct,100*(21-11)/11);
});

test('V2 hiyerarşi parent özetlerini üretir ve her satır kendi parent benchmarkını kullanır',()=>{
  const result=engine.supplierIntelligence(sample,{
    dimensions:['classification','manufacturer'],metric:'median',includeOutliers:true,minSample:2,
  });
  assert.ok(result.hierarchyRows.some(row=>row.level===0&&row.path[0]==='Tee'&&row.isSummary));
  assert.ok(result.hierarchyRows.some(row=>row.level===1&&row.path.join('/')==='Tee/Alpha'&&!row.isSummary));
  assert.equal(result.rows.find(row=>row.path.join('/')==='Dress/Gamma').parentBenchmark.value,31);
});

test('V2 üç veya daha fazla kırılımda ara parent seviyelerini korur',()=>{
  const result=engine.supplierIntelligence(sample.map((row,index)=>({...row,buyer:index%2?'Buyer B':'Buyer A'})),{
    dimensions:['classification','manufacturer','buyer'],metric:'average',includeOutliers:true,minSample:1,
  });
  assert.ok(result.hierarchyRows.some(row=>row.isSummary&&row.path.join('/')==='Tee'));
  const alphaSummary=result.hierarchyRows.find(row=>row.isSummary&&row.path.join('/')==='Tee/Alpha');
  assert.ok(alphaSummary);
  assert.equal(alphaSummary.parentBenchmark.value,16);
  assert.ok(result.hierarchyRows.some(row=>!row.isSummary&&row.path.join('/')==='Tee/Alpha/Buyer A'));
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/function appendHierarchy/);
});

test('V2 veri kalitesi eksik fiyatı ve çıkarılan outlierı açıkça raporlar',()=>{
  const input=[...sample,{rowId:7,modelKey:'X',classification:'Tee',manufacturer:'Alpha',price:null,currency:'USD'},
    {rowId:8,modelKey:'Y',classification:'Tee',manufacturer:'Alpha',price:1000,currency:'USD'}];
  const result=engine.supplierIntelligence(input,{
    dimensions:['classification','manufacturer'],metric:'average',includeOutliers:false,minSample:3,
  });
  assert.equal(result.dataQuality.inputCount,8);
  assert.equal(result.dataQuality.excludedMissingPrice,1);
  assert.equal(result.dataQuality.excludedOutlier,1);
  assert.equal(result.records.length,6);
  assert.ok(result.rows.some(row=>row.sampleFlag==='low-sample'));
});

test('V2 karışık para biriminde fiyat farkını hesaplamaz',()=>{
  const mixed=[...sample,{rowId:9,modelKey:'Z',classification:'Tee',manufacturer:'Alpha',price:400,currency:'TRY'}];
  const result=engine.supplierIntelligence(mixed,{
    dimensions:['classification','manufacturer'],metric:'average',includeOutliers:true,
  });
  const alpha=result.rows.find(row=>row.path.join('/')==='Tee/Alpha');
  assert.equal(alpha.values.average.value,null);
  assert.equal(alpha.parentBenchmark.value,null);
  assert.equal(alpha.differencePct,null);
  assert.equal(alpha.pricePosition,'unavailable');
  assert.ok(result.dataQuality.mixedCurrencyGroups>0);
});

test('V2 ekranı otomatik hazır Collection dashboard sözleşmesini kullanır',()=>{
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/const STORAGE_KEY='lcw\.priceSupplierAnalysis\.v2'/);
  assert.match(ui,/source:'collection'/);
  assert.match(ui,/scope:'all'/);
  assert.match(ui,/dimensions:\['classification','manufacturer'\]/);
  assert.match(ui,/metric:'average'/);
  assert.match(ui,/sort:\{key:'average',dir:'asc'\}/);
  assert.doesNotMatch(ui,/data-pa="run"/);
  for(const marker of ['paV2Toolbar','paV2Overview','paV2Ranking','paV2Opportunities','paV2Heatmap'])assert.match(ui,new RegExp(marker));
});

test('V2 tek filtre drawerı, esnek breakdown ve kullanıcıya özel saved view durumunu taşır',()=>{
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/data-pa="filters"/);
  assert.match(ui,/data-pa="breakdown"/);
  assert.match(ui,/openValueFilterPanel/);
  assert.match(ui,/BLStorage/);
  assert.match(ui,/dimensions:structuredClone/);
  assert.match(ui,/thresholds:structuredClone/);
  assert.match(ui,/includeOutliers/);
});

test('V2 ranking sanallaştırılır, drill-down ve dataset tabanlı Excel export korunur',()=>{
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/paV2Virtual/);
  assert.match(ui,/requestAnimationFrame/);
  assert.match(ui,/openDrilldown/);
  assert.match(ui,/XLSX\.utils\.json_to_sheet/);
  assert.match(ui,/Data Quality/);
  assert.doesNotMatch(ui,/table\.outerHTML/);
});

test('V2 heatmap veri hücreleri sıralama yapmaz; sıralama yalnız başlık hücrelerinde kalır',()=>{
  const ui=read('public/collection-analytics.js');
  assert.match(ui,/paV2HeatmapRowSort/);
  assert.match(ui,/data-heat-column-sort/);
  assert.match(ui,/data-heat-row-sort/);
  assert.match(ui,/querySelectorAll\('\[data-heat-row\]'\).*dblclick/s);
  assert.doesNotMatch(ui,/<td[^>]*data-heat-row="[^"]*"[^>]*data-heat-row-sort=/);
});

test('V2 kaynak adaptörü ortak alanları canonical registry üzerinden okur',()=>{
  const app=read('public/app-main.js');
  const bridge=app.slice(app.indexOf('window.BLPriceSupplierAnalysisBridge='),app.indexOf('function kolTableClipboardColumns'));
  assert.match(bridge,/BLCanonicalFields/);
  assert.match(bridge,/canonicalPriceObservation/);
  assert.doesNotMatch(bridge,/row\['Sub-Manufacturer'\]\|\|row\['Sub Manufacturer'\]/);
});

test('V2 modül CSS’i Buyer Log tokenlarıyla kompakt drawer, ranking ve pozisyon durumlarını tanımlar',()=>{
  const css=read('public/collection-analytics.css');
  for(const marker of ['.paV2Toolbar','.paV2Drawer','.paV2Ranking','.paV2Position.is-below','.paV2Heatmap'])assert.match(css,new RegExp(marker.replace('.','\\.')));
  assert.doesNotMatch(css.slice(css.indexOf('.priceSupplierAnalysis')),/#(?:[0-9a-fA-F]{3}){1,2}\b/);
});
