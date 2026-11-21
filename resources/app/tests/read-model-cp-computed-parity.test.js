'use strict';
/* WS5 (#1078) parite kapısı: CP hesaplanmış sütunları (yerel arka uç işçisi)
 * tarayıcıdaki CP hesabıyla aynı sonucu üretmelidir.
 *
 * Eski yol ("legacy") tarayıcıyı taklit eder ve sunucu modülü KULLANMAZ:
 *  - CP projeksiyonu JSON'dan gelir; satırlar app-main.js'in gerçek normalizeCPDates
 *    zinciriyle canlandırılır;
 *  - karar katmanı istemcinin yüklediği dosyalarla ayrı vm'de, istemci gibi beslenen
 *    BLStorage (kişisel kayıt > rol varsayılanı) ve supplier-sync birleştirmesiyle;
 *  - öncelik sütunları app-main.js'in GERÇEK syncUnifiedPrioritiesForTable /
 *    applyUnifiedPriorityAnalysis / computeFlags fonksiyonlarıyla yazılır;
 *  - checklist hücreleri GERÇEK checklist-supplier-sync.js refreshColumns ile,
 *    CP çiziminin kullandığı karar nesnesiyle (peekDecisionsForRows) yazılır.
 * Aday ("candidate") gerçek sunucu yoludur: gzip projeksiyon → işçi görevi
 * (cp-computed-task + WS1 veri kümesi önbelleği) → karar barındırıcısı; bağlam
 * WS2a createContextLoader ile; değerler istemcinin GERÇEK applyCpComputedColumns
 * fonksiyonuyla ayrı bir tarayıcı bağlamındaki taze satırlara uygulanır.
 * Karşılaştırma: satır başına bütün hesaplanmış sütunlar (öncelik kodu, nedenler,
 * sinyaller, etiketler, hesap durumu, revizyon temel önceliği, checklist hücre/durum/
 * parça/bileşen/görev) kanonik hash olarak eşit.
 * 30k satır: BUYER_LOG_PARITY_30K=1 ile (varsayılan pakette 2k).
 */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),zlib=require('node:zlib');
const parity=require('./helpers/read-model-parity.cjs');
const {extractFunction}=require('./helpers/app-main-functions');
const parse=require('../server/lib/parse'),tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const engine=require('../server/lib/read-model/query-engine');
const worker=require('../server/lib/read-model/read-model-worker');
const task=require('../server/lib/read-model/cp-computed-task');
const overviewTask=require('../server/lib/read-model/overview-model-task');
const {createContextLoader}=require('../server/lib/read-model/overview-model-service');
const {SCRIPTS}=require('../server/lib/read-model/overview-decision-host');
const Merge=require('../public/checklist-answer-merge-engine');
const OD=require('../public/order-decision-engine'),Rules=require('../public/cp-rules-engine'),Readiness=require('../public/cp-readiness-engine');
const ROOT=path.resolve(__dirname,'..'),PUBLIC=path.join(ROOT,'public');
const SOURCE=fs.readFileSync(path.join(PUBLIC,'app-main.js'),'utf8');

/* ---------- tarayıcı ---------- */
function block(start,end){const i=SOURCE.indexOf(start);if(i<0)throw new Error(start);return SOURCE.slice(i,SOURCE.indexOf(end,i)+end.length);}
const CLIENT_FUNCTIONS=['norm','toNum','turknorm','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','dateOrdinal',
  'toDateOnly','daysBetween','mondayOf','isProductionStatus','normalizeTransitDelType','cpLogisticSegments','cpLogisticHasDetails',
  'rebuildCpLogisticCaches','applyCpApprovalDate','normalizeCPDates','actionPriorityCode','computeFlags','unifiedPriorityRowActive',
  'applyUnifiedPriorityAnalysis','syncUnifiedPrioritiesForTable','applyCpComputedRow','applyCpComputedColumns'];
