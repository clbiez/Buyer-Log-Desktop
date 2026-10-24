'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {extractFunction,loadAppMainFunctions}=require('./helpers/app-main-functions');
const canonical=require('../public/canonical-fields');
const parse=require('../server/lib/parse');
const flow=require('../public/overview-global-flow');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');
const clean=value=>String(value==null?'':value).replace(/\s+/g,' ').trim();
function drawer(moduleId='cp'){
  const names=['hasValue','rowSources','fieldRefs','detailModule','lookupValue','rawValueOf','columnSchema','valueOf','excelValueOf','fallbackDateText','textValue'];
  const ctx=vm.createContext({root:{BLCanonicalFields:canonical},active:{moduleId,rows:[]},columnSchemaCache:new WeakMap(),clean,isEn:()=>true,Date});
  vm.runInContext(names.map(name=>extractFunction(read('detail-drawer.js'),name)).join('\n'),ctx);
  return ctx;
}
function detailRows(records){
  const ctx=vm.createContext({window:{BLCanonicalFields:canonical},modeLabel:v=>v,actionPriorityCode:flow.actionPriorityCode});
  vm.runInContext(extractFunction(read('overview-global-flow.js'),'cpDetailRows'),ctx);
  return ctx.cpDetailRows(records);
}
function snapshot(keys){
  const columns=keys.map(key=>({k:key,type:'ro'}));
  return loadAppMainFunctions(['detailTableViewSnapshot'],{
    window:{},tableViewAllKeys:()=>keys,colmgr:{cp:{order:keys,hidden:new Set()}},COLS_BY_TABLE:{cp:columns},
    normalizedColumnOrder:(_t,order)=>order,tableColumnLabel:(_t,c)=>c.k,tableColumnGroupLabel:v=>v,
    colWidthPx:()=>100,tableViewPresetState:()=> 'all',tableViewEffectiveKeys:()=>keys,
    cellPlainText:(col,row)=>row[col.k],
  }).detailTableViewSnapshot('cp');
}
const d=value=>new Date(value+'T00:00:00');
const order={ocode:1234567,plm:700001,model:'DEMO MODEL',ccode:'01',colour:'BLUE',season:'W26',countryRaw:'INDIA',buyer:'DEMO BUYER',buyerGrup:'DEMO GROUP',manufacturer:'DEMO SUPPLIER',licensor:'DTR',license:'DEMO',category:'KNIT',qty:1000,kalan:600,antrepo:0,merkezSevkeHazirKalan:0,fob:12.5,opd:d('2026-07-01'),ex:d('2026-10-30'),retail:d('2026-12-01'),mb:d('2026-12-15')};
const overrides={submap:{},delmap:{},suppfobmap:{},notesmap:{},licensormap:{},transitRules:[],pricingRules:[]};

test('Backlog opt-in details carry their own source projection through JSON, without CP operational aggregates',()=>{
  const normal=parse.buildBacklogTemplateRows([order],{},overrides,{});
  assert.equal(normal[0]._detailSource,undefined,'normal Excel/report payload stays small');
  const rows=JSON.parse(JSON.stringify(parse.buildBacklogTemplateRows([order],{},overrides,{},[],{includeSourceDetails:true})));
  assert.ok(rows[0]._detailSource);
  assert.equal(rows[0]._detailSource['Supp. FOB'],12.5);
  assert.ok(Object.keys(rows[0]._detailSource).every(key=>!key.startsWith('_')));
  const [rec]=flow.shipmentPartialsFromRows(rows,'backlog');
  const [detail]=detailRows([rec]);
  const keys=['FOB ($)','Supp. FOB','Order Quantity','Licensor','OPD','Retail Date','In-Store (Model Budget)','PLM ID'];
  const columns=snapshot(keys).columns,reader=drawer();
  // The fixture starts at local midnight. Assert its exact JSON instant rather
  // than assuming the test host runs in UTC, then verify calendar-day fidelity.
  const dates={OPD:'2026-07-01','Retail Date':'2026-12-01','In-Store (Model Budget)':'2026-12-15'};
  const expected=[12.5,12.5,1000,'DTR',d(dates.OPD).toISOString(),d(dates['Retail Date']).toISOString(),d(dates['In-Store (Model Budget)']).toISOString(),'700001'];
  columns.forEach((col,i)=>{
    assert.equal(String(reader.valueOf(col,detail)),String(expected[i]),col.key+' screen');
    assert.equal(String(reader.excelValueOf(col,detail)),String(expected[i]),col.key+' Excel');
    if(dates[col.key]) {
      const restored=parse.parseDateOnly(reader.excelValueOf(col,detail));
      assert.ok(restored instanceof Date);
      assert.equal(restored.getFullYear(),Number(dates[col.key].slice(0,4)),col.key+' calendar year');
      assert.equal(restored.getMonth()+1,Number(dates[col.key].slice(5,7)),col.key+' calendar month');
      assert.equal(restored.getDate(),Number(dates[col.key].slice(8,10)),col.key+' calendar day');
    }
  });
});

test('CP catalog formatters use canonical/nested resolved values instead of rereading an absent source key',()=>{
  const reader=drawer(),col=snapshot(['FOB ($)']).columns[0];
  const row={raw:{'FOB Fiyatı':9.75}};
  assert.equal(reader.valueOf(col,row),9.75);
  assert.equal(reader.excelValueOf(col,row),9.75);
  assert.equal(reader.valueOf(col,{'FOB ($)':null}), '');
  assert.equal(reader.valueOf(col,{'FOB ($)':0}),0);
});

