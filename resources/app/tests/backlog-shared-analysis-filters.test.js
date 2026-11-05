'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const parse=require('../server/lib/parse');
const overrides={notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[]};
const order=(extra={})=>({ocode:1001,model:'MODEL',ccode:'01',colour:'BLACK',season:'S7',countryRaw:'TURKIYE',manufacturer:'DEMO',category:'KNIT',merch:'12',ageGroup:'A1',buyer:'BUYER',buyerGrup:'KIDS',line:'LINE',qty:100,kalan:100,opd:new Date(2026,0,1),ex:new Date(2026,1,1),retail:new Date(2026,2,1),mb:new Date(2026,1,15),merkezSevkeHazirKalan:0,...extra});
const cp=(header,values,rest={})=>({id:'cp:'+header,source:'cp',header,rowKey:header,values,...rest});
function sameScope(orders,map,filters,expected,rest={}){
  const opts={groupBy:['status'],analysisFilters:JSON.stringify(filters),...rest};
  const grouped=parse.buildBacklogGrouped(orders,map,overrides,opts);
  const rows=parse.buildBacklogTemplateRows(orders,map,overrides,opts);
  assert.equal(grouped.totalRows,expected);
  assert.equal(rows.length,expected);
  assert.equal(grouped.totalQty,rows.reduce((sum,r)=>sum+r.Adet,0));
  if(grouped.tree?.length){
    const detail=parse.buildBacklogDetailRows(orders,map,overrides,{...opts,path:'0'});
    assert.equal(detail.length,grouped.tree[0].rows);
  }
  return rows;
}
test('analysis filters constrain pivot, detail and Excel rows and combine with existing dimensions',()=>{
  const orders=[order(),order({ocode:1002,season:'W6'}),order({ocode:1003,buyer:'OTHER'})];
  const rows=sameScope(orders,{},[cp('Sezon',['S7'])],1,{dimFilters:{buyer:['BUYER']}});
  assert.equal(rows[0]['Sipariş Kod'],1001);
  sameScope(orders,{},[],3);
  sameScope(orders,{},[cp('Sezon',['missing'])],0);
  sameScope(orders,{},[cp('Sezon',[])],3);
});
test('raw IAS filter selects one partial without bringing back its siblings or production balance',()=>{
  const orders=[order({_sourceFields:{Team:'A'}})];
  const map=parse.parseAntrepoRows([
    {'Sipariş Kod':'1001','Ürün Ad':'MODEL','Renk Kod':'01','Supplier Portal Statü':'Depoda','Yükleme Toplam Adet':30,'Net Alım Sipariş Miktarı':100,Container:'ONE'},
    {'Sipariş Kod':'1001','Ürün Ad':'MODEL','Renk Kod':'01','Supplier Portal Statü':'Yolda','Yükleme Toplam Adet':20,'Net Alım Sipariş Miktarı':100,Container:'TWO'},
  ]);
  const catalog=parse.backlogCustomDimensionContext(orders,map).customDimensions;
  const ias=catalog.find(c=>c.source==='antrepo'&&c.header==='Container');
  const asas=catalog.find(c=>c.source==='asas'&&c.header==='Team');
  const rows=sameScope(orders,map,[{...ias,values:['ONE']},{...asas,values:['A']}],1);
  assert.equal(rows[0].Adet,30);
  sameScope(orders,map,[{...ias,values:['']}],1);
});
test('date bounds are inclusive, blanks remain selectable and invalid fields fail closed',()=>{
  const orders=[order(),order({ocode:1002,ex:new Date(2026,1,2),buyer:''}),order({ocode:1003,ex:new Date(2026,1,3)})];
  sameScope(orders,{},[cp('REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)',[],{from:'2026-02-02',to:'2026-02-02'})],1);
  sameScope(orders,{},[cp('Buyer',[''])],1);
  sameScope(orders,{},[{id:'cp:missing',rowKey:'Buyer',values:['BUYER']}],0);
});
test('all shared client queries serialize saved analysis criteria',()=>{
  const app=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8');
  const start=app.indexOf('function buildBacklogParams()'),end=app.indexOf('\nconst BACKLOG_DATE_INPUT_IDS',start);
  const sandbox={document:{getElementById:()=>({value:''})},backlogGroupBy:['status'],backlogColBy:[],backlogDateLevels:[],backlogBuyerGrupSelected:new Set(),backlogDimFilters:{},backlogDateFilter:{},window:{BLBacklogOverview:{queryFilters:()=>[cp('Sezon',['S7'])]}}};
  vm.runInNewContext(app.slice(start,end),sandbox);
  assert.deepEqual(JSON.parse(sandbox.buildBacklogParams().analysisFilters),[cp('Sezon',['S7'])]);
});
test('historical comparison and activity use the selected Backlog order lines before computing totals',async()=>{
  const source=fs.readFileSync(require.resolve('../server/server.js'),'utf8');
  const start=source.indexOf("app.get('/api/backlog-plan-actual',"),end=source.indexOf("\napp.get(",start+1);
  const orders=[order(),order({ocode:1002,season:'W6'})];
  const snapshots=orders.map(o=>({id:String(o.ocode),orderCode:o.ocode,modelName:o.model,colourCode:o.ccode}));
  let handler,result,compared,history;
  const lineId=(...parts)=>parts.map(String).join('|');
  const sandbox={app:{get:(_path,_guard,fn)=>{handler=fn;}},userAccess:{requireArea:()=>null,filterRowsByScope:(_user,rows)=>rows},assertSourceFilters:()=>{},sourceUserId:()=> 'demo',ensureBacklogPlanActualArchive:async()=>({}),ensureBacklogRuntime:async()=>{},ensureBacklogSourceFields:async()=>{},cacheForUser:()=>({}),effectiveOverridesForUser:()=>overrides,ordersForTarget:()=>orders,antrepoForTarget:()=>({}),buildBacklogTemplateRows:parse.buildBacklogTemplateRows,loadRefreshHistory:()=>({items:[{details:orders.map(o=>({ocode:o.ocode,modelName:o.model,colourCode:o.ccode}))}]}),sendDateSafeJson:(_res,body)=>{result=body;},apiError:(_res,error)=>{throw error;},backlogPlanActual:{lineId,resolveRange:()=>({start:{rows:snapshots},end:{rows:snapshots}}),collapseHistory:items=>{history=items;return {activity:items[0].details};},compareSnapshots:(a,b)=>{compared=[a,b];return {summary:{},changes:a,plan:{rows:b}};},catalogsFromRows:()=>({})}};
  vm.runInNewContext(source.slice(start,end),sandbox);
  await handler({currentUser:{},query:{from:'2026-02-01',to:'2026-03-01',analysisFilters:JSON.stringify([cp('Sezon',['S7'])])}},{});
  assert.equal(compared[0].length,1);assert.equal(compared[1].length,1);
  assert.equal(compared[0][0].orderCode,1001);assert.equal(history[0].details.length,1);
  assert.equal(result.activity.length,1);
});

