'use strict';
/* WS1 (#1073) parite kapısı: public/read-model-query.js, app-main.js'teki GERÇEK
 * istemci filtre + sıralama + arama zinciriyle (cpPassesBase, cpPassesGroup,
 * prepareColFilter/preparedColFilterPasses, sortRows, BLTableSearch.orderRows)
 * 2k satırlık projeksiyonda birebir aynı sonucu (sıra dahil) üretmelidir.
 *
 * İstemci fonksiyonları stub'sız olarak app-main.js kaynağından çıkarılıp vm'de
 * çalıştırılır. Sunucu tarafı aynı projeksiyonun JSON'a serileştirilmiş
 * (worker'ın gördüğü) biçimini kullanır; istemci tarafı ise tarayıcıdaki gibi
 * tarih alanlarını Date'e çevrilmiş biçimini.
 *
 * Geçici yerel parite yardımcısı: WS0'ın tests/helpers/read-model-parity*
 * yardımcısı main'e girince bu dosyadaki parityHash ona taşınacak (#1072).
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {extractFunction}=require('./helpers/app-main-functions');
const tasks=require('../server/lib/compute-tasks');
const query=require('../public/read-model-query');
const rules=require('../public/business-rules'),schema=require('../public/column-schema'),dates=require('../public/date-dimension');
const rowGroups=require('../public/table-search-row-groups'),fields=require('../server/lib/canonical-fields');

const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
function extractConstLine(name){
  const match=new RegExp(`^(?:const|var|let) ${name}\\s*=.*$`,'m').exec(SOURCE);
  if(!match)throw new Error(`app-main.js içinde ${name} bulunamadı`);
  return match[0];
}
function extractArrayConst(name){
  const start=SOURCE.indexOf(`const ${name} = [`);if(start<0)throw new Error(name);
  const end=SOURCE.indexOf('\n];',start);return SOURCE.slice(start,end+3);
}
const CLIENT_FUNCTIONS=['norm','toNum','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','fmtDate','nfIntTR','nfMoneyTR',
  'fmtMoneyPlain','fmtInt','fmtOC','fmtPct','normalizeDecimalText','numericFilterValue','numericFilterRulePasses','cellPlainText','columnByKey',
  'prepareColFilter','prepareColFilters','buildPreparedColFilter','preparedColFilterPasses','preparedFiltersPass','isCpFabricFilterKey','dateBucketKey',
  'comparableColumnFilterValue','normalizeTransitDelType','sortRows','columnSchemaFor','parseTableSearchTerms','tableSearchMatches',
  'cpSearchHaystack','cpCanonicalSearchKeys','cpPassesBase','cpPassesGroup','passesOvDimFilters','cpLogisticSegments','cpLogisticHasDetails'];
function loadClient(){
  const code=[
    ...['ISO_DAY_CACHE_MAX','_isoDayCache','_nfIntTR','_colIndexCache','_preparedColFilterCache','_preparedFabricFilterCache','CP_FABRIC_PLM_KEY',
      'CP_BASE_SEARCH_KEYS','CP_CANONICAL_SEARCH_FIELDS'].map(extractConstLine),
    ...CLIENT_FUNCTIONS.map(name=>extractFunction(SOURCE,name)),
    extractConstLine('CP_SEARCH_KEYS'),extractArrayConst('CP_COLS'),extractConstLine('CP_DATE_KEYS').replace(/^const CP_DATE_KEYS.*$/,'')
  ].join('\n');
  const state={colFilters:{cp:{}},cpSelected:new Set()};
  const window={BLColumnSchema:schema,BLDateDimension:dates,BLCanonicalFields:fields};
  const context=vm.createContext({window,state,BLBusinessRules:rules,Intl,Date,Map,Set,WeakMap,Array,Object,String,Number,Math,JSON,RegExp,isNaN});
  vm.runInContext(`${code}\nconst COLS_BY_TABLE={cp:CP_COLS,orders:CP_COLS};const OV_DIM_META={};function ovStateFor(){return __ov;}var __ov={};
    globalThis.__client={${CLIENT_FUNCTIONS.join(',')},CP_COLS,CP_SEARCH_KEYS};`,context,{filename:'app-main.js (parite)'});
  // İstemcideki gibi satır grubu arama genişletmesi global bağlamaların üzerine kurulur.
  context.BLTableSearch={parseTerms:context.parseTableSearchTerms,matches:context.tableSearchMatches};
  rowGroups.install(context);
  return {api:context.__client,context,state};
}

function fixtureSource(count=2200){
  const seasons=['S5','W5','S6','W6','S7','W7','2026 SUMMER',''],countries=['TURKIYE','BANGLADESH','CHINA','EGYPT','INDIA'];
  const licenses=['Disney','Marvel','Lisanssız','Barbie','Şirin Kuzu',''],buyers=['Buyer A','Buyer B','Çağrı Öztürk','İlkay Işık'];
  const words=['Kız Çocuk Tişört','ERKEK ÇOCUK ŞORT','Bebek Örme Elbise','Sweatshirt Kapüşonlu','Ince Hırka','İnce Hırka'];
  const rows=Array.from({length:count},(_,i)=>{
    const r=(i*7919)%9973;
    return {ocode:500000+(r%1700),model:`${words[r%words.length]} ${r%97}`,ccode:['R','K',' B ','N'][r%4],colour:['Red','Kırmızı','Blue','Lacivert'][r%4],
      buyer:buyers[r%buyers.length],merch:['M1','M2','M3'][r%3],ageGroup:['A','B'][r%2],buyerGrup:['G1','Ğ2'][r%2],license:licenses[r%licenses.length],
      manufacturer:['Demo Tekstil','ACME','Örnek Örme'][r%3],season:seasons[r%seasons.length],countryRaw:countries[r%countries.length],
      qty:(r%13)*100+(r%7),kalan:(r%11)*50,fob:r%5===0?null:Math.round((r%400)/7*100)/100,
      ex:r%9===0?null:new Date(2026,r%12,1+(r%27)),retail:new Date(2026+(r%2),(r*3)%12,1+(r%20)),mb:r%4===0?null:new Date(2027,r%12,2)};
  });
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{},lflRows:[]};
}
function projectionRows(){
  const projected=tasks.buildProjections(fixtureSource(),{modules:['cp'],overrides:{},horizons:{}}).cp.rows;
  // Sunucu işçisinin gördüğü biçim: projeksiyon gzip/JSON'u.
  return JSON.parse(tasks.serialize(projected,'projection'));
}

const SCENARIOS=[
  {name:'no filter, Season sort',sort:{key:'Season',dir:1}},
  {name:'Season sort desc',sort:{key:'Season',dir:-1}},
  {name:'country quick filter + qty sort',fC:'Turkey',sort:{key:'Order Quantity',dir:-1}},
  {name:'license quick + season quick',fL:'Marvel',fSeason:'W7',sort:{key:'Model Name',dir:1}},
  {name:'dim filters',dims:{'Buyer':['Buyer A','İlkay Işık'],'Merch Alt Grup Kod':['M2']},sort:{key:'FOB ($)',dir:1}},
  {name:'display value filter text',colFilters:{'License':{values:['Marvel','Şirin Kuzu','']}},sort:{key:'Ex-factory',dir:1}},
  {name:'display value filter date text',colFilters:{'Retail Date':{values:['01.01.26','04.04.27','05.10.26']}}},
  {name:'date granularity month',colFilters:{'Ex-factory':{granularity:'month',values:['2026-03','2026-07']}},sort:{key:'Retail Date',dir:-1}},
  {name:'date granularity year',colFilters:{'In-Store (Model Budget)':{granularity:'year',values:['2027']}},sort:{key:'In-Store (Model Budget)',dir:1}},
  {name:'money display + int display',colFilters:{'FOB ($)':{values:['0,00','14,29','28,57']},'Order Quantity':{values:['1.204','0','300']}}},
  {name:'pct range',colFilters:{'%':{range:{min:0,max:0.5}}},sort:{key:'%',dir:1}},
  {name:'numeric rule between',colFilters:{'Order Quantity':{numericRule:{op:'between',a:'300',b:'900'},values:[]}},sort:{key:'Order Code',dir:-1}},
  {name:'numeric rule gt TR text',colFilters:{'FOB ($)':{numericRule:{op:'gt',a:'40,5'},values:[]}},sort:{key:'FOB ($)',dir:-1}},
  {name:'ordercode display filter',colFilters:{'Order Code':{values:['500001','500100','501699']}}},
  {name:'search contains turkish',search:'ince hırka',sort:{key:'Order Quantity',dir:1}},
  {name:'search OR group reorders',search:'şort, elbise',sort:{key:'Season',dir:1}},
  {name:'search exclusion',search:'çocuk; !kız',sort:{key:'Model Name',dir:-1}},
  {name:'search row groups',search:'(Disney; Demo), (Marvel; ACME)'},
  {name:'combined',fC:'CHINA',dims:{'Buyer Grup (TR)':['Ğ2']},colFilters:{'Season':{values:['S6','W6','—']},'Remaining Units':{numericRule:{op:'gte',a:'100'},values:[]}},search:'/demo',sort:{key:'Retail Date',dir:1}},
];
function clientRun(client,rows,s){
  const {api,state}=client;
  state.colFilters.cp=Object.fromEntries(Object.entries(s.colFilters||{}).map(([key,entry])=>[key,{...entry,...(entry.values?{values:new Set(entry.values)}:{})}]));
  const bucket=state.colFilters.cp;
  const ctx={q:client.context.parseTableSearchTerms(s.search||''),fC:s.fC||'',fL:s.fL||'',fSeason:s.fSeason||'',checkFilter:'',
    baseFilters:api.prepareColFilters('cp',['Priority','STATUS','Del. Type','Season','Ex-factory']).concat(
      ['Ex-factory'].filter(key=>bucket[key]).map(key=>({key,prepared:api.prepareColFilter('cp',key,bucket[key])}))),
    dimEntries:Object.entries(s.dims||{}).map(([col,values])=>[col,new Set(values)]),
    groupFilters:{season:api.prepareColFilter('cp','Season',bucket.Season)}};
  let out=rows.filter(row=>api.cpPassesBase(row,ctx)&&api.cpPassesGroup(row,ctx,'season'));
  if(s.sort)out=api.sortRows(out,s.sort.key,s.sort.dir);
  out=client.context.BLTableSearch.orderRows(out,ctx.q,api.cpSearchHaystack,{plainMode:'contains'});
  return out;
}
function serverQuery(client,s){
  const filters=[];
  if(s.fC)filters.push({key:'Country',op:'eq',value:s.fC});
  if(s.fL)filters.push({key:'License',op:'eq',value:s.fL});
  if(s.fSeason)filters.push({key:'Season',op:'eq',value:s.fSeason});
  for(const [key,values] of Object.entries(s.dims||{}))filters.push({key,op:'in',values});
  for(const [key,entry] of Object.entries(s.colFilters||{})){
    if(entry.range)filters.push({key,op:'range',min:entry.range.min,max:entry.range.max});
    else if(entry.numericRule)filters.push({key,op:'numeric',rule:entry.numericRule});
    else filters.push({key,op:'display-in',values:entry.values,...(entry.granularity?{granularity:entry.granularity}:{})});
  }
  return {version:1,columns:client.api.CP_COLS.map(col=>({k:col.k,type:col.type})),filters,
    ...(s.search?{search:{text:s.search,plainMode:'contains'}}:{}),...(s.sort?{sort:s.sort}:{}),limit:1000,
    aggregates:{sums:['Order Quantity','Remaining Units']}};
}
// Geçici yerel parite yardımcısı (WS0 #1072 yardımcısına taşınacak).
function parityHash(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}

test('shared date-key list and search keys equal the client constants',()=>{
  const client=loadClient();
  const clientDateKeys=vm.runInNewContext(extractConstLine('CP_BASELINE_DATE_KEYS')+'\n'+extractConstLine('CP_DATE_KEYS')+';CP_DATE_KEYS');
  assert.deepEqual([...query.DATE_KEYS],[...clientDateKeys]);
  assert.deepEqual([...query.searchKeys()],[...client.api.CP_SEARCH_KEYS]);
});

test('read-model-query reproduces client filter + sort + search order on a 2k projection',()=>{
  const client=loadClient(),serverRows=projectionRows();
  assert.ok(serverRows.length>=1500,String(serverRows.length));
  // İstemci: JSON'dan gelen satırlar normalizeCPDates'in tarih adımıyla Date'e çevrilir.
  const clientRows=JSON.parse(JSON.stringify(serverRows));
  const clientDateKeys=[...query.DATE_KEYS];
  clientRows.forEach(row=>clientDateKeys.forEach(key=>{if(key in row)row[key]=client.api.coerceDateLoose(row[key]);}));
  const normalized=query.normalizeRows(JSON.parse(JSON.stringify(serverRows)));
  let nonTrivial=0;
  for(const s of SCENARIOS){
    const expected=Array.from(clientRun(client,clientRows,s),row=>row._id);
    const result=query.runQuery(normalized,serverQuery(client,s),{includeOrder:true});
    const actual=result.order.map(index=>normalized[index]._id);
    assert.equal(result.total,expected.length,s.name);
    assert.equal(parityHash(actual),parityHash(expected),`${s.name}: order differs`);
    const byId=new Map(clientRows.map(row=>[row._id,row]));
    const qty=expected.reduce((sum,id)=>sum+(Number(byId.get(id)['Order Quantity'])||0),0);
    assert.equal(result.aggregates.sums['Order Quantity'],qty,s.name);
    const windowIds=result.rows.map(row=>row._id);
    assert.deepEqual(windowIds,expected.slice(0,1000),s.name);
    if(expected.length>0&&expected.length<serverRows.length)nonTrivial++;
  }
  // Senaryoların çoğu gerçekten süzmeli; boş/tam küme paritesi tek başına kanıt değildir.
  assert.ok(nonTrivial>=SCENARIOS.length-2,`non-trivial scenarios: ${nonTrivial}`);
});
