'use strict';
/* Genel Bakış okuma modeli (#1074): CP kişisel karar katmanını arka uç
 * işçisinde ÇALIŞTIRAN barındırıcı.
 *
 * Mantık ikinci kez yazılmaz: istemcinin `cpAssistant` özelliğiyle yüklediği
 * dosyaların AYNISI (cp-readiness/checklist/rules motorları, PLM numune modülü,
 * Moderatör kural kanalı ve cp-overview-assistant.js) aynı sırayla ayrı bir vm
 * bağlamında çalışır. Bağlamın BLStorage'ı kullanıcının sunucudaki tercih
 * kayıtlarıyla (lcw.cp.*), checklist cevapları paylaşılan cevap deposuyla
 * birleştirilmiş haliyle, Moderatör kuralları ve PLM numune verisi sunucu
 * kayıtlarıyla doldurulur. Ağ, zamanlayıcı ve DOM yoktur.
 *
 * Gerçek bir realm sınırı vardır: satırlar ana realm'de üretilir. Tarih
 * karşılaştırmaları `instanceof Date` ile yapıldığı için bağlama ana realm'in
 * Date/Map/Set kurucuları verilir.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const PUBLIC=path.resolve(__dirname,'..','..','..','public');
// public/index.html + perf-runtime.js `cpAssistant` sırası (karar katmanı için gereken alt küme).
const SCRIPTS=Object.freeze(['chronological-values.js','business-rules.js','order-decision-engine.js','revision-display.js','canonical-fields.js',
  'checklist-components-engine.js','backlog-delivery-engine.js','cp-readiness-engine.js','cp-checklist-engine.js','cp-rules-engine.js',
  'plm-sample-requests-engine.js','plm-sample-requests.js','cp-decision-runtime.js','cp-managed-rules.js','overview-model.js','overview-premium.js','cp-overview-assistant.js']);
// Bu betikler `document` görürse ekran bağlamaya geçer; yalnız saf API'leri yüklenir.
const PURE_WITHOUT_DOCUMENT=new Set(['overview-premium.js']);
const MANAGED_CACHE_KEY='lcw.cp.managedRules.cache.v1';
let compiled=null;
function scripts(){
  if(!compiled)compiled=SCRIPTS.map(name=>({name,script:new vm.Script(fs.readFileSync(path.join(PUBLIC,name),'utf8'),{filename:`public/${name}`})}));
  return compiled;
}
const resolved=value=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(value??null))});

/* context: { userId, lang, entries:{key:string}, answers:{}, managedRules, plm, transitRules }
   entries: kullanıcının etkin tercih kayıtları (yalnız lcw.cp.* anahtarları gerekir). */
