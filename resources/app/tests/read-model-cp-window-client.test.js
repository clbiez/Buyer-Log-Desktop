'use strict';
/* WS5 (#1078) alt PR 2: pencereli CP istemci sözleşmeleri.
   - Anahtar kapalıyken (varsayılan) renderCPNow eski yola gider; açıkken önce pencereli yol.
   - Pencere satırları: tam satırlar bellekteyse AYNI nesne (düzenleme bugünkü gibi), değilse
     salt okunur kopya; hesaplanmış sütunlar (alt PR 1 demeti) her iki durumda uygulanır.
   - Sayfalı görünüm kopyası, tümünü seç / Excel / kopyala hazırlığı, yeniden çiz, sütun paneli.
   - Kaydedilmemiş düzenleme / yolda yazım varken pencereli yol kullanılmaz (alt PR 3).
   - Veri ve kişisel bağlam değişimi pencereli sonucu geçersiz kılar. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const slice=(start,end)=>{const i=SOURCE.indexOf(start);assert.ok(i>=0,start);return SOURCE.slice(i,SOURCE.indexOf(end,i));};

test('flag ON by default (#1078 satır yaması); preference "0" or window flag false opts out; renderCPNow tries the windowed path first when enabled',()=>{
  const enabled=extractFunction(SOURCE,'cpReadModelEnabled');
  const make=(win,stored)=>{const ctx=vm.createContext({window:win,localStorage:{getItem:()=>stored}});
    vm.runInContext(`const cpRM={disabled:false};let cpRMEnabledCache=null;const CP_RM_STORAGE_KEY='bl.cpReadModel.v1';${enabled};globalThis.f=cpReadModelEnabled;`,ctx);return ctx.f();};
  assert.equal(make({},null),true,'varsayılan AÇIK');
  assert.equal(make({},'1'),true);
  assert.equal(make({},'0'),false,'geri dönüş: kullanıcı tercihi "0"');
  assert.equal(make({BL_CP_READ_MODEL:false},null),false,'geri dönüş: sayfa anahtarı');
  const ctx=vm.createContext({window:{},localStorage:{getItem:()=>null}});
  vm.runInContext(`const cpRM={disabled:false};let cpRMEnabledCache=null;const CP_RM_STORAGE_KEY='bl.cpReadModel.v1';${enabled};globalThis.f=cpReadModelEnabled;`,ctx);
  assert.equal(ctx.f(),true);
  const on=vm.createContext({window:{BL_CP_READ_MODEL:true},localStorage:{getItem:()=>null}});
  vm.runInContext(`const cpRM={disabled:false};let cpRMEnabledCache=null;const CP_RM_STORAGE_KEY='bl.cpReadModel.v1';${enabled};globalThis.f=cpReadModelEnabled;`,on);
  assert.equal(on.f(),true);
  // Yönlendirici renderCPNow adını devralır (eski gövde renderCPNowLegacy olarak aynen kalır).
  const route=slice('const renderCPNowLegacy=renderCPNow;','return renderCPNowLegacy.apply(this,arguments);');
  assert.match(route,/renderCPNow=function renderCPNowRoute\(\)\{\s*if\(cpReadModelEnabled\(\)\)\{\s*if\(renderCPFromReadModel\(\)\)return;\s*if\(!state\.cp\)\{void ensureCpLoaded\(\);return;\}/);
  assert.match(SOURCE,/function renderCPNow\(\)\{\s*if\(!state\.cp\) return;\s*cpPlmDetailsSync\(\);/,'eski gövde değişmedi');
  // Eski yola düşüş yönlendiriciye geri girmez.
  assert.match(slice('function renderCPFromReadModel(){','/* Tümünü seç'),/else renderCPNowLegacy\(\);/);
  // Kullanıcı başına tercih (user-storage kapsamlı önek).
  assert.match(fs.readFileSync(path.join(__dirname,'..','public','user-storage.js'),'utf8'),/'bl\.cpReadModel\.'/);
});

test('window rows: full rows are reused (same object) and get the computed tuple; otherwise a read-only copy',()=>{
  const full=[{_id:1,'Order Code':'A',Priority:'ON_TRACK'},{_id:2,'Order Code':'B',Priority:'ON_TRACK'}];
  const applied=[];
  const ctx=vm.createContext({state:{cp:{rows:full}},WeakMap,Map,JSON,Object,Array,
    norm:v=>String(v==null?'':v).trim(),applyCpComputedRow:(row,tuple)=>{row.Priority=tuple[1];applied.push(row._id);},
    reviveServerDates(){},applyLicensorRulesToLoadedRows(){},recalcSuppFobForRow(){},applyFormulas(){},ensurePlmSampleAccessors(){},window:{}});
  vm.runInContext(`const _cpRMFullIndex=new WeakMap();${extractFunction(SOURCE,'cpRMFullRow')}${extractFunction(SOURCE,'cpRMDecorate')}globalThis.d=cpRMDecorate;`,ctx);
  const out=ctx.d([{_id:1,'Order Code':'A',_rowIndex:4},{_id:3,'Order Code':'C',_rowIndex:9},{_id:2,'Order Code':'X',_rowIndex:7}],
    [JSON.stringify(['1','CRITICAL']),JSON.stringify(['3','LATE']),JSON.stringify(['2','ON_TRACK'])]);
  assert.equal(out[0],full[0],'aynı nesne (düzenleme ve seçim bugünkü gibi)');
  assert.equal(full[0].Priority,'CRITICAL','tam satıra arka uç değeri');
  assert.notEqual(out[1],full[1]);assert.equal(out[1]._canEdit,false,'salt okunur (satır bazlı düzenleme alt PR 3)');
  assert.equal(out[1]._rowIndex,undefined);assert.equal(out[1].Priority,'LATE');
  assert.notEqual(out[2],full[1],'farklı nesilde aynı _id başka satır: kimlik alanı tutmazsa tam satır kullanılmaz');
  assert.deepEqual(applied,[1,3,2]);
});

test('paged copy: pending rows of the copied range are loaded and replaced in place',async()=>{
  const pending=index=>({_rmPending:true,_rmIndex:index});
  const store={rows:Array.from({length:600},(_,i)=>i<200?{_id:i}:pending(i))};
  const page=store.rows.slice(250,300),calls=[];
  const ctx=vm.createContext({Math,Array,__store:store,__calls:calls});
  vm.runInContext(`${extractFunction(SOURCE,'cpRMPrepareRange')}
    var cpRM=__store;function cpRMWindowedActive(){return true;}
    async function cpRMEnsureRange(start,end){__calls.push([start,end]);for(let i=start;i<end;i++)cpRM.rows[i]={_id:i};return true;}globalThis.p=cpRMPrepareRange;`,ctx);
  assert.equal(await ctx.p({startRow:10,endRow:19},page),true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[[260,270]]);
  assert.deepEqual(page.slice(10,20).map(row=>row._id),[260,261,262,263,264,265,266,267,268,269]);
});

test('shared paths are wired: copy, export, grid clipboard, redraw, header filter, filteredCP, footer totals',()=>{
  assert.match(SOURCE,/if\(info\.tableKey==='cp'&&cpRMWindowedActive\(\)\)\{void cpRMCopyAll\(info\);return;\}/);
  assert.match(SOURCE,/if\(tab==='cp'&&!\(await cpPrepareAllRows\(\)\)\)return;/);
  assert.match(SOURCE,/\.\.\.\(tableKey==='cp'\?\{prepareRange:\(range,rows\)=>cpRMPrepareRange\(range,rows\)\}:\{\}\)/);
  assert.match(SOURCE,/else if\(tableKey==='cp'&&cpRMWindowedActive\(\)\)\{cpRMInvalidate\('redraw'\);renderCPNow\(\);\}/);
  assert.match(SOURCE,/if\(tableKey==='cp'&&cpRMOpenHeaderFilter\(key,anchorEl,rerenderOuter\)\)return;/);
  assert.match(slice('function filteredCP(){','if(!state.cp) return [];'),/cpRMMaterializedRows\(\)/);
  const paint=slice('function cpRMPaintTable(){','function cpRMFooterSpec(){');
  assert.match(paint,/footerTotals:cpRMFooterTotals/);assert.match(paint,/loadAllRows:cpRMLoadAllIdRows/);assert.match(paint,/selectionRows:cpRMSelectionRows/);
  assert.match(paint,/cpRMNeedRow\(row\._rmIndex\)/,'pencere deponun indeksiyle istenir (sayfalı görünüm)');
});

test('unsaved edits and pending writes keep the legacy path (row-level editing is sub-PR 3)',()=>{
  const spec=slice('function cpReadModelSpec(options={}){','migrateLegacyCpQuickFilters();');
  // Alt PR 3: satır kaydı anahtarı açıkken yalnız onaylanmamış yazma; kapalıyken bugünkü kural (kirli satır).
  assert.match(spec,/if\(typeof cpEditsBlockServerPaths==='function'\?cpEditsBlockServerPaths\(\):Boolean\(state\.cpDirty&&state\.cpDirty\.size\)\)return \{ok:false,reason:'dirty'\}/);
  assert.match(spec,/pendingOverrideWriteCount\(\)>0\)return \{ok:false,reason:'pending-writes'\}/);
});

test('every query transition supersedes in-flight window and count requests; data and context changes invalidate',()=>{
  const render=slice('function renderCPFromReadModel(){','/* Tümünü seç / kopyala / Excel');
  assert.match(render,/const supersede=\(\)=>\{cpRM\.seq\+\+;cpRM\.facetsSeq\+\+;\};/);
  assert.match(render,/if\(!spec\.ok\)\{supersede\(\);/);
  assert.match(render,/if\(signature===cpRM\.signature&&cpRM\.rows\)\{\s*supersede\(\);/);
  assert.match(render,/cpRM\.unsupportedSignature=signature/,'reddedilen sorgu tekrar denenmez');
  // Sunucu/eş senkronu ve transit kuralı → yeniden sorgu; tam satır yüklemesi → aynı nesnelere bağlanır.
  for(const reason of ['cp-projection-loaded','server-cp-deferred','cp-peer-sync','remote-cp-decision-patch','transit-rules-server'])
    assert.ok(SOURCE.includes(`'${reason}'`)&&slice('const CP_RM_DATA_REASONS=','const cpRM=').includes(`'${reason}'`),reason);
  assert.match(SOURCE,/const computed=window\.BLCpComputedColumns\?\.onDecisionContextChanged\?\.\(event\),windowed=window\.BLCpReadModel\?\.onDecisionContextChanged\?\.\(\);\s*if\(!computed&&!windowed&&currentActiveTab\(\)==='cp'\)renderCP\(\);/);
  // İmza gün ve dile bağlı: gün değişimi ve dil değişimi yeni sorgu.
  assert.match(extractFunction(SOURCE,'cpRMSignature'),/cpRMLang\(\),cpRMToday\(\)/);
});

test('preference flush failure disables the windowed path for the session even when the flag is forced (no request loop)',()=>{
  const enabled=extractFunction(SOURCE,'cpReadModelEnabled');
  const ctx=vm.createContext({window:{BL_CP_READ_MODEL:true},localStorage:{getItem:()=>'1'}});
  vm.runInContext(`const cpRM={disabled:false};let cpRMEnabledCache=null;const CP_RM_STORAGE_KEY='bl.cpReadModel.v1';${enabled};globalThis.f=cpReadModelEnabled;globalThis.rm=cpRM;`,ctx);
  assert.equal(ctx.f(),true);ctx.rm.disabled=true;assert.equal(ctx.f(),false);
  const render=slice('function renderCPFromReadModel(){','/* Tümünü seç / kopyala / Excel');
  assert.match(render,/if\(error\.status===400\)cpRM\.unsupportedSignature=signature;else cpRM\.disabled=true;/);
});

test('Codex #1090 P2: a full CP projection reload invalidates the windowed query and counts (no stale adoption)',()=>{
  const ctx=vm.createContext({window:{BLPerf:null},queueMicrotask:fn=>fn(),renders:0,
    cpReadModelEnabled:()=>true,cpRMWindowedActive:()=>true,currentActiveTab:()=>'cp',renderCP(){ctx.renders++;}});
  vm.runInContext(`const cpRM={epoch:3,seq:1,facetsSeq:1,signature:'sig',facets:{total:5},facetsKey:'k',materialized:{rows:[]},unsupportedSignature:'u',rows:[{_id:1}]};
    ${slice('const CP_RM_DATA_REASONS=','const cpRM=')}
    ${extractFunction(SOURCE,'cpRMInvalidate')}${extractFunction(SOURCE,'cpRMOnDataChanged')}globalThis.rm=cpRM;globalThis.on=cpRMOnDataChanged;`,ctx);
  ctx.on('cp-projection-loaded');
  assert.equal(ctx.rm.signature,'','sorgu imzası düştü: yenilenen veride sorgu baştan kurulur');
  assert.equal(ctx.rm.epoch,4);assert.equal(ctx.rm.facets,null);assert.equal(ctx.rm.materialized,null);
  assert.equal(ctx.renders,1,'açık sekme aynı filtrelerle yeniden sorgular');
  ctx.on('cp-history-edit');assert.equal(ctx.rm.epoch,4,'yerel düzenleme olayı (kirli → eski yol) sorguyu düşürmez');
});

test('Codex #1090 P2: selection actions wait for full CP rows when the windowed path opened without them',()=>{
  // Düğmeler tam satırlar gelene kadar pasif; seçim tam satır yüklemesini başlatır.
  const visibility=extractFunction(SOURCE,'updateShippingBtnVisibility');
  assert.match(visibility,/const cpCount = \(state\.cpSelected && !window\.BLCpReadModel\?\.selectionNeedsRows\?\.\(\) && state\.cpSelected\.size\) \|\| 0;/);
  const loads=[];
  const ctx=vm.createContext({state:{cp:null,cpSelected:new Set([1,2])},loads,
    cpReadModelEnabled:()=>true,ensureCpLoaded:opts=>{loads.push(opts);return Promise.resolve(true);},updateShippingBtnVisibility(){}});
  vm.runInContext(`let _cpRMSelectionLoad=null;${extractFunction(SOURCE,'cpRMSelectionNeedsRows')}${extractFunction(SOURCE,'cpRMLoadRowsForSelection')}
    globalThis.needs=cpRMSelectionNeedsRows;globalThis.load=cpRMLoadRowsForSelection;`,ctx);
  assert.equal(ctx.needs(),true);
  ctx.load();ctx.load();
  assert.equal(loads.length,1,'tek yükleme');assert.equal(loads[0].deferRender,true);
  ctx.state.cp={rows:[]};assert.equal(ctx.needs(),false);
  ctx.state.cp=null;ctx.state.cpSelected=new Set();assert.equal(ctx.needs(),false,'seçim yoksa yükleme gerekmez');
  // Seçimi okuyan yollar tam satırları ister (boş liste sessizce "seçim yok" sayılmaz).
  for(const fn of ['selectedCpRowsForAction','cpKolSelectedSourceRows'])assert.match(extractFunction(SOURCE,fn),/window\.BLCpReadModel\?\.selectionNeedsRows\?\.\(\)\)void window\.BLCpReadModel\.loadRowsForSelection\(\);\s*return \[\];/,fn);
  assert.match(SOURCE,/selectionNeedsRows:cpRMSelectionNeedsRows,\s*loadRowsForSelection:cpRMLoadRowsForSelection,/);
  assert.match(slice('function cpRMPaintTable(){','function cpRMFooterSpec(){'),/onSelectionChange:\(\)=>\{if\(cpRMSelectionNeedsRows\(\)\)cpRMLoadRowsForSelection\(\);updateShippingBtnVisibility\(\);\}/);
});

/* #1078 satır yaması: kayıt sürerken pencere/sayaç okuması bayatlarsa (409) ya da kuyruk doluysa (503)
   kullanıcı hata görmez; önceki sonuç kalır ve sınırlı sayıda yeniden istenir. */
