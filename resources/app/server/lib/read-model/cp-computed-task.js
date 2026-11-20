'use strict';
/* CP hesaplanmış sütunlar (#1078, WS5 alt PR 1): okuma modeli işçisinde
 * kullanıcının CP satırları için öncelik, karar ve checklist sonuçlarını üretir.
 *
 * Mantık ikinci kez yazılmaz:
 *  - Karar katmanı: WS2a barındırıcısı (overview-decision-host.js), yani
 *    istemcinin `cpAssistant` özelliğiyle yüklediği cp-overview-assistant.js ve
 *    motorlar. Satır kararı `computeDecisionsForRows` ile alınır.
 *  - Öncelik sütunları: app-main.js syncUnifiedPrioritiesForTable /
 *    applyUnifiedPriorityAnalysis ile aynı alanlar; revizyonlu satırların temel
 *    önceliği BLRevision.baselineRow gölge satırında aynı motorla hesaplanır.
 *  - Checklist hücreleri: aynı vm bağlamında checklist-supplier-sync.js
 *    `refreshColumns({decision})` çalışır; hücre değerleri satırdan okunur.
 *
 * Satır verisi WS2a'nın 'cp-overview' veri kümesiyle paylaşılır (aynı anahtar,
 * aynı tarayıcı biçimi hazırlığı; ikinci 30k kopya tutulmaz). Checklist geçişi
 * bu satırlara yalnız `__checklist__*` alanlarını ve sayılmayan `_checklist*`
 * özelliklerini yazar; Genel Bakış modeli bu alanları okumaz (test kilitler).
 *
 * Barındırıcı (kullanıcı kapsamı + dil + cevap dışı bağlam) anahtarıyla küçük
 * LRU'da tutulur. Checklist cevabı değişince barındırıcı korunur: cevaplar
 * değişmeyen kayıtların nesne kimliği korunarak yerinde güncellenir; böylece
 * istemcinin kendi delta mekanizmaları (kişisel katman CPR-09 ve checklist
 * sütun deltası) yalnız etkilenen sipariş/opsiyonları yeniden değerlendirir.
 *
 * Yük: { dataset:{datasetKey,scopeKey,buffer?}, scopeKey, lang, since?, context,
 *        tasks:[test raporu görevi] }
 * Çıktı (version 1): { version, lang, token, delta, total, fields, rows:[[...]], removed:[id] }
 */
const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {performance}=require('node:perf_hooks');
const {createDecisionHost}=require('./overview-decision-host');
const {prepareCpRows}=require('./overview-row-prep');
const PUBLIC=path.resolve(__dirname,'..','..','..','public');
const MAX_HOSTS=2,HISTORY=4;
const ANSWER_KEY='lcw.cp.checklist.v1';
// Satır demeti alanları; istemci (app-main.js applyCpComputedRow) aynı sırayı okur.
// orderKey/optionId: checklist cevap anahtarının satıra eşlenmesi (istemcinin iyimser yerel güncellemesi).
const FIELDS=Object.freeze(['id','priority','calculationStatus','trackingTags','priorityTags','actionReasons','signals','basePriority','checklist','orderKey','optionId']);
const hosts=new Map();
let supplierScript=null;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');

function datasetFor(spec,{cache,engine},loads){
  let dataset=cache.get(spec.datasetKey);
  if(dataset)return dataset;
  if(!spec.buffer)return null;
  const started=performance.now();
  dataset=engine.decodeDataset(spec.buffer);spec.buffer=null;
  prepareCpRows(dataset.rows);
  cache.set(spec.datasetKey,spec.scopeKey,dataset);
  loads.cp=performance.now()-started;
  return dataset;
}

/* Cevap dışındaki bağlam: değişirse barındırıcı yeniden kurulur. */
function hostKeyOf(payload){
  const context=payload.context||{},entries={...(context.entries||{})};
  delete entries[ANSWER_KEY];
  return hash(JSON.stringify([payload.scopeKey||'',payload.lang==='en'?'en':'tr',String(context.userId||''),entries,
    context.managedRules||null,context.plm||null,context.transitRules||[]]));
}

async function createEntry(payload){
  const host=await createDecisionHost({...payload.context,lang:payload.lang});
  const win=host.window;
  win.COLS_BY_TABLE={cp:[]};
  win.__cpComputedRows=[];
  win.BLFormulaRows={cp:()=>win.__cpComputedRows};
  if(!supplierScript)supplierScript=new vm.Script(fs.readFileSync(path.join(PUBLIC,'checklist-supplier-sync.js'),'utf8'),{filename:'public/checklist-supplier-sync.js'});
  supplierScript.runInContext(win);
  const sync=win.BLChecklistSupplierSync;
  if(!sync||typeof sync.refreshColumns!=='function')throw Object.assign(new Error('CP computed host failed to start'),{code:'CP_COMPUTED_HOST_FAILED'});
  return {host,sync,answersJson:new Map(),tasksSignature:'',history:[]};
}