function loadClientFunctions(browser){
  const code=[
    'const ISO_DAY_CACHE_MAX = 20000;','const _isoDayCache = new Map();',
    block("const CP_BASELINE_DATE_KEYS = [","];"),block("const CP_DATE_KEYS = [","];"),block('const CP_COMPUTED_HIDDEN=[','];'),
    'const _unifiedPriorityCache={cp:null,orders:null};const _unifiedPriorityTableRevision={cp:1,orders:1};',
    'let _cpPriorityIndex=null,_cpPriorityIndexRevision=0;const cpComputed={applied:null};const cpComputedEligible=()=>false;',
    ...CLIENT_FUNCTIONS.map(name=>extractFunction(SOURCE,name)),
    `globalThis.__client={${CLIENT_FUNCTIONS.join(',')}};`,
  ].join('\n');
  vm.runInContext(code,browser,{filename:'app-main.js (parite)'});
  return browser.__client;
}
async function loadBrowser({userId,personal,roleDefaults,shared,managed,plm,transitRules,tasks:taskList}){
  const local=new Map(Object.entries(personal||{}));
  const own=JSON.parse(local.get('lcw.cp.checklist.v1')||'{}');
  local.set('lcw.cp.checklist.v1',JSON.stringify(Merge.merge(own,shared,{})));
  const BLStorage={getItem:k=>local.has(k)?local.get(k):(roleDefaults[k]&&roleDefaults[k].value!=null?String(roleDefaults[k].value):null),
    setItem:(k,v)=>local.set(k,String(v)),removeItem:k=>local.delete(k),actualKey:k=>'bl.user.'+userId+'.'+k};
  const localStorage={getItem:()=>null,setItem(){},removeItem(){}};
  const json=value=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(value))});
  const noop=()=>{};
  const browser={console:{log:noop,warn:noop,error:noop,info:noop},Date,Map,Set,WeakMap,WeakSet,JSON,Promise,Intl,queueMicrotask,structuredClone,
    setTimeout:noop,clearTimeout:noop,localStorage,BLStorage,BL_USER_CONTEXT:{id:userId},appLang:'tr',state:{overrides:{transitRules},cp:null},
    document:{documentElement:{lang:'tr',dataset:{}},body:{dataset:{}},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop},
    fetch:async url=>url==='/api/cp-managed-rules'?json(managed):url==='/api/plm-requests'?json(plm):url==='/api/test-reports/tasks'?json({tasks:taskList||[]}):{ok:false,status:404,json:async()=>({})},
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},addEventListener:noop,dispatchEvent:()=>true,showToast:noop,
    COLS_BY_TABLE:{cp:[]}};
  browser.window=browser;browser.globalThis=browser;
  browser.BLFormulaRows={cp:()=>browser.state.cp&&browser.state.cp.rows||[]};
  vm.createContext(browser);
  for(const name of [...SCRIPTS,'checklist-supplier-sync.js']){
    const hide=name==='overview-premium.js',doc=browser.document;
    if(hide)browser.document=undefined;
    try{vm.runInContext(fs.readFileSync(path.join(PUBLIC,name),'utf8'),browser,{filename:name});}finally{browser.document=doc;}
  }
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  // İstemci: supplier-sync startRuntime → loadTestReportTasks (sunucu yetkili görevleri).
  await browser.BLChecklistSupplierSync.loadTestReportTasks();
  return {browser,client:loadClientFunctions(browser)};
}
// Bir satırın bütün hesaplanmış sütunları (istemcinin ekranda/filtrede/exportta okuduğu alanlar).
function computedOf(rows,columns){
  return rows.map(row=>({id:String(row._id),priority:row.Priority,calculationStatus:row._calculationStatus,trackingTags:row._trackingTags,priorityTags:row._priorityTags,
    reasons:row._actionPriorityReasons,signals:row._actionPrioritySignals,basePriority:row._unifiedBasePriority,
    revisionBase:row._revBaseRow?row._revBaseRow.Priority:null,
    cells:Object.fromEntries(columns.map(key=>[key,row[key]===undefined?null:row[key]])),
    checklist:{status:row._checklistStatus||null,parts:row._checklistParts||null,elements:row._checklistElements||null,tasks:row._checklistTasks||null,single:row._checklistSingleSet===true}}));
}
async function legacyComputed(projection,ctx){
  const {browser,client}=await loadBrowser(ctx);
  const A=browser.BLCpAssistant;
  const rows=JSON.parse(projection.cpJson).rows;client.normalizeCPDates(rows);
  browser.state.cp={rows};
  // scheduleUnifiedPrioritiesForTable: CP satırlarının kararı, sonra gerçek senkron (revizyon temeli dahil).
  const result=A.computeDecisionsForRows(rows);
  assert.equal(client.syncUnifiedPrioritiesForTable('cp',result),true);
  // CP çizimi (wrapRender): aynı karar nesnesiyle checklist sütunları.
  const decision=A.peekDecisionsForRows(rows)||result;
  browser.BLChecklistSupplierSync.refreshColumns({render:false,decision,reuse:true});
  const columns=browser.COLS_BY_TABLE.cp.filter(col=>col.checklistSupplierColumn).map(col=>col.k);
  return {columns,computed:computedOf(rows,columns)};
}

