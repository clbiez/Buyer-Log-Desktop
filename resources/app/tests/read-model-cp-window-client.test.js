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

test('flag off by default; renderCPNow tries the windowed path first only when enabled',()=>{
  const enabled=extractFunction(SOURCE,'cpReadModelEnabled');
  const ctx=vm.createContext({window:{},localStorage:{getItem:()=>null}});
  vm.runInContext(`const cpRM={disabled:false};let cpRMEnabledCache=null;const CP_RM_STORAGE_KEY='bl.cpReadModel.v1';${enabled};globalThis.f=cpReadModelEnabled;`,ctx);
  assert.equal(ctx.f(),false);
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
  assert.match(spec,/state\.cpDirty&&state\.cpDirty\.size\)return \{ok:false,reason:'dirty'\}/);
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
  assert.match(SOURCE,/if\(!window\.BLCpReadModel\?\.onDecisionContextChanged\?\.\(\)&&!computedHandled&&currentActiveTab\(\)==='cp'\)renderCP\(\);/);
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