/* Değişmeyen cevap kayıtlarının nesne kimliği korunur (delta mekanizmaları
   değişikliği kimlikle algılar); değişen/eklenen/silinen kayıtlar işlenir. */
function syncAnswers(entry,answers){
  const state=entry.host.assistant._state,current=state.answers||{},next={},seen=new Map();
  for(const [key,value] of Object.entries(answers||{})){
    const json=JSON.stringify(value);
    seen.set(key,json);
    next[key]=entry.answersJson.get(key)===json&&Object.prototype.hasOwnProperty.call(current,key)?current[key]:value;
  }
  // Barındırıcının kendi yükselttiği opsiyon onayları (promoteReusableChecklistAnswers)
  // kaynakta yoksa düşer; karar katmanı aynı geçişte yeniden üretir (istemciyle aynı).
  entry.answersJson=seen;
  state.answers=next;
}
function syncTasks(entry,tasks){
  const list=Array.isArray(tasks)?tasks:[],signature=JSON.stringify(list);
  if(signature===entry.tasksSignature)return;
  const map=new Map();
  for(const task of list){
    if(!task||!task.orderKey||!task.itemId)continue;
    const key=String(task.orderKey).replace(/\s+/g,' ').trim()+'::'+String(task.itemId).replace(/\s+/g,' ').trim();
    if(!map.has(key))map.set(key,[]);
    map.get(key).push(task);
  }
  entry.sync._state.testTasks=map;entry.tasksSignature=signature;
}

/* app-main.js computeFlags → applyFormulas gölge satırı (yalnız Ex→Retail ve LT). */
function shadowFormulas(win,transitRules){
  const BR=win.BLBusinessRules,Q=require('../../../public/read-model-query').internals;
  const ordinal=v=>{const d=Q.coerceDateLoose(v);return d?Math.trunc(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/86400000):null;};
  return shadow=>{
    const common=BR.computePriorityFlags({
      exFactory:shadow['Ex-factory'],retailDate:shadow['Retail Date'],inStoreDate:shadow['In-Store (Model Budget)'],
      antArrival:shadow['Ant. Arrival'],handoverDate:shadow['HANDOVER Tarihi'],shipConfirmationDate:shadow['Buying Son Onay Tarihi'],
      status:shadow['STATUS'],shortage:Number(shadow._logisticShortageQty)>0,shortageQty:shadow._logisticShortageQty,
      shortageNote:Number(shadow._logisticShortageQty)>0&&shadow._logisticAllPartialsInWarehouse===true,
      delType:shadow['Del. Type'],season:shadow.Season,country:shadow.Country,rules:transitRules,today:new Date(),
    },ordinal);
    const a=ordinal(shadow['OPD']),b=ordinal(shadow['Ex-factory']);
    shadow['Ex→Retail']=common.exr==null?'':common.exr;
    shadow['LT']=a==null||b==null?'':b-a;
  };
}

function computeRows(entry,rows,transitRules){
  const {host,sync}=entry,win=host.window,OD=win.BLOrderDecisionEngine,Model=win.BLOverviewModel,Rev=win.BLRevision,Checklist=win.BLCpChecklistEngine;
  const phases={};let started=performance.now();
  const decision=host.decide(rows.slice());
  phases.decisionMs=performance.now()-started;started=performance.now();
  const code=value=>Model.actionPriorityCode(value,OD);
  const out=new Map(),bases=[];
  for(const row of rows){
    const analysis=decision&&decision.byRow?decision.byRow.get(row):null;
    out.set(row,{
      priority:code(analysis&&analysis.priority)||'ON_TRACK',
      calculationStatus:analysis&&analysis.calculationStatus||'KNOWN',
      trackingTags:Array.isArray(analysis&&analysis.trackingTags)?analysis.trackingTags.slice():[],
      priorityTags:Array.isArray(analysis&&analysis.priorityTags)?analysis.priorityTags.slice():[],
      actionReasons:analysis&&Array.isArray(analysis.actionReasons)?analysis.actionReasons.slice():[],
      signals:analysis&&Array.isArray(analysis.signals)?analysis.signals.slice():[],
      basePriority:null,
      orderKey:analysis&&analysis.orderKey||'',
      optionId:analysis&&Checklist&&typeof Checklist.optionIdentity==='function'?Checklist.optionIdentity(analysis)||'':'',
    });
    let revised=[];try{revised=Rev.revisedDateKeys(row)||[];}catch(_){revised=[];}
    if(revised.length)bases.push(row);
  }
  if(bases.length){
    const derive=shadowFormulas(win,transitRules);
    const shadows=bases.map(row=>Rev.baselineRow(row,derive));
    const baseResult=host.decide(shadows);
    shadows.forEach((shadow,index)=>{
      const analysis=baseResult&&baseResult.byRow?baseResult.byRow.get(shadow):null;
      const value=code(analysis&&analysis.priority)||'ON_TRACK';
      shadow['Priority']=value;out.get(bases[index]).basePriority=value;
    });
  }
  phases.priorityMs=performance.now()-started;started=performance.now();
  win.__cpComputedRows=rows;
  sync.refreshColumns({render:false,decision,reuse:true});
  const columns=(win.COLS_BY_TABLE.cp||[]).filter(col=>col&&col.checklistSupplierColumn).map(col=>col.k);
  for(const row of rows){
    const values=out.get(row);
    if(!columns.length){values.checklist=null;continue;}
    const cells={};for(const key of columns)cells[key]=row[key]==null?'':row[key];
    values.checklist={cells,status:row._checklistStatus||{},parts:row._checklistParts||{},elements:row._checklistElements||{},
      single:row._checklistSingleSet===true,tasks:row._checklistTasks||{}};
  }
  phases.checklistMs=performance.now()-started;
  return {out,columns,phases};
}