/* ---------- sunucu (candidate) ---------- */
function contextFor(ctx){
  return createContextLoader({
    preferences:{load:()=>({entries:Object.fromEntries(Object.entries(ctx.personal||{}).map(([k,v])=>[k,{value:v}]))})},
    roleEntries:()=>ctx.roleDefaults,managedRules:()=>ctx.managed,transitRules:()=>ctx.transitRules,plmPayload:()=>ctx.plm,
    checklistPayload:()=>ctx.shared,revision:()=>'r1',merge:(own,shared)=>Merge.merge(own,shared)})({id:ctx.userId});
}
async function candidateRun(projection,ctx,{since=null,fresh=true}={}){
  if(fresh){task.clearHosts();worker.cache.clear();}
  const deps={cache:worker.cache,engine};
  const dataset={datasetKey:'cp-overview-'+projection.id,scopeKey:'cp-overview'};
  if(!worker.cache.get(dataset.datasetKey))dataset.buffer=Uint8Array.from(zlib.gzipSync(Buffer.from(projection.cpJson))).buffer;
  const out=await task.execute({dataset,scopeKey:'s-'+ctx.userId,lang:'tr',since,context:contextFor(ctx).value,tasks:ctx.tasks||[]},deps);
  assert.ok(out.body,'işçi sonucu döndü');
  return {columns:JSON.parse(out.body),timing:out.timing};
}
async function candidateClient(projection,ctx){
  const {browser,client}=await loadBrowser(ctx);
  const rows=JSON.parse(projection.cpJson).rows;client.normalizeCPDates(rows);
  browser.state.cp={rows};
  return {browser,client,rows};
}

