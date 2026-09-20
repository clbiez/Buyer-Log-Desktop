'use strict';
// NOT (v7.00): sürüm etiketi iddiaları belirli bir sürüm numarasını değil,
// önbellek etiketinin VARLIĞINI çivilemelidir; her sürüm yükseltmesinde
// kırılmasınlar diye kalıp \d+\.\d+ olarak gevşetildi.

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const Engine=require(path.join(root,'public','lfl-order-analytics-engine'));
const ui=fs.readFileSync(path.join(root,'public','lfl-order-analytics.js'),'utf8');
const lfl=fs.readFileSync(path.join(root,'public','lfl.js'),'utf8');
const html=fs.readFileSync(path.join(root,'public','index.html'),'utf8');
const perf=fs.readFileSync(path.join(root,'public','perf-runtime.js'),'utf8');

const current=[
  {id:'c1',orderCode:'100',modelName:'M1',manufacturer:'A',country:'TR',mag:'G1',classification:'K1',quantity:120,inStoreMonth:'2026-05'},
  {id:'c2',orderCode:'101',modelName:'M2',manufacturer:'B',country:'CN',mag:'G1',classification:'K2',quantity:80,inStoreMonth:'2026-06'},
  {id:'c3',orderCode:'102',modelName:'M3',manufacturer:'NEW',country:'TR',mag:'G2',classification:'K1',quantity:50,inStoreMonth:'2026-06'},
];
const previous=[
  {id:'p1',orderCode:'200',modelName:'P1',manufacturer:'A',country:'TR',mag:'G1',classification:'K1',quantity:100,inStoreMonth:'2025-05'},
  {id:'p2',orderCode:'201',modelName:'P2',manufacturer:'B',country:'CN',mag:'G1',classification:'K2',quantity:100,inStoreMonth:'2025-06'},
  {id:'p3',orderCode:'202',modelName:'P3',manufacturer:'EXIT',country:'BD',mag:'G2',classification:'K1',quantity:40,inStoreMonth:'2025-06'},
];

test('v6.64 tüm boyut toplamları aynı sipariş hacmini verir',()=>{
  const model=Engine.aggregate(current,previous,{stableThreshold:5});
  assert.equal(model.totals.currentQty,250);assert.equal(model.totals.previousQty,240);
  for(const dim of Engine.DIMENSIONS){
    assert.equal(model.dimensions[dim].reduce((sum,row)=>sum+row.currentQty,0),250,dim);
    assert.equal(model.dimensions[dim].reduce((sum,row)=>sum+row.previousQty,0),240,dim);
  }
});

test('v6.64 üretici durumları ve sıfır baz güvenli hesaplanır',()=>{
  const model=Engine.aggregate(current,previous,{stableThreshold:5}),byName=Object.fromEntries(model.dimensions.manufacturer.map(row=>[row.name,row]));
  assert.equal(byName.A.status,'GROWING');assert.equal(byName.B.status,'DECLINING');assert.equal(byName.NEW.status,'NEW');assert.equal(byName.EXIT.status,'EXIT');
  assert.equal(byName.NEW.changePct,null);assert.ok(!ui.includes('Infinity'));
  assert.equal(Engine.statusFor(105,100,5),'STABLE');assert.equal(Engine.statusFor(106,100,5),'GROWING');
});

test('v6.64 Top N + Diğer hacmi kaybetmez',()=>{
  const model=Engine.aggregate(current,previous),top=Engine.topNWithOther(model.dimensions.manufacturer,2);
  assert.equal(top.length,3);assert.equal(top.at(-1).name,'Diğer');
  assert.equal(top.reduce((sum,row)=>sum+row.currentQty,0),model.totals.currentQty);
  assert.equal(top.reduce((sum,row)=>sum+row.previousQty,0),model.totals.previousQty);
});

test('v6.64 matris toplamı ortak agregasyonla tutarlıdır',()=>{
  const model=Engine.aggregate(current,previous),matrix=Engine.matrix(model,'manufacturer','country','currentQty');
  assert.equal([...matrix.cells.values()].reduce((sum,cell)=>sum+cell.currentQty,0),model.totals.currentQty);
  assert.equal(matrix.rows.reduce((sum,row)=>sum+row.total,0),model.totals.currentQty);
});