test('delivery analysis refresh is independent of pivot grouping',()=>{
  const app=fs.readFileSync(require.resolve('../public/app-main.js'),'utf8');
  const start=app.indexOf('function renderBacklog(data)'),end=app.indexOf('function renderBacklogFlatRows',start);
  const body=app.slice(start,end);
  assert.ok(body.indexOf('window.BLBacklogAnalysis?.onBacklogRendered')<body.indexOf('if(!data.tree)'));
});
test('shared filter drawer loads column values without fetching overview rows while collapsed',async()=>{
  const source=fs.readFileSync(require.resolve('../public/backlog-overview.js'),'utf8');
  const start=source.indexOf('async function openFilterPanel()'),end=source.indexOf('\nfunction closeFilterPanel',start);
  let loads=0;const field={id:'cp:Sezon'};
  const sandbox={filterOpen:false,filterRoot:()=>({querySelector:()=>null,classList:{add(){}},hidden:true}),window:{},requestAnimationFrame:fn=>fn(),updateFilterButton(){},renderFilterPanel(){},ensureFilterCatalog:async()=>{},ensureFilterValues:async f=>{assert.equal(f,field);loads++;},overviewFilters:()=>[field],filterEditorId:field.id,refresh:()=>{throw Error('Full row request is unnecessary for filter values');}};
  await vm.runInNewContext(source.slice(start,end)+'\nopenFilterPanel()',sandbox);
  assert.equal(loads,1);
});