test('transient 409/503: window and counts retry silently (bounded); the first window keeps the previous table without a toast',async()=>{
  const timers=[],warnings=[];let failures=2;
  const stale=()=>Object.assign(new Error('stale'),{code:'COMPUTE_STALE_GENERATION',status:409});
  const ctx=vm.createContext({Math,Map,Set,Promise,Error,Object,console:{warn:(...a)=>warnings.push(a)},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},__stale:stale,
    __fetch:async()=>{if(failures-->0)throw stale();return {offset:100,rows:[{_id:'x'}],computed:[]};}});
  vm.runInContext(`${slice('const CP_RM_TRANSIENT_RETRIES=','/* Kayıt anında yalnız')}
    const CP_RM_WINDOW=100;var cpRM={total:1000,windows:new Set(),pending:new Map(),signature:'s1',rows:new Array(1000)};
    function cpRMFetchRange(){return __fetch();}
    function cpRMPlace(offset,rows){for(let i=0;i<rows.length;i++)cpRM.rows[offset+i]=rows[i];}
    function cpRMDecorate(rows){return rows;}let repaints=0;function cpRMScheduleRepaint(){repaints++;}
    ${extractFunction(SOURCE,'cpRMEnsureWindow')}
    globalThis.api={ensure:cpRMEnsureWindow,state:()=>cpRM,repaints:()=>repaints,transient:cpRMTransientError};`,ctx);
  assert.equal(ctx.api.transient({code:'COMPUTE_STALE_GENERATION',status:409}),true);
  assert.equal(ctx.api.transient({code:'SOURCE_FILTER_REQUIRED',status:409}),false,'kaynak filtresi gereksinimi geçici değildir');
  assert.equal(ctx.api.transient({status:503}),true);assert.equal(ctx.api.transient({status:400}),false);
  assert.equal(await ctx.api.ensure(1),false);
  assert.equal(warnings.length,0,'kullanıcıya/konsola hata yok');
  assert.equal(timers.length,1);
  timers.shift().fn();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.length,1,'ikinci geçici hata da sessizce yeniden denendi');
  timers.shift().fn();for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(ctx.api.state().windows.has(1),'pencere yeni sonuçla yerleşti');assert.equal(ctx.api.repaints(),1);
  // Sürekli geçici hata: sınırlı deneme sonra uyarı (sonsuz döngü yok).
  failures=100;ctx.api.state().windows.delete(1);
  await ctx.api.ensure(1);
  for(let n=0;n<10&&timers.length;n++){timers.shift().fn();for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));}
  assert.equal(timers.length,0);assert.equal(warnings.length,1);
  // İlk pencere ve sayaçlar: geçici hata önceki tabloyu korur, uyarı göstermez, yeniden çizer.
  const first=slice('function renderCPFromReadModel(){','/* Tümünü seç');
  assert.match(first,/if\(cpRMTransientError\(error\)&&\(cpRM\.transient=\(cpRM\.transient\|\|0\)\+1\)<=CP_RM_TRANSIENT_RETRIES\)\{\s*setTimeout\(\(\)=>\{if\(seq!==cpRM\.seq\)return;if\(currentActiveTab\(\)==='cp'\)renderCP\(\);else _deferredTabRenders\.add\('cp'\);\},cpRMRetryDelay\(cpRM\.transient\)\);\s*return;\s*\}/);
  assert.ok(first.indexOf('cpRMTransientError(error)')<first.indexOf('showToast(message)'),'geçici hata uyarıdan önce ele alınır');
  assert.match(slice('function cpRMRequestFacets(','// D1 ölçümü'),/if\(cpRMTransientError\(error\)&&attempt<CP_RM_TRANSIENT_RETRIES\)\{\s*setTimeout\(\(\)=>\{if\(seq===cpRM\.facetsSeq&&signature===cpRM\.signature\)cpRMRequestFacets\(spec,signature,attempt\+1\);\}/);
});

