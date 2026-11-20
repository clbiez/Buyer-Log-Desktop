'use strict';
/* WS5 (#1078): CP hesaplanmış sütunların istemci yolu. app-main.js'in GERÇEK
   fonksiyonları (scheduleUnifiedPrioritiesForTable, syncUnifiedPrioritiesForTable,
   ensureUnifiedPrioritiesForTable, scheduleCpComputedColumns, applyCpComputed*)
   ayrı bir vm'de, ağ ve karar motoru sahte nesnelerle çalışır:
   - anahtar kapalıyken eski yol aynen çalışır (ağ yok, istemci kararı var);
   - anahtar açıkken istemci 30k satır için karar motoru çalıştırmaz, sunucu
     değerlerini _id ile uygular; ikinci istek `since` ile yalnız değişeni alır;
   - kaydedilmemiş CP düzenlemesi / yoldaki yazım varken eski yol;
   - sunucu hatası oturumu eski yola alır, satır uyuşmazlığı yalnız o hesabı;
   - checklist-supplier-sync.js sağlayıcı etkinken satır geçişi ve Genel Bakış
     asistan hesabı çalıştırmaz. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const SYNC_SOURCE=fs.readFileSync(path.join(__dirname,'..','public','checklist-supplier-sync.js'),'utf8');
function block(start,end){const i=SOURCE.indexOf(start);if(i<0)throw new Error(start);return SOURCE.slice(i,SOURCE.indexOf(end,i)+end.length);}
const FUNCTIONS=['norm','actionPriorityCode','unifiedPriorityRowActive','applyUnifiedPriorityAnalysis','syncUnifiedPrioritiesForTable','scheduleUnifiedPrioritiesForTable',
  'ensureUnifiedPrioritiesForTable','cpComputedEnabled','cpComputedEligible','applyCpComputedRow','applyCpComputedColumns','cpComputedAnswerOverlay','prepareCpComputedContext','scheduleCpComputedColumns','cpComputedSignature','cpComputedOptimisticAnswer',
  'cpComputedPending','cpComputedDependentKey','cpViewNeedsComputed','cpComputedPendingCell'];

function load({flag=true,rows=4,server,deltaRow=0}={}){
  const calls={fetch:[],decide:0,decideAsync:0,render:0,overview:0,flush:0,sync:0,marks:[],timers:[]};
  const cpRows=Array.from({length:rows},(_,i)=>({_id:'r'+i,'Order Code':'O'+i,Priority:''}));
  const assistant={
    computeDecisionsForRows:list=>{calls.decide++;return {byRow:new Map(list.map(row=>[row,{priority:'CRITICAL'}]))};},
    computeDecisionsForRowsAsync:async list=>{calls.decideAsync++;return {byRow:new Map(list.map(row=>[row,{priority:'CRITICAL'}]))};},
    decisionContextRevision:()=>ctx.__contextRevision,
  };
  const reply=server||((body)=>({status:200,json:{ok:true,columns:{version:1,lang:'tr',token:'t'+calls.fetch.length,delta:Boolean(body.since),total:rows,
    rows:(body.since?cpRows.slice(deltaRow,deltaRow+1):cpRows).map(row=>[row._id,'ACTION_TODAY','KNOWN',['TAG'],[],[{code:'R1'}],[{code:'S'}],null,
      {cells:{__checklist__pps:'Bekliyor'},status:{pps:'open'},parts:{},elements:{},single:false,tasks:{}},row['Order Code'],'']),removed:[]}}}));
  const ctx={
    console,Map,Set,WeakMap,Promise,JSON,Object,Array,String,Number,Boolean,Error,Math,Date,queueMicrotask,AbortController,
    setTimeout:(fn,ms)=>{calls.timers.push({fn,ms});return calls.timers.length;},
    performance:{now:()=>0},
    window:null,state:{cp:{rows:cpRows},cpDirty:new Set(),cpSort:{key:null,dir:1},colFilters:{cp:{}}},appLang:'tr',
    COLS_BY_TABLE:{cp:[{k:'Priority'},{k:'__checklist__pps',checklistSupplierColumn:true},{k:'f1',formulaCustom:true},{k:'Season'}]},
    document:{getElementById:id=>ctx.__dom?.[id]||null},escapeHtml:value=>String(value),
    __contextRevision:1,
    pendingOverrideWriteCount:()=>ctx.__pending||0,
    renderCP:()=>{calls.render++;},scheduleOverviewRender:()=>{calls.overview++;},showToast:()=>{},renderOrders:()=>{},
    showUnifiedPriorityLoading:()=>{calls.loading=(calls.loading||0)+1;},currentActiveTab:()=>'cp',
    CustomEvent:class{constructor(type,init){this.type=type;this.detail=init&&init.detail;}},
    fetch:async(url,init)=>{const body=JSON.parse(init.body);calls.fetch.push({url,body});const r=reply(body,calls,cpRows);return {ok:r.status===200,status:r.status,json:async()=>r.json};},
  };
  ctx.window=ctx;
  Object.assign(ctx,{BLCpAssistant:assistant,BL_READ_MODEL_CP_COMPUTED:flag,
    BLOrderDecisionEngine:{ACTION_PRIORITY:{CRITICAL:{},ACTION_TODAY:{},ACTION_THIS_WEEK:{},ON_TRACK:{}}},
    BLModulePreparation:{setStatus(){}},BLPerf:{mark:(name,detail)=>calls.marks.push({name,detail})},dispatchEvent:()=>true,
    BLStorage:{flushPending:async()=>{calls.flush++;},getItem:key=>ctx.__stored?.[key]??null,setItem(){}},
    BLChecklistSupplierSync:{syncAnswerChanges:async()=>{calls.sync++;},_state:{pendingAnswers:{}},refreshColumns:opts=>{(calls.columns=calls.columns||[]).push(opts);return true;}}});
  vm.createContext(ctx);
  vm.runInContext([
    'const _unifiedPriorityCache={cp:null,orders:null};const _unifiedPriorityTableRevision={cp:1,orders:1};',
    'let _cpPriorityIndex=null,_cpPriorityIndexRevision=0;let cpPriorityJob=null;',
    block('const CP_COMPUTED_STORAGE_KEY=',';'),block('const cpComputedPendingText=',';'),block('const cpComputed={','};'),block('const CP_COMPUTED_HIDDEN=[','];'),block('const CP_COMPUTED_OVERLAY_MAX_BYTES=',';'),block('const CP_COMPUTED_OPTIMISTIC_MAX_ROWS=',';'),
    // #1078 alt PR 3: hesaplanmış sütun isteği okuma modeli sınırlayıcısından geçer (gerçek kaynak).
    SOURCE.slice(SOURCE.indexOf('const CP_RM_MAX_ACTIVE=2;'),SOURCE.indexOf('async function cpRMPost(')),
    ...FUNCTIONS.map(name=>extractFunction(SOURCE,name)),
    block('window.BLCpComputedColumns={','\n};'),
    `globalThis.__api={${FUNCTIONS.join(',')},cache:()=>_unifiedPriorityCache,computed:()=>cpComputed};`,
  ].join('\n'),ctx,{filename:'app-main.js (cp-computed)'});
  return {api:ctx.__api,ctx,calls,rows:cpRows};
}

test('flag off: legacy client path, no request to the read model; default is ON, preference "0" turns it off',async()=>{
  const stored=load({flag:null});stored.ctx.__stored={'bl.cpComputed.v1':'1'};
  assert.equal(stored.api.cpComputedEnabled(),true,'kullanıcı tercihi');
  const unset=load({flag:null});
  assert.equal(unset.api.cpComputedEnabled(),true,'varsayılan AÇIK (#1078 alt PR 3, kullanıcı kararı)');
  const optOut=load({flag:null});optOut.ctx.__stored={'bl.cpComputed.v1':'0'};
  assert.equal(optOut.api.cpComputedEnabled(),false,'geri dönüş: tercih "0"');
  const {api,calls,rows}=load({flag:false});
  assert.equal(await api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(calls.fetch.length,0);assert.equal(calls.decideAsync,1);
  assert.equal(rows[0].Priority,'CRITICAL');
  assert.equal(api.cache().cp.rows,rows);
});

test('flag on: values come from the back end by _id; no client decision engine; second request is a delta',async()=>{
  const {api,ctx,calls,rows}=load();
  assert.equal(await api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(calls.decide+calls.decideAsync,0,'istemci karar motoru çalışmadı');
  assert.equal(calls.fetch.length,1);assert.equal(calls.fetch[0].url,'/api/read-model/cp/computed');
  assert.deepEqual(calls.fetch[0].body,{version:1,lang:'tr'});
  assert.equal(calls.flush,1,'kişisel bağlam önce sunucuya yazıldı');
  for(const row of rows){
    assert.equal(row.Priority,'ACTION_TODAY');assert.deepEqual(row._trackingTags,['TAG']);assert.equal(row._actionPriorityReasons[0].code,'R1');
    assert.equal(row.__checklist__pps,'Bekliyor');assert.equal(row._checklistStatus.pps,'open');
    assert.equal(Object.keys(row).includes('_checklistStatus'),false,'checklist meta alanları sayılmaz (export/kopya)');
    assert.equal(row._unifiedBasePriority,'ACTION_TODAY');
  }
  const cache=api.cache().cp;assert.equal(cache.rows,rows);assert.equal(cache.source,'read-model');
  assert.ok(calls.render>=1&&calls.overview>=1);
  assert.ok(ctx.BLCpComputedColumns.covers(rows)&&ctx.BLCpComputedColumns.active());
  // Bağlam değişti (ör. checklist cevabı): tablo eski değerlerle çizilir, yalnız değişen satır istenir.
  ctx.__contextRevision=2;
  assert.equal(api.ensureUnifiedPrioritiesForTable('cp'),true,'yükleme ekranına dönülmedi');
  assert.equal(calls.loading||0,0);
  await api.computed().job?.promise;
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.fetch.length,2);assert.equal(calls.fetch[1].body.since,'t1');
  assert.equal(calls.decide+calls.decideAsync,0);
  // Eşzamanlı okuma yolu (filtre/export) 30k satırı burada hesaplamaz.
  ctx.__contextRevision=3;
  assert.equal(api.syncUnifiedPrioritiesForTable('cp'),false);
  assert.equal(calls.decide,0);
  await api.computed().job?.promise;
});

test('unsaved or in-flight CP edits keep the legacy client path; afterwards a full (non-delta) request is made',async()=>{
  const {api,ctx,calls,rows}=load();
  await api.scheduleUnifiedPrioritiesForTable('cp');
  ctx.state.cpDirty.add('r1');
  ctx.__contextRevision=2;
  assert.equal(api.syncUnifiedPrioritiesForTable('cp'),true,'eski yol eşzamanlı hesapladı');
  assert.equal(calls.decide,1);assert.equal(rows[1].Priority,'CRITICAL');
  assert.equal(api.computed().applied,null,'istemci hesabı sunucu tokenını geçersiz kıldı');
  ctx.state.cpDirty.clear();ctx.__pending=1;ctx.__contextRevision=3;
  assert.equal(api.ensureUnifiedPrioritiesForTable('cp'),false);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.fetch.length,1,'yoldaki yazım varken istek yok');
  ctx.__pending=0;ctx.__contextRevision=4;
  assert.equal(await api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(calls.fetch.length,2);assert.equal(calls.fetch[1].body.since,undefined,'tam istek');
});

/* #1078 satır yaması: kayıt sürerken okuma bayatlarsa (409) ya da kuyruk doluysa (503) kullanıcıya hata yok:
   önceki değerler satırlarda kalır, oturum kapanmaz, sınırlı sayıda yeniden istenir; yenisi gelince uygulanır. */
