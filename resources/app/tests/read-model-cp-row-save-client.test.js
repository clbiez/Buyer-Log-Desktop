'use strict';
/* WS5 (#1078) alt PR 3: CP satır kaydı istemci sözleşmeleri (gerçek app-main.js fonksiyonları vm'de).
   - base satırın ilk bekleyen düzenlemesinden ÖNCE kayıt haritalarından alınır; onayda sunucu değerine taşınır:
     aynı satırın ardışık iki kaydı kendi önceki kaydıyla çakışmaz.
   - Yalnız değişen alanlar ve onların base'i gider; satır kimliği zorunlu.
   - Çakışma: sunucu değeri satıra ve haritalara yazılır, kullanıcı bilgilendirilir, satır yeniden çizilir.
   - Uzak canlı yama kayıt haritalarını da günceller (sonraki base doğru).
   - Toplu yakalama, Supp. FOB / fiyat geri yükleme ve kimliksiz satır bugünkü yolda.
   - Anahtar kapalıyken bugünkü kural (kirli satır → pencereli/hesaplanmış yol kapalı) aynen. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const NAMES=['cpRowSaveEnabled','cpUnsavedRowEdits','cpRowStoredRecord','cpRowStoredValue','cpRowSnapshot','cpRowCaptureBase','cpRowSaveEligible',
  'cpRowBaseFor','cpRowApplyStored','cpRowApplyConflict','cpRowSaveSend','cpRowSaveSettled','cpRowSaveRemoteApplied'];
function load({responses=[],enabled=true,capturing=false}={}){
  const requests=[],toasts=[],refreshed=[];
  const ctx=vm.createContext({console,JSON,Object,Array,Map,Set,Promise,Number,String,Boolean,Error,Date,
    window:{BL_CP_ROW_SAVE:enabled,BL_CLIENT_ID:'tab-1',isCapturingOverrideBatch:()=>capturing,dispatchEvent(){},BLPerf:null},
    localStorage:{getItem:()=>null},CustomEvent:class{constructor(type){this.type=type;}},
    state:{cpDirty:new Set(),overrides:{notesmap:{},delmap:{},submap:{},licensormap:{},noteColumnValues:{},datemap:{}},storeRevisions:{orders:0}},
    appLang:'tr',CP_NOTE_COLUMN_DEFS:[{id:'nc_a'}],requests,toasts,refreshed,
    fetchJSON:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),headers:opts.headers});const next=responses.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(JSON.parse(opts.body)):next;},
    lineKeyOfRow:row=>row['Model Name']&&row['C.Code']?`${row['Order Code']}|${row['Model Name']}|${row['C.Code']}`.toLowerCase():'',
    lineIdentity:row=>row['Model Name']&&row['C.Code']?{model:row['Model Name'],ccode:row['C.Code']}:{},
    showToast:message=>toasts.push(message),refreshRowEverywhere:id=>refreshed.push(id),loadFromServer:async()=>{ctx.reloaded=(ctx.reloaded||0)+1;},
    invalidateUnifiedPriorityDecisions(){},applyFormulas(){},syncCpProductionLogisticSegment(){},coerceDateLoose:value=>value?new Date(value+'T00:00:00'):null,
    pendingOverrideWriteCount:()=>0,currentActiveTab:()=>'overview',notifyOverrideSaveError(){}});
  vm.runInContext(`const CP_ROW_SAVE_STORAGE_KEY='bl.cpRowSave.v1';const cpRowSave={enabled:null,base:new Map(),inFlight:new Map(),queue:Promise.resolve()};
    const CP_ROW_DATE_FIELDS={exFactory:'ex',retailDate:'retail',inStoreDate:'mb'};const cpRowIsObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
    function overrideSyncKey(row,orderCode){return lineKeyOfRow(row)||String(orderCode==null?'':orderCode);}
    ${NAMES.map(name=>extractFunction(SOURCE,name)).join('\n')}
    globalThis.api={${NAMES.join(',')},rowSave:cpRowSave};`,ctx);
  return {ctx,api:ctx.api,requests,toasts,refreshed};
}
const row=()=>({_id:7,'Order Code':123,'Model Name':'M1','C.Code':'C1',Notes:'',NotesHtml:'','Ek Not':'','Ek NotHtml':'','Del. Type':'Gemi'});
const key='123|m1|c1';
const okResponse=current=>body=>({applied:body.items.map(item=>({orderCode:item.orderCode,key,noop:false,current:current(item)})),conflicts:[],revisions:{orders:5,suppFob:1}});

test('base is taken before the local maps change and rebased on each ack: two saves of the same row never conflict with themselves',async()=>{
  const server={notes:{Notes:'',NotesHtml:'',EkNot:'',EkNotHtml:''},delType:'Gemi',dates:{exFactory:null,retailDate:null,inStoreDate:null}};
  const reply=okResponse(item=>{
    if(item.patch.delType)server.delType=item.patch.delType;
    if(item.patch.notes)server.notes={...server.notes,Notes:item.patch.notes.Notes,NotesHtml:item.patch.notes.NotesHtml};
    return JSON.parse(JSON.stringify(server));});
  const {api,ctx,requests}=load({responses:[reply,reply]});
  ctx.state.overrides.delmap[key]='Gemi';
  const r=row();
  api.cpRowCaptureBase(r);
  // Yerel harita sonra değişir (syncOverridesFromRow); base ilk değerde kalır.
  ctx.state.overrides.delmap[key]='Uçak';r['Del. Type']='Uçak';
  const first=api.cpRowSaveSend(r,123,{delType:'Uçak',notes:{Notes:'',NotesHtml:''}});
  const second=api.cpRowSaveSend(r,123,{delType:'Kamyon',notes:{Notes:'not',NotesHtml:''}});
  await Promise.all([first,second]);
  assert.equal(requests.length,2);
  assert.equal(requests[0].url,'/api/overrides/rows');
  assert.deepEqual(requests[0].body.items[0].patch,{model:'M1',ccode:'C1',delType:'Uçak',notes:{Notes:'',NotesHtml:''}});
  assert.equal(requests[0].body.items[0].base.delType,'Gemi','düzenleme öncesi kayıtlı değer');
  assert.equal(requests[1].body.items[0].base.delType,'Uçak','ikinci kayıt ilk kaydın onaylanmış değerini base alır');
  assert.equal(requests[0].headers['X-Client-Id'],'tab-1');
  assert.equal(ctx.state.storeRevisions.orders,5,'global revizyon izlenir (toplu işlemler kendi yazmalarıyla 409 almaz)');
  assert.equal(api.rowSave.inFlight.size,0);assert.equal(api.rowSave.base.size,0,'onaylanınca base temizlenir');
  assert.equal(ctx.state.overrides.delmap[key],'Kamyon');
});

test('conflict: server value is written back to the row and maps; the user is told; no silent loss',async()=>{
  const conflict=body=>({applied:[],conflicts:[{orderCode:123,key,fields:['delType','notes'],
    current:{delType:'Tren',notes:{Notes:'başkası',NotesHtml:'',EkNot:'',EkNotHtml:''},dates:{exFactory:null,retailDate:null,inStoreDate:null}}}],revisions:{orders:9}});
  const {api,ctx,toasts,refreshed}=load({responses:[conflict]});
  const r=row();r['Del. Type']='Uçak';r.Notes='benim';
  await api.cpRowSaveSend(r,123,{delType:'Uçak',notes:{Notes:'benim',NotesHtml:''}});
  assert.equal(r['Del. Type'],'Tren');assert.equal(r.Notes,'başkası');
  assert.equal(ctx.state.overrides.delmap[key],'Tren');assert.equal(ctx.state.overrides.notesmap[key].Notes,'başkası');
  assert.equal(toasts.length,1);assert.match(toasts[0],/başka bir kullanıcı/);
  assert.deepEqual(refreshed,[7]);
  assert.equal(ctx.reloaded,undefined,'kayıtlı değer bilindiği için tam yeniden yükleme yok');
  // Kayıtlı değeri olmayan alan (kaynağa dönmüş) → yeniden yükleme.
  const {api:api2,ctx:ctx2}=load({responses:[()=>({applied:[],conflicts:[{orderCode:123,key,fields:['delType'],current:{dates:{}}}]})]});
  await api2.cpRowSaveSend(row(),123,{delType:'Uçak'});
  assert.equal(ctx2.reloaded,1);
});

test('eligibility: flag, bulk capture, row identity and pricing fields keep the existing path',()=>{
  assert.equal(load().api.cpRowSaveEligible(row(),{notes:{}}),true);
  assert.equal(load({enabled:false}).api.cpRowSaveEligible(row(),{notes:{}}),false);
  assert.equal(load({capturing:true}).api.cpRowSaveEligible(row(),{notes:{}}),false,'toplu yapıştırma atomik batch yolunda');
  assert.equal(load().api.cpRowSaveEligible({...row(),'C.Code':''},{notes:{}}),false,'kimliksiz satır');
  for(const field of ['suppFob','suppFobMeta','pricingRestore'])assert.equal(load().api.cpRowSaveEligible(row(),{notes:{},[field]:1}),false,field);
});

test('remote live patches update the stored maps so the next base is right (no false conflict)',()=>{
  const {api,ctx}=load();
  ctx.state.overrides.delmap[key]='Gemi';
  api.cpRowSaveRemoteApplied(row(),{model:'M1',ccode:'C1',delType:'Uçak',notes:{Notes:'uzak',NotesHtml:''},dates:{retailDate:'2027-01-05'}});
  const snap=api.cpRowSnapshot(key,123);
  assert.equal(snap.delType,'Uçak');assert.equal(snap.notes.Notes,'uzak');assert.equal(snap.dates.retailDate,'2027-01-05');
  assert.equal(load({enabled:false}).api.cpRowSaveRemoteApplied(row(),{delType:'X'}),undefined);
});

test('unsaved-edit rule: flag on → only unacknowledged writes; flag off → any dirty row (today)',()=>{
  const on=load();on.ctx.state.cpDirty=new Set([7]);
  assert.equal(on.api.cpUnsavedRowEdits(),false,'onaylanmış kirli satır pencereli yolu kapatmaz');
  on.api.rowSave.inFlight.set(key,1);assert.equal(on.api.cpUnsavedRowEdits(),true);
  const off=load({enabled:false});off.ctx.state.cpDirty=new Set([7]);assert.equal(off.api.cpUnsavedRowEdits(),true);
});

test('hooks: markDirty and date saves capture base first; saves branch to the row path; spec/computed use the unsaved rule',()=>{
  const wrapper=SOURCE.slice(SOURCE.indexOf('const _origMarkDirty = markDirty;'),SOURCE.indexOf('};',SOURCE.indexOf('const _origMarkDirty = markDirty;')));
  assert.ok(wrapper.indexOf('cpRowCaptureBase(row)')>0&&wrapper.indexOf('cpRowCaptureBase(row)')<wrapper.indexOf('syncOverridesFromRow(row)'));
  const dates=extractFunction(SOURCE,'saveDateOverrides');
  assert.ok(dates.indexOf('cpRowCaptureBase(row)')<dates.indexOf('computeDates(bucket)'),'tarih haritası değişmeden önce');
  assert.match(dates,/if\(typeof cpRowSaveEligible==='function'&&cpRowSaveEligible\(row,\{dates\}\)\)\{\s*cpRowSaveSend\(row,orderCode,\{dates\}\)/);
  const sync=extractFunction(SOURCE,'syncOverrideToServer');
  assert.match(sync,/const rowSave=typeof cpRowSaveEligible==='function'&&cpRowSaveEligible\(row,body\);/);
  assert.match(sync,/:enqueueOverrideMutation\('orders',`\/api\/overrides\/\$\{orderCode\}`,\{method:'PATCH'/);
  assert.match(extractFunction(SOURCE,'applyRemoteRowPatch'),/cpRowSaveRemoteApplied\(row,patch\); \/\/ #1078\s*return row;/);
  assert.match(extractFunction(SOURCE,'cpReadModelSpec'),/if\(typeof cpUnsavedRowEdits==='function'\?cpUnsavedRowEdits\(\):Boolean\(state\.cpDirty&&state\.cpDirty\.size\)\)return \{ok:false,reason:'dirty'\};/);
  assert.match(extractFunction(SOURCE,'cpComputedEligible'),/return !\(typeof cpUnsavedRowEdits==='function'\?cpUnsavedRowEdits\(\):Boolean\(state\.cpDirty&&state\.cpDirty\.size>0\)\)&&pendingOverrideWriteCount\(\)===0;/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','public','user-storage.js'),'utf8'),/'bl\.cpRowSave\.'/);
});