/* ---------- fixture ---------- */
const TODAY=new Date();
const todayIso=`${TODAY.getFullYear()}-${String(TODAY.getMonth()+1).padStart(2,'0')}-${String(TODAY.getDate()).padStart(2,'0')}`;
function projections(rows){
  const fx=parity.makeFixture({rows,today:todayIso});
  const asas=parse.parseASASRows(fx.asas).orders,antrepo=parse.parseAntrepoRows(fx.antrepo);
  const src={loadedAt:'r1',asasOrders:asas,asasOrdersByTarget:{cp:asas,orders:asas},antrepoMap:antrepo,lflRows:[]};
  const buyers=[...new Set(asas.map(row=>row.buyer))].sort();
  const scoped=user=>{
    const ctx=access.createAccessContext({userId:user.id,systemRole:user.all?'moderator':'buyer',manageAll:user.all,
      viewScope:{all:user.all,mode:user.all?'ALL':'CUSTOM',buyers:user.buyers},editScopes:{buyers:user.buyers},
      authority:Object.fromEntries(asas.map(row=>[row.ocode,[row]])),profiles:[]});
    const built=tasks.buildProjections(src,{modules:['cp'],overrides:{},horizons:{},access:ctx});
    // Elle tarih revizyonu (overrides.datemap'in projeksiyondaki izi): ASAS orijinali farklı.
    built.cp.rows.forEach((row,i)=>{
      if(i%23!==0)return;
      for(const [key,field] of [['Retail Date','_asasRetailDate'],['Ex-factory','_asasExFactory']]){
        const d=row[key]?new Date(row[key]):null;if(!d||Number.isNaN(d.getTime()))continue;
        d.setDate(d.getDate()+(i%2?12:-40));row[field]=d.toISOString().slice(0,10);
      }
    });
    const keys=built.cp.rows.map(row=>Readiness.analyzeOrder(row).orderKey);
    return {id:`${rows}-${user.id}`,cpRows:built.cp.rows.length,keys,cpJson:tasks.serialize({rows:built.cp.rows},'projection')};
  };
  return {buyers,scoped};
}
const ITEMS=['pps','soff','artwork','tests','fabric'];
function answersFor(keys,salt){
  const answers={};
  keys.forEach((key,i)=>{
    if((i+salt)%7===0)answers[`${key}::${ITEMS[i%ITEMS.length]}`]={state:'approved',at:'2026-01-0'+(1+i%8)+'T10:00:00.000Z',by:'u'};
    else if((i+salt)%11===0)answers[`${key}::${ITEMS[(i+1)%ITEMS.length]}`]={state:'rejected',at:'2026-01-0'+(1+i%8)+'T11:00:00.000Z',by:'u',note:'Renk farkı'};
  });
  return answers;
}
function decisionContext(userId,keys,{salt=0}={}){
  const catalog=OD.normalizePriorityCatalog([{id:'prio:vip-acil',tr:'VIP Acil',en:'VIP Urgent',tone:'red',isRisk:true},...OD.DEFAULT_PRIORITY_CATALOG]);
  const rule=Rules.normalizeRule({id:'vip-qty',kind:'priority',target:'prio:vip-acil',name:'VIP Adet',conditions:[{field:'@qty',operator:'gte',value:4000}]},{priorityCatalog:catalog});
  const own=answersFor(keys.slice(0,Math.ceil(keys.length/2)),salt);
  const shared=answersFor(keys.slice(Math.ceil(keys.length/2)),salt+3);
  return {
    userId,
    // 2026-11-21: yerleşik kural yok; eski tanımlar kullanıcı kuralı olarak kurulur.
    personal:{...require('./fixtures/legacy-builtin-rules').storeEntries({extraPriority:[rule],priorityCatalog:catalog}),
      'lcw.cp.checklist.v1':JSON.stringify(own)},
    roleDefaults:{'lcw.cp.assistant.v1':{value:JSON.stringify({settings:{targetType:'retail'},checklistSettings:{enabled:true}})}},
    shared:{answers:shared,tombstones:{}},
    managed:{rules:[],deletedRuleIds:[],priorityCatalog:[],checklistStatuses:[],revision:0},
    plm:{models:{},updatedAt:null},
    transitRules:[{id:'t-sea',seasons:[],countries:[],delType:'',days:35,exfStart:'',exfEnd:''}],
    tasks:keys.filter((_,i)=>i%97===5).map((orderKey,i)=>({id:'t'+i,orderKey,itemId:'tests',kind:'buying-review',title:'Buyingden dönüş bekleniyor'})),
  };
}