async function createDecisionHost(context){
  const store=new Map();
  for(const [key,value] of Object.entries(context.entries||{}))if(typeof value==='string')store.set(key,value);
  // İstemcide supplier-sync paylaşılan cevapları asistan durumuna birleştirir; burada
  // birleşmiş hal doğrudan cevap deposuna yazılır.
  store.set('lcw.cp.checklist.v1',JSON.stringify(context.answers||{}));
  if(context.managedRules)store.set(MANAGED_CACHE_KEY,JSON.stringify(context.managedRules));
  const storage={getItem:key=>store.has(String(key))?store.get(String(key)):null,setItem:(key,value)=>{store.set(String(key),String(value));},removeItem:key=>{store.delete(String(key));},
    key:i=>[...store.keys()][i]??null,get length(){return store.size;}};
  const routes={'/api/cp-managed-rules':context.managedRules||null,'/api/plm-requests':context.plm||{models:{},updatedAt:null}};
  const noop=()=>{};
  const ctx={console:{log:noop,info:noop,warn:noop,error:noop,debug:noop},
    Date,Map,Set,WeakMap,WeakSet,JSON,Promise,Intl,Math,Number,String,Boolean,Symbol,Error,TypeError,RangeError,
    queueMicrotask,structuredClone,
    setTimeout:noop,clearTimeout:noop,setInterval:noop,clearInterval:noop,requestAnimationFrame:noop,
    localStorage:storage,BLStorage:{...storage,actualKey:key=>String(key),native:storage,isSynced:()=>false},
    BL_USER_CONTEXT:{id:String(context.userId||'')},appLang:context.lang==='en'?'en':'tr',
    state:{overrides:{transitRules:Array.isArray(context.transitRules)?context.transitRules:[]}},
    document:{documentElement:{lang:context.lang==='en'?'en':'tr',dataset:{}},body:{dataset:{}},getElementById:()=>null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:noop,createElement:()=>({style:{},dataset:{},setAttribute:noop,appendChild:noop,addEventListener:noop})},
    fetch:async url=>{const key=String(url||'').split('?')[0];return Object.hasOwn(routes,key)?resolved(routes[key]):{ok:false,status:404,json:async()=>({})};},
    CustomEvent:class CustomEvent{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},
    addEventListener:noop,removeEventListener:noop,dispatchEvent:()=>true,showToast:noop,
    matchMedia:()=>({matches:false,addEventListener:noop}),
  };
  ctx.window=ctx;ctx.globalThis=ctx;ctx.self=ctx;
  vm.createContext(ctx);
  for(const {name,script} of scripts()){
    if(!PURE_WITHOUT_DOCUMENT.has(name)){script.runInContext(ctx);continue;}
    const document=ctx.document;ctx.document=undefined;
    try{script.runInContext(ctx);}finally{ctx.document=document;}
  }
  // Asistan açılışta Moderatör kanalını ve PLM verisini yükler (sözde ağ hemen çözülür).
  for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
  const assistant=ctx.BLCpAssistant;
  if(!assistant||typeof assistant.computeDecisionsForRows!=='function')throw Object.assign(new Error('Overview decision host failed to start'),{code:'OVERVIEW_DECISION_HOST_FAILED'});
  const OD=ctx.BLOrderDecisionEngine;
  let revision=0;
  return {
    assistant,
    window:ctx,
    // Satırlar ana realm'den gelir; karar sonucu Map/WeakMap olarak döner.
    decide(rows){return assistant.computeDecisionsForRows(rows);},
    /* Genel Bakış'ın CP kısmı: kişisel karar katmanı + ekranda gösterilen özet +
       satır başına Unified Action Priority kodu (sezon × öncelik kırılımı için).
       İstemcide row.Priority = actionPriorityCode(analysis.priority)||'ON_TRACK'. */
    overview(rows){
      // İstemci sırası: renderOverviewNow önce özeti onOverviewRendered ile (commit:
      // otomatik kural cevapları yazılır) kurar, CP öncelik işi ardından commit'siz koşar.
      assistant.onOverviewRendered(rows,{dataRevision:++revision,filterRevision:'read-model'});
      const state=assistant._state;
      const summary=assistant.overviewSummaryOf(state.model,state.checklist);
      const result=assistant.computeDecisionsForRows(rows);
      const priorityOf=row=>{const analysis=result&&result.byRow?result.byRow.get(row):null;return ctx.BLOverviewModel.actionPriorityCode(ctx.BLOverviewModel.actionPriorityCode(analysis&&analysis.priority,OD)||'ON_TRACK',OD);};
      const codes=OD&&typeof OD.priorityIds==='function'?OD.priorityIds():(OD&&Array.isArray(OD.ACTION_PRIORITIES)?OD.ACTION_PRIORITIES.slice():[]);
      return {summary,priorityOf,codes,
        labels:Object.fromEntries(codes.map(code=>[code,{tr:OD.priorityLabel(code,'tr')||'',en:OD.priorityLabel(code,'en')||''}]))};
    },
  };
}
module.exports={createDecisionHost,SCRIPTS};
