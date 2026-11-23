'use strict';
const parse=require('./parse'),access=require('./compute-access'),horizon=require('./horizon-fields');
const {buildCollectionCatalogs,COLLECTION_CATALOG_SCHEMA_VERSION}=require('./collection-catalog');
const {stringifyWithDates}=require('./json-dates');
const cpRowStored=require('./cp-row-stored');
function apiDate(d){
  if(!(d instanceof Date)||isNaN(d))return null;
  const local=d.getHours()===0&&d.getMinutes()===0&&d.getSeconds()===0&&d.getMilliseconds()===0;
  const utc=d.getUTCHours()===0&&d.getUTCMinutes()===0&&d.getUTCSeconds()===0&&d.getUTCMilliseconds()===0,p=n=>String(n).padStart(2,'0');
  return `${utc&&!local?d.getUTCFullYear():d.getFullYear()}-${p((utc&&!local?d.getUTCMonth():d.getMonth())+1)}-${p(utc&&!local?d.getUTCDate():d.getDate())}`;
}
function projectionDate(d){const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;}
function serialize(value,mode='api'){return stringifyWithDates(value,mode==='projection'?projectionDate:apiDate);}
function rawOrders(source,target){return source.asasOrdersByTarget&&Array.isArray(source.asasOrdersByTarget[target])?source.asasOrdersByTarget[target]:source.asasOrders||[];}
function antrepoFor(source,target){return source.antrepoMapByTarget&&source.antrepoMapByTarget[target]||source.antrepoMap||{};}
function withSourceOverrides(source,data){
  if(!data.mergeSourceOverrides)return data;
  const imported=source.cpupdateOverrides||{},shared=data.overrides||{};
  return {...data,overrides:{...shared,...Object.fromEntries(['submap','suppfobmap','suppfobmetamap'].map(key=>[key,{...(imported[key]||{}),...(shared[key]||{})}]))}};
}
function scopedOrders(source,target,data){
  let rows=parse.applyDateOverrides(rawOrders(source,target),data.overrides);
  const applied=source.modelRefresh?.appliedHorizons;
  const selected=data.preferSourceAppliedHorizons&&applied&&Object.hasOwn(applied,target)?applied[target]||{}:data.horizons?.[target];
  if(selected)rows=horizon.filterRows(rows,selected);
  return data.access?access.filterRows(data.access,rows):rows;
}
function sameRows(a,b){return a===b||(a.length===b.length&&a.every((row,index)=>row===b[index]));}
function buildProjections(source,data){
  // CP satır kaydının base'i paylaşılan belgedeki kayıtlı değerdir (CP-update alt üreticisi katmanı değil).
  const sharedOverrides=data.overrides||{};
  data=withSourceOverrides(source,data);
  const wanted=new Set(data.modules||['cp','orders','overview','order-summary','collection-catalog']),out={},overrides=data.overrides||{};
  const cpSource=scopedOrders(source,'cp',data),ordersSource=scopedOrders(source,'orders',data),cpAntrepo=antrepoFor(source,'cp'),ordersAntrepo=antrepoFor(source,'orders');
  const catalogFromCp=data.catalogSource==='cp-overview';
  const needCp=wanted.has('cp'),needOrders=wanted.has('orders')||(wanted.has('collection-catalog')&&!data.catalogRows&&!catalogFromCp);
  const allowed=data.cpAllowed!==false,summaryAllowed=data.summaryAllowed!==false;
  const pair=allowed&&needCp&&needOrders&&cpAntrepo===ordersAntrepo&&sameRows(cpSource,ordersSource)
    ?parse.buildSharedOrderProjectionRowsFromASAS(ordersSource,ordersAntrepo,overrides)
    :{cp:allowed&&needCp?parse.buildCPRowsFromASAS(cpSource,cpAntrepo,overrides):[],orders:allowed&&needOrders?parse.buildOrdersRowsFromASAS(ordersSource,ordersAntrepo,overrides):[]};
  const editable=new Map(),canEdit=row=>{const code=row&&row['Order Code'],key=String(code??'');if(!editable.has(key))editable.set(key,data.access?access.canEditCode(data.access,code):true);return editable.get(key);};
  pair.cp.forEach(row=>{row._canEdit=canEdit(row);});pair.orders.forEach(row=>{row._canEdit=false;});
  cpRowStored.attachCpRowStored(pair.cp,sharedOverrides);
  if(needCp)out.cp={rows:data.sharedHints&&data.access?access.sharedRows(data.access,pair.cp):pair.cp,cpModelColumns:data.cpModelColumns||[]};
  if(wanted.has('orders'))out.orders={rows:pair.orders};
  let overview=[];
  if(summaryAllowed&&(wanted.has('overview')||(wanted.has('collection-catalog')&&(catalogFromCp||!(data.catalogRows||pair.orders).length))))overview=parse.buildOverviewSummaryRowsFromASAS(cpSource,overrides);
  if(wanted.has('overview'))out.overview={rows:overview};
  if(wanted.has('order-summary')){const rows=summaryAllowed?parse.buildOrderSummaryRowsFromASAS(cpSource,cpAntrepo,overrides):[];rows.forEach(row=>{row._canEdit=canEdit(row);});out['order-summary']={rows};}
  if(wanted.has('collection-catalog')){const rows=catalogFromCp?overview:data.catalogRows||pair.orders;out['collection-catalog']={catalogs:allowed?buildCollectionCatalogs(rows.length?rows:overview):{},catalogSchemaVersion:COLLECTION_CATALOG_SCHEMA_VERSION};}
  return out;
}
/* #1079 WS6c — Backlog satır belleği (işçi başına, tek giriş, kısa ömür).
   Backlog okuma modeli 'v3-items' (Genel Bakış) ve 'delivery-items' (Teslimat Riski), drill-down
   'rows' (tıklanan siparişlerin tam satırları) ve geri dönüş yolundaki 'export' aynı
   sorgu için aynı şablon satırlarını üretir; havuz Backlog işlerini aynı işçide sırayla
   çalıştırır (30k: sorgu hazırlığı + satırlar ~3,1 sn). Sonraki görev satırları
   yeniden kullanır. Anahtar, istemcinin satır yeniden kullanımıyla aynı kimliktir
   (sourceRevision: kaynak nesli + kullanıcı bağlamı/yetki/ufuk + ortak override
   revizyonları + takvim + gün; computeParamsFor) + işçideki kaynak nesnesi + yetki
   hash'i + sorgu. Önizleme, kaynak ayrıntısı ve harita projeksiyonu belleğe girmez.
   Satırlar salt okunur kullanılır. Son kullanımdan 20 sn sonra, en geç 120 sn'de bırakılır. */
