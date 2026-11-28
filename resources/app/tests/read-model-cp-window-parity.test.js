'use strict';
/* WS5 (#1078) alt PR 2 parite kapısı: pencereli CP yolu eski istemci yoluyla aynı sonucu verir.
 *
 * İstemci tarafı: app-main.js'teki GERÇEK fonksiyonlar vm'de çalışır.
 *   cpBuildFilterContext / cpPassesBase / cpPassesGroup / cpEvaluateAll / filteredCP
 *   sortRows (Priority: priorityRank) + BLTableSearch.orderRows (satır sırası + toplam)
 *   actionPriorityCounts + renderCPNow'daki sayaç döngüleri (hızlı filtre çipleri)
 *   pageModelOptionStats (sayım satırı), alt toplam hesap parçaları
 *   cpReadModelSpec (filtre durumu → sunucu sorgusu çevirisi)
 * Sunucu tarafı: GERÇEK işçi görevi cp-query-task (ensureComputed + cp-query) gzip CP
 * projeksiyonu üzerinde. Hesaplanmış sütunlar (Priority, etiketler) her iki tarafta aynı
 * kaynaktan (alt PR 1; eşitliği read-model-cp-computed-parity.test.js kanıtlar): burada
 * süzme/sıralama/sayma semantiği karşılaştırılır.
 * Fixture: WS0 demo verisi → parseASASRows / parseAntrepoRows → buildProjections('cp'),
 * iki yetki kapsamı (moderatör: tümü; alıcı: alıcıların yarısı). 30k: BL_CP_PARITY_ROWS=30000.
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const {extractFunction}=require('./helpers/app-main-functions');
const parity=require('./helpers/read-model-parity.cjs');
const parse=require('../server/lib/parse'),tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const engine=require('../server/lib/read-model/query-engine');
const worker=require('../server/lib/read-model/read-model-worker');
const computedTask=require('../server/lib/read-model/cp-computed-task');
const queryTask=require('../server/lib/read-model/cp-query-task');
const {createContextLoader}=require('../server/lib/read-model/overview-model-service');
const Merge=require('../public/checklist-answer-merge-engine');
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
  'CP_BASE_SEARCH_KEYS','CP_CANONICAL_SEARCH_FIELDS','CP_SEARCH_KEYS','CP_COLS','CP_MIRROR_GROUPS','CP_MIRROR_IDS','CP_MIRROR_COLS','CP_DIM_META',
  'CP_BASELINE_DATE_KEYS','CP_DATE_KEYS','REVISION_FILTER_MODES','_quickExfBounds','partialViewState','CP_EXF_PERIODS','CP_RM_CLIENT_DERIVED_KEYS','CP_RM_CLIENT_TYPES','ordersRMNumber'];
const FUNCTIONS=['norm','turknorm','toNum','dateOrdinal','normalizeCPDates','applyCpApprovalDate','rebuildCpLogisticCaches','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','fmtDate','nfIntTR','nfMoneyTR',
  'fmtMoneyPlain','fmtInt','fmtOC','fmtPct','normalizeDecimalText','numericFilterValue','numericFilterRulePasses','cellPlainText','columnByKey',
  'prepareColFilter','prepareColFilters','buildPreparedColFilter','preparedColFilterPasses','preparedFiltersPass','isCpFabricFilterKey','dateBucketKey',
  'comparableColumnFilterValue','normalizeTransitDelType','sortRows','columnSchemaFor','parseTableSearchTerms','tableSearchMatches','cpSearchHaystack',
  'cpCanonicalSearchKeys','cpLogisticSegments','cpLogisticHasDetails','revisionFilterMode','revisionFilterPasses','colFilterHasValueTest','matchesQuickExFactory',
  'quickExFactoryBounds','toDateOnly','mondayOf','addDays','isProductionStatus','normalizeCheckFilterMode','partialViewEnabled','pageModelOptionStats',
  'actionPriorityCode','actionPriorityCodes','priorityHas','priorityRank','actionPriorityCounts',
  'normalizeUnifiedPriorityFilter','migrateLegacyCpQuickFilters','cpBuildFilterContext','cpPassesBase','cpPassesGroup','cpRowPasses','cpEvaluateAll','filteredCP',
  'cpReadModelSpec','cpRMColFilter','cpRMClientOnlyKey','cpRMColumns',
  'tableNumericValue','kolWeightedAverage','kolArithmeticAverage','kolParseMoneyNum','tableVisibleSelectedCount','selectionHasId','selectionIdKey','isQuantityLikeColumn','cpOrdersAverageFooterCols'];

function loadClient(){
  const code=[...CONSTS.map(extractConst),...FUNCTIONS.map(name=>extractFunction(SOURCE,name))].join('\n');
  const elements=new Map();
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{value:''});return elements.get(id);}};
  const state={colFilters:{cp:{}},checkFilter:{cp:''},cpSelected:new Set(),cpDirty:new Set(),cpSort:{key:null,dir:1},cpLogisticExpanded:new Set(),cp:null,cpQuickExf:''};
  const window={BLColumnSchema:schema,BLDateDimension:dates,BLCanonicalFields:fields,BLModelOptionStats:optionStats,BLQuickFilterGroups:{config:()=>({hidden:[],extra:[]})},
    BLCollectionModelGroups:require('../public/collection-model-groups'),BLOrderDecisionEngine:require('../public/order-decision-engine')};
  const context=vm.createContext({window,document,state,BLBusinessRules:rules,BLRevision:require('../public/revision-display'),Intl,Date,Map,Set,WeakMap,Array,Object,String,Number,Math,JSON,RegExp,isNaN});
  vm.runInContext(`${code}
    let cpDimFilters={};const GENERIC_TABLE_SOURCES={};const ORDERS_COLS=[];const COLS_BY_TABLE={cp:CP_COLS,orders:ORDERS_COLS};
    function partialViewRows(tableKey,rows){return rows;}function partialViewStatusGroups(){return [];}
    function cpRMMaterializedRows(){return null;}function ensurePlmSampleAccessors(rows){return rows;}function pendingOverrideWriteCount(){return 0;}
    function readPrivateOrderNote(){return '';}function kolFabricCardsEnsureLoaded(){}function L(v){return v;}
    globalThis.__setDims=value=>{cpDimFilters=value;};
    globalThis.__client={${FUNCTIONS.join(',')},CP_COLS};`,context,{filename:'app-main.js (cp pencere parite)'});
  context.BLTableSearch={parseTerms:context.parseTableSearchTerms,matches:context.tableSearchMatches};
  rowGroups.install(context);
  window.BLTableSearch=context.BLTableSearch;
  return {api:context.__client,context,state,elements,setDims:context.__setDims};
}

const TODAY=(()=>{const d=new Date();const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;})();
const PARITY_ROWS=Math.max(500,Number(process.env.BL_CP_PARITY_ROWS)||2000);
function projections(rows=PARITY_ROWS){
  const fx=parity.makeFixture({rows,today:TODAY});
  const asas=parse.parseASASRows(fx.asas).orders,antrepo=parse.parseAntrepoRows(fx.antrepo);
  const src={loadedAt:'r1',asasOrders:asas,asasOrdersByTarget:{cp:asas,orders:asas},antrepoMap:antrepo,lflRows:[]};
  const buyers=[...new Set(asas.map(row=>row.buyer))].sort();
  const scoped=user=>{
    const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,
      viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:user.buyers},editScopes:{buyers:user.buyers},
      authority:Object.fromEntries(asas.map(row=>[row.ocode,[row]])),profiles:[]});
    const built=tasks.buildProjections(src,{modules:['cp'],overrides:{},horizons:{},access:ctx});
    return {id:`${rows}-${user.id}`,json:tasks.serialize({rows:built.cp.rows},'projection')};
  };
  return {buyers,scoped};
}
const CONTEXT=createContextLoader({
  // 2026-11-21: yerleşik kural yok; eski tanımlar kullanıcı kuralı olarak kurulur.
  preferences:{load:()=>({entries:Object.fromEntries(Object.entries(require('./fixtures/legacy-builtin-rules').storeEntries()).map(([k,v])=>[k,{value:v}]))})},
  roleEntries:()=>({'lcw.cp.assistant.v1':{value:JSON.stringify({settings:{targetType:'retail'},checklistSettings:{enabled:true}})}}),
  managedRules:()=>({rules:[],deletedRuleIds:[],priorityCatalog:[],checklistStatuses:[],revision:0}),// Vasıta tipine bağlı kurallar (fixture vasıtaları). delType:'' hiçbir vasıtayla eşleşmez: üretim aşamasındaki
  // satırlar kuralsız (UNKNOWN) kalır ve öncelik çeşitliliği yalnız sevk edilmiş satırlardan gelirdi.
  transitRules:()=>['Gemi','Uçak','TIR','Gemi+Uçak','Kamyon'].map((delType,i)=>({id:'t-'+i,seasons:[],countries:[],delType,days:35,exfStart:'',exfEnd:''})),
  plmPayload:()=>({models:{},updatedAt:null}),checklistPayload:()=>({answers:{},tombstones:{}}),revision:()=>'r1',merge:(own,shared)=>Merge.merge(own,shared)})({id:'u'}).value;
async function serverRun(projection,kind,request){
  const deps={cache:worker.cache,engine};
  const dataset={datasetKey:'cp-window-'+projection.id,scopeKey:'cp-overview'};
  if(!worker.cache.get(dataset.datasetKey))dataset.buffer=Uint8Array.from(zlib.gzipSync(Buffer.from(projection.json))).buffer;
  const out=await queryTask.execute({dataset,scopeKey:'s-'+projection.id,lang:'tr',context:CONTEXT,tasks:[],kind,request},deps);
  assert.ok(out.result,'işçi sonucu döndü');return out;
}
// Tarayıcıdaki ensureCpLoaded (reviveServerDates → gerçek normalizeCPDates) + alt PR 1 hesaplanmış sütunları (Priority, etiketler).
function clientRowsFrom(projection,client,computed){
  const rows=JSON.parse(projection.json).rows;
  client.api.normalizeCPDates(rows);
  rows.forEach(row=>{
    const tuple=computed.get(String(row._id));
    row.Priority=tuple[1];row._trackingTags=tuple[3];row._priorityTags=tuple[4];
  });
  return rows;
}
function applyScenario(client,s){
  const {state,elements}=client;
  state.colFilters.cp=Object.fromEntries(Object.entries(s.colFilters||{}).map(([key,entry])=>[key,{...entry,...(entry.values?{values:new Set(entry.values)}:{})}]));
  state.checkFilter.cp=s.check||'';
  state.cpSelected=new Set(s.selected||[]);
  state.cpSort=s.sort?{...s.sort}:{key:null,dir:1};
  state.cpQuickExf=s.quickExf||'';
  ['cpSearch','cpFPriority','cpFCountry','cpFLicense','cpFDelType','cpFStatus','cpFSeason'].forEach(id=>{elements.set(id,{value:''});});
  elements.set('cpSearch',{value:s.search||''});
  for(const [id,key] of [['cpFPriority','fP'],['cpFCountry','fC'],['cpFLicense','fL'],['cpFDelType','fD'],['cpFStatus','fS'],['cpFSeason','fSeason']])elements.set(id,{value:s[key]||''});
  client.setDims(Object.fromEntries(Object.entries(s.dims||{}).map(([dim,values])=>[dim,new Set(values)])));
}
const plain=value=>JSON.parse(JSON.stringify(value));
const sortObject=obj=>Object.fromEntries(Object.entries(obj).sort(([a],[b])=>a<b?-1:a>b?1:0));
function legacyRun(client){
  const {api,context}=client;
  const scope=api.cpEvaluateAll();
  // renderCPNow: sıralama → arama sıralaması (eski yol aynen).
  const rows=context.BLTableSearch.orderRows(client.state.cpSort.key?api.sortRows(scope.all,client.state.cpSort.key,client.state.cpSort.dir):scope.all,
    api.parseTableSearchTerms(client.elements.get('cpSearch').value),api.cpSearchHaystack,{plainMode:'contains'});
  const qty=rows.reduce((sum,row)=>sum+(api.toNum(row['Order Quantity'])||0),0);
  const stats=api.pageModelOptionStats(rows);
  // renderCPNow sayaç döngüleri (partial view kapalı).
  const statusCounts={};scope.status.forEach(r=>{const values=api.cpLogisticHasDetails(r)?(r._logisticStatusValues||api.cpLogisticSegments(r).map(s=>s.status)):[r.STATUS];
    [...new Set(values.map(v=>api.norm(v)||'—'))].forEach(s=>{statusCounts[s]=(statusCounts[s]||0)+1;});});
  const delCounts={};scope.del.forEach(r=>{const values=api.cpLogisticHasDetails(r)?(r._logisticDelTypeValues||api.cpLogisticSegments(r).map(s=>s.delType)):[r['Del. Type']];
    [...new Set(values.map(raw=>api.normalizeTransitDelType(raw)||api.norm(raw)||'—'))].forEach(d=>{delCounts[d]=(delCounts[d]||0)+1;});});
  const seasonCounts={};scope.season.forEach(r=>{const s=api.norm(r.Season)||'—';seasonCounts[s]=(seasonCounts[s]||0)+1;});
  const exfCounts=Object.fromEntries(['past','thisWeek','nextWeek','thisMonth','nextMonth'].map(k=>[k,0]));
  scope.exf.forEach(r=>{Object.keys(exfCounts).forEach(k=>{if(api.matchesQuickExFactory(r,k))exfCounts[k]++;});});
  const qtyCols=api.CP_COLS.filter(api.isQuantityLikeColumn).map(c=>c.k);
  const footer={sums:Object.fromEntries(qtyCols.map(k=>[k,rows.reduce((sum,row)=>sum+api.tableNumericValue(row[k]),0)])),
    averages:Object.fromEntries([...api.cpOrdersAverageFooterCols('cp').entries()].map(([k,spec])=>[k,{
      weighted:api.kolWeightedAverage(rows,row=>row[k],spec.getQty),arithmetic:api.kolArithmeticAverage(rows,row=>row[k])}])),
    selectedCount:api.tableVisibleSelectedCount(rows,client.state.cpSelected,row=>row._id)};
  return plain({ids:rows.map(row=>row._id),total:rows.length,qty,stats,none:scope.none.length,pri:api.actionPriorityCounts(scope.pri),
    status:statusCounts,del:delCounts,season:seasonCounts,exf:exfCounts,filtered:api.filteredCP().map(row=>row._id),footer,qtyCols});
}
async function windowedRun(projection,spec,footer){
  const body={version:1,columns:spec.columns,base:spec.base,groups:spec.groups,today:TODAY,...(spec.search?{search:spec.search}:{})};
  const ids=[];let total=0;
  for(let offset=0;;offset+=1000){
    const out=(await serverRun(projection,'query',{...body,...(spec.sort?{sort:spec.sort}:{}),offset,limit:1000,fields:['_id']})).result;
    total=out.total;out.rows.forEach(row=>ids.push(row._id));
    if(offset+1000>=out.total)break;
  }
  const facets=(await serverRun(projection,'facets',{...body,kpi:true,sums:['Order Quantity'],footer})).result;
  return {ids,total,facets};
}

const SCENARIOS=[
  {name:'açılış: filtresiz, sırasız'},
  {name:'Priority sıralama (katalog sırası)',sort:{key:'Priority',dir:1}},
  {name:'Priority azalan',sort:{key:'Priority',dir:-1}},
  {name:'Season sıralama',sort:{key:'Season',dir:1}},
  {name:'Order Quantity azalan',sort:{key:'Order Quantity',dir:-1}},
  {name:'Ex-factory artan (tarih)',sort:{key:'Ex-factory',dir:1}},
  {name:'arama (Türkçe, contains)',search:'kız',sort:{key:'Model Name',dir:1}},
  {name:'arama OR + dışlama',search:'elbise, tişört; !bebek',sort:{key:'Priority',dir:1}},
  {name:'öncelik çipi (sütun filtresi)',priChip:true,sort:{key:'Order Code',dir:-1}},
  {name:'öncelik seçim kutusu',priSelect:true},
  {name:'lojistik STATUS çipi',statusChip:true,sort:{key:'Retail Date',dir:-1}},
  {name:'Del. Type sütun filtresi (kanonik)',delChip:true},
  {name:'STATUS seçim kutusu',statusSelect:true,sort:{key:'Priority',dir:-1}},
  {name:'hızlı Ex-factory (sütun)',colFilters:{'Ex-factory':{values:['thisMonth','nextMonth'],quickExf:true}}},
  {name:'hızlı Ex-factory (eski durum)',quickExf:'past',sort:{key:'Ex-factory',dir:-1}},
  {name:'Season hızlı çipi',colFilters:{Season:{values:['6W26']}},sort:{key:'Retail Date',dir:-1}},
  {name:'Country + License seçim kutuları',fC:'Egypt',fL:'Disney',sort:{key:'FOB ($)',dir:1}},
  {name:'boyut filtreleri',dims:{country:['Turkey','China']},sort:{key:'Order Quantity',dir:1}},
  {name:'License görünen değer filtresi',colFilters:{License:{values:['Marvel','Barbie','']}},sort:{key:'Ex-factory',dir:-1}},
  {name:'Ex-factory ay kovası',colFilters:{'Ex-factory':{granularity:'month',values:['2026-01','2026-03','2026-05']}},sort:{key:'Ex-factory',dir:1}},
  {name:'sayı kuralı between',colFilters:{'Order Quantity':{numericRule:{op:'between',a:'500',b:'3000'},values:[]}},sort:{key:'Order Quantity',dir:-1}},
  {name:'işaretliler filtresi',check:'checked',selected:[1,5,8,13,21,34,55,89,144,233,377,610,987],sort:{key:'Priority',dir:1}},
  {name:'birleşik',fC:'Turkey',priChip:true,statusChip:true,colFilters:{Season:{values:['6W26','6S27']}},search:'/a',sort:{key:'Model Name',dir:-1}},
];
// Fixture'a göre çip değerleri (ekrandaki çiplerden seçilir gibi): en sık değerler.
function resolveScenario(s,base){
  const out={...s,colFilters:{...(s.colFilters||{})}};
  const top=(counts,skip=0)=>Object.entries(counts).filter(([k,n])=>n>0&&k!=='—').sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1))[skip]?.[0];
  if(s.priChip)out.colFilters.Priority={values:[top(base.pri,1),top(base.pri,2)].filter(Boolean)};
  if(s.priSelect)out.fP=top(base.pri,0);
  if(s.statusChip)out.colFilters.STATUS={values:[top(base.status,0)]};
  if(s.statusSelect)out.fS=top(base.status,1)||top(base.status,0);
  if(s.delChip)out.colFilters['Del. Type']={values:[top(base.del,0)]};
  return out;
}

async function runScopes(rows){
  const {buyers,scoped}=projections(rows);
  const users=[{id:'moderator',all:true,buyers:[]},{id:'buyer-a',all:false,buyers:buyers.slice(0,Math.ceil(buyers.length/2))}];
  const totals=new Set(),summary=[];
  for(const user of users){
    worker.cache.clear();computedTask.clearHosts();
    const projection=scoped(user);
    // Hesaplanmış sütunlar: aynı işçi önbelleği (ensureComputed) → istemci satırlarına.
    const deps={cache:worker.cache,engine};
    const dataset={datasetKey:'cp-window-'+projection.id,scopeKey:'cp-overview',buffer:Uint8Array.from(zlib.gzipSync(Buffer.from(projection.json))).buffer};
    const columns=JSON.parse((await computedTask.execute({dataset,scopeKey:'s-'+projection.id,lang:'tr',context:CONTEXT,tasks:[]},deps)).body);
    const computed=new Map(columns.rows.map(row=>[row[0],row]));
    const client=loadClient();
    client.state.cp={rows:clientRowsFrom(projection,client,computed)};
    totals.add(client.state.cp.rows.length);
    applyScenario(client,{});
    const base=legacyRun(client);
    assert.ok(Object.values(base.pri).filter(n=>n>0).length>=3,`öncelik çeşitliliği: ${JSON.stringify(base.pri)}`);
    for(const raw of SCENARIOS){
      const scenario=resolveScenario(raw,base),name=`${user.id} · ${scenario.name}`;
      applyScenario(client,scenario);
      const spec=plain(client.api.cpReadModelSpec());
      assert.equal(spec.ok,true,`${name}: ${spec.reason}`);
      const legacy=legacyRun(client);
      const server=await windowedRun(projection,spec,{sums:legacy.qtyCols,averages:[{key:'FOB ($)',qtyKey:'Order Quantity'},{key:'Supp. FOB',qtyKey:'Order Quantity'}],
        selected:[...client.state.cpSelected].map(String)});
      await parity.assertParity({name:`cp ${name}`,rows:[],context:null,legacy:()=>({ids:legacy.ids,total:legacy.total}),candidate:()=>({ids:server.ids,total:server.total})});
      assert.deepEqual(legacy.filtered,legacy.ids,`${name}: filteredCP`);
      const f=server.facets;
      assert.equal(f.total,legacy.total,`${name}: facets total`);
      assert.equal(f.sums['Order Quantity'],legacy.qty,`${name}: qty`);
      assert.deepEqual({...f.stats,rowCount:undefined},{...legacy.stats,rowCount:undefined},`${name}: stats`);
      await parity.assertParity({name:`cp kpi ${name}`,rows:[],context:null,
        legacy:()=>({none:legacy.none,pri:sortObject(legacy.pri),status:sortObject(legacy.status),del:sortObject(legacy.del),season:sortObject(legacy.season),exf:legacy.exf}),
        candidate:()=>({none:f.none,pri:sortObject(f.kpi.pri),status:sortObject(f.kpi.status),del:sortObject(f.kpi.del),season:sortObject(f.kpi.season),exf:f.kpi.exf})});
      await parity.assertParity({name:`cp footer ${name}`,rows:[],context:null,decimals:9,legacy:()=>legacy.footer,candidate:()=>f.footer});
      summary.push(`${scenario.name}: ${legacy.total}`);
    }
  }
  assert.equal(totals.size,2,'iki yetki kapsamı farklı satır kümeleri üretti');
  const distinct=new Set(summary.map(line=>line.split(': ').pop()));
  assert.ok(distinct.size>=10,summary.join(' | '));
}

test(`cpReadModelSpec + cp-query işçisi eski CP sonucunu (sıra, toplam, çipler, sayım, alt toplam) birebir üretir: ${PARITY_ROWS} satır, iki yetki kapsamı`,{timeout:1800000},async()=>{
  await runScopes(PARITY_ROWS);
});

test('sunucunun değerlendiremediği durumlar eski yola düşer (sessiz yanlış sonuç yok)',()=>{
  const client=loadClient();
  const cases=[
    [{colFilters:{'Ex-factory':{revision:'revised'}}},'filter:Ex-factory'],
    [{colFilters:{'Supp. FOB':{values:['1,00']}}},'filter:Supp. FOB'],
    [{colFilters:{'Fabric (PLM)':{values:['x']}}},'filter:Fabric (PLM)'],
    [{colFilters:{'__checklist__pps':{values:['Onaylandı']}}},'filter:__checklist__pps'],
    [{colFilters:{Priority:{range:{min:0,max:1}}}},'filter:Priority'],
    [{sort:{key:'Licensor',dir:1}},'sort:Licensor'],
    [{sort:{key:'Ex→Retail',dir:1}},'sort:Ex→Retail'],
    [{check:'unchecked'},'unchecked-filter'],
  ];
  for(const [scenario,reason] of cases){
    applyScenario(client,scenario);
    const spec=client.api.cpReadModelSpec();
    assert.equal(spec.ok,false,reason);assert.equal(spec.reason,reason);
  }
  applyScenario(client,{});client.state.cpDirty=new Set([3]);
  assert.equal(client.api.cpReadModelSpec().reason,'dirty','kaydedilmemiş düzenleme (alt PR 3) eski yolda');
  client.state.cpDirty=new Set();client.state.cpLogisticExpanded=new Set([3]);
  assert.equal(client.api.cpReadModelSpec().reason,'logistic-detail');
  client.state.cpLogisticExpanded=new Set();
  // Priority sıralaması ve öncelik/lojistik filtreleri artık sunucuda.
  applyScenario(client,{sort:{key:'Priority',dir:1},colFilters:{Priority:{values:['CRITICAL']},STATUS:{values:['Depoda']},'Del. Type':{values:['Gemi']}}});
  const spec=plain(client.api.cpReadModelSpec());
  assert.equal(spec.ok,true);
  assert.deepEqual(spec.groups.pri,[{op:'cp-priority',flags:['CRITICAL']}]);
  assert.deepEqual(spec.groups.status,[{op:'cp-status',values:['Depoda']}]);
  assert.equal(spec.groups.del[0].op,'cp-deltype');
});
