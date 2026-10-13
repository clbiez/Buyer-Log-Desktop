'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { SERVER_DATA_ROOT, atomicWriteJson } = require('../user-data');
const { readJsonWithValidatedBackup } = require('./safe-json-read');
const {withFileLeaseSync}=require('./shared-file-transaction');

const STORE_FILE = path.join(SERVER_DATA_ROOT, 'automation-recipes.json');
const SCHEMA_VERSION = 4;
const MAX_TERMINAL_CODE = 120000;
const MAX_RECIPES = 160;
const MAX_RUNS = 400;
const MAX_EMAIL_GROUPS = 80;

function clean(value){ return String(value == null ? '' : value).trim(); }
function iso(value=Date.now()){ return new Date(value).toISOString(); }
function id(prefix){ return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`; }
function clone(value){ return JSON.parse(JSON.stringify(value)); }
function num(value,fallback=0){ const n=Number(value); return Number.isFinite(n)?n:fallback; }
function bool(value){ return value === true; }
function uniqueEmails(value){
  const raw=Array.isArray(value)?value:String(value||'').split(/[\n,;]+/);
  const seen=new Set(),out=[];
  raw.forEach(item=>{const email=clean(item).toLowerCase();if(!email||seen.has(email)||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return;seen.add(email);out.push(email.slice(0,254));});
  return out.slice(0,120);
}
function defaultStore(){ return { schemaVersion:SCHEMA_VERSION, recipes:[], runs:[], emailGroups:[], changeBaselines:{}, agentScheduleGrants:{}, revision:0, updatedAt:null }; }

function normalizeFilter(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  const allowed=new Set(['eq','neq','contains','starts_with','in','empty','not_empty','changed','gt','gte','lt','lte']);
  const operator=clean(item.operator).toLowerCase();
  return { field:clean(item.field).slice(0,240), operator:allowed.has(operator)?operator:'eq', value:clean(item.value).slice(0,4000) };
}
/* v6.39 — ZİNCİRLEME (ikinci kaynak bağlama).
   Kullanıcı isteği: "birden fazla tablo başlığını zincirleyerek komplike
   otomasyonlar". Tek kaynakla bu mümkün değildi — bir otomasyon ya ASAS
   başlıklarını ya IAS başlıklarını görebiliyordu. Artık tarif ikinci bir
   kaynak bağlayabiliyor; iki tablonun satırları Sipariş Kod üzerinden
   eşleştirilip TEK satırda birleştiriliyor ve koşullar her iki tablonun
   başlıklarına birlikte kurulabiliyor.
   mode:
     'match'   → yalnız ikinci kaynakta karşılığı OLAN satırlar (iç birleşim)
     'optional'→ karşılığı olmayan satırlar da kalır, ek alanlar boş gelir
     'missing' → yalnız ikinci kaynakta karşılığı OLMAYAN satırlar
   Bu üçü ayrı ayrı gerçek senaryolara karşılık geliyor; örneğin "ASAS'ta var
   ama Antrepo'ya hiç girmemiş siparişler" yalnız 'missing' ile ifade edilir. */
function normalizeJoin(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  const source=clean(item.source).toLowerCase();
  const mode=clean(item.mode).toLowerCase();
  return {
    source:['asas','ias','cp','orders','backlog','lfl','collection'].includes(source)?source:'',
    mode:['match','optional','missing'].includes(mode)?mode:'match',
    prefix:(clean(item.prefix)||'').slice(0,40),
  };
}
function normalizeBinding(raw){
  const item=raw&&typeof raw==='object'?raw:{};const mode=clean(item.mode).toLowerCase();
  return { mode:mode==='field'?'field':'fixed', field:mode==='field'?clean(item.field).slice(0,240):'' };
}
function normalizeStep(raw){
  const step=raw&&typeof raw==='object'?clone(raw):{};
  step.binding=normalizeBinding(step.binding);
  return step;
}
function normalizeEmail(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  /* v6.36 — ALICI ÇÖZÜMLEME.
     Eskiden alıcı tek bir sabit alandı (groupId): otomasyon, eşleşen satırların
     tamamını TEK bir gruba tek e-posta olarak gönderirdi. Kullanıcının gerçek
     senaryoları bunu aşıyor — "siparişin geçildiği üreticiye" ve "ilgili ülkenin
     ihracat ekibine" demek, satırları bir alana göre gruplayıp HER GRUBA kendi
     satırlarıyla ayrı e-posta göndermek demektir.
     recipientMode:
       'group' → eski davranış, tek sabit grup (varsayılan; geriye dönük uyumlu)
       'field' → recipientField değerine göre böl, her değer için ayrı e-posta */
  const recipientMode=['group','field'].includes(clean(item.recipientMode))?clean(item.recipientMode):'group';
  return {
    groupId:clean(item.groupId).slice(0,120),
    recipientMode,
    recipientField:clean(item.recipientField).slice(0,240),
    subject:(clean(item.subject)||'Buyer Log Raporu').slice(0,500),
    body:clean(item.body).slice(0,16000),
    includeReport:item.includeReport!==false,
    reportFields:(Array.isArray(item.reportFields)?item.reportFields:[]).map(clean).filter(Boolean).slice(0,40),
    deliveryMode:'draft',
    openDraftOnManual:item.openDraftOnManual!==false,
    /* v9.47 — YAZIŞMA DİLİ.
       'auto': dil satırın kendi verisinden gelir (üretim ülkesi Türkiye ise TR,
       değilse EN) — karar TEK yerde, backlog-automation.resolveCommunicationLanguage
       içinde verilir. 'tr'/'en': kullanıcı sabitler.
       İngilizce metin BOŞSA Türkçesine düşülür; sessizce boş mail gitmez. */
    languageMode:['auto','tr','en'].includes(clean(item.languageMode))?clean(item.languageMode):'tr',
    subjectEn:clean(item.subjectEn).slice(0,500),
    bodyEn:clean(item.bodyEn).slice(0,16000),
  };
}
function normalizeSchedule(raw){
  const item=raw&&typeof raw==='object'?raw:{},mode=clean(item.mode).toLowerCase();
  const time=/^([01]\d|2[0-3]):[0-5]\d$/.test(clean(item.time))?clean(item.time):'09:00';
  const weekdays=[...new Set((Array.isArray(item.weekdays)?item.weekdays:[]).map(v=>Math.floor(Number(v))).filter(v=>v>=0&&v<=6))];
  return {
    enabled:item.enabled===true,
    mode:['daily','weekly','interval'].includes(mode)?mode:'manual',
    time,
    weekdays:weekdays.length?weekdays:[1],
    intervalHours:Math.max(1,Math.min(168,Math.floor(num(item.intervalHours,24)))),
    lastKey:clean(item.lastKey).slice(0,120),
    lastRunAt:clean(item.lastRunAt).slice(0,80),
  };
}
function normalizeAnalysis(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  return { groupBy:clean(item.groupBy).slice(0,240), valueField:clean(item.valueField).slice(0,240), operation:['count','sum','avg','min','max'].includes(clean(item.operation))?clean(item.operation):'count', topN:Math.max(1,Math.min(50,Math.floor(num(item.topN,15)))) };
}
/* v9.47 — Backlog teslimat analizi ayarları.
   Otomasyon kendi risk/ETA hesabını kurmaz; yalnız Backlog Intelligence
   motorunun HANGİ hedefe göre (Retail Depo / In Store) çalışacağını ve kök
   sebeplerin hangi sorumluya yönleneceğini taşır. Bilinmeyen sebep anahtarı
   ya da bilinmeyen sorumlu sessizce ATILIR — uydurulmuş bir yönlendirme,
   yanlış kişiye giden bir mail demektir. */
const BACKLOG_ROUTING_CAUSES=new Set(['LATE_LOADING','NOT_YET_LOADED','PRODUCTION_DELAY','TRANSIT_DELAY','CUSTOMS_DELAY','RETAIL_TRANSFER_DELAY','INSUFFICIENT_TRANSIT_BUFFER','TARGET_DATE_PASSED','MISSING_DATE','MISSING_TRANSIT_RULE','UNKNOWN']);
const BACKLOG_ROUTING_OWNERS=new Set(['supplier','merchandiser','buyer','import','none']);
function normalizeBacklog(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  const routing={};
  const rawRouting=item.routing&&typeof item.routing==='object'?item.routing:{};
  for(const [cause,owner] of Object.entries(rawRouting)){
    const causeKey=String(cause||'').trim().toUpperCase(),ownerKey=clean(owner).toLowerCase();
    if(BACKLOG_ROUTING_CAUSES.has(causeKey)&&BACKLOG_ROUTING_OWNERS.has(ownerKey))routing[causeKey]=ownerKey;
  }
  return { targetType:clean(item.targetType)==='inStore'?'inStore':'retail', requireTransitRule:item.requireTransitRule!==false, routing };
}
function normalizeAppActions(raw){
  const allowed=new Set(['open_page','refresh_source','show_report']);
  return (Array.isArray(raw)?raw:[]).slice(0,30).map(item=>{
    const action=clean(item&&item.action).toLowerCase();
    return { action:allowed.has(action)?action:'show_report', page:clean(item&&item.page).slice(0,60), source:clean(item&&item.source).slice(0,60), label:clean(item&&item.label).slice(0,180) };
  });
}
function normalizeAiDefinition(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  const trigger=item.trigger&&typeof item.trigger==='object'?item.trigger:{};
  const conditions=(Array.isArray(item.conditions)?item.conditions:[]).slice(0,60).map(condition=>{
    const value=condition&&typeof condition==='object'?condition:{};
    return {
      kind:['field','function'].includes(clean(value.kind))?clean(value.kind):'field',
      field:clean(value.field).slice(0,240),
      function:clean(value.function).slice(0,60),
      args:(Array.isArray(value.args)?value.args:[]).map(clean).slice(0,6),
      operator:clean(value.operator).slice(0,40),
      value:Array.isArray(value.value)?value.value.slice(0,20).map(item=>typeof item==='number'?item:clean(item)):typeof value.value==='number'||typeof value.value==='boolean'?value.value:clean(value.value),
    };
  });
  const actions=(Array.isArray(item.actions)?item.actions:[]).slice(0,20).map(action=>{
    const source=action&&typeof action==='object'?action:{};
    const result={type:clean(source.type).slice(0,60)};
    for(const key of ['RECIPIENT_GROUP','RECIPIENT_FIELD','SUBJECT','INCLUDE_MATCHING_ROWS','ATTACHMENT','MODULE','SOURCE','TITLE']){
      if(Object.prototype.hasOwnProperty.call(source,key))result[key]=typeof source[key]==='boolean'||typeof source[key]==='number'?source[key]:clean(source[key]).slice(0,1000);
    }
    return result;
  });
  return {
    languageVersion:clean(item.languageVersion).slice(0,20), name:clean(item.name).slice(0,180), source:clean(item.source).toLowerCase().slice(0,40),
    trigger:{type:clean(trigger.type).slice(0,30),time:clean(trigger.time).slice(0,10),weekday:clean(trigger.weekday).slice(0,20),hours:Math.max(0,Math.min(168,Math.floor(num(trigger.hours,0))))},
    conditions, actions, requiredInputs:[...new Set((Array.isArray(item.requiredInputs)?item.requiredInputs:[]).map(clean).filter(Boolean))].slice(0,20),
  };
}
function normalizeAi(raw){
  if(!raw||typeof raw!=='object')return null;
  const definition=normalizeAiDefinition(raw.definition);
  return {
    origin:clean(raw.origin)==='ai_import'?'ai_import':'',
    status:['draft','active','needs_review','needs_input','invalid'].includes(clean(raw.status))?clean(raw.status):'draft',
    appVersion:clean(raw.appVersion).slice(0,40), capabilitySchemaVersion:Math.max(0,Math.min(99,Math.floor(num(raw.capabilitySchemaVersion,0)))),
    capabilityHash:clean(raw.capabilityHash).slice(0,64), languageVersion:clean(raw.languageVersion).slice(0,20),
    sourceCode:String(raw.sourceCode==null?'':raw.sourceCode).slice(0,MAX_TERMINAL_CODE), definition,
  };
}
function normalizeRecipe(raw,ownerId=''){
  const item=raw&&typeof raw==='object'?raw:{},now=iso();
  const source=clean(item.source).toLowerCase();
  const purpose=['browser','email','analysis','app','mixed'].includes(clean(item.purpose).toLowerCase())?clean(item.purpose).toLowerCase():'browser';
  return {
    id:clean(item.id)||id('recipe'), ownerId:clean(ownerId||item.ownerId),
    name:(clean(item.name)||'Yeni otomasyon').slice(0,180), description:clean(item.description).slice(0,4000), enabled:item.enabled!==false, purpose,
    url:clean(item.url).slice(0,4000), source:['manual','cp','orders','backlog','lfl','collection','asas','ias','intake'].includes(source)?source:'manual',
    filters:(Array.isArray(item.filters)?item.filters:[]).slice(0,20).map(normalizeFilter).filter(rule=>rule.field||['empty','not_empty'].includes(rule.operator)),
    limit:Math.max(1,Math.min(200,Math.floor(num(item.limit,50)))), timeoutMs:Math.max(1000,Math.min(30000,Math.floor(num(item.timeoutMs,12000)))),
    continueOnError:item.continueOnError===true, successText:clean(item.successText).slice(0,2000),
    terminalCode:String(item.terminalCode == null ? '' : item.terminalCode).slice(0,MAX_TERMINAL_CODE),
    steps:(Array.isArray(item.steps)?item.steps:[]).slice(0,250).map(normalizeStep),
    join:normalizeJoin(item.join),
    email:normalizeEmail(item.email), schedule:normalizeSchedule(item.schedule), analysis:normalizeAnalysis(item.analysis), backlog:normalizeBacklog(item.backlog), appActions:normalizeAppActions(item.appActions), ai:normalizeAi(item.ai),
    createdAt:clean(item.createdAt)||now, updatedAt:clean(item.updatedAt)||now, revision:Math.max(0,Math.floor(num(item.revision,0))),
  };
}
function normalizeRun(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  return {
    id:clean(item.id)||id('auto_run'), ownerId:clean(item.ownerId), recipeId:clean(item.recipeId), recipeName:clean(item.recipeName).slice(0,180),
    status:['reserved','running','completed','partial','interrupted','skipped','failed','dry_run'].includes(clean(item.status))?clean(item.status):'running', dryRun:item.dryRun===true,
    scopeRecipe:item.scopeRecipe&&typeof item.scopeRecipe==='object'?clone(item.scopeRecipe):null,
    executor:item.executor&&typeof item.executor==='object'?clone(item.executor):null,
    trigger:['manual','schedule','missed'].includes(clean(item.trigger))?clean(item.trigger):'manual', scheduleKey:clean(item.scheduleKey).slice(0,120),
    source:clean(item.source), matched:Math.max(0,Math.floor(num(item.matched,0))), processed:Math.max(0,Math.floor(num(item.processed,0))), failed:Math.max(0,Math.floor(num(item.failed,0))),
    message:clean(item.message).slice(0,3000), result:item.result==null?null:clone(item.result),
    createdAt:clean(item.createdAt)||iso(), updatedAt:clean(item.updatedAt)||clean(item.createdAt)||iso(), finishedAt:clean(item.finishedAt),
  };
}
function normalizeEmailGroup(raw){
  const item=raw&&typeof raw==='object'?raw:{};
  return { id:clean(item.id)||id('mailgrp'), name:(clean(item.name)||'E-posta grubu').slice(0,160), to:uniqueEmails(item.to), cc:uniqueEmails(item.cc), bcc:uniqueEmails(item.bcc), updatedAt:clean(item.updatedAt)||iso(), updatedBy:clean(item.updatedBy).slice(0,120) };
}
function loadStore(){
  fs.mkdirSync(SERVER_DATA_ROOT,{recursive:true});
  return readJsonWithValidatedBackup(STORE_FILE,{
    fallback:defaultStore,
    normalize:raw=>{const store=defaultStore();
    store.revision=Math.max(0,Math.floor(num(raw&&raw.revision,0)));store.updatedAt=clean(raw&&raw.updatedAt)||null;
    store.recipes=(Array.isArray(raw&&raw.recipes)?raw.recipes:[]).slice(0,MAX_RECIPES).map(item=>normalizeRecipe(item));
    store.runs=(Array.isArray(raw&&raw.runs)?raw.runs:[]).slice(0,MAX_RUNS).map(normalizeRun);
    store.emailGroups=(Array.isArray(raw&&raw.emailGroups)?raw.emailGroups:[]).slice(0,MAX_EMAIL_GROUPS).map(normalizeEmailGroup);
    store.changeBaselines=raw&&raw.changeBaselines&&typeof raw.changeBaselines==='object'&&!Array.isArray(raw.changeBaselines)?clone(raw.changeBaselines):{};
    store.agentScheduleGrants=raw&&raw.agentScheduleGrants&&typeof raw.agentScheduleGrants==='object'?clone(raw.agentScheduleGrants):{};
    return store;
    },
    restore:value=>atomicWriteJson(STORE_FILE,value),
  });
}
// baselineRevision verilirse ve diskteki güncel revizyon bundan farklıysa (dosya
// mutate()'in kendi loadStore()'u ile bu yazım arasında başka bir çağrı tarafından
// değiştirildiyse) yazmadan null döner — mutate() bunu görüp yeniden okuyup dener.
function saveStore(store,baselineRevision,options={}){return withFileLeaseSync(STORE_FILE,()=>{
  const current=loadStore();options.assertAuthority?.();
  if(options.expectedStoreRevision!=null&&current.revision!==options.expectedStoreRevision)throw Object.assign(new Error('Automation changed.'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});
  if(baselineRevision!=null && current.revision!==baselineRevision) return null;
  const next={schemaVersion:SCHEMA_VERSION,recipes:(store.recipes||[]).slice(0,MAX_RECIPES),runs:(store.runs||[]).slice(0,MAX_RUNS),emailGroups:(store.emailGroups||[]).slice(0,MAX_EMAIL_GROUPS),changeBaselines:store.changeBaselines&&typeof store.changeBaselines==='object'?store.changeBaselines:{},agentScheduleGrants:store.agentScheduleGrants||{},revision:Math.max(0,num(store.revision,0))+1,updatedAt:iso()};
  atomicWriteJson(STORE_FILE,next);return next;
 });
}
// Tek dosyada tüm kullanıcıların verisi tutulduğu için (ör. 60sn'lik zamanlayıcı
// runScheduledAutomations ile kullanıcı tetiklemesi çakışabilir) oku-değiştir-yaz
// arasına başka bir yazma girerse kayıp güncelleme olmaması için "compare-and-swap"
// yeniden deneme: çakışma tespit edilirse dosya yeniden okunup fn baştan uygulanır.
const MAX_MUTATE_ATTEMPTS=8;
function mutate(fn,options={}){
  for(let attempt=0;attempt<MAX_MUTATE_ATTEMPTS;attempt++){
    const store=loadStore(),baselineRevision=store.revision,result=fn(store),saved=saveStore(store,baselineRevision,options);
    if(saved) return{result:clone(result),revision:saved.revision};
  }
  throw Object.assign(new Error('Otomasyon kaydı çok sık aynı anda değiştiriliyor, işlem tekrar denenemedi. Lütfen tekrar deneyin.'),{statusCode:409,code:'AUTOMATION_STORE_CONTENTION'});
}
function stateForOwner(ownerId){const key=clean(ownerId),store=loadStore();return{recipes:store.recipes.filter(r=>r.ownerId===key).map(clone),runs:store.runs.filter(r=>r.ownerId===key).slice(0,100).map(clone),emailGroups:store.emailGroups.map(clone),revision:store.revision,updatedAt:store.updatedAt};}
function recipeForOwner(ownerId,recipeId){return stateForOwner(ownerId).recipes.find(r=>r.id===clean(recipeId))||null;}
function allRecipes(){return loadStore().recipes.map(clone);}
function createRecipe(ownerId,value,options={}){return mutate(store=>{if(store.recipes.length>=MAX_RECIPES)throw Object.assign(new Error('Automation limit reached.'),{code:'AUTOMATION_RECIPE_LIMIT',statusCode:409});const now=iso(),recipe=normalizeRecipe({...value,id:id('recipe'),ownerId,createdAt:now,updatedAt:now,revision:1},ownerId);store.recipes.unshift(recipe);return recipe;},options);}
function updateRecipe(ownerId,recipeId,value,options={}){return mutate(store=>{const index=store.recipes.findIndex(r=>r.id===clean(recipeId)&&r.ownerId===clean(ownerId));if(index<0)throw Object.assign(new Error('Otomasyon bulunamadı.'),{statusCode:404,code:'AUTOMATION_NOT_FOUND'});const prev=store.recipes[index];if(options.expectedRecipeRevision!=null&&prev.revision!==options.expectedRecipeRevision)throw Object.assign(new Error('Automation changed.'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});const recipe=normalizeRecipe({...prev,...value,schedule:{...prev.schedule,...value.schedule,lastKey:prev.schedule.lastKey,lastRunAt:prev.schedule.lastRunAt},id:prev.id,ownerId:prev.ownerId,createdAt:prev.createdAt,updatedAt:iso(),revision:prev.revision+1},prev.ownerId);store.recipes[index]=recipe;if(options.scheduleGrant!==undefined){if(options.scheduleGrant)store.agentScheduleGrants[recipe.id]=options.scheduleGrant;else delete store.agentScheduleGrants[recipe.id];}return recipe;},options);}
function deleteRecipe(ownerId,recipeId,options={}){return mutate(store=>{const index=store.recipes.findIndex(r=>r.id===clean(recipeId)&&r.ownerId===clean(ownerId));if(index<0)throw Object.assign(new Error('Otomasyon bulunamadı.'),{statusCode:404,code:'AUTOMATION_NOT_FOUND'});if(options.expectedRecipeRevision!=null&&store.recipes[index].revision!==options.expectedRecipeRevision)throw Object.assign(new Error('Automation changed.'),{code:'OFFICE_PREVIEW_CHANGED',statusCode:409});const removed=store.recipes.splice(index,1)[0];delete store.agentScheduleGrants[removed.id];if(store.changeBaselines&&typeof store.changeBaselines==='object')delete store.changeBaselines[removed.id];return removed;},options);}
function createRun(ownerId,recipe,{dryRun=false,source='',matched=0,trigger='manual',scheduleKey=''}={}){return mutate(store=>{const run=normalizeRun({id:id('auto_run'),ownerId,recipeId:recipe.id,recipeName:recipe.name,scopeRecipe:recipe,status:dryRun?'dry_run':'running',dryRun,trigger,scheduleKey,source,matched,createdAt:iso(),updatedAt:iso()});store.runs.unshift(run);if(store.runs.length>MAX_RUNS)store.runs.length=MAX_RUNS;return run;});}
function updateRun(ownerId,runId,patch){return mutate(store=>{const index=store.runs.findIndex(r=>r.id===clean(runId)&&r.ownerId===clean(ownerId));if(index<0)throw Object.assign(new Error('Otomasyon çalışması bulunamadı.'),{statusCode:404,code:'AUTOMATION_RUN_NOT_FOUND'});const prev=store.runs[index],next=normalizeRun({...prev,...patch,id:prev.id,ownerId:prev.ownerId,recipeId:prev.recipeId,recipeName:prev.recipeName,createdAt:prev.createdAt,updatedAt:iso()});store.runs[index]=next;return next;});}
function replaceEmailGroups(groups,actor){return mutate(store=>{store.emailGroups=(Array.isArray(groups)?groups:[]).slice(0,MAX_EMAIL_GROUPS).map(item=>normalizeEmailGroup({...item,updatedAt:iso(),updatedBy:clean(actor&&actor.id||actor)}));return store.emailGroups;});}

function changeBaselineForRecipe(ownerId,recipeId){
  const owner=clean(ownerId),rid=clean(recipeId),store=loadStore();
  const recipe=store.recipes.find(r=>r.id===rid&&r.ownerId===owner);
  if(!recipe)return null;
  const raw=store.changeBaselines&&store.changeBaselines[rid];
  return raw&&typeof raw==='object'?clone(raw):null;
}
function setChangeBaseline(ownerId,recipeId,baseline){
  return mutate(store=>{
    const owner=clean(ownerId),rid=clean(recipeId),recipe=store.recipes.find(r=>r.id===rid&&r.ownerId===owner);
    if(!recipe)throw Object.assign(new Error('Otomasyon bulunamadı.'),{statusCode:404,code:'AUTOMATION_NOT_FOUND'});
    if(!store.changeBaselines||typeof store.changeBaselines!=='object')store.changeBaselines={};
    const value=baseline&&typeof baseline==='object'?clone(baseline):{};
    store.changeBaselines[rid]={...value,updatedAt:iso()};recipe.revision++;recipe.updatedAt=iso();
    return store.changeBaselines[rid];
  });
}
function clearChangeBaseline(ownerId,recipeId){
  return mutate(store=>{
    const owner=clean(ownerId),rid=clean(recipeId),recipe=store.recipes.find(r=>r.id===rid&&r.ownerId===owner);
    if(!recipe)return null;
    if(store.changeBaselines&&typeof store.changeBaselines==='object')delete store.changeBaselines[rid];recipe.revision++;recipe.updatedAt=iso();
    return null;
  });
}

function markSchedule(ownerId,recipeId,key,options={}){return mutate(store=>{
 const index=store.recipes.findIndex(r=>r.id===clean(recipeId)&&r.ownerId===clean(ownerId));if(index<0)return null;
 const recipe=store.recipes[index],now=options.now||new Date();if(recipe.schedule.lastKey===clean(key)||store.runs.some(run=>run.ownerId===clean(ownerId)&&run.recipeId===recipe.id&&run.scheduleKey===clean(key))||options.expectedRecipeRevision!=null&&recipe.revision!==options.expectedRecipeRevision)return null;
 if(options.strict){const schedule=require('./automation-schedule-service'),grant=store.agentScheduleGrants[recipe.id],due=schedule.automationDueOccurrence(recipe,now,grant),actualKey=schedule.automationScheduleKey(recipe,now,grant);if(options.allowMissed?due?.key!==key:actualKey!==key||due?.key===key&&!schedule.automationIsWithinGrace(due))return null;}
 recipe.schedule={...recipe.schedule,lastKey:clean(key),lastRunAt:iso(now)};recipe.updatedAt=iso(now);recipe.revision++;store.recipes[index]=normalizeRecipe(recipe,recipe.ownerId);
 const run=normalizeRun({id:id('auto_run'),ownerId,recipeId:recipe.id,recipeName:recipe.name,scopeRecipe:recipe,status:options.skip?'skipped':'reserved',trigger:options.allowMissed?'missed':'schedule',scheduleKey:key,source:recipe.source,executor:options.executor||{pid:process.pid,host:require('os').hostname(),instanceId:'legacy',expiresAt:iso(Date.now()+120000)},createdAt:iso(now),finishedAt:options.skip?iso(now):''});store.runs.unshift(run);if(store.runs.length>MAX_RUNS)store.runs.length=MAX_RUNS;
 return {...store.recipes[index],reservation:run};
 },options);}
function withEffectGuard(check,work){return withFileLeaseSync(STORE_FILE,()=>{check();return work();});}
function reconcileScheduleReservations(){const stale=loadStore().runs.filter(run=>['reserved','running'].includes(run.status)&&run.scheduleKey&&run.executor&&(!Number.isFinite(Date.parse(run.executor.expiresAt))||Date.parse(run.executor.expiresAt)<=Date.now()||run.executor.host===require('os').hostname()&&!processAlive(run.executor.pid)));if(!stale.length)return [];
 return mutate(store=>{const changed=[];for(const run of store.runs)if(stale.some(item=>item.id===run.id)&&['reserved','running'].includes(run.status)){run.status='interrupted';run.message='AUTOMATION_RECONCILE_REQUIRED';run.finishedAt=iso();changed.push(run.id);}return changed;}).result;
}
function processAlive(pid){if(!Number.isInteger(Number(pid))||Number(pid)<=0)return false;try{process.kill(Number(pid),0);return true;}catch(err){return err.code==='EPERM';}}


module.exports={loadStore,MAX_RECIPES,mutate,STORE_FILE,SCHEMA_VERSION,normalizeRecipe,normalizeJoin,normalizeRun,normalizeEmailGroup,stateForOwner,recipeForOwner,allRecipes,createRecipe,updateRecipe,deleteRecipe,createRun,updateRun,replaceEmailGroups,changeBaselineForRecipe,setChangeBaseline,clearChangeBaseline,markSchedule,withEffectGuard,reconcileScheduleReservations};