test('transient 409 stale / 503 busy: previous result kept, no session fallback, bounded retry; exhausted keeps previous values (one slow retry), first load falls back to legacy for the job',async()=>{
  let mode='ok';
  const t=load({server:(body)=>mode==='ok'?{status:200,json:{ok:true,columns:{version:1,lang:'tr',token:'t1',delta:false,total:4,
    rows:['r0','r1','r2','r3'].map(id=>[id,'ACTION_TODAY','KNOWN',[],[],[],[],null,null,'O','']),removed:[]}}}
    :mode==='stale'?{status:409,json:{ok:false,code:'COMPUTE_STALE_GENERATION'}}:{status:503,json:{ok:false,code:'COMPUTE_QUEUE_BUSY'}}});
  assert.equal(await t.api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(t.rows[0].Priority,'ACTION_TODAY');
  mode='stale';t.ctx.__contextRevision=2;
  assert.equal(await t.api.scheduleUnifiedPrioritiesForTable('cp'),false);
  assert.equal(t.api.computed().disabled,false,'oturum kapanmadı');
  assert.equal(t.calls.decideAsync,0,'eski yol çalışmadı');
  assert.equal(t.rows[0].Priority,'ACTION_TODAY','önceki değer satırda kaldı');
  assert.equal(t.calls.timers.length,1,'yeniden deneme planlandı');
  // Yeniden deneme yeni değeri getirir; sayaç sıfırlanır.
  mode='ok';t.calls.timers.shift().fn();
  for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(t.calls.fetch.length,3);assert.equal(t.api.computed().transient,0);
  // Sürekli geçici hata: sınırlı deneme, sonra yalnız bu hesap eski yolla; oturum yine açık.
  mode='busy';t.ctx.__contextRevision=3;
  await t.api.scheduleUnifiedPrioritiesForTable('cp');
  for(let attempt=0;attempt<10&&t.calls.timers.length&&t.calls.timers[0].ms<10000;attempt++){
    t.calls.timers.shift().fn();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(t.calls.fetch.length,3+5,'ilk istek + 4 yeniden deneme');
  // Önceki sunucu değerleri satırlarda: 30k istemci hesabına düşülmez, değerler kalır; tek geç deneme planlanır.
  assert.equal(t.calls.decideAsync,0,'eski yol çalışmadı');
  assert.equal(t.rows[0].Priority,'ACTION_TODAY','önceki değerler kaldı');
  assert.equal(t.calls.timers.length,1);assert.equal(t.calls.timers[0].ms,10000,'tek geç deneme');
  t.calls.timers.shift().fn();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
  for(let attempt=0;attempt<10&&t.calls.timers.length;attempt++){t.calls.timers.shift().fn();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(t.calls.fetch.length,8+5,'geç deneme tek sınırlı tur');
  assert.equal(t.calls.timers.length,0,'ikinci geç deneme yok (yoklama döngüsü yok)');assert.equal(t.calls.decideAsync,0);
  assert.equal(t.api.computed().disabled,false,'oturum açık kaldı');
  // Önceki değer yokken (ilk yükleme) tükenince bu hesap eski yolla.
  const fresh=load({server:()=>({status:503,json:{ok:false,code:'COMPUTE_QUEUE_BUSY'}})});
  await fresh.api.scheduleUnifiedPrioritiesForTable('cp');
  for(let attempt=0;attempt<10&&fresh.calls.timers.length;attempt++){fresh.calls.timers.shift().fn();for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(fresh.calls.decideAsync,1,'ilk yüklemede tükenince eski yol');assert.equal(fresh.api.computed().disabled,false);
});

test('server error falls back to the legacy path for the session; row mismatch only for that job',async()=>{
  const failing=load({server:()=>({status:500,json:{ok:false,code:'COMPUTE_WORKER_FAILED'}})});
  assert.equal(await failing.api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(failing.calls.decideAsync,1,'eski yol hesapladı');
  assert.equal(failing.api.computed().disabled,true);
  assert.equal(failing.rows[0].Priority,'CRITICAL');
  failing.ctx.__contextRevision=2;
  await failing.api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(failing.calls.fetch.length,1,'oturum eski yolda kaldı');

  const partial=load({server:(body)=>({status:200,json:{ok:true,columns:{version:1,lang:'tr',token:'x',delta:false,total:1,rows:[['r0','ON_TRACK','KNOWN',[],[],[],[],null,null]],removed:[]}}})});
  assert.equal(await partial.api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(partial.calls.decideAsync,1,'uyuşmazlıkta bu hesap eski yolla');
  assert.equal(partial.api.computed().disabled,false,'oturum kapatılmadı');
  assert.equal(partial.rows[3].Priority,'CRITICAL');
  // Sağlayıcı etkin kalsa da checklist hücreleri eski yolun karar nesnesiyle yazılır (Codex P2).
  assert.equal(partial.calls.columns.length,1);
  assert.ok(partial.calls.columns[0].decision&&partial.calls.columns[0].decision.byRow.get(partial.rows[3]),'karar nesnesiyle tam checklist geçişi');
  assert.equal(partial.calls.columns[0].render,false);

  // Tercih yazımı başarısız: sunucu eski kural/ayarla hesaplamaz; oturum eski yola geçer (Codex P2).
  const unsaved=load();
  unsaved.ctx.BLStorage.flushPending=async()=>{throw new Error('PREFERENCE_SAVE_FAILED');};
  assert.equal(await unsaved.api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(unsaved.calls.fetch.length,0,'eski tercihle sunucu sonucu istenmedi');
  assert.equal(unsaved.calls.decideAsync,1);assert.equal(unsaved.api.computed().disabled,true);
  assert.equal(unsaved.calls.columns.length,1,'checklist yerelde yazıldı');

});

test('answers still in the checklist sync queue travel as an overlay; only non-answer context changes wait for the preference flush',async()=>{
  const {api,ctx,calls}=load();
  ctx.BLCpAssistant._state={answers:{'O1::pps':{state:'approved',at:'2026-11-20T10:00:00.000Z'},'O2::soff':{state:'open'}}};
  ctx.BLChecklistSupplierSync._state.pendingAnswers={'O1::pps':{},'O9::tests':{}};
  assert.equal(await api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(calls.sync,0,'senkron turu beklenmedi');assert.equal(calls.flush,1,'ilk hesapta tercihler yazıldı');
  assert.deepEqual(calls.fetch[0].body.answers,{'O1::pps':{state:'approved',at:'2026-11-20T10:00:00.000Z'},'O9::tests':null},'kuyruktaki kendi cevapları (silinen: null)');
  // Yalnız cevap değişti: tercih yazımı beklenmez.
  ctx.__contextRevision=2;
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(calls.flush,1);
  // Cevap dışı bağlam (kural/ayar): yazım beklenir.
  api.computed().answersOnly=false;ctx.__contextRevision=3;
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(calls.flush,2);
  // Kuyruk boş: katman gönderilmez.
  ctx.BLChecklistSupplierSync._state.pendingAnswers={};ctx.__contextRevision=4;
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(calls.fetch.at(-1).body.answers,undefined);
  // Çok büyük katman: önce senkron beklenir; yine sığmazsa bu hesap eski yolla.
  const big=load();
  big.ctx.BLCpAssistant._state={answers:Object.fromEntries(Array.from({length:3000},(_,i)=>[`O${i}::pps`,{state:'approved',note:'x'.repeat(200)}]))};
  big.ctx.BLChecklistSupplierSync._state.pendingAnswers=Object.fromEntries(Object.keys(big.ctx.BLCpAssistant._state.answers).map(key=>[key,{}]));
  assert.equal(await big.api.scheduleUnifiedPrioritiesForTable('cp'),true);
  assert.equal(big.calls.sync,1);assert.equal(big.calls.fetch.length,0);assert.equal(big.calls.decideAsync,1);
  assert.equal(big.api.computed().disabled,false);
});

test('checklist-supplier-sync: provider skips the row pass and the Overview assistant recompute; legacy code stays when inactive',()=>{
  // Satır geçişi yalnız karar nesnesiyle ya da sağlayıcı yokken.
  assert.match(SYNC_SOURCE,/const provider = !opts\.decision \? \(root\.BLCpComputedColumns && typeof root\.BLCpComputedColumns\.active === 'function' && root\.BLCpComputedColumns\.active\(\) \? root\.BLCpComputedColumns : null\) : null;\s*if \(provider\) \{[\s\S]{0,200}const refreshing = !opts\.columnsOnly && typeof provider\.refresh === 'function';\s*if \(refreshing\) void Promise\.resolve\(provider\.refresh\(\)\)[\s\S]{0,120}refreshing \? \{ render: false \} : \{\}\);/);
  assert.match(SYNC_SOURCE,/if \(opts\.columnsOnly\) \{[\s\S]{0,600}state\.appliedColumns = null; state\.columnDelta = null;[\s\S]{0,120}return true;\s*\}/);
  // Sütun tanımı kodu columnsOnly dönüşünden önce kurulur.
  assert.ok(SYNC_SOURCE.indexOf("cols.splice.apply(cols")<SYNC_SOURCE.indexOf('if (opts.columnsOnly) {'));
  assert.match(SYNC_SOURCE,/function refreshAssistantView\(\) \{[\s\S]{0,260}const provider = \(root\.BLCpComputedColumns && typeof root\.BLCpComputedColumns\.active === 'function' && root\.BLCpComputedColumns\.active\(\) \? root\.BLCpComputedColumns : null\);\s*if \(provider\) \{ if \(typeof provider\.refresh === 'function'\) void Promise\.resolve\(provider\.refresh\(\)\)\.catch\(function \(\) \{\}\); return; \}/);
  assert.match(SYNC_SOURCE,/root\[renderKey\] = function \(\) \{\s*const provider = \(root\.BLCpComputedColumns && typeof root\.BLCpComputedColumns\.active === 'function' && root\.BLCpComputedColumns\.active\(\) \? root\.BLCpComputedColumns : null\);\s*if \(provider\) \{[\s\S]{0,200}columnsOnly: true[\s\S]{0,80}return original\.apply\(this, arguments\);/);
  // Sunucu barındırıcısı refreshColumns'u karar nesnesiyle çağırır: sağlayıcı devreye girmez.
  assert.match(SOURCE,/window\.BLCpComputedColumns=\{\s*active:\(\)=>cpComputedEligible\(\),/);
});

test('checklist-supplier-sync behaviour: active provider → refreshColumns writes no cells and calls no decision engine',()=>{
  let decisions=0,refreshes=0,overview=0;
  const rows=[{_id:'a'},{_id:'b'}];
  const root={COLS_BY_TABLE:{cp:[]},BLFormulaRows:{cp:()=>rows},
    BLCpAssistant:{_state:{rules:[{id:'pps',kind:'checklist',tr:'PPS',en:'PPS'}],answers:{},checklistSettings:{enabled:true}},
      computeDecisionsForRows:()=>{decisions++;return {byRow:new Map()};},onOverviewRendered:()=>{overview++;}},
    BLCpComputedColumns:{active:()=>true,covers:()=>true,refresh:()=>{refreshes++;}},
    BLChecklistComponents:require('../public/checklist-components-engine')};
  // Fabrika kökü kapanışta tutar: modül kendi kökümüzle (document yok → init yok) kurulur.
  const box=Object.assign(root,{console,setTimeout:()=>{},module:{exports:{}}});box.globalThis=box;
  vm.createContext(box);vm.runInContext(SYNC_SOURCE,box,{filename:'checklist-supplier-sync.js'});
  const factoryApi=box.module.exports;
  assert.ok(factoryApi&&typeof factoryApi.refreshColumns==='function');
  assert.equal(factoryApi.refreshColumns({render:false}),true);
  assert.equal(decisions,0,'karar motoru çağrılmadı');assert.equal(refreshes,1,'yenileme sağlayıcıya gitti');
  assert.equal(rows[0].__checklist__pps,undefined,'hücre yazılmadı (sunucu yazar)');
  assert.ok(root.COLS_BY_TABLE.cp.some(col=>col.checklistSupplierColumn&&col.k==='__checklist__pps'),'sütun tanımı kuruldu');
  factoryApi.refreshAssistantView();
  assert.equal(overview,0,'Genel Bakış asistan hesabı çalışmadı');assert.equal(decisions,0);
  // Sağlayıcı pasif: eski satır geçişi.
  root.BLCpComputedColumns.active=()=>false;
  factoryApi.refreshColumns({render:false});
  assert.equal(decisions,1);assert.equal(rows[0].__checklist__pps,'Bekliyor');
});

test('optimistic checklist answer: only the affected order rows are recomputed locally; an equal back-end result does not redraw',async()=>{
  const {api,ctx,calls,rows}=load({deltaRow:1});
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(rows[1]._cpOrderKey,'O1');assert.equal(Object.keys(rows[1]).includes('_cpOrderKey'),false,'eşleme alanı sayılmaz');
  const refreshed=[];
  ctx.BLChecklistSupplierSync.refreshColumns=opts=>{refreshed.push(opts);for(const row of opts.rows)row.__checklist__pps='Bekliyor';return true;};
  ctx.BLChecklistSupplierSync._state.pendingAnswers={'O1::pps':{}};
  const decided=[];ctx.BLCpAssistant.computeDecisionsForRows=list=>{decided.push(list.slice());return {byRow:new Map(list.map(row=>[row,{priority:'ACTION_TODAY',trackingTags:['TAG'],actionReasons:[{code:'R1'}],signals:[{code:'S'}]}]))};};
  const renders=calls.render;
  assert.equal(api.cpComputedOptimisticAnswer(),true);
  assert.equal(decided.length,1);assert.deepEqual(decided[0],[rows[1]],'yalnız cevabı değişen siparişin satırı');
  assert.deepEqual(refreshed[0].rows,[rows[1]]);assert.equal(refreshed[0].decision.byRow.get(rows[1]).priority,'ACTION_TODAY');
  assert.equal(calls.render,renders+1,'hemen çizildi');
  // Arka uç aynı değeri döndürür (delta: 1 satır): ikinci çizim yok.
  ctx.__contextRevision=2;
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(calls.render,renders+1,'aynı sonuç yeniden çizilmedi');
  // Satır sınırı ve eşleşmeyen anahtar: iyimser yol yok, arka uç beklenir.
  ctx.BLChecklistSupplierSync._state.pendingAnswers={'NOPE::pps':{}};
  assert.equal(api.cpComputedOptimisticAnswer(),false);
  ctx.state.cpDirty.add('r0');
  ctx.BLChecklistSupplierSync._state.pendingAnswers={'O1::pps':{}};
  assert.equal(api.cpComputedOptimisticAnswer(),false,'kaydedilmemiş düzenleme varken eski yol');
});

test('decision-context listener hook: legacy render unless back-end columns are applied; non-answer reasons require the preference flush',async()=>{
  const {api,ctx,calls}=load();
  const hook=ctx.BLCpComputedColumns;
  assert.equal(hook.onDecisionContextChanged({detail:{reason:'preferences'}}),false,'henüz uygulanmadı → çağıran çizer');
  assert.equal(api.computed().answersOnly,false);
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(api.computed().answersOnly,true);
  ctx.__contextRevision=2;
  assert.equal(hook.onDecisionContextChanged({detail:{reason:'checklist-answer'}}),true,'uygulandı → arka uç yeniler');
  assert.equal(api.computed().answersOnly,true,'yalnız cevap: yazım beklenmez');
  await api.computed().job?.promise;
  assert.equal(calls.fetch.length,2);
  ctx.__contextRevision=3;
  assert.equal(hook.onDecisionContextChanged({detail:{reason:'preferences'}}),true);
  assert.equal(api.computed().answersOnly,false,'kural/ayar: sonraki istek tercih yazımını bekler');
  await api.computed().job?.promise;
  assert.equal(calls.flush,2);
  // Kaynaktan çıkarılan eski testler için: sağlayıcı yoksa dinleyici eski yolu izler.
  // Alt PR 2: pencereli CP de bağlam değişiminde arka uçtan yeniden sorgular; ikisi de işlemezse eski çizim.
    assert.match(SOURCE,/const computed=window\.BLCpComputedColumns\?\.onDecisionContextChanged\?\.\(event\),windowed=window\.BLCpReadModel\?\.onDecisionContextChanged\?\.\(\);\s*if\(!computed&&!windowed&&currentActiveTab\(\)==='cp'\)renderCP\(\);/);
});

test('(A) pending computed columns: the table is drawn without waiting unless the view depends on them; no silent partial result',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {api,ctx,rows}=load({server:(body)=>({status:200,json:{ok:true,columns:{version:1,lang:'tr',token:'t1',delta:false,total:4,
    rows:rows.map((row,i)=>[row._id,i%2?'CRITICAL':'ON_TRACK','KNOWN',[],[],[],[],null,null,row['Order Code'],'']),removed:[]}}})});
  assert.equal(api.cpComputedPending(),true,'soğuk: bu satırlara arka uç sütunları uygulanmadı');
  // Bağımlı anahtarlar: Priority, checklist ve formül sütunları; Season değil.
  for(const key of ['Priority','__checklist__pps','f1','_trackingTags'])assert.equal(api.cpComputedDependentKey(key),true,key);
  assert.equal(api.cpComputedDependentKey('Season'),false);
  assert.equal(api.cpViewNeedsComputed(),false,'filtre/sıralama/arama yok → satırlar hemen çizilir');
  ctx.state.colFilters.cp.Season={values:new Set(['S6'])};assert.equal(api.cpViewNeedsComputed(),false,'hesaplanmayan sütun filtresi bağlı değil');
  // Hesap yokken Kritik filtresi seçilir → görünüm hesaplanmış değere bağlı: tablo yükleme durumunda bekler (boş sonuç yok).
  ctx.state.colFilters.cp.Priority={values:new Set(['CRITICAL'])};
  assert.equal(api.cpViewNeedsComputed(),true);
  ctx.state.colFilters.cp={};ctx.state.cpSort={key:'Priority',dir:1};assert.equal(api.cpViewNeedsComputed(),true,'Priority sıralaması');
  ctx.state.cpSort={key:null,dir:1};ctx.__dom={cpSearch:{value:'kritik'}};assert.equal(api.cpViewNeedsComputed(),true,'arama');ctx.__dom={};
  // Bekleyen görünüm hücresi: Priority/checklist "Hesaplanıyor…", diğer sütun normal yol.
  api.computed().pendingView=true;
  assert.match(api.cpComputedPendingCell({k:'Priority'},'cp'),/Hesaplanıyor…/);
  assert.equal(api.cpComputedPendingCell({k:'Season'},'cp'),'');
  assert.equal(api.cpComputedPendingCell({k:'Priority'},'orders'),'');
  // Sonuç gelince bekleme biter ve değerler satırlarda: Kritik filtresi doğru satırları görür.
  await api.scheduleUnifiedPrioritiesForTable('cp');
  assert.equal(api.cpComputedPending(),false);
  assert.deepEqual(rows.filter(row=>row.Priority==='CRITICAL').map(row=>row._id),['r1','r3']);
  release();
});

test('(A) render path: renderCPNow draws immediately in the pending view, keeps the loading state otherwise; KPI and extra groups show "calculating" chips with a notice',()=>{
  const render=SOURCE.slice(SOURCE.indexOf('function renderCPNow(){'),SOURCE.indexOf('const CP_IMAGE_WARMUP_ROWS'));
  assert.match(render,/if\(!cpPrioritiesReadyForRender\(\)\)return;/);
  assert.match(extractFunction(SOURCE,'cpPrioritiesReadyForRender'),/cpComputed\.pendingView=cpComputedPending\(\)&&!cpViewNeedsComputed\(\);\s*if\(cpComputed\.pendingView\)\{void scheduleUnifiedPrioritiesForTable\('cp'\);return true;\}\s*return ensureUnifiedPrioritiesForTable\('cp'\);/);
  assert.match(render,/computedPending:cpComputed\.pendingView/);
  assert.match(render,/cpComputed\.pendingView\?cpPendingQuickGroups\(/);
  const kpi=SOURCE.slice(SOURCE.indexOf('function renderCpKpiBar('),SOURCE.indexOf("document.querySelectorAll('#cpKpi .kpi:not([data-qfg-col])')")+400);
  assert.match(kpi,/computedPending\s*\?`<div class="kpi tone-gray cpComputedPending" data-computed-pending="1">/);
  assert.match(kpi,/if\(el\.dataset\.computedPending\)\{el\.addEventListener\('click',cpComputedPendingNotice\);return;\}/);
  assert.match(SOURCE,/function cellHtml\(c,r,cf,tableKey='cp'\)\{\n[^\n]*\n  const pendingCell=typeof cpComputedPendingCell==='function'\?cpComputedPendingCell\(c,tableKey\):'';if\(pendingCell\)return pendingCell;/);
});
