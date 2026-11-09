'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Q=require('../public/lcwai-data-query'),K=require('../server/lib/lcwai/lcwai-knowledge');
function ds(id='lfl',rows){return Q.datasetFromRecords({id,module:'lfl',label:id,rows:rows||[
  {season:'S6',mag:'CU4E',mmyg:'KIDS',classification:'T-Shirt',country:'CHINA',manufacturer:'Alpha',quantity:100,fob:4},
  {season:'S7',mag:'CU4E',mmyg:'KIDS',classification:'T-Shirt',country:'CHINA',manufacturer:'Alpha',quantity:300,fob:3},
  {season:'S6',mag:'CU4E',mmyg:'KIDS',classification:'T-Shirt',country:'TURKEY',manufacturer:'Beta',quantity:200,fob:100},
  {season:'S7',mag:'CU4E',mmyg:'KIDS',classification:'T-Shirt',country:'TURKEY',manufacturer:'Beta',quantity:100,fob:110},
  {season:'S7',mag:'CU4E',mmyg:'KIDS',classification:'New product',country:'CHINA',manufacturer:'New',quantity:999,fob:1},
]});}
test('LFL known without asking for its definition; same engine, default same-prefix seasons, separate currencies and comparable cohorts',()=>{
  const data=ds(),norm=Q.normalizeSpec({dataset:'lfl',comparison:{type:'lfl'}},[data],{request:'basit bir LFL analizi yap'});
  assert.equal(norm.ok,true,norm.errors.join());assert.equal(norm.clarify,null);
  assert.deepEqual(norm.spec.comparison.currentFilters[0].values,['S7']);assert.deepEqual(norm.spec.comparison.referenceFilters[0].values,['S6']);
  const r=Q.execute(norm.spec,data,{reference:norm.reference});
  assert.equal(r.rows.length,2);
  const usd=r.rows.find(row=>row.includes('USD')),tryRow=r.rows.find(row=>row.includes('TRY'));
  assert.deepEqual(usd.slice(3),['USD',300,100,3,4,-25,25]);
  assert.deepEqual(tryRow.slice(3),['TRY',100,200,110,100,10,-10]);
  assert.equal(r.comparisonStats.currentComparable,2);assert.equal(r.comparisonStats.change,-16.25);
  assert.match(Q.describe(norm.spec,data,r).join('\n'),/LFL: Like-for-Like/);
  assert.equal(Q.toWorkbook(r).sheets[0].rows.length,2);
  assert.match(K.moduleKnowledge('lfl','en'),/LFL = Like-for-Like/);
  assert.ok(K.selectModules({task:'CP siparişlerime LFL analizi yap'}).includes('lfl'));
});
test('CP current cohort can compare against authorized LFL history using canonical compatible dimensions',()=>{
  const current=Q.datasetFromRecords({id:'cp',rows:[{Season:'S7','Merch Alt Grup Kod':'CU4E','Merch Marka Yaş Grup Kod':'KIDS',Category:'T-Shirt',Country:'CHINA','Order Quantity':100,FOB:3}]}),history=ds();
  const norm=Q.normalizeSpec({dataset:'cp',comparison:{type:'lfl',referenceDataset:'lfl',currentFilters:[{field:'season',values:['S7']}],referenceFilters:[{field:'season',values:['S6']}]}},[current,history]);
  assert.equal(norm.ok,true,norm.errors.join());
  const result=Q.execute(norm.spec,current,{reference:norm.reference});assert.deepEqual(result.rows[0].slice(3),['USD',100,100,3,4,-25,25]);
});
test('LFL honors a requested supplier breakdown instead of silently using default dimensions',()=>{
  const data=ds(),n=Q.normalizeSpec({dataset:'lfl',rows:['manufacturer'],comparison:{type:'lfl'}},[data]);assert.equal(n.ok,true,n.errors.join());
  assert.deepEqual(n.spec.comparison.matchBy,[{field:'manufacturer',referenceField:'manufacturer'}]);
  assert.equal(Q.execute(n.spec,data).columns[0].label,'Üretici');
});
test('LFL refuses ordinary total as a substitute, incompatible matching, malformed periods and identical periods; absent history asks periods',()=>{
  const data=ds();
  assert.ok(Q.normalizeSpec({dataset:'lfl',measures:[{agg:'sum',field:'quantity'}]},[data],{request:'LFL analizi'}).errors.includes('missing-requested-analysis:lfl'));
  for(const comparison of [{type:'lfl',matchBy:['fob']},{type:'lfl',currentFilters:[],referenceFilters:{}},{type:'lfl',currentFilters:[{field:'season',values:['S7']}],referenceFilters:[{field:'season',values:['S7']}]}])assert.equal(Q.normalizeSpec({dataset:'lfl',comparison},[data]).ok,false);
  const single=ds('lfl',[data.rows[1]]),norm=Q.normalizeSpec({dataset:'lfl',comparison:{type:'lfl'}},[single]);assert.ok(norm.clarify);assert.match(norm.clarify.question,/önceki sezon/);
});
test('Backlog and supplier rankings use real fields and distinct objectives',()=>{
  const backlog=Q.datasetFromRecords({id:'backlog',rows:[{Manufacturer:'A','Remaining Units':100},{Manufacturer:'B','Remaining Units':200}]});
  const n=Q.normalizeSpec({dataset:'backlog',rows:['manufacturer'],measures:[{agg:'sum',field:'remainingUnits'}],sort:{by:0,dir:'desc'}},[backlog]);assert.equal(n.ok,true,n.errors.join());assert.deepEqual(Q.execute(n.spec,backlog).rows,[['B',200],['A',100]]);
  const quotations=ds('quotations',[{manufacturer:'A',classification:'T-Shirt',currency:'USD',fob:4},{manufacturer:'B',classification:'T-Shirt',currency:'USD',fob:3}]);
  const quote=Q.normalizeSpec({dataset:'quotations',filters:[{field:'category',values:['T-Shirt']}],rows:['manufacturer','currency'],measures:[{agg:'min',field:'fob'},{agg:'count'}],sort:{by:0,dir:'asc'},limit:1},[quotations]);
  assert.equal(quote.ok,true,quote.errors.join());assert.deepEqual(Q.execute(quote.spec,quotations).rows,[['B','USD',3,1]]);
  assert.match(K.moduleKnowledge('suppliers','en'),/not a universal score/);
});
test('one request can answer lowest quote and highest volume from different sources without partial results',()=>{
  const orders=ds('orders'),quotes=ds('quotations',[{manufacturer:'Cheap',classification:'T-Shirt',currency:'USD',fob:2}]);
  const request="t-shirt'e en uygun fiyat veren ve en çok t-shirt siparişi alan üretici";
  const queries=[{dataset:'quotations',title:'Lowest quote',rows:['manufacturer','currency'],measures:[{agg:'min',field:'fob'}]},
    {dataset:'orders',title:'Highest volume',rows:['manufacturer'],measures:[{agg:'sum',field:'quantity'}],sort:{by:0,dir:'desc'},limit:1}];
  const n=Q.normalizeSpec({queries},[orders,quotes],{request});assert.equal(n.ok,true,n.errors.join());
  const result=Q.execute(n.spec,n.dataset,{datasets:[orders,quotes]});
  assert.match(Q.toMarkdown(result),/Lowest quote/);assert.match(Q.toMarkdown(result),/Highest volume/);
  const wb=Q.toWorkbook(result);assert.equal(wb.sheets.length,2);assert.equal(wb.sheets[0].rows[0][0],'Cheap');assert.equal(wb.sheets[1].rows[0][0],'New');
  assert.equal(Q.normalizeSpec(queries[1],[orders,quotes],{request}).ok,false,'quotation objective cannot be omitted');
  assert.equal(Q.normalizeSpec({queries:[queries[0],{...queries[1],measures:[{agg:'sum',field:'absent'}]}]},[orders,quotes],{request}).ok,false,'one invalid query blocks the whole answer');
});
test('price aggregation cannot mix currencies; grouped prices and LFL keep currency boundaries',()=>{
  const data=ds();
  const one=Q.normalizeSpec({dataset:'lfl',measures:[{agg:'weighted_avg',field:'fob',weightField:'quantity'}]},[data]);
  assert.equal(one.ok,false);assert.ok(one.errors.includes('mixed-price-currencies:group-by-currency-or-country'));
  const grouped=Q.normalizeSpec({dataset:'lfl',rows:['country'],measures:[{agg:'weighted_avg',field:'fob',weightField:'quantity'}]},[data]);
  assert.equal(grouped.ok,true,grouped.errors.join());
  const result=Q.execute(grouped.spec,data);assert.equal(result.total.at(-1),null,'grand total cannot average TRY and USD');
  assert.match(Q.describe(grouped.spec,data,result,'en').join('\n'),/currencies.*were not combined/);
});
test('an explicitly requested missing dataset is never replaced with the only available source',()=>{
  const n=Q.normalizeSpec({dataset:'quotations',measures:[{agg:'min',field:'fob'}]},[ds('orders')]);
  assert.equal(n.ok,false);assert.deepEqual(n.errors,['unknown-dataset:quotations']);
});
test('cooperative execution returns exactly the synchronous result and honors cancellation',async()=>{
  const data=ds('lfl',Array.from({length:20000},(_,i)=>({country:'CHINA',manufacturer:'Demo',quantity:i%2?300:100,fob:i%2?6:2})));
  const n=Q.normalizeSpec({dataset:'lfl',rows:['manufacturer'],measures:[{agg:'sum',field:'quantity'},{agg:'weighted_avg',field:'fob',weightField:'quantity'}]},[data],{deferCurrencyCheck:true});
  assert.equal(n.ok,true,n.errors.join());
  assert.deepEqual(await Q.executeAsync(n.spec,data),Q.execute(n.spec,data));
  assert.equal(await Q.schemaTextAsync([data]),Q.schemaText([data]));
  let checks=0;await assert.rejects(Q.executeAsync(n.spec,data,{cancelled:()=>++checks>1}),error=>error.code==='LCWAI_CANCELLED');assert.ok(checks>1);
});