async function runParity(rows,users){
  const {buyers,scoped}=projections(rows),totals=new Set();
  for(const user of users(buyers)){
    const projection=scoped(user);
    assert.ok(projection.cpRows>0,`${user.id}: kapsamda CP satırı var`);
    const ctx=decisionContext(user.id,projection.keys);
    let candidate=null,client=null;
    const first=await parity.assertParity({name:`cp-computed ${rows} ${user.id} tam`,rows:[],context:{},
      legacy:async()=>(await legacyComputed(projection,ctx)).computed,
      candidate:async()=>{
        candidate=await candidateRun(projection,ctx);
        assert.equal(candidate.columns.delta,false);assert.equal(candidate.columns.total,projection.cpRows);
        client=await candidateClient(projection,ctx);
        assert.equal(client.client.applyCpComputedColumns(client.rows,candidate.columns,null),projection.cpRows);
        const columns=client.browser.BLCpAssistant&&Object.keys(candidate.columns.rows[0][8]?.cells||{});
        return computedOf(client.rows,columns);
      }});
    assert.ok(first.equal);
    // Parite boş/kararsız veride geçmesin.
    const values=candidate.columns.rows;
    assert.ok(values.some(row=>row[1]==='prio:vip-acil'),'kişisel öncelik kuralı uygulandı');
    assert.ok(values.some(row=>row[7]!=null),'revizyonlu satırın temel önceliği üretildi');
    assert.ok(values.some(row=>row[8]&&Object.values(row[8].status).includes('approved'))&&values.some(row=>row[8]&&Object.values(row[8].status).includes('rejected')),'checklist cevapları hücrelere işlendi');
    assert.ok(values.some(row=>row[8]&&Object.keys(row[8].tasks).length),'test raporu görevi hücrede');
    totals.add(projection.cpRows);

    // Bağlam değişikliği (checklist cevabı): aynı barındırıcı, yalnız değişen satırlar döner.
    const ctx2=decisionContext(user.id,projection.keys,{salt:1});
    const next=await parity.assertParity({name:`cp-computed ${rows} ${user.id} cevap deltası`,rows:[],context:{},
      legacy:async()=>(await legacyComputed(projection,ctx2)).computed,
      candidate:async()=>{
        const delta=await candidateRun(projection,ctx2,{since:candidate.columns.token,fresh:false});
        assert.equal(delta.columns.delta,true,'önceki sonuca göre delta');
        assert.ok(delta.columns.rows.length>0&&delta.columns.rows.length<projection.cpRows,`yalnız etkilenen satırlar (${delta.columns.rows.length}/${projection.cpRows})`);
        assert.equal(delta.timing.phases.hostMs,0,'cevap değişikliğinde barındırıcı yeniden kurulmadı');
        client.client.applyCpComputedColumns(client.rows,delta.columns,candidate.columns.token);
        return computedOf(client.rows,Object.keys(candidate.columns.rows[0][8]?.cells||{}));
      }});
    assert.ok(next.equal);
  }
  assert.equal(totals.size,2,'iki yetki kapsamı farklı satır kümeleri üretti');
}
const twoScopes=buyers=>[{id:'moderator',all:true,buyers:[]},{id:'buyer-a',all:false,buyers:buyers.slice(0,Math.ceil(buyers.length/2))}];

test('CP hesaplanmış sütunlar: 2k fixture, iki yetki kapsamı, tam + cevap deltası istemciyle hash-eşit',{timeout:300000},async()=>{
  await runParity(2000,twoScopes);
});
test('CP hesaplanmış sütunlar: 30k fixture (BUYER_LOG_PARITY_30K=1)',{skip:process.env.BUYER_LOG_PARITY_30K!=='1',timeout:1800000},async()=>{
  await runParity(30000,twoScopes);
});

test('CP hesaplanmış sütunlar paylaşılan cp-overview veri kümesinde Genel Bakış modelini değiştirmez',{timeout:120000},async()=>{
  const {scoped}=projections(600),projection=scoped({id:'moderator',all:true,buyers:[]});
  const ctx=decisionContext('moderator',projection.keys);
  worker.cache.clear();task.clearHosts();overviewTask.clearHosts();
  const deps={cache:worker.cache,engine},key='cp-overview-shared';
  const summaryJson=tasks.serialize({rows:[]},'projection');
  const overview=async()=>{
    overviewTask.clearHosts();
    const cp=worker.cache.get(key)?{datasetKey:key,scopeKey:'cp-overview'}:{datasetKey:key,scopeKey:'cp-overview',buffer:Uint8Array.from(zlib.gzipSync(Buffer.from(projection.cpJson))).buffer};
    const out=await overviewTask.execute({parts:'full',cp,overview:{datasetKey:'ov-'+key,scopeKey:'ov',buffer:Uint8Array.from(zlib.gzipSync(Buffer.from(summaryJson))).buffer},
      contextKey:'c1',context:contextFor(ctx).value,filters:{main:{},bg:{}},lang:'tr'},deps);
    assert.ok(out.body);return out.body;
  };
  const before=await overview();
  const computed=await task.execute({dataset:{datasetKey:key,scopeKey:'cp-overview'},scopeKey:'s',lang:'tr',context:contextFor(ctx).value,tasks:ctx.tasks},deps);
  assert.ok(computed.body&&JSON.parse(computed.body).total===projection.cpRows,'aynı veri kümesi kullanıldı (yeniden çözülmedi)');
  assert.equal(computed.timing.loadMs,0);
  assert.equal(await overview(),before);
});