/* #1078 satır yaması: pencereli ilk çizim sunucu hesaplanmış sütunlarını (soğuk barındırıcı, 30k ~15 sn) beklemez.
   İlk sonuç gelene kadar eski yol (#1094 (A): yer tutucu / yükleniyor); ilk sonuç uygulanınca pencereli yol. */
test('windowed path waits for the first server computed result of the session; until then the legacy table opens CP',()=>{
  const fn=extractFunction(SOURCE,'renderCPFromReadModel');
  const marks=[];
  const ctx=vm.createContext({window:{BLPerf:{mark:(n,d)=>marks.push([n,d])}},
    applyCoreAutoFilterState(){},cpReadModelSpec:()=>({ok:true}),cpRMSignature:()=>'sig',
    document:{getElementById:()=>null},performance:{now:()=>0},__posts:0});
  vm.runInContext(`var cpRM={seq:0,facetsSeq:0,legacyReason:'',signature:'',rows:null,unsupportedSignature:''};var cpComputed={readyOnce:false};
    function cpRMPost(){__posts++;return new Promise(()=>{});}function renderCorePageLoadingState(){}function cpRMQueryBody(){return {};}const CP_RM_WINDOW=200;
    ${fn};globalThis.r=renderCPFromReadModel;globalThis.s={cpRM,cpComputed};`,ctx);
  assert.equal(ctx.r(),false,'eski yol');
  assert.equal(ctx.s.cpRM.legacyReason,'computed-warming');assert.equal(ctx.__posts,0,'soğuk hesabı bekleyen sorgu yok');
  ctx.s.cpComputed.readyOnce=true;
  assert.equal(ctx.r(),true,'ilk sonuçtan sonra pencereli yol');assert.equal(ctx.__posts,1);
  // readyOnce yalnız başarılı uygulamada (scheduleCpComputedColumns) set edilir.
  const sched=extractFunction(SOURCE,'scheduleCpComputedColumns');
  assert.match(sched,/cpComputed\.applied=\{rows,token:payload\.columns\.token,lang\};cpComputed\.transient=0;cpComputed\.readyOnce=true;/);
  assert.ok(sched.indexOf('cpComputed.readyOnce=true')<sched.indexOf('renderCP();'),'ilk sonuç tabloyu yeniden çizer → pencereli yol');
});