async function execute(payload,deps){
  const started=performance.now(),loads={};
  if(!payload||!payload.dataset)throw Object.assign(new Error('Invalid compute request'),{code:'COMPUTE_JOB_INVALID'});
  const dataset=datasetFor(payload.dataset,deps,loads);
  if(!dataset)return {missing:['cp']};
  if(!payload.context)return {missing:['context']};
  const key=hostKeyOf(payload);
  let entry=hosts.get(key),hostMs=0;
  if(entry){hosts.delete(key);hosts.set(key,entry);}
  else{
    const hostStarted=performance.now();
    entry=await createEntry(payload);
    hostMs=performance.now()-hostStarted;
    hosts.set(key,entry);
    while(hosts.size>MAX_HOSTS)hosts.delete(hosts.keys().next().value);
  }
  syncAnswers(entry,payload.context.answers);
  syncTasks(entry,payload.tasks);
  const rows=dataset.rows;
  const {out,phases}=computeRows(entry,rows,payload.context.transitRules||[]);
  const serialized=new Map(),digests=new Map();
  for(const row of rows){
    const id=String(row&&row._id!=null?row._id:'');
    if(!id)continue;
    const v=out.get(row);
    const json=JSON.stringify([id,v.priority,v.calculationStatus,v.trackingTags,v.priorityTags,v.actionReasons,v.signals,v.basePriority,v.checklist,v.orderKey,v.optionId]);
    serialized.set(id,json);digests.set(id,crypto.createHash('sha1').update(json).digest('base64'));
  }
  // Delta, aynı barındırıcının aynı veri kümesi üzerindeki son HISTORY sonucundan birine göre
  // (istemci araya giren bağlam olayıyla bir sonucu atmış olabilir). Satır başına yalnız özet tutulur.
  const previous=payload.since?entry.history.find(item=>item.token===payload.since&&item.rows===rows):null,delta=Boolean(previous);
  const parts=[],removed=[];
  for(const [id,json] of serialized)if(!delta||previous.digests.get(id)!==digests.get(id))parts.push(json);
  if(delta)for(const id of previous.digests.keys())if(!serialized.has(id))removed.push(id);
  const token=crypto.randomBytes(9).toString('base64url');
  entry.history.unshift({token,rows,digests});entry.history.length=Math.min(entry.history.length,HISTORY);
  const lang=payload.lang==='en'?'en':'tr';
  const body=`{"version":1,"lang":${JSON.stringify(lang)},"token":${JSON.stringify(token)},"delta":${delta?'true':'false'},"total":${serialized.size},"fields":${JSON.stringify(FIELDS)},"rows":[${parts.join(',')}],"removed":${JSON.stringify(removed)}}`;
  return {body,timing:{loadMs:loads.cp||0,queryMs:performance.now()-started-(loads.cp||0),totalMs:performance.now()-started,rows:rows.length,
    changed:parts.length,delta,phases:{hostMs,...phases},
    // Tanı: veri kümesi yeniden çözüldüyse (önbellekten düştüyse) kararlar baştan hesaplanır.
    datasetReloaded:Boolean(loads.cp),datasetCache:typeof deps.cache.stats==='function'?deps.cache.stats():null}};
}
function clearHosts(){hosts.clear();}
function hostCount(){return hosts.size;}
module.exports={execute,clearHosts,hostCount,FIELDS,MAX_HOSTS};