/* WS5 alt PR 3: düzenleme sonrası yeni nesilde yalnız etkilenen satırlar (kaynağı değişenler + aynı
   sipariş/opsiyon grubu) yeniden hesaplanır. Artımlı sonuç, aynı veri üzerinde sıfırdan tam hesapla
   hash-eşit olmalı; aksi halde artımlı yol kullanılamaz. */
async function incrementalParity(rows,user){
  const {scoped}=projections(rows),projection=scoped(user);
  const ctx=decisionContext(user.id,projection.keys),context=contextFor(ctx).value;
  const deps={cache:worker.cache,engine};
  const run=(json,key,extra={})=>task.ensureComputed({dataset:{datasetKey:key,scopeKey:'cp-overview',buffer:Uint8Array.from(zlib.gzipSync(Buffer.from(json))).buffer},
    scopeKey:'s-'+user.id,lang:'tr',context,tasks:ctx.tasks||[],...extra},deps);
  worker.cache.clear();task.clearHosts();
  const first=await run(projection.cpJson,'gen-1');
  assert.equal(first.incremental,false);
  // Düzenleme: birkaç satırın tarih revizyonu ve notu (kullanıcı düzenlemesinin projeksiyondaki izi;
  // lojistik parsiyelden türetilen Del. Type ve onaydan gelen Ex-factory işçide yeniden türetilir).
  const doc=JSON.parse(projection.cpJson),edited=[];
  doc.rows.forEach((row,i)=>{
    if(i%331!==3)return;
    for(const key of ['Retail Date','In-Store (Model Budget)']){
      const d=row[key]?new Date(row[key]):null;
      if(d&&!Number.isNaN(d.getTime())){d.setDate(d.getDate()-120);row[key]=d.toISOString().slice(0,10);}
    }
    row['Notes']='düzenlendi '+i;edited.push(String(row._id));
  });
  assert.ok(edited.length>=2);
  const json=tasks.serialize(doc,'projection');
  const incremental=await run(json,'gen-2');
  assert.equal(incremental.incremental,true,'artımlı yol kullanıldı');
  const info=incremental.current.phases.incremental;
  assert.equal(info.changed,edited.length,'yalnız düzenlenen satırlar değişmiş sayıldı: '+JSON.stringify(info));
  assert.ok(info.targets>=edited.length&&info.targets<incremental.current.rows.length/4,`yeniden hesaplanan satır ${info.targets}/${incremental.current.rows.length}`);
  const incrementalTuples=[...incremental.current.serialized.values()];
  // Sıfırdan tam hesap (yeni barındırıcı) ile karşılaştır.
  worker.cache.clear();task.clearHosts();
  const full=await run(json,'gen-2-full');
  assert.equal(full.incremental,false);
  const result=await parity.assertParity({name:`cp-computed artımlı ${rows} ${user.id}`,rows:[],context:{},
    legacy:()=>[...full.current.serialized.values()].map(value=>JSON.parse(value)),candidate:()=>incrementalTuples.map(value=>JSON.parse(value))});
  assert.ok(result.equal);
  // Düzenleme gerçekten bir şeyi değiştirdi (boş parite değil).
  const before=new Map([...first.current.serialized].map(([id,v])=>[id,v]));
  assert.ok(edited.some(id=>before.get(id)!==full.current.serialized.get(id)),'düzenlenen satırların hesaplanmış değeri değişti');
}
test('CP hesaplanmış sütunlar: düzenleme sonrası artımlı yeniden hesap tam hesapla hash-eşit (2k, iki kapsam)',{timeout:600000},async()=>{
  const {buyers}=projections(2000);
  for(const user of twoScopes(buyers))await incrementalParity(2000,user);
});
test('CP hesaplanmış sütunlar: artımlı yeniden hesap 30k (BUYER_LOG_PARITY_30K=1)',{skip:process.env.BUYER_LOG_PARITY_30K!=='1',timeout:1800000},async()=>{
  const {buyers}=projections(30000);
  for(const user of twoScopes(buyers))await incrementalParity(30000,user);
});