test('completed Backlog orders retain source details even when excluded from active CP',()=>{
  const completed={...order,kalan:0};
  const key=parse.orderLineKey(completed.ocode,completed.model,completed.ccode);
  const warehouse={[key]:{ocode:completed.ocode,model:completed.model,ccode:completed.ccode,statu:'Depoda',arr:d('2026-10-20'),handover:d('2026-10-01'),vasita:'Gemi',loadedQty:1000,_sourceRow:1}};
  assert.equal(parse.buildCPRowsFromASAS([completed],warehouse,overrides).length,0);
  const rows=parse.buildBacklogTemplateRows([completed],warehouse,overrides,{},[],{includeSourceDetails:true});
  assert.ok(rows.length);
  for(const row of rows){
    assert.equal(row._detailSource.Licensor,'DTR');
    assert.equal(row._detailSource['Supp. FOB'],12.5);
    assert.equal(row._detailSource['Order Quantity'],1000);
  }
});

test('partial status, quantity and deliberately empty dates override the parent in screen and export',()=>{
  const source={'Order Code':'DEMO-1','Order Quantity':1000,'STATUS':'Depoda','HANDOVER Tarihi':'2026-10-01','Ant. Arrival':'2026-10-20',_logisticSegments:[{quantity:400,status:'Depoda'}]};
  const [detail]=detailRows([{source:'cp',raw:source,orderCode:'DEMO-1',status:'Üretimde',qty:600,handover:'',eta:'',mode:'sea'}]);
  assert.deepEqual(Array.from(detail._logisticSegments||[]),[]);
  const reader=drawer();
  for(const col of snapshot(['STATUS','Shipment Quantity','HANDOVER Tarihi','Ant. Arrival']).columns){
    const expected=({'STATUS':'Üretimde','Shipment Quantity':600,'HANDOVER Tarihi':'','Ant. Arrival':''})[col.key];
    assert.equal(reader.valueOf(col,detail),expected,col.key);
    assert.equal(reader.excelValueOf(col,detail),expected,col.key+' Excel');
  }
  assert.equal(source._logisticSegments.length,1,'source is not mutated');
  assert.equal(detailRows([{source:'backlog',raw:{},priority:'VAR',actionPriority:''}])[0].Priority,'','Backlog risk is not Unified Action Priority');
});

test('shared report readers respect explicit empty, zero and false values from column accessors',()=>{
  const reader=drawer();
  for(const value of ['',null,0,false]){
    const col={key:'FOB',value:()=>value};
    assert.equal(reader.rawValueOf(col,{raw:{FOB:88}}),value);
  }
  assert.equal(reader.rawValueOf({key:'FOB',value:()=>undefined},{raw:{FOB:88}}),88);
});

test('translated labels and parenthesized descriptions cannot alias unrelated fields',()=>{
  const reader=drawer(),row={'PLM ID':'990001',PLM:'990001',FOB:88};
  assert.equal(reader.rawValueOf({key:'Fabric (PLM)',label:'Fabric (PLM)'},row),undefined);
  assert.equal(reader.rawValueOf({key:'unregistered',label:'FOB'},row),undefined);
  assert.equal(reader.rawValueOf({key:'FOB ($)',label:'Localized price'},row),88);
});

test('all report wrappers resolve nested source fields, cycle-safely and with outer canonical values first',()=>{
  const reader=drawer('orders');
  for(const wrapper of ['row','raw','source','data','_source','sourceRow']){
    const row={fob:0,[wrapper]:{raw:{'FOB ($)':99,Licensor:'DEMO'}}};
    row[wrapper].data=row;
    assert.equal(reader.rawValueOf({key:'FOB ($)'},row),0,wrapper+' precedence');
    assert.equal(reader.rawValueOf({key:'Licensor'},row),'DEMO',wrapper+' recursion');
  }
});

test('Collection analytics details materialize inherited fields and preserve colour overrides',()=>{
  const groups=require('../public/collection-model-groups');
  let rows=groups.normalizeRows([
    {id:1,plmId:'100',modelKod:'DEMO',inStoreMonth:'2026-10',colour:'BLUE',colourCode:'01',buyer:'PARENT',season:'W26'},
    {id:2,plmId:'100',modelKod:'DEMO',inStoreMonth:'2026-10',colour:'RED',colourCode:'02',buyer:'',season:''},
  ]).rows;
  const child=rows.find(row=>row.modelGroupRole==='variant');
  rows=groups.setSharedValue(rows,child.modelGroupId,'buyer','INHERITED BUYER');
  rows=groups.setSharedValue(rows,child.modelGroupId,'season','W27');
  rows=groups.setVariantOverride(rows,child.id,'season','S27');
  const selected=rows.find(row=>row.id===child.id),before=JSON.stringify(selected);
  let options;
  const ctx={window:{BLDetailDrawer:{open:value=>{options=value;}}},appLang:'en',
    kolColDefs:()=>['buyer','season','plmId','modelKod','colourCode','colour'].map(k=>({k})),
    kolEffectiveValue:(row,key)=>groups.effectiveValue(row,key,rows)};
  vm.createContext(ctx);
  vm.runInContext(extractFunction(read('app-main.js'),'kolEffectiveProjection'),ctx);
  const src=read('app-main.js'),start=src.indexOf('window.BLCollectionAnalyticsBridge={'),end=src.indexOf('\n};',start)+3;
  vm.runInContext(src.slice(start,end),ctx);
  ctx.window.BLCollectionAnalyticsBridge.openDrilldown([selected],'DEMO');
  assert.equal(options.rows[0].buyer,'INHERITED BUYER');
  assert.equal(options.rows[0].season,'S27');
  assert.equal(options.rows[0].colourCode,'02');
  assert.equal(JSON.stringify(selected),before);
});
