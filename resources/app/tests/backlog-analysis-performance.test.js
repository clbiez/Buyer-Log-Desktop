'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const parse=require('../server/lib/parse');
const ov=()=>({notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[]});
const order=(extra={})=>({ocode:1001,model:'DEMO',ccode:'01',colour:'BLACK',season:'S7',countryRaw:'TURKIYE',manufacturer:'DEMO',category:'KNIT',buyer:'BUYER',buyerGrup:'KIDS',line:'LINE',qty:100,kalan:100,opd:new Date(2026,0,1),ex:new Date(2026,10,1),retail:new Date(2026,11,1),mb:new Date(2026,11,15),...extra});
const cp=(header,values,rest={})=>({id:'cp:'+header,values,...rest});
const partials=()=>parse.parseAntrepoRows([30,20].map((qty,i)=>({'Sipariş Kod':1001,'Ürün Ad':'DEMO','Renk Kod':'01','Supplier Portal Statü':i?'Yol Operasyonları':'Depoda','Yükleme Toplam Adet':qty,'Net Alım Sipariş Miktarı':100,Container:i?'TWO':'ONE'})));
test('narrow analysis skips operational preparation for rejected orders and does not project risk for a season pivot',()=>{
 let rejectedQtyReads=0,riskReads=0;
 const selected=order(),rejected=order({ocode:1002,season:'W6'});
 Object.defineProperty(selected,'shipConf',{get(){if(new Error().stack.includes('backlogTemplateRowsFromSegments'))riskReads++;return null;},enumerable:true});
 Object.defineProperty(rejected,'qty',{get(){rejectedQtyReads++;return 100;},enumerable:true});
 const report=parse.buildBacklogGrouped([selected,rejected],{},ov(),{groupBy:['season'],lazyDimensions:true,analysisFilters:[cp('Sezon',['S7'])]});
 assert.equal(report.totalOrders,1);assert.equal(report.totalQty,100);
 assert.equal(rejectedQtyReads,0,'rejected orders must not produce operational segments');
 assert.equal(riskReads,0,'a season filter does not need a risk/Excel projection');
 assert.deepEqual(report.dimValues,{});
});
test('raw ASAS predicates run before segmentation; IAS predicates retain complete partials when calculating remainder',()=>{
 let reads=0;const selected=order({_sourceFields:{Team:'A'}}),rejected=order({ocode:1002,_sourceFields:{Team:'B'}}),map=partials();
 Object.defineProperty(rejected,'qty',{get(){reads++;return 100;},enumerable:true});
 const catalog=parse.backlogCustomDimensionContext([selected,rejected],map).customDimensions;
 const team=catalog.find(c=>c.source==='asas'&&c.header==='Team'),container=catalog.find(c=>c.source==='antrepo'&&c.header==='Container');
 const rows=parse.buildBacklogTemplateRows([selected,rejected],map,ov(),{analysisFilters:[{id:team.id,values:['A']},{id:container.id,values:['']}]});
 assert.equal(reads,0);assert.equal(rows.length,1);assert.equal(rows[0].Adet,50);
 assert.equal(rows[0]._partial.kind,'production');
});
test('lazy dimension values preserve alternatives and active values for the requested field',()=>{
 const orders=[order(),order({ocode:1002,season:'W6',_sourceFields:{Unrequested:'HIDDEN'}})];
 const report=parse.buildBacklogGrouped(orders,{},ov(),{lazyDimensions:true,valueDimensions:['season'],analysisFilters:[cp('Sezon',['S7'])]});
 assert.deepEqual(report.dimValues,{season:['W6','S7']});assert.deepEqual(report.dimValuesActive,{season:['S7']});
});
test('column facets return values outside the analysis selection without serializing detail rows',()=>{
 const orders=[order(),order({ocode:1002,season:'W6'}),order({ocode:1003,season:''})];
 const result=parse.buildBacklogFilterValues(orders,{},ov(),{analysisFilters:[cp('Sezon',['S7'])]},'cp:Sezon');
 assert.equal(result.kind,'values');assert.equal(result.totalRows,3);
 assert.deepEqual(result.values,[{value:'W6',count:1},{value:'S7',count:1},{value:'',count:1}]);
 assert.equal(Object.hasOwn(result,'rows'),false);
 assert.throws(()=>parse.buildBacklogFilterValues(orders,{},ov(),{},'cp:_sourceFields'));
});
test('date facets, notes, blank selections, unknown fields and revised dates preserve report semantics',()=>{
 const overrides=ov();overrides.notesmap={1001:{Notes:'keep'}};
 const orders=parse.applyDateOverrides([order(),order({ocode:1002})],{datemap:{1001:{retail:'2027-01-01'}}});
 const result=parse.buildBacklogFilterValues(orders,{},overrides,{},'cp:Retail Depo Tarih Yıl Ay Gün');
 assert.equal(result.kind,'date');assert.equal(result.min,'2026-12-01');assert.equal(result.max,'2027-01-01');
 const rows=parse.buildBacklogTemplateRows(orders,{},overrides,{retailFrom:'2027-01-01',analysisFilters:[cp('buying note',['keep'])]});
 assert.equal(rows.length,1);assert.equal(rows[0]['buying note'],'keep');
 assert.equal(parse.buildBacklogTemplateRows(orders,{},overrides,{analysisFilters:[cp('missing',[''])]}).length,0);
});
