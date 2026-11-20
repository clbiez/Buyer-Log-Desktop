'use strict';
/* WS2a (#1074) parite kapısı: Genel Bakış okuma modeli (yerel arka uç işçisi)
 * tarayıcıdaki Genel Bakış hesabıyla aynı sonucu üretmelidir.
 *
 * Eski yol ("legacy") tarayıcıyı taklit eder ve sunucu modülü KULLANMAZ:
 *  - CP/özet projeksiyonu JSON'dan gelir, CP satırları app-main.js'in gerçek
 *    normalizeCPDates zinciriyle canlandırılır (kaynaktan çıkarılır, stub yok);
 *  - CP karar katmanı istemcinin yüklediği dosyalarla ayrı bir vm'de, istemci
 *    gibi beslenen BLStorage (kişisel kayıt > rol varsayılanı) ve supplier-sync
 *    birleştirmesiyle çalışır; özet onOverviewRendered (commit) sonrası okunur,
 *    satır öncelikleri tüm CP tablosunda (applyUnifiedPriorityAnalysis gibi);
 *  - boyut filtresi, grup sayımı, öncelik kodu app-main.js'in gerçek
 *    passesOvDimFilters / groupCount / actionPriorityCode fonksiyonlarıdır;
 *  - KPI, sezon × öncelik ve Buying Group hesabı main 3cc606d renderOverviewNow
 *    gövdesinin dondurulmuş kopyasıdır (yeni ortak modül ondan türetildi).
 * Aday ("candidate") gerçek sunucu yoludur: gzip projeksiyon → işçi görevi
 * (overview-model-task + WS1 veri kümesi önbelleği) → karar barındırıcısı;
 * bağlam overview-model-service createContextLoader ile sunucu kayıtlarından.
 * 30k satır: BUYER_LOG_PARITY_30K=1 ile (varsayılan pakette 2k).
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const parity=require('./helpers/read-model-parity.cjs');
const {extractFunction}=require('./helpers/app-main-functions');
const parse=require('../server/lib/parse'),tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const engine=require('../server/lib/read-model/query-engine');
const worker=require('../server/lib/read-model/read-model-worker');
const task=require('../server/lib/read-model/overview-model-task');
const {createContextLoader}=require('../server/lib/read-model/overview-model-service');
const {SCRIPTS}=require('../server/lib/read-model/overview-decision-host');
const Merge=require('../public/checklist-answer-merge-engine');
const OD=require('../public/order-decision-engine'),Rules=require('../public/cp-rules-engine');
const ROOT=path.resolve(__dirname,'..'),PUBLIC=path.join(ROOT,'public');
const SOURCE=fs.readFileSync(path.join(PUBLIC,'app-main.js'),'utf8');

/* ---------- tarayıcı (legacy) ---------- */
function block(start,end){const i=SOURCE.indexOf(start);if(i<0)throw new Error(start);return SOURCE.slice(i,SOURCE.indexOf(end,i)+end.length);}
const CLIENT_FUNCTIONS=['norm','toNum','turknorm','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','dateOrdinal',
  'normalizeTransitDelType','cpLogisticSegments','cpLogisticHasDetails','rebuildCpLogisticCaches','applyCpApprovalDate','normalizeCPDates',
  'passesOvDimFilters','actionPriorityCode','actionPriorityCodes','groupCount','isTurkeyCountry','compareSeasonValues'];
