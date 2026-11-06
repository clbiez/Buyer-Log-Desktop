'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const parse=require('../server/lib/parse'),catalog=require('../server/lib/collection-catalog');
const access=require('../server/lib/compute-access'),tasks=require('../server/lib/compute-tasks');
const {stringifyWithDates}=require('../server/lib/json-dates');
function fixture(){
  const rows=Array.from({length:18},(_,i)=>({ocode:100+i,model:'Demo '+i,ccode:'R',colour:'Red',buyer:i%2?'Buyer A':'Buyer B',merch:'M',ageGroup:'A',buyerGrup:'G',license:'',manufacturer:'Demo',season:'W7',countryRaw:'TURKIYE',qty:10+i,kalan:5+i,fob:5,ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_sourceFields:{'Synthetic Column':'Value '+i}}));
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};
}
function context(source,all=false){return access.createAccessContext({userId:'a',systemRole:all?'moderator':'buyer',manageAll:all,viewScope:{all,mode:all?'ALL':'CUSTOM',buyers:['Buyer A']},editScopes:{buyers:['Buyer A']},authority:Object.fromEntries(source.asasOrders.map(row=>[row.ocode,[row]])),profiles:[{id:'a',username:'Buyer A'}]});}
test('common worker builders preserve every projection and edit hint with full and restricted authority',()=>{
  for(const all of [true,false]){
    const source=fixture(),ctx=context(source,all),overrides={},data={access:ctx,overrides,horizons:{},cpModelColumns:[{id:'demo'}],cpAllowed:true,summaryAllowed:true};
    const scoped=access.filterRows(ctx,source.asasOrders),pair=parse.buildSharedOrderProjectionRowsFromASAS(scoped,{},overrides);
    pair.cp.forEach(row=>row._canEdit=access.canEditCode(ctx,row['Order Code']));pair.orders.forEach(row=>row._canEdit=false);
    const summary=parse.buildOrderSummaryRowsFromASAS(scoped,{},overrides);summary.forEach(row=>row._canEdit=access.canEditCode(ctx,row['Order Code']));
    const overview=parse.buildOverviewSummaryRowsFromASAS(scoped,overrides);
    assert.deepEqual(tasks.buildProjections(source,data),{cp:{rows:pair.cp,cpModelColumns:data.cpModelColumns},orders:{rows:pair.orders},overview:{rows:overview},'order-summary':{rows:summary},'collection-catalog':{catalogs:catalog.buildCollectionCatalogs(pair.orders.length?pair.orders:overview),catalogSchemaVersion:catalog.COLLECTION_CATALOG_SCHEMA_VERSION}});
    assert.deepEqual(tasks.buildProjections(source,{...data,modules:['cp'],sharedHints:true}).cp.rows,access.sharedRows(ctx,pair.cp));
  }
});
test('target horizons and date overrides are applied before authorization without changing source records',()=>{
  const source=fixture(),before=structuredClone(source),ctx=context(source,true),overrides={datemap:{}};
  const data={access:ctx,overrides,horizons:{cp:{seasons:['NONEXISTENT']}},cpAllowed:true,summaryAllowed:true,modules:['cp']};
  const horizon=require('../server/lib/horizon-fields');
  const expected=parse.buildCPRowsFromASAS(access.filterRows(ctx,horizon.filterRows(parse.applyDateOverrides(source.asasOrders,overrides),data.horizons.cp)),{},overrides);
  expected.forEach(row=>row._canEdit=true);assert.equal(expected.length,0);assert.deepEqual(tasks.buildProjections(source,data).cp.rows,expected);assert.deepEqual(source,before);
});
test('Backlog export, filters, source catalog, grouped and detail use the exact current parser contracts',()=>{
  const source=fixture(),ctx=context(source,false),base={access:ctx,overrides:{},horizons:{},headers:['Demo'],sourceRevision:'rev',rowsRevision:'rows',calendar:{configured:false}},orders=access.filterRows(ctx,source.asasOrders);
  const custom=parse.backlogCustomDimensionContext(orders,{});
  for(const includeSourceDetails of [false,true])for(const previewLimit of [0,3]){
    const params={...base,options:{},includeSourceDetails,previewLimit,sourceColumns:[]};
    const query=parse.prepareBacklogQuery(orders,{}, {},{},custom,false),rows=parse.buildBacklogTemplateRows(orders,{}, {},{},[],{limit:previewLimit,includeSourceDetails,queryContext:query});
    const actual=tasks.buildBacklog('export',source,params);
    assert.deepEqual(actual.rows,rows);assert.equal(actual.totalRows,rows.totalRows||rows.length);assert.deepEqual(actual.sourceCatalog,custom.customDimensions);
  }
  assert.deepEqual(tasks.buildBacklog('source-columns',source,base),{columns:custom.customDimensions,defaultHeaders:base.headers});
  const query=parse.prepareBacklogQuery(orders,{}, {},{},custom,true);
  assert.deepEqual(tasks.buildBacklog('grouped',source,{...base,options:{}}),{...parse.buildBacklogGrouped(orders,{}, {},{},query),rowsInputRevision:'rev'});
  const selector={identities:[{orderCode:orders[0].ocode,modelName:orders[0].model,colourCode:orders[0].ccode}]};
  assert.deepEqual(tasks.buildBacklog('detail',source,{...base,selector,target:'cp'}),{headers:base.headers,rows:parse.buildBacklogDetailRows(orders,{}, {},selector,{includeInternalMeta:true})});
});
test('worker serialization preserves separate API and historical projection date behavior',()=>{
  const value={local:new Date(2026,5,1),utc:new Date('2026-06-01T00:00:00.000Z'),invalid:new Date(NaN),text:'2026-06-01T00:00:00.000Z'};
  function legacyApi(d){if(!(d instanceof Date)||isNaN(d))return null;const local=d.getHours()===0&&d.getMinutes()===0&&d.getSeconds()===0&&d.getMilliseconds()===0,utc=d.getUTCHours()===0&&d.getUTCMinutes()===0&&d.getUTCSeconds()===0&&d.getUTCMilliseconds()===0,p=n=>String(n).padStart(2,'0');return `${utc&&!local?d.getUTCFullYear():d.getFullYear()}-${p((utc&&!local?d.getUTCMonth():d.getMonth())+1)}-${p(utc&&!local?d.getUTCDate():d.getDate())}`;}
  function legacyProjection(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}
  assert.equal(tasks.serialize(value,'api'),stringifyWithDates(value,legacyApi));assert.equal(tasks.serialize(value,'projection'),stringifyWithDates(value,legacyProjection));assert.ok(value.local instanceof Date);
});
test('cold worker uses the selected owner snapshot CP-update overrides beneath shared manual overrides',()=>{
  const source=fixture();source.cpupdateOverrides={submap:{100:'Imported supplier'},suppfobmap:{100:2},suppfobmetamap:{100:{source:'import'}}};
  const data={access:context(source,true),horizons:{},overrides:{submap:{100:'Manual supplier'}},modules:['cp'],mergeSourceOverrides:true};
  const effective={...data.overrides,submap:{...source.cpupdateOverrides.submap,...data.overrides.submap},suppfobmap:source.cpupdateOverrides.suppfobmap,suppfobmetamap:source.cpupdateOverrides.suppfobmetamap};
  const expected=parse.buildCPRowsFromASAS(source.asasOrders,{},effective);expected.forEach(row=>row._canEdit=true);
  assert.deepEqual(tasks.buildProjections(source,data).cp.rows,expected);
});
test('snapshot applied horizon takes precedence over newly edited preferences until source refresh',()=>{
  const source=fixture();source.modelRefresh={appliedHorizons:{cp:{seasons:['NONEXISTENT']}}};
  const data={access:context(source,true),horizons:{cp:{}},overrides:{},modules:['cp'],preferSourceAppliedHorizons:true};
  assert.equal(tasks.buildProjections(source,data).cp.rows.length,0);
});
test('source-column catalog preserves its full authorized source universe independently of view Horizon',()=>{
  const source=fixture(),data={access:context(source,true),overrides:{},horizons:{backlog:{seasons:['NONEXISTENT']}},headers:[]};
  const expected=parse.backlogCustomDimensionContext(source.asasOrders,{}).customDimensions;assert.ok(expected.length>0);
  assert.deepEqual(tasks.buildBacklog('source-columns',source,data).columns,expected);
});
module.exports={fixture,context};