const ROWS_MEMO_TTL_MS=20000,ROWS_MEMO_MAX_MS=120000;
const memoSources=new WeakMap();let memoSourceSeq=0,rowsMemo=null;
function memoSourceId(source){let id=memoSources.get(source);if(!id){id=++memoSourceSeq;memoSources.set(source,id);}return id;}
function clearRowsMemo(){if(rowsMemo&&rowsMemo.timer)clearTimeout(rowsMemo.timer);rowsMemo=null;}
// Süre dolunca bırakılan satırlar (30k'da ~50 MB) boştaki işçide hemen toplanır (idle-gc).
function releaseRowsMemo(){const had=!!rowsMemo;clearRowsMemo();if(had)require('./idle-gc').collectGarbage();}
function rowsMemoKey(source,data){
  if(!source||typeof source!=='object'||!data.sourceRevision||(data.previewLimit||0)>0||data.includeSourceDetails||data.mapProjection)return null;
  return JSON.stringify([memoSourceId(source),data.sourceRevision,data.access?data.access.accessHash||null:null,data.target||'backlog',data.options||{},data.sourceColumns||[],!!data.mergeSourceOverrides,!!data.preferSourceAppliedHorizons]);
}
function armRowsMemo(memo){
  if(memo.timer)clearTimeout(memo.timer);
  const timer=setTimeout(releaseRowsMemo,Math.max(0,Math.min(ROWS_MEMO_TTL_MS,memo.createdAt+ROWS_MEMO_MAX_MS-Date.now())));timer.unref?.();
  memo.timer=timer;
}
function takeRowsMemo(key){
  if(!rowsMemo||rowsMemo.key!==key)return null;
  if(Date.now()-rowsMemo.createdAt>=ROWS_MEMO_MAX_MS){clearRowsMemo();return null;}
  armRowsMemo(rowsMemo);
  return rowsMemo;
}
function keepRowsMemo(key,value){
  clearRowsMemo();
  rowsMemo={key,...value,createdAt:Date.now(),timer:null};armRowsMemo(rowsMemo);
}
function backlogRowsResult(kind,data,rows,columns,customDimensions,mapDetails){
  // Teslimat Riski drill-down: okuma modelinin seçtiği satır sıraları, export ile aynı tam satırlar.
  if(kind==='rows'){
    const indices=Array.isArray(data.rowIndices)?data.rowIndices:[];
    return {rows:indices.map(index=>Number.isInteger(index)&&index>=0&&index<rows.length?rows[index]:null).filter(Boolean),totalRows:rows.length};
  }
  // Backlog V3 Genel Bakış okuma modeli (#1079 WS6c): aynı satırlar, işçide V3 kaydına çevrilir.
  if(kind==='v3-items')return require('./read-model/backlog-v3-items').build(rows,data,apiDate);
  if(kind==='delivery-items')return require('./read-model/backlog-v3-items').buildDelivery(rows,data,apiDate);
  const mapRows=data.mapProjection?require('../../public/overview-global-flow').projectBacklogMapRows(rows):rows;
  return {headers:[...data.headers,...columns.map(column=>column.label)],rows:mapRows,totalRows:rows.totalRows||rows.length,sourceColumns:data.mapProjection?[]:columns,sourceCatalog:data.mapProjection?[]:customDimensions,rowsRevision:data.rowsRevision,merchCalendar:data.calendar,...(data.mapProjection||mapDetails?{sourceRevision:data.sourceRevision}:{})};
}
function buildBacklog(kind,source,data){
  data=withSourceOverrides(source,data);
  const options=data.options||{},overrides=data.overrides||{},target=data.target||'backlog';
  let orders=kind==='source-columns'?(data.access?access.filterRows(data.access,parse.applyDateOverrides(rawOrders(source,target),overrides)):parse.applyDateOverrides(rawOrders(source,target),overrides)):scopedOrders(source,target,data);
  const antrepo=antrepoFor(source,target),mapDetails=kind==='map-details';
  if(mapDetails){
    if(!data.expectedSourceRevision||data.expectedSourceRevision!==data.sourceRevision)throw Object.assign(Error('Source generation changed'),{code:'COMPUTE_STALE_GENERATION',statusCode:409});
    const wanted=new Set((data.selector?.identities||[]).map(item=>parse.orderLineKey(item?.orderCode,item?.modelName,item?.colourCode)));
    orders=orders.filter(row=>wanted.has(parse.orderLineKeyOf(row)));kind='export';
  }
  if(kind==='detail')return {headers:data.headers,rows:parse.buildBacklogDetailRows(orders,antrepo,overrides,data.selector,{includeInternalMeta:true})};
  const memoKey=!mapDetails&&['export','v3-items','delivery-items','rows'].includes(kind)?rowsMemoKey(source,data):null;
  const memo=memoKey?takeRowsMemo(memoKey):null;
  if(memo)return backlogRowsResult(kind,data,memo.rows,memo.columns,memo.customDimensions,false);
  const custom=parse.backlogCustomDimensionContext(orders,antrepo);
  if(kind==='source-columns')return {columns:custom.customDimensions,defaultHeaders:data.headers};
  const query=parse.prepareBacklogQuery(orders,antrepo,overrides,options,custom,kind==='grouped'&&(!options.lazyDimensions||options.valueDimensions?.length>0));
  if(kind==='grouped')return {...parse.buildBacklogGrouped(orders,antrepo,overrides,options,query),rowsInputRevision:data.sourceRevision,...(data.pageCache?{pageCache:data.pageCache}:{})};
  if(kind==='filter-values'){
    const id=String(data.field||'');
    if(!data.headers.some(header=>'cp:'+header===id)&&!custom.customDimensions.some(column=>column.id===id))throw Object.assign(Error('Unknown Backlog filter field'),{code:'BACKLOG_FILTER_FIELD_INVALID',statusCode:400});
    return {...parse.buildBacklogFilterValues(orders,antrepo,overrides,options,id,query),rowsInputRevision:data.sourceRevision};
  }
  if(!['export','v3-items','delivery-items','rows'].includes(kind))throw Error('Unknown Backlog computation');
  const byId=new Map(custom.customDimensions.map(column=>[column.id,column])),columns=(data.sourceColumns||[]).map(id=>byId.get(id)).filter(Boolean);
  const rows=parse.buildBacklogTemplateRows(orders,antrepo,overrides,options,columns,{limit:data.previewLimit||0,includeSourceDetails:Boolean(data.includeSourceDetails)&&!data.mapProjection,queryContext:query});
  if(memoKey)keepRowsMemo(memoKey,{rows,columns,customDimensions:custom.customDimensions});
  return backlogRowsResult(kind,data,rows,columns,custom.customDimensions,mapDetails);
}
module.exports={buildProjections,buildBacklog,serialize,scopedOrders,antrepoFor,withSourceOverrides,_clearRowsMemo:clearRowsMemo};