test('LFL üretici ve ülke kırılımı canonical key ile gerçek detay satırlarını korur',()=>{
  const model=Engine.aggregate(current,previous),manufacturer=model.dimensions.manufacturer.find(row=>row.key==='A'),country=model.dimensions.country.find(row=>row.key==='TR');
  const combination=Engine.matrix(model,'manufacturer','country','currentQty').cells.get('A\u0001TR');
  assert.equal(manufacturer.currentRows.map(row=>row.id).join(','),'c1');
  assert.equal(manufacturer.previousRows.map(row=>row.id).join(','),'p1');
  assert.equal(country.currentRows.map(row=>row.id).join(','),'c1,c3');
  assert.equal(country.previousRows.map(row=>row.id).join(','),'p1');
  assert.equal(combination.currentRows.map(row=>row.id).join(','),'c1');
  assert.equal(combination.previousRows.map(row=>row.id).join(','),'p1');
  assert.equal(combination.currentRows.reduce((sum,row)=>sum+row.quantity,0),combination.currentQty);
  assert.equal(manufacturer.currentRows.reduce((sum,row)=>sum+row.quantity,0),manufacturer.currentQty);
  assert.equal(country.currentRows.reduce((sum,row)=>sum+row.quantity,0),country.currentQty);
});

test('LFL analiz tabloları drilldown satırını görünen label yerine canonical key ile bağlar',()=>{
  assert.match(ui,/data-la-key="\$\{encodeURIComponent\(row\.key\)\}"/);
  assert.match(ui,/findAggregateRow\(dim,key\)/);
  assert.doesNotMatch(ui,/data-la-name=/);
  assert.doesNotMatch(ui,/findAggregateRow\(dim,name\)/);
});

test('v6.64 filtre, pay ve yetersiz geçmiş davranışı',()=>{
  const filtered=Engine.aggregate(current,previous,{filters:{country:'TR'}});
  assert.equal(filtered.totals.currentQty,170);assert.equal(filtered.totals.previousQty,100);
  assert.equal(Math.round(filtered.dimensions.manufacturer.reduce((sum,row)=>sum+row.currentShare,0)),100);
  const noHistory=Engine.aggregate(current,[]);assert.equal(noHistory.totals.changePct,null);assert.match(Engine.insights(noHistory,'S26','S25')[0],/yeterli geçmiş veri/);
});

test('v6.64 analiz ek sorgu yapmaz ve LFL satırlarını doğrudan kullanır',()=>{
  assert.doesNotMatch(ui,/\bfetch\s*\(/);assert.doesNotMatch(ui,/XMLHttpRequest|axios\./);
  assert.match(lfl,/analysis:a[\s\S]*openDrilldown:openLflPortfolioModal/);
  assert.match(ui,/(?:context|ctx|state\.context).*analysis\.currentRows/);assert.match(ui,/(?:context|ctx|state\.context).*analysis\.compareRows/);
});

test('v6.64 panel Otomatik Yorumlar önünde ve gerekli sekmelerle yüklenir',()=>{
  const panel=html.indexOf('id="lflOrderAnalytics"'),comments=html.indexOf('Otomatik Yorumlar');
  assert.ok(panel>0&&comments>panel);
  assert.doesNotMatch(html,/lfl-order-analytics-engine\.js\?v=\d+\.\d+(?:-[^\"']+)?/);
  assert.match(perf,/lfl:\['lfl-order-analytics-engine\.js','lfl-order-analytics\.js','lfl\.js\?rev=/);
  assert.match(fs.readFileSync(path.join(root,'public','app-main.js'),'utf8'),/ensureFeature\('lfl'\)/);
  for(const token of ['overview','manufacturer','country','mag','classification','matrix'])assert.ok(ui.includes(token),token);
});

test('v6.64 Excel çoklu sayfa, görünüm tercihi ve drilldown içerir',()=>{
  assert.match(ui,/append\(T\('summary'\)/);assert.match(ui,/append\(T\('matrix'\)/);assert.match(ui,/append\(T\('orderDetail'\)/);
  assert.match(ui,/STORAGE_KEY='lcw\.lfl\.orderAnalytics\.v1'/);assert.match(ui,/openDrilldown/);assert.match(ui,/data-la-view/);
});