function loadClientFunctions(browser){
  const code=[
    'const ISO_DAY_CACHE_MAX = 20000;','const _isoDayCache = new Map();',
    block("const CP_BASELINE_DATE_KEYS = [","];"),block("const CP_DATE_KEYS = [","];"),block('const OV_DIM_META = {','\n};'),
    ...CLIENT_FUNCTIONS.map(name=>extractFunction(SOURCE,name)),
    `function ovStateFor(scope){return scope==='bg'?__filters.bg:__filters.main;}var __filters={main:{},bg:{}};`,
    `globalThis.__client={${CLIENT_FUNCTIONS.join(',')},setFilters:f=>{__filters=f;}};`,
  ].join('\n');
  vm.runInContext(code,browser,{filename:'app-main.js (parite)'});
  return browser.__client;
}
// İstemcinin cpAssistant özelliğinin yüklediği dosyalar, istemci gibi beslenmiş tarayıcı bağlamında.
async function loadBrowser({userId,personal,roleDefaults,shared,managed,plm,transitRules}){
  const local=new Map(Object.entries(personal||{}));
  // supplier-sync paylaşılan cevapları asistanın cevaplarına birleştirir (bekleyen yerel cevap yok).
  const own=JSON.parse(local.get('lcw.cp.checklist.v1')||'{}');
  local.set('lcw.cp.checklist.v1',JSON.stringify(Merge.merge(own,shared,{})));
  // user-storage.js getItem: kişisel kayıt, yoksa rol varsayılanı.
  const BLStorage={getItem:k=>local.has(k)?local.get(k):(roleDefaults[k]&&roleDefaults[k].value!=null?String(roleDefaults[k].value):null),
    setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),actualKey:k=>'bl.user.'+userId+'.'+k};
  const localStorage={getItem:()=>null,setItem(){},removeItem(){}};
  const json=value=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(value))});
  const noop=()=>{};
  const browser={console:{log:noop,warn:noop,error:noop,info:noop},Date,Map,Set,WeakMap,WeakSet,JSON,Promise,Intl,queueMicrotask,structuredClone,
    setTimeout:noop,clearTimeout:noop,localStorage,BLStorage,BL_USER_CONTEXT:{id:userId},appLang:'tr',state:{overrides:{transitRules}},
    document:{documentElement:{lang:'tr',dataset:{}},body:{dataset:{}},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop},
    fetch:async url=>url==='/api/cp-managed-rules'?json(managed):url==='/api/plm-requests'?json(plm):{ok:false,status:404,json:async()=>({})},
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},addEventListener:noop,dispatchEvent:()=>true,showToast:noop};
  browser.window=browser;browser.globalThis=browser;vm.createContext(browser);
  for(const name of SCRIPTS){
    const hide=name==='overview-premium.js',doc=browser.document;
    if(hide)browser.document=undefined;
    try{vm.runInContext(fs.readFileSync(path.join(PUBLIC,name),'utf8'),browser,{filename:name});}finally{browser.document=doc;}
  }
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  return {browser,client:loadClientFunctions(browser)};
}
async function legacyOverview(projection,ctx,filters){
  const {browser,client}=await loadBrowser(ctx);
  const A=browser.BLCpAssistant,OD=browser.BLOrderDecisionEngine;
  const cpAll=JSON.parse(projection.cpJson).rows;client.normalizeCPDates(cpAll);
  const summaryRows=JSON.parse(projection.summaryJson).rows;client.normalizeCPDates(summaryRows);
  client.setFilters({main:Object.fromEntries(Object.entries(filters.main).map(([d,v])=>[d,new Set(v)])),bg:Object.fromEntries(Object.entries(filters.bg).map(([d,v])=>[d,new Set(v)]))});
  const cpRows=cpAll.filter(r=>client.passesOvDimFilters(r,true,'main'));
  // renderOverviewNow: önce özet (commit), sonra CP tablosunun öncelik işi.
  A.onOverviewRendered(cpRows,{dataRevision:1,filterRevision:'parity'});
  const summary=A.overviewSummaryOf(A._state.model,A._state.checklist);
  const decided=A.computeDecisionsForRows(cpAll);
  for(const row of cpAll)row.Priority=client.actionPriorityCode(decided.byRow.get(row)?.priority)||'ON_TRACK';
  // --- main 3cc606d renderOverviewNow (dondurulmuş) ---
  const norm=client.norm,toNum=client.toNum,isTurkeyCountry=client.isTurkeyCountry,codes=client.actionPriorityCodes();
  const seasonMap={};
  cpRows.forEach(r=>{
    const season=norm(r['Season'])||'—';
    if(!seasonMap[season])seasonMap[season]={priorities:Object.fromEntries(codes.map(code=>[code,0])),qty:0,count:0};
    const code=client.actionPriorityCode(r['Priority']);
    if(code&&Object.prototype.hasOwnProperty.call(seasonMap[season].priorities,code))seasonMap[season].priorities[code]++;
    seasonMap[season].qty+=(toNum(r['Order Quantity'])||0);seasonMap[season].count++;
  });
  const seasonRows=Object.entries(seasonMap).sort((a,b)=>client.compareSeasonValues(a[0],b[0]));
  const orderRowsF=summaryRows.filter(r=>client.passesOvDimFilters(r,false,'main'));
  const active=orderRowsF.filter(r=>norm(r['Active/Inactive'])==='Active');
  const totalFobUsd=active.filter(r=>!isTurkeyCountry(r.Country)).reduce((s,r)=>s+(toNum(r['FOB ($)'])*toNum(r['Order Quantity'])||0),0);
  const totalFobTry=active.filter(r=>isTurkeyCountry(r.Country)).reduce((s,r)=>s+(toNum(r['FOB ($)'])*toNum(r['Order Quantity'])||0),0);
  const bgMap={};
  summaryRows.filter(r=>client.passesOvDimFilters(r,false,'bg')).forEach(r=>{
    const bg=norm(r['Buyer Grup (TR)'])||'—';
    if(!bgMap[bg])bgMap[bg]={total:0,active:0,remaining:0,totalQty:0,fobValueUsd:0,fobValueTry:0,totalFobValueUsd:0,totalFobValueTry:0};
    const d=bgMap[bg];d.total++;d.totalQty+=(toNum(r['Order Quantity'])||0);
    const val=(toNum(r['FOB ($)'])*toNum(r['Order Quantity'])||0);
    if(isTurkeyCountry(r.Country))d.totalFobValueTry+=val;else d.totalFobValueUsd+=val;
    if(norm(r['Active/Inactive'])==='Active'){d.active++;d.remaining+=(toNum(r['Remaining'])||0);if(isTurkeyCountry(r.Country))d.fobValueTry+=val;else d.fobValueUsd+=val;}
  });
  const bgRows=Object.entries(bgMap).sort((a,b)=>b[1].active-a[1].active);
  // --- İstisna Kutusu: BLExceptionInboxBridge (filter + analyze) + exception-inbox.js ---
  const Inbox=require('../public/exception-inbox'),Engine=browser.BLCpReadinessEngine;
  const inbox=await Inbox.project(cpAll,{fields:require('../server/lib/canonical-fields'),analyze:row=>Engine.analyzeOrder(row,{transitRules:ctx.transitRules}),
    filter:row=>client.passesOvDimFilters(row,true,'main'),yield:()=>Promise.resolve()});
  return {
    cp:{rows:cpRows.length,country:client.groupCount(cpRows,'Country'),subManufacturer:client.groupCount(cpRows,'Sub-Manufacturer'),
      season:{codes,labels:Object.fromEntries(codes.map(code=>[code,{tr:OD.priorityLabel(code,'tr')||'',en:OD.priorityLabel(code,'en')||''}])),
        rows:seasonRows.map(([label,data])=>({label,count:data.count,qty:data.qty,priorities:data.priorities}))},
      summary,notes:cpRows.filter(r=>norm(r['Notes'])||norm(r['Ek Not'])).map(r=>r._id)},
    exceptionInbox:inbox,
    orders:{kpi:{total:orderRowsF.length,active:active.length,fobUsd:totalFobUsd,fobTry:totalFobTry},
      buyingGroup:bgRows.map(([label,d])=>({label,active:d.active,total:d.total,remaining:d.remaining,totalQty:d.totalQty,fobUsd:d.fobValueUsd,fobTry:d.fobValueTry,totalFobUsd:d.totalFobValueUsd,totalFobTry:d.totalFobValueTry}))},
  };
}

