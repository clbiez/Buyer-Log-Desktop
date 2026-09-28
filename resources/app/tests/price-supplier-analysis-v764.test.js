'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
const engine=require('../public/collection-analytics-engine.js');
const canonical=require('../public/canonical-fields.js');
const modelScopes=require('../server/lib/model-scopes');
const modelHorizon=require('../server/lib/modelHorizon');
const sample=[
  {rowId:1,modelKey:'A',orderKey:'O1',classification:'Tee',manufacturer:'M1',country:'TR',price:10,currency:'USD',quantity:100},
  {rowId:2,modelKey:'B',orderKey:'O2',classification:'Tee',manufacturer:'M2',country:'CN',price:20,currency:'USD',quantity:50},
  {rowId:3,modelKey:'C',orderKey:'O3',classification:'Dress',manufacturer:'M2',country:'CN',price:30,currency:'USD',quantity:25},
];

test('esnek motor çoklu kırılımı mevcut fiyat istatistikleriyle üretmeye devam eder',()=>{
  const result=engine.analyzeFlexible(sample,{dimensions:['classification','manufacturer'],metrics:['average','modelCount','totalQuantity']});
  assert.equal(result.rows.length,3);
  assert.equal(result.rows.find(row=>row.path.join('/')==='Tee/M1').values.average.value,10);
  assert.ok(Math.abs(engine.metricResult(sample,'weightedAverage').value-(2750/175))<1e-9);
});

test('farklı para birimleri fiyat metriğini ve delta kıyasını kapatır',()=>{
  const mixed=[...sample,{...sample[0],rowId:4,modelKey:'D',currency:'TRY',price:400}];
  assert.equal(engine.metricResult(mixed,'average').value,null);
  const a=engine.analyzeFlexible(sample,{dimensions:['classification'],metrics:['average']});
  const b=engine.analyzeFlexible(mixed,{dimensions:['classification'],metrics:['average']});
  assert.ok(engine.compareAnalyses([a,b],'average').rows.some(row=>row.delta==null));
});

test('bağımsız ekran yalnız seçilen kaynağı hazırlayan köprü ve kendi erişim alanını kullanır',()=>{
  const html=read('public/index.html'),app=read('public/app-main.js'),access=read('public/user-access-ui.js'),ui=read('public/price-supplier-analysis.js');
  assert.match(html,/data-tab="priceanalysis"/);
  assert.match(html,/id="view-priceanalysis"/);
  assert.match(app,/if\(selected==='cp'\)await ensureCpLoaded\(\)/);
  assert.match(app,/else if\(selected==='orders'\)await ensureOrdersLoaded\(\)/);
  assert.doesNotMatch(access,/key === 'priceanalysis' \? 'lfl'/);
  assert.match(access,/areas && areas\[(key|mapped)\]/);
  for(const marker of ['data-ps-tab','openDrilldown','BLPriceSupplierAnalysisBridge.get','json_to_sheet'])assert.match(ui,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('CP ve Orders analizinde girilmiş Sub-Manufacturer canonical supplier olarak korunur',()=>{
  assert.equal(canonical.value({'Sub-Manufacturer':'Factory One',Manufacturer:'Main Factory'},'orders','subManufacturer'),'Factory One');
  assert.equal(canonical.value({'Sub Mfr':'Factory Two'},'orders','subManufacturer'),'Factory Two');
  assert.equal(canonical.value({Manufacturer:'Main Factory'},'orders','subManufacturer'),undefined);
  const app=read('public/app-main.js');
  assert.match(app,/manufacturer:norm\(base\.manufacturer\|\|manufacturer\)/);
  assert.match(app,/chosen==='supplierFob'\?'supplierFob':'fob'/);
});

test('Price & Supplier Analysis Product Group, Line ve Product Main Definition alanlarını ayırır',()=>{
  const fields=read('public/canonical-fields.js');
  const app=read('public/app-main.js');
  const ui=read('public/price-supplier-insights-engine.js');
  assert.match(fields,/productGroup:\{label:\{en:'Product Group',tr:'Ürün Grubu'\}/);
  assert.doesNotMatch(fields,/line:\{label:\{en:'Line',tr:'Line'\},type:'text',role:'dimension',aliases:\[[^\]]*'Ürün Grubu'/);
  assert.equal(canonical.value({productGroup:'PG-1',line:'LINE-1'},'collection','productGroup'),'PG-1');
  assert.equal(canonical.value({productGroup:'PG-1',line:'LINE-1'},'collection','line'),'LINE-1');
  assert.match(app,/productMainDefinition=norm\(read\(moduleId==='collection'\?'productMainDefinition':'productDescription'\)\)/);
  assert.match(app,/productGroup:norm\(read\('productGroup'\)\)/);
  assert.doesNotMatch(app,/productGroup:norm\(read\('line'\)\)/);
  assert.match(ui,/'productGroup'/);
});

test('lowest/high price özetleri kullanıcı limitine kadar veri sağlayabilir',()=>{
  const rows=Array.from({length:14},(_,index)=>({rowId:index,modelKey:`M${index}`,classification:'Tee',manufacturer:`Supplier ${index}`,price:index+1,currency:'USD',quantity:1}));
  const result=engine.supplierIntelligence(rows,{dimensions:['classification','manufacturer'],metric:'average',includeOutliers:true,minSample:1});
  assert.equal(result.insights.lowest.length,14);
});

test('Price & Supplier Analysis Horizon kaynağını ve kendine ait horizon rozetini tanımlar',()=>{
  const html=read('public/index.html');
  const app=read('public/app-main.js');
  const ui=read('public/price-supplier-analysis.js');
  const scopes=read('server/lib/model-scopes.js');
  const refresh=read('server/lib/model-refresh.js');
  const server=read('server/server.js');
  assert.match(ui,/horizon\s*:\s*['"]Horizon['"]/);
  assert.match(app,/priceanalysis\s*:\s*['"]priceAnalysisHorizonBadge['"]/);
  assert.match(html,/id="priceAnalysisHorizonBadge"/);
  /* v7.81 — rozet eşlemesi artık app-main.js'teki HORIZON_BADGE_IDS'te;
     horizon-editor.js silindi (kişisel ufuk kaldırıldı). */
  assert.match(app,/priceanalysis\s*:\s*['"]priceAnalysisHorizonBadge['"]/);
  assert.match(scopes,/priceanalysis/);
  assert.match(refresh,/priceanalysis/);
  assert.match(server,/\/api\/data\/price-analysis/);
  assert.match(server,/USER_WORKSPACE_MODULES\s*=\s*new Set\(\[[^\]]*priceanalysis/);
  const normalizedScopes=modelScopes.normalizeScopes([{id:'legacy',targets:['cp','orders'],horizon:{}}],'asas',{},modelHorizon.normalizeHorizon);
  assert.ok(normalizedScopes.some(scope=>scope.targets.includes('priceanalysis')));
});
