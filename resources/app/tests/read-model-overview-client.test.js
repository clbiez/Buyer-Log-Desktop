'use strict';
/* WS2a (#1074): istemci tarafı — özellik anahtarı ve geri dönüş, saf modüllerin
   app-main.js ile eşitliği, İstisna Kutusu'nun önceden hesaplanmış sonucu,
   Nabız/Termin Ufku'nun özetten çizilmesi. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const Model=require('../public/overview-model'),Inbox=require('../public/exception-inbox');
const Premium=require('../public/overview-premium'),OD=require('../public/order-decision-engine');
const ROOT=path.resolve(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const VIEW=fs.readFileSync(path.join(ROOT,'public','cp-overview-assistant.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const fn=name=>{const start=APP.indexOf(`function ${name}(`);assert.ok(start>=0,name);return APP.slice(start,APP.indexOf('\nfunction ',start+10));};

test('feature switch: model path only when BL_READ_MODEL_OVERVIEW is not false and not materialized; legacy path intact',()=>{
  assert.match(APP,/function overviewReadModelEnabled\(\)\{return window\.BL_READ_MODEL_OVERVIEW!==false&&!overviewReadModel\.materialized;\}/);
  const render=fn('renderOverviewNow');
  assert.match(render,/if\(overviewReadModelEnabled\(\)\)\{renderOverviewFromModel\(\);return;\}\n  const cpRows = ovFilteredCpRows\(\);/);
  // Eski yol (anahtar kapalı) CP bağımlılığını ve istemci karar katmanını aynen kullanır.
  assert.match(render,/window\.BLCpAssistant\?\.onOverviewRendered\?\.\(cpRows,/);
  assert.match(render,/void ensureOverviewCpDependency\(\)/);
  // Model yolu CP projeksiyonu indirmez, istemcide karar hesaplamaz.
  const fromModel=fn('renderOverviewFromModel');
  assert.doesNotMatch(fromModel,/ensureCpLoaded|ensureOverviewCpDependency|onOverviewRendered|computeDecisionsForRows|state\.cp\b/);
  assert.match(fromModel,/showOverviewSummary\?\.\(summary,\{materialize:materializeOverview\}\)/);
});

test('fallback: any model error switches this session to the client path; tıklama materialize ile eski yolu hazırlar',()=>{
  const request=fn('requestOverviewModel');
  assert.match(request,/fetch\('\/api\/read-model\/overview\/model',\{method:'POST'/);
  assert.match(request,/\.catch\(error=>\{[\s\S]*overviewReadModel\.materialized=true;[\s\S]*scheduleOverviewRender\('overview-model-fallback'\)/);
  // Codex #1085: geri dönüşte asistan kartı bayat sunucu özetini bırakır (aksi halde eski yol çizimi görünmez).
  assert.match(request,/overviewReadModel\.materialized=true;\s*\/\/[^\n]*\n\s*window\.BLCpAssistant\?\.showOverviewSummary\?\.\(null\);/);
  // Eski yanıt yeni filtrenin sonucunu ezmez.
  assert.match(request,/if\(serial!==slot\.serial\)return slot\.data/);
  assert.match(request,/if\(serial!==slot\.serial\)return null/);
  // İki aşama (#1085 koordinasyon): hızlı aşama önce, tam aşama yalnız ondan sonra.
  assert.match(fn('requestOverviewModelParts'),/requestOverviewModel\('fast'\)\.then\(fast=>fast&&overviewReadModelEnabled\(\)\?requestOverviewModel\('full'\):null\)/);
  const materialize=fn('materializeOverview');
  assert.match(materialize,/overviewReadModel\.materialized=true;[\s\S]*await ensureCpLoaded\(\{deferRender:true,reason:'overview'\}\)/);
  assert.match(materialize,/if\(!loaded\|\|!state\.cp\)\{overviewReadModel\.materialized=false;/);
  // Kişisel bağlam değişince önce sunucu tercih kaydı beklenir, sonra model yenilenir.
  assert.match(APP,/addEventListener\('bl:cp-decision-context-changed',\(\)=>\{[\s\S]{0,200}flushPending\?\.\(\)[\s\S]{0,160}overviewReadModel\.parts\.full\.dirty=true/);
  // Durum nesnesi ilk kullanımdan (scheduleOverviewRender) önce tanımlıdır (TDZ yok).
  assert.ok(APP.indexOf('const overviewReadModel=')<APP.indexOf('function scheduleOverviewRender('));
  assert.ok(INDEX.indexOf('overview-model.js')>0&&INDEX.indexOf('overview-model.js')<INDEX.indexOf('app-main.js'),'ortak modül app-main.js öncesi yüklenir');
});

test('first paint: KPI and Buying Group draw from overview summary rows without waiting for the model; decision cards only from the full part',()=>{
  const fromModel=fn('renderOverviewFromModel');
  assert.match(fromModel,/const full=overviewModelPart\('full'\),fast=overviewModelPart\('fast'\)/);
  assert.match(fromModel,/void requestOverviewModelParts\(\)/);
  // KPI / BG: model değil, açılışta indirilen özet satırları.
  assert.match(fromModel,/const summaryRows=overviewSummaryRows\(\);\n  if\(state\.orderSummary\|\|state\.overviewSummary\)\{/);
  assert.match(fromModel,/renderOverviewKpis\(M\.orderKpis\(summaryRows\.filter\(row=>M\.passesDimFilters\(row,false,main\)\)\)\)/);
  assert.match(fromModel,/M\.buyingGroups\(summaryRows\.filter\(row=>M\.passesDimFilters\(row,false,bg\)\)\)/);
  assert.doesNotMatch(fromModel,/\.orders\.kpi|\.orders\.buyingGroup/);
  // Ülke / alt üretici hangi aşama hazırsa; asistan, sezon ve İstisna Kutusu yalnız tam aşamadan.
  assert.match(fromModel,/const base=full\|\|fast,cp=base&&base\.cp,decided=full&&full\.cp;/);
  assert.match(fromModel,/if\(decided&&decided\.summary\)\{/);
  assert.match(fromModel,/if\(full&&full\.exceptionInbox&&/);
  // Model istek anahtarı aşamadan bağımsızdır (aynı filtre = aynı anahtar).
  assert.match(fn('overviewModelKey'),/const \{parts,\.\.\.rest\}=body;/);
  // Açılış sonrası CP arka plan yüklemesi yalnız eski yolda (model yolunda tarayıcı karar katmanı sunucuyla yarışmaz).
  assert.match(APP,/if\(currentActiveTab\(\)==='overview'&&!overviewReadModelEnabled\(\)\)void ensureOverviewCpDependency\(\);/);
  assert.doesNotMatch(APP,/if\(currentActiveTab\(\)==='overview'\)void ensureOverviewCpDependency\(\);/);
  // Arka plan CP hazırlığı, Genel Bakış model yolundayken önce tam modeli bekler.
  assert.match(APP,/await window\.BLOverviewReadModel\?\.beforeWarmup\?\.\(\);\n      const ok=await ensureCpLoaded\(\{deferRender:true,reason:'warmup'\}\);/);
  assert.match(APP,/beforeWarmup:\(\)=>currentActiveTab\(\)==='overview'&&overviewReadModelEnabled\(\)\?requestOverviewModelParts\(\)\.catch\(\(\)=>null\):null/);
  // Kendi model yenilemesi kirli işaretlemez (sonsuz istek döngüsü yok).
  assert.match(fn('scheduleOverviewRender'),/if\(!String\(reason\)\.startsWith\('overview-model'\)\)markOverviewModelDirty\(\);/);
});

test('exception inbox: model result is used without rows; opening a record still reads real CP rows',async()=>{
  const bridge=APP.slice(APP.indexOf('window.BLExceptionInboxBridge={'),APP.indexOf('\n};',APP.indexOf('window.BLExceptionInboxBridge={')));
  assert.match(bridge,/return window\.BLExceptionInbox\.precomputed\(model\.exceptionInbox\)/);
  assert.match(bridge,/const rows=await bridge\.readRows\(\);/);
  const result={items:[{id:'x',key:'k',type:'EX_FACTORY_OVERDUE',orderCode:'1',modelName:'M',colourCode:'C'}],counts:{EX_FACTORY_OVERDUE:1},total:1};
  const out=await Inbox.project(Inbox.precomputed(result),{fields:null,analyze:()=>{throw new Error('analiz çalışmamalı');}});
  assert.deepEqual(out,{items:result.items,counts:{EX_FACTORY_OVERDUE:1,DATE_SYNC_MISMATCH:0},total:1});
  // Yetki kapısı önceden hesaplanmış sonuçta da uygulanır.
  assert.equal((await Inbox.project(Inbox.precomputed(result),{allowed:()=>false})).cancelled,true);
});

test('overview-model.js mirrors app-main passesOvDimFilters and actionPriorityCode exactly',()=>{
  const OV_DIM_META=APP.slice(APP.indexOf('const OV_DIM_META = {'),APP.indexOf('\n};',APP.indexOf('const OV_DIM_META = {'))+3);
  const ctx={window:{BLOrderDecisionEngine:OD},__f:{}};vm.createContext(ctx);
  vm.runInContext([OV_DIM_META,extractFunction(APP,'norm'),extractFunction(APP,'passesOvDimFilters'),extractFunction(APP,'actionPriorityCode'),
    'function ovStateFor(){return __f;}','globalThis.client={passesOvDimFilters,actionPriorityCode,setFilters:f=>{__f=f;}};'].join('\n'),ctx);
  for(const [dim,col] of Object.entries(Model.DIM_COLUMNS))assert.match(OV_DIM_META,new RegExp(`${dim}:[^\\n]*col:'${col.replace(/[()]/g,'\\$&')}'`));
  const rows=[{Country:'Egypt','Active/Inactive':'Inactive',Season:' 6S27 ','Buyer Grup (TR)':'G1'},{Country:'Turkey','Active/Inactive':'',Season:'6W26'},{Country:null}];
  const filters=[{},{country:new Set(['Egypt'])},{orderStatus:new Set(['Active'])},{orderStatus:new Set(['Inactive']),season:new Set(['6S27'])},{buyerGrup:new Set()}];
  for(const f of filters){
    ctx.client.setFilters(f);
    for(const row of rows)for(const isCp of [true,false])
      assert.equal(Model.passesDimFilters(row,isCp,Model.normalizeFilters(f)),ctx.client.passesOvDimFilters(row,isCp,'main'),JSON.stringify([row,isCp,[...Object.entries(f)].map(([k,v])=>[k,[...v]])]));
  }
  OD.setPriorityCatalog(OD.normalizePriorityCatalog([{id:'prio:vip',tr:'VIP Acil',en:'VIP Urgent',tone:'red',isRisk:true},...OD.DEFAULT_PRIORITY_CATALOG]));
  try{
    for(const value of ['CRITICAL','ACT_TODAY','ACT_THIS_WEEK','prio:vip','vip acil','VIP URGENT','Kritik','on track','Yolunda','',null,'?? ',' WATCH '])
      assert.equal(Model.actionPriorityCode(value,OD),ctx.client.actionPriorityCode(value),String(value));
  }finally{OD.setPriorityCatalog(null);}
});

test('overview premium: pulse and horizon render from a summary identical to the one built from the model',()=>{
  const DAY=86400000,today=Math.floor(Date.UTC(new Date().getFullYear(),new Date().getMonth(),new Date().getDate())/DAY);
  const orders=[{plannedLoadDate:today,qty:10,priority:'CRITICAL'},{plannedLoadDate:today+3,qty:5,priority:'ON_TRACK',calculationStatus:'UNKNOWN'},
    {plannedLoadDate:today-2,qty:7,priority:'ACTION_TODAY',stage:'PRODUCTION'},{plannedLoadDate:null,qty:2,priority:'WATCH'},{plannedLoadDate:today+10,qty:1,priority:'ACTION_THIS_WEEK'}];
  const model={orders,priorities:[{name:'CRITICAL',rows:1},{name:'ON_TRACK',rows:1}]};
  const summary=Premium.summarize(model);
  assert.deepEqual(summary.horizon[7].days.map(d=>d.count),[1,0,0,1,0,0,0]);
  assert.equal(summary.horizon[7].overdue,1);assert.equal(summary.horizon[7].missing,1);
  assert.equal(summary.horizon[14].days[10].count,1);
  assert.deepEqual(summary.pulse.find(item=>item.key==='scope'),{key:'scope',tone:null,tr:'',en:'',count:5,qty:25});
  assert.equal(JSON.stringify(summary),JSON.stringify(JSON.parse(JSON.stringify(summary))),'özet JSON-güvenli');
  const premium=fs.readFileSync(path.join(ROOT,'public','overview-premium.js'),'utf8');
  // Çizim tek kaynaktan: model varsa özet ondan kurulur, yoksa okuma modelinin özeti kullanılır.
  assert.match(premium,/function view\(\)\{return model\?summarize\(model\):\(context\.summary\|\|null\);\}/);
  assert.doesNotMatch(premium.slice(premium.indexOf('function renderPulse'),premium.indexOf('function collectionBuckets')),/buildHorizon\(model|pulseScopes\(model\)/);
});

test('CP assistant overview card: one summary object feeds both paths; row-bound clicks materialize first',()=>{
  assert.match(VIEW,/function overviewSummaryOf\(model, checklist\)/);
  assert.match(VIEW,/const summary = fromModel \|\| \(state\.model \? overviewSummaryOf\(state\.model, state\.checklist\) : null\);/);
  const bindSummary=VIEW.slice(VIEW.indexOf('function bindSummary('),VIEW.indexOf('function showOverviewSummary('));
  for(const hook of ['data-cpa-queue','data-cpa-summary-attention','data-cpa-priority','data-cpa-open-checklist','data-cpa-automate-priority'])assert.ok(bindSummary.includes(hook),hook);
  assert.match(bindSummary,/Promise\.resolve\(summaryMaterialize\(\)\)\.then\(ready =>/);
  // CP sayfasından açılan İş Listesi Genel Bakış kartını filtresiz modele çevirmez.
  assert.match(VIEW,/preferSummary = Boolean\(modelSummary\);/);
  // supplier-sync de onOverviewRendered(tüm CP) çağırır: bu, model özetini bırakmaz.
  assert.doesNotMatch(VIEW.slice(VIEW.indexOf('function onOverviewRendered('),VIEW.indexOf('loadPrefs();',VIEW.indexOf('function onOverviewRendered('))),/preferSummary = false/);
  assert.match(APP,/OVERVIEW_MODEL_MATERIALIZE'\);\n  \/\/[^\n]*\n  window\.BLCpAssistant\?\.showOverviewSummary\?\.\(null\);/);
});