/* ---------- sunucu (candidate) ---------- */
let lastCandidate=null;
async function candidateOverview(projection,ctx,filters){
  task.clearHosts();worker.cache.clear();
  const loader=createContextLoader({
    preferences:{load:()=>({entries:Object.fromEntries(Object.entries(ctx.personal||{}).map(([k,v])=>[k,{value:v}]))})},
    roleEntries:()=>ctx.roleDefaults,managedRules:()=>ctx.managed,transitRules:()=>ctx.transitRules,plmPayload:()=>ctx.plm,
    checklistPayload:()=>ctx.shared,revision:()=>'r1',merge:(own,shared)=>Merge.merge(own,shared)});
  const context=loader({id:ctx.userId});
  const deps={cache:worker.cache,engine};
  const spec=(module,json)=>({datasetKey:module+'-'+projection.id,scopeKey:module,buffer:Uint8Array.from(zlib.gzipSync(Buffer.from(json))).buffer});
  const payload={cp:spec('cp',projection.cpJson),overview:spec('overview',projection.summaryJson),contextKey:'c1',context:context.value,filters,lang:'tr'};
  const out=await task.execute(payload,deps);
  assert.ok(out.body,'işçi sonucu döndü');
  const model=JSON.parse(out.body);
  assert.equal(model.version,1);assert.equal(model.parts,"full");delete model.version;delete model.parts;
  model.cp.notes=model.cp.notes.map(r=>r._id);
  lastCandidate=model;
  return model;
}

