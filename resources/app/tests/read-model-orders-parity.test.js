'use strict';
/* WS3 (#1076) parite kapısı: pencereli Siparişler yolu, eski istemci yoluyla aynı
 * sonucu vermelidir.
 *
 * İstemci tarafı: app-main.js'teki GERÇEK fonksiyonlar stub'sız vm'de çalışır.
 *   ordersBuildFilterContext / ordersRowPasses / filteredOrders (satır sırası + toplam)
 *   ordersEvaluateAll + ordersScopeCounts (hızlı filtre çip sayaçları)
 *   pageModelOptionStats (sayım satırı)
 *   uniqueColValues / uniqueDateBuckets (sütun paneli)
 *   ordersReadModelSpec (filtre durumu → sunucu sorgusu çevirisi)
 * Sunucu tarafı: işçinin gördüğü JSON projeksiyonu üzerinde query-engine.executeQuery
 * ve orders-facets.runOrdersFacets.
 * Fixture: WS0 demo verisi (tests/helpers/read-model-parity.cjs) → sunucu
 * ayrıştırıcısı (parseASASRows / parseAntrepoRows) → buildProjections('orders').
 * Lojistik çok değerli STATUS, Active/Inactive ve Del. Type çeşitliliği gerçektir.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const parity=require('./helpers/read-model-parity.cjs');
const parse=require('../server/lib/parse');
const tasks=require('../server/lib/compute-tasks');
const engine=require('../server/lib/read-model/query-engine');
const facets=require('../server/lib/read-model/orders-facets');
const rules=require('../public/business-rules'),schema=require('../public/column-schema'),dates=require('../public/date-dimension');
const rowGroups=require('../public/table-search-row-groups'),fields=require('../server/lib/canonical-fields');
const optionStats=require('../public/model-option-stats');

const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
function extractConst(name){
  const match=new RegExp(`^(?:const|let|var) ${name}\\s*=`,'m').exec(SOURCE);
  if(!match)throw new Error(`app-main.js içinde ${name} bulunamadı`);
  let i=match.index+match[0].length,depth=0,quote=null;
  for(;i<SOURCE.length;i++){
    const ch=SOURCE[i];
    if(quote){if(ch==='\\'){i++;continue;}if(ch===quote)quote=null;continue;}
    if(ch==='"'||ch==="'"||ch==='`'){quote=ch;continue;}
    if(ch==='{'||ch==='['||ch==='(')depth++;
    else if(ch==='}'||ch===']'||ch===')')depth--;
    else if((ch===';'||ch==='\n')&&depth===0)break;
  }
  return SOURCE.slice(match.index,i)+';';
}
const CONSTS=['ISO_DAY_CACHE_MAX','_isoDayCache','_nfIntTR','_colIndexCache','_preparedColFilterCache','_preparedFabricFilterCache','CP_FABRIC_PLM_KEY',
  'CP_BASE_SEARCH_KEYS','CP_CANONICAL_SEARCH_FIELDS','CP_SEARCH_KEYS','CP_COLS','ORDERS_STATUS_COL','ORDERS_COLS','CP_MIRROR_GROUPS','ORDERS_MIRROR_GROUPS',
  'ORDERS_MIRROR_IDS','ORDERS_MIRROR_COLS','CP_DIM_META','ORDERS_DIM_META','REVISION_FILTER_MODES','_quickExfBounds','partialViewState','ORDERS_EXF_QUICK_KEYS',
  'ORDERS_RM_CLIENT_DERIVED_KEYS','ORDERS_RM_CLIENT_TYPES','ORDERS_RM_LOGISTIC_KEYS','ordersRMNumber','_facetCacheByRows','FACET_CACHE_MAX_ENTRIES'];
const FUNCTIONS=['norm','toNum','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','fmtDate','nfIntTR','nfMoneyTR',
  'fmtMoneyPlain','fmtInt','fmtOC','fmtPct','normalizeDecimalText','numericFilterValue','numericFilterRulePasses','cellPlainText','columnByKey',
  'prepareColFilter','prepareColFilters','buildPreparedColFilter','preparedColFilterPasses','preparedFiltersPass','isCpFabricFilterKey','dateBucketKey',
  'comparableColumnFilterValue','normalizeTransitDelType','sortRows','columnSchemaFor','parseTableSearchTerms','tableSearchMatches','cpSearchHaystack',
  'cpCanonicalSearchKeys','cpLogisticSegments','cpLogisticHasDetails','revisionFilterMode','revisionFilterPasses','colFilterHasValueTest','matchesQuickExFactory',
  'quickExFactoryBounds','toDateOnly','mondayOf','addDays','isProductionStatus','normalizeCheckFilterMode','migrateLegacyOrdersQuickFilters',
  'ordersBuildFilterContext','ordersPassesBase','ordersPassesGroup','ordersRowPasses','ordersEvaluateAll','filteredOrders','partialViewEnabled',
  'ordersScopeCounts','pageModelOptionStats','uniqueColValues','uniqueDateBuckets','rowsForFilterUniverse','facetCacheValue','uniqueVals','isDateColumnDefinition',
  'ordersReadModelSpec','ordersRMColFilter','ordersRMClientOnlyKey','ordersRMColumns','ordersColumnsFromCp',
  // Alt toplam satırı (renderQuantityTotalsFooter'ın hesap parçaları).
  'tableNumericValue','kolWeightedAverage','kolArithmeticAverage','kolParseMoneyNum','tableVisibleSelectedCount','selectionHasId','selectionIdKey','isQuantityLikeColumn','cpOrdersAverageFooterCols'];

function loadClient(){
  const code=[...CONSTS.map(name=>name==='ORDERS_COLS'||name==='ORDERS_STATUS_COL'?null:extractConst(name)).filter(Boolean),
    ...FUNCTIONS.map(name=>extractFunction(SOURCE,name)),extractConst('ORDERS_STATUS_COL'),extractConst('ORDERS_COLS')].join('\n');
  const elements=new Map();
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{value:''});return elements.get(id);}};
  const state={colFilters:{orders:{}},checkFilter:{orders:''},ordersSelected:new Set(),ordersQuickActive:new Set(),ordersSort:{key:null,dir:1},ordersLogisticExpanded:new Set(),orders:null,ordersQuickExf:''};
  const window={BLColumnSchema:schema,BLDateDimension:dates,BLCanonicalFields:fields,BLModelOptionStats:optionStats,BLQuickFilterGroups:{config:()=>({hidden:[],extra:[]})},
    BLCollectionModelGroups:require('../public/collection-model-groups')};
  const context=vm.createContext({window,document,state,BLBusinessRules:rules,BLRevision:{revisedDateKeys:()=>[]},Intl,Date,Map,Set,WeakMap,Array,Object,String,Number,Math,JSON,RegExp,isNaN});
  vm.runInContext(`${code}
    let ordersDimFilters={};const GENERIC_TABLE_SOURCES={};const COLS_BY_TABLE={cp:CP_COLS,orders:ORDERS_COLS};
    function partialViewRows(tableKey,rows){return rows;}function partialViewStatusGroups(){return [];}
    function ordersRMMaterializedRows(){return null;}function ordersRMWindowedActive(){return false;}function ordersRMColumnFacet(){return null;}
    function actionPriorityCode(v){return v;}function priorityRank(){return 0;}function readPrivateOrderNote(){return '';}
    function kolFabricCardsEnsureLoaded(){}function L(v){return v;}
    globalThis.__setDims=value=>{ordersDimFilters=value;};
    globalThis.__client={${FUNCTIONS.join(',')},ORDERS_COLS};`,context,{filename:'app-main.js (orders parite)'});
  context.BLTableSearch={parseTerms:context.parseTableSearchTerms,matches:context.tableSearchMatches};
  rowGroups.install(context);
  window.BLTableSearch=context.BLTableSearch;
  return {api:context.__client,context,state,elements,setDims:context.__setDims};
}

const TODAY=(()=>{const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})();
// CI 2k satır; 30k parite koşusu: BL_ORDERS_PARITY_ROWS=30000 npm test -- read-model-orders-parity
const PARITY_ROWS=Math.max(500,Number(process.env.BL_ORDERS_PARITY_ROWS)||2000);
function projection(rows=PARITY_ROWS){
  // Demo verisinin "bugün"ü gerçek gün: Ex-factory dönem sayaçları boş kalmasın.
  const fx=parity.makeFixture({rows,today:TODAY});
  const asas=parse.parseASASRows(fx.asas),antrepo=parse.parseAntrepoRows(fx.antrepo);
  const orders=asas.orders;
  const built=tasks.buildProjections({loadedAt:'r1',asasOrders:orders,asasOrdersByTarget:{orders},antrepoMap:antrepo,lflRows:[]},{modules:['orders'],overrides:{},horizons:{}});
  return JSON.parse(tasks.serialize(built.orders.rows,'projection'));
}
function clientRowsFrom(serverRows,client){
  // Tarayıcıdaki ensureOrdersLoaded: reviveServerDates (CP_DATE_KEYS → Date) + _canEdit=false.
  const rows=JSON.parse(JSON.stringify(serverRows));
  const keys=require('../public/read-model-query').DATE_KEYS;
  rows.forEach(row=>{keys.forEach(key=>{if(key in row)row[key]=client.api.coerceDateLoose(row[key]);});row._canEdit=false;});
  return rows;
}
function applyScenario(client,s){
  const {state,elements}=client;
  state.colFilters.orders=Object.fromEntries(Object.entries(s.colFilters||{}).map(([key,entry])=>[key,{...entry,...(entry.values?{values:new Set(entry.values)}:{})}]));
  state.checkFilter.orders=s.check||'';
  state.ordersSelected=new Set(s.selected||[]);
  state.ordersQuickActive=new Set(s.active||[]);
  state.ordersSort=s.sort?{...s.sort}:{key:null,dir:1};
  ['ordersSearch','ordersFCountry','ordersFLicense','ordersFDelType','ordersFStatus','ordersFSeason'].forEach(id=>{elements.set(id,{value:''});});
  elements.set('ordersSearch',{value:s.search||''});
  elements.set('ordersFCountry',{value:s.fC||''});elements.set('ordersFLicense',{value:s.fL||''});elements.set('ordersFSeason',{value:s.fSeason||''});
  client.setDims(Object.fromEntries(Object.entries(s.dims||{}).map(([dim,values])=>[dim,new Set(values)])));
}
function legacyRun(client){
  const {api,context}=client;
  const scope=api.ordersEvaluateAll();
  const rows=context.BLTableSearch.orderRows(client.state.ordersSort.key?api.sortRows(scope.all,client.state.ordersSort.key,client.state.ordersSort.dir):scope.all,
    api.parseTableSearchTerms(client.elements.get('ordersSearch').value),api.cpSearchHaystack,{plainMode:'contains'});
  const qty=rows.reduce((sum,row)=>sum+(api.toNum(row['Order Quantity'])||0),0);
  const stats=api.pageModelOptionStats(rows);
  // renderQuantityTotalsFooter: görünür adet sütunları toplamı, FOB ortalamaları, görünür seçili sayısı.
  const qtyCols=api.ORDERS_COLS.filter(api.isQuantityLikeColumn).map(c=>c.k);
  const footer={sums:Object.fromEntries(qtyCols.map(k=>[k,rows.reduce((sum,row)=>sum+api.tableNumericValue(row[k]),0)])),
    averages:Object.fromEntries([...api.cpOrdersAverageFooterCols('orders').entries()].map(([k,spec])=>[k,{
      weighted:api.kolWeightedAverage(rows,row=>row[k],spec.getQty),arithmetic:api.kolArithmeticAverage(rows,row=>row[k])}])),
    selectedCount:api.tableVisibleSelectedCount(rows,client.state.ordersSelected,row=>row._id)};
  return plain({ids:rows.map(row=>row._id),total:rows.length,qty,stats,counts:api.ordersScopeCounts(scope),filtered:api.filteredOrders().map(row=>row._id),footer,qtyCols});
}
function serverRun(dataset,spec,footer){
  const body={version:1,columns:spec.columns,filters:spec.filters,...(spec.search?{search:spec.search}:{}),...(spec.sort?{sort:spec.sort}:{}),limit:1000};
  const ids=[];let total=0;
  for(let offset=0;;offset+=1000){
    const out=engine.executeQuery(dataset,{...body,offset,fields:['_id']});
    total=out.total;out.rows.forEach(row=>ids.push(row._id));
    if(offset+1000>=out.total)break;
  }
  const f=facets.runOrdersFacets(dataset,{version:1,columns:spec.columns,...(spec.search?{search:spec.search}:{}),base:spec.base,active:spec.active,groups:spec.groups,today:TODAY,kpi:true,sums:['Order Quantity'],...(footer?{footer}:{})});
  return {ids,total,facets:f};
}
// vm realm'inden gelen dizi/nesneler düz JSON'a çevrilir (deepStrictEqual prototip karşılaştırır).
const plain=value=>JSON.parse(JSON.stringify(value));
const sortObject=obj=>Object.fromEntries(Object.entries(obj).sort(([a],[b])=>a<b?-1:a>b?1:0));

const SCENARIOS=[
  {name:'açılış: filtresiz, sırasız'},
  {name:'Season sıralama',sort:{key:'Season',dir:1}},
  {name:'Order Quantity azalan',sort:{key:'Order Quantity',dir:-1}},
  {name:'Ex-factory artan (tarih)',sort:{key:'Ex-factory',dir:1}},
  {name:'arama (Türkçe, contains)',search:'kız',sort:{key:'Model Name',dir:1}},
  {name:'arama OR + dışlama',search:'elbise, tişört; !bebek',sort:{key:'Order Code',dir:-1}},
  {name:'Season hızlı çipi',colFilters:{Season:{values:['6W26']}},sort:{key:'Retail Date',dir:-1}},
  {name:'Sipariş Durumu çipi: Pasif',active:['Inactive'],selected:[0,3,7,11,500,1999]},
  {name:'Active/Inactive sütun filtresi',colFilters:{'Active/Inactive':{values:['Active']}},sort:{key:'License',dir:1}},
  {name:'Country + License seçim kutuları',fC:'Egypt',fL:'Disney',sort:{key:'FOB ($)',dir:1}},
  {name:'boyut filtreleri (Buyer Grup / Country)',dims:{country:['Turkey','China'],buyerGrup:['Erkek Çocuk','Kız Çocuk']},sort:{key:'Order Quantity',dir:1}},
  {name:'License görünen değer filtresi',colFilters:{License:{values:['Marvel','Barbie','']}},sort:{key:'Ex-factory',dir:-1}},
  {name:'Ex-factory ay kovası',colFilters:{'Ex-factory':{granularity:'month',values:['2026-01','2026-03','2026-05']}},sort:{key:'Ex-factory',dir:1}},
  {name:'Retail Date yıl kovası + Season',colFilters:{'Retail Date':{granularity:'year',values:['2026']},Season:{values:['6S27']}}},
  {name:'sayı kuralı between',colFilters:{'Order Quantity':{numericRule:{op:'between',a:'500',b:'3000'},values:new Set()}},sort:{key:'Order Quantity',dir:-1}},
  {name:'aralık (%)',colFilters:{'%':{range:{min:0,max:0.5}}},sort:{key:'%',dir:1}},
  {name:'işaretliler filtresi',check:'checked',selected:[1,5,8,13,21,34,55,89,144,233,377,610,987,1597],sort:{key:'Order Code',dir:1}},
  {name:'birleşik',fC:'Turkey',active:['Active'],colFilters:{Season:{values:['6W26','6S27']},'Order Quantity':{numericRule:{op:'gte',a:'1000'},values:new Set()}},search:'/a',sort:{key:'Model Name',dir:-1}},
];

test('ordersReadModelSpec + sunucu sorgusu eski Siparişler sonucunu (sıra, toplam, sayaçlar) birebir üretir',async()=>{
  const client=loadClient(),serverRows=projection();
  const dataset=engine.prepareDataset(JSON.parse(JSON.stringify(serverRows)));
  client.state.orders={rows:clientRowsFrom(serverRows,client)};
  assert.ok(serverRows.length>=PARITY_ROWS*0.95,String(serverRows.length));
  const summary=[];
  for(const scenario of SCENARIOS){
    applyScenario(client,scenario);
    const spec=plain(client.api.ordersReadModelSpec());
    assert.equal(spec.ok,true,`${scenario.name}: ${spec.reason}`);
    const legacy=legacyRun(client);
    const server=serverRun(dataset,spec,{sums:legacy.qtyCols,averages:[{key:'FOB ($)',qtyKey:'Order Quantity'},{key:'Supp. FOB',qtyKey:'Order Quantity'}],
      selected:[...client.state.ordersSelected].map(String)});
    // Sıra + toplam: WS0 parite kapısı (ilk ayrışan yolu raporlar).
    await parity.assertParity({name:`orders ${scenario.name}`,rows:serverRows,context:null,
      legacy:()=>({ids:legacy.ids,total:legacy.total}),candidate:()=>({ids:server.ids,total:server.total})});
    assert.deepEqual(legacy.filtered,legacy.ids,`${scenario.name}: filteredOrders`);
    const f=server.facets,c=legacy.counts;
    assert.equal(f.total,legacy.total,`${scenario.name}: facets total`);
    assert.equal(f.sums['Order Quantity'],legacy.qty,`${scenario.name}: qty`);
    assert.deepEqual({...f.stats,rowCount:undefined},{...legacy.stats,rowCount:undefined},`${scenario.name}: stats`);
    await parity.assertParity({name:`orders kpi ${scenario.name}`,rows:serverRows,context:null,
      legacy:()=>({none:c.noneCount,active:{Active:c.activeCount,Inactive:c.inactiveCount},season:sortObject(c.seasonCounts),status:sortObject(c.statusCounts),del:sortObject(c.delCounts),exf:c.exfCounts}),
      candidate:()=>({none:f.none,active:f.kpi.active,season:sortObject(f.kpi.season),status:sortObject(f.kpi.status),del:sortObject(f.kpi.del),exf:f.kpi.exf})});
    // Alt toplam satırı (Codex #1086: seyrek dizide bekleyen satırlar sıfır sayılmasın).
    await parity.assertParity({name:`orders footer ${scenario.name}`,rows:serverRows,context:null,decimals:9,
      legacy:()=>legacy.footer,candidate:()=>f.footer});
    summary.push(`${scenario.name}: ${legacy.total}`);
  }
  // Senaryolar boş/tam küme dışında da ayırt edici olmalı.
  const totals=new Set(summary.map(line=>line.split(': ').pop()));
  assert.ok(totals.size>=8,summary.join(' | '));
});

test('sütun paneli değer listesi ve tarih kovaları sunucu yüzeyleriyle aynı',()=>{
  const client=loadClient(),serverRows=projection();
  const dataset=engine.prepareDataset(JSON.parse(JSON.stringify(serverRows)));
  client.state.orders={rows:clientRowsFrom(serverRows,client)};
  applyScenario(client,{fC:'Egypt',colFilters:{License:{values:['Marvel','Disney']},Season:{values:['6W26']}}});
  for(const key of ['License','Season','Country','Model Name','Order Code','FOB ($)','Order Quantity','STATUS','Del. Type','Active/Inactive']){
    const spec=plain(client.api.ordersReadModelSpec({excludeKey:key}));assert.equal(spec.ok,true,key);
    const out=facets.runOrdersFacets(dataset,{version:1,columns:spec.columns,base:spec.base,active:spec.active,groups:spec.groups,today:TODAY,column:{key}});
    assert.equal(out.column.truncated,false);
    assert.deepEqual(out.column.values,plain(client.api.uniqueColValues('orders',key)),key);
  }
  for(const key of ['Ex-factory','Retail Date','OPD']){
    const spec=plain(client.api.ordersReadModelSpec({excludeKey:key}));
    for(const granularity of ['year','month','week','day']){
      const out=facets.runOrdersFacets(dataset,{version:1,columns:spec.columns,base:spec.base,active:spec.active,groups:spec.groups,today:TODAY,column:{key,granularity}});
      assert.deepEqual(out.column.values,plain(client.api.uniqueDateBuckets('orders',key,granularity)),`${key}/${granularity}`);
    }
  }
  // Seçim kutuları (buildOrdersFilters → uniqueVals) filtresiz veri kümesinden.
  const all=facets.runOrdersFacets(dataset,{version:1,today:TODAY,distinct:['Country','License','Del. Type','STATUS','Season']});
  for(const key of ['Country','License','Del. Type','STATUS','Season'])assert.deepEqual(all.distinct[key],plain(client.api.uniqueVals(client.state.orders.rows,key)),key);
});

test('sunucunun değerlendiremediği durumlar eski yola düşer (sessiz yanlış sonuç yok)',()=>{
  const client=loadClient();
  const cases=[
    [{colFilters:{STATUS:{values:['Depoda']}}},'filter:STATUS'],
    [{colFilters:{'Del. Type':{values:['Gemi']}}},'filter:Del. Type'],
    [{colFilters:{'Ex-factory':{values:['past'],quickExf:true}}},'filter:Ex-factory'],
    [{colFilters:{'Ex-factory':{revision:'revised'}}},'filter:Ex-factory'],
    [{colFilters:{'Supp. FOB':{values:['1,00']}}},'filter:Supp. FOB'],
    [{sort:{key:'Priority',dir:1}},'sort:Priority'],
    [{sort:{key:'Licensor',dir:1}},'sort:Licensor'],
    [{check:'unchecked'},'unchecked-filter'],
  ];
  for(const [scenario,reason] of cases){
    applyScenario(client,scenario);
    const spec=client.api.ordersReadModelSpec();
    assert.equal(spec.ok,false,reason);assert.equal(spec.reason,reason);
  }
  applyScenario(client,{});client.state.ordersLogisticExpanded=new Set([3]);
  assert.equal(client.api.ordersReadModelSpec().reason,'logistic-detail');
  client.state.ordersLogisticExpanded=new Set();client.state.partialViewState={orders:true};
});

test('orders-facets doğrulaması: bilinmeyen alan, geçersiz gün ve desteklenmeyen sütun reddedilir',()=>{
  const dataset=engine.prepareDataset([]);
  assert.throws(()=>facets.runOrdersFacets(dataset,{version:1,today:TODAY,bogus:1}),{code:'READ_MODEL_QUERY_INVALID'});
  assert.throws(()=>facets.runOrdersFacets(dataset,{version:1,today:'2026-02-30'}),{code:'READ_MODEL_QUERY_INVALID'});
  assert.throws(()=>facets.runOrdersFacets(dataset,{version:1,today:TODAY,groups:{pri:[]}}),{code:'READ_MODEL_QUERY_INVALID'});
  assert.throws(()=>facets.runOrdersFacets(dataset,{version:1,today:TODAY,base:[{key:'Priority',op:'in',values:['A']}]}),{code:'READ_MODEL_FILTER_UNSUPPORTED'});
  assert.throws(()=>facets.runOrdersFacets(dataset,{version:1,today:TODAY,columns:[{k:'__f_x',type:'formula'}],column:{key:'__f_x'}}),{code:'READ_MODEL_FILTER_UNSUPPORTED'});
  assert.throws(()=>facets.runOrdersFacets(dataset,{version:1,today:TODAY,distinct:['__proto__']}),{code:'READ_MODEL_QUERY_INVALID'});
  const empty=facets.runOrdersFacets(dataset,{version:1,today:TODAY,kpi:true});
  assert.equal(empty.total,0);assert.equal(empty.none,0);assert.deepEqual(empty.kpi.exf,{past:0,thisWeek:0,nextWeek:0,thisMonth:0,nextMonth:0});
});

test('alt toplam: uç değerlerde (0/negatif adet, TR biçimli metin, boş) sunucu ile istemci hesabı aynı',async()=>{
  const client=loadClient(),{api}=client;
  const rows=[
    {_id:1,'Order Quantity':0,'FOB ($)':5,'Supp. FOB':'4,5','Remaining Units':'1.234'},
    {_id:2,'Order Quantity':-3,'FOB ($)':7,'Supp. FOB':'','Remaining Units':'1.234,5'},
    {_id:3,'Order Quantity':'1.200','FOB ($)':'1.234,50','Supp. FOB':null,'Remaining Units':null},
    {_id:4,'Order Quantity':'2,5','FOB ($)':-1,'Supp. FOB':'3.5','Remaining Units':' 12 '},
    {_id:5,'Order Quantity':10,'FOB ($)':'abc','Supp. FOB':'1.2.3','Remaining Units':'1.000.000'},
    {_id:5,'Order Quantity':4,'FOB ($)':2,'Supp. FOB':2,'Remaining Units':4},
  ];
  const sumKeys=['Order Quantity','Remaining Units'],avgKeys=['FOB ($)','Supp. FOB'],selected=new Set(['5','2','99']);
  const legacy=plain({sums:Object.fromEntries(sumKeys.map(k=>[k,rows.reduce((sum,row)=>sum+api.tableNumericValue(row[k]),0)])),
    averages:Object.fromEntries(avgKeys.map(k=>[k,{weighted:api.kolWeightedAverage(rows,row=>row[k],row=>row['Order Quantity']),arithmetic:api.kolArithmeticAverage(rows,row=>row[k])}])),
    selectedCount:api.tableVisibleSelectedCount(rows,selected,row=>row._id)});
  const out=facets.runOrdersFacets(engine.prepareDataset(rows),{version:1,today:TODAY,
    footer:{sums:sumKeys,averages:avgKeys.map(key=>({key,qtyKey:'Order Quantity'})),selected:[...selected]}});
  await parity.assertParity({name:'orders footer uç değerler',rows,context:null,decimals:9,legacy:()=>legacy,candidate:()=>out.footer});
});