/* ---------- fixture ---------- */
const TODAY=new Date();
const todayIso=`${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}`;
function projections(rows){
  const fx=parity.makeFixture({rows,today:todayIso});
  const asas=parse.parseASASRows(fx.asas).orders,antrepo=parse.parseAntrepoRows(fx.antrepo);
  // Not hatırlatıcısı için birkaç satıra not (kullanıcının ve başkasının).
  const src={loadedAt:'r1',asasOrders:asas,asasOrdersByTarget:{cp:asas,orders:asas},antrepoMap:antrepo,lflRows:[]};
  const buyers=[...new Set(asas.map(row=>row.buyer))].sort();
  const scoped=(user)=>{
    const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,
      viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:user.buyers},editScopes:{buyers:user.buyers},
      authority:Object.fromEntries(asas.map(row=>[row.ocode,[row]])),profiles:[]});
    const built=tasks.buildProjections(src,{modules:['cp','overview'],overrides:{},horizons:{},access:ctx});
    built.cp.rows.slice(0,40).forEach((row,i)=>{row['Notes']=i%3?'Numune bekleniyor':'';row['Ek Not']=i%4===0?'Fiyat kontrol':'';row._notesBy=user.id;});
    return {id:`${rows}-${user.id}`,cpRows:built.cp.rows.length,cpJson:tasks.serialize({rows:built.cp.rows},'projection'),summaryJson:tasks.serialize({rows:built.overview.rows},'projection')};
  };
  return {buyers,scoped};
}
function decisionContext(userId){
  const catalog=OD.normalizePriorityCatalog([{id:'prio:vip-acil',tr:'VIP Acil',en:'VIP Urgent',tone:'red',isRisk:true},...OD.DEFAULT_PRIORITY_CATALOG]);
  const rule=Rules.normalizeRule({id:'vip-qty',kind:'priority',target:'prio:vip-acil',name:'VIP Adet',conditions:[{field:'@qty',operator:'gte',value:4000}]},{priorityCatalog:catalog});
  return {
    userId,
    personal:{'lcw.cp.rules.priority.v1':JSON.stringify({version:1,rules:[rule],deletedRuleIds:[],priorityCatalog:catalog}),
      'lcw.cp.checklist.v1':JSON.stringify({})},
    roleDefaults:{'lcw.cp.assistant.v1':{value:JSON.stringify({settings:{targetType:'retail'},checklistSettings:{enabled:true}})}},
    shared:{answers:{},tombstones:{}},
    managed:{rules:[],deletedRuleIds:[],priorityCatalog:[],checklistStatuses:[],revision:0},
    plm:{models:{},updatedAt:null},
    transitRules:[{id:'t-sea',seasons:[],countries:[],delType:'',days:35,exfStart:'',exfEnd:''}],
  };
}
const SCENARIOS=[
  {name:'filtre yok',filters:{main:{},bg:{}}},
  {name:'ülke + sezon filtresi, ayrı BG filtresi',filters:{main:{country:['Egypt','Turkey']},bg:{orderStatus:['Active']}}},
];

async function runParity(rows,users){
  const {buyers,scoped}=projections(rows),seen=new Set();
  for(const user of users(buyers)){
    const projection=scoped(user);
    assert.ok(projection.cpRows>0,`${user.id}: kapsamda CP satırı var`);
    const ctx=decisionContext(user.id);
    for(const scenario of SCENARIOS){
      const result=await parity.assertParity({name:`overview-model ${rows} ${user.id} ${scenario.name}`,rows:[],context:{},
        legacy:()=>legacyOverview(projection,ctx,scenario.filters),candidate:()=>candidateOverview(projection,ctx,scenario.filters)});
      assert.ok(result.equal);
      // Parite boş/kararsız veride geçmesin: kişisel kural, not, istisna ve öncelik dağılımı gerçekten üretildi.
      const m=lastCandidate,vip=m.cp.season.rows.reduce((sum,row)=>sum+(row.priorities['prio:vip-acil']||0),0);
      assert.ok(vip>0,'kişisel öncelik kuralı (prio:vip-acil) satırlara uygulandı');
      assert.ok(m.cp.summary.priorities.find(item=>item.key==='prio:vip-acil').rows>0,'özet özel etiketi sayıyor');
      assert.ok(m.cp.summary.checklist&&m.cp.summary.checklist.items.length>0,'checklist özeti dolu');
      assert.ok(m.cp.notes.length>0&&m.exceptionInbox.total>0&&m.orders.kpi.total>0,'not, istisna ve KPI dolu');
      seen.add(`${user.id}|${scenario.name}|${m.cp.rows}|${m.orders.kpi.total}`);
    }
  }
  assert.equal(new Set([...seen].map(key=>key.split('|').slice(2).join('|'))).size,seen.size,'kapsam ve filtre senaryoları farklı satır kümeleri üretti');
}
const twoScopes=buyers=>[{id:'moderator',all:true,buyers:[]},{id:'buyer-a',all:false,buyers:buyers.slice(0,Math.ceil(buyers.length/2))}];

test('Genel Bakış modeli: 2k fixture, iki yetki kapsamı ve iki filtre senaryosunda istemciyle hash-eşit',{timeout:180000},async()=>{
  await runParity(2000,twoScopes);
});
test('Genel Bakış modeli: 30k fixture (BUYER_LOG_PARITY_30K=1)',{skip:process.env.BUYER_LOG_PARITY_30K!=='1',timeout:900000},async()=>{
  await runParity(30000,twoScopes);
});
