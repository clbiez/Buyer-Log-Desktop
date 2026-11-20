'use strict';
/* WS5 (#1078) alt PR 3: CP satır kaydı istemci sözleşmeleri (gerçek app-main.js bloğu vm'de).
   - Yalnız kullanıcının DOKUNDUĞU birimler gider (geri al kaydı / geri al-yinele / tarih kaydı). Ekranda kaynak
     değeriyle ya da bayat duran dokunulmamış alan (ör. lojistik parçadan türeyen Del. Type) asla yazılmaz.
   - Birim = sunucunun ayrı karşılaştırdığı parça; base o birimin düzenleme öncesi KAYITLI değeridir ve yalnız o
     birimin onayı onu taşır (aynı satırın başka biriminin onayı bekleyen düzenlemeyi kaybettirmez).
   - Çakışma: gönderilen birimlerin sunucu değeri satıra ve haritalara yazılır, kullanıcı bilgilendirilir; base
     taşınmaz (sıradaki düzenleme başkasının değerini sessizce ezemez).
   - Uzak canlı yama kayıt haritalarını günceller, bekleyen düzenlemenin base'ini değiştirmez.
   - Licensor / Supp. FOB, toplu yakalama, kimliksiz satır ve dokunulan sütunu bilinmeyen düzenleme bugünkü yolda.
   - Anahtar kapalıyken bugünkü kural (kirli satır → pencereli/hesaplanmış yol kapalı) aynen. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');
const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const BLOCK=SOURCE.slice(SOURCE.indexOf("const CP_ROW_SAVE_STORAGE_KEY='bl.cpRowSave.v1';"),SOURCE.indexOf('window.BLCpRowSave={'));
function load({responses=[],enabled=true,capturing=false,rows=[]}={}){
  const requests=[],toasts=[],refreshed=[];
  const ctx=vm.createContext({console,JSON,Object,Array,Map,Set,Promise,Number,String,Boolean,Error,Date,
    window:{BL_CP_ROW_SAVE:enabled,BL_CLIENT_ID:'tab-1',isCapturingOverrideBatch:()=>capturing,dispatchEvent(){},BLPerf:null},
    localStorage:{getItem:()=>null},CustomEvent:class{constructor(type){this.type=type;}},
    state:{cp:{rows},cpDirty:new Set(),overrides:{notesmap:{},delmap:{},submap:{},licensormap:{},noteColumnValues:{},datemap:{}},storeRevisions:{orders:0}},
    appLang:'tr',CP_NOTE_COLUMN_DEFS:[{id:'nc_a'},{id:'nc_b'}],requests,toasts,refreshed,
    fetchJSON:async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body),headers:opts.headers});const next=responses.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(JSON.parse(opts.body)):next;},
    lineKeyOfRow:row=>row['Model Name']&&row['C.Code']?`${row['Order Code']}|${row['Model Name']}|${row['C.Code']}`.toLowerCase():'',
    lineIdentity:row=>row['Model Name']&&row['C.Code']?{model:row['Model Name'],ccode:row['C.Code']}:{},
    showToast:message=>toasts.push(message),refreshRowEverywhere:id=>refreshed.push(id),loadFromServer:async()=>{ctx.reloaded=(ctx.reloaded||0)+1;},
    invalidateUnifiedPriorityDecisions(){},applyFormulas(){},syncCpProductionLogisticSegment(){},coerceDateLoose:value=>value?new Date(value+'T00:00:00'):null,
    pendingOverrideWriteCount:()=>0,currentActiveTab:()=>'overview',notifyOverrideSaveError(){}});
  vm.runInContext(`function overrideSyncKey(row,orderCode){return lineKeyOfRow(row)||String(orderCode==null?'':orderCode);}
    ${BLOCK}
    globalThis.api={cpRowSaveEnabled,cpRowSaveDebounce,cpUnsavedRowEdits,cpEditsBlockServerPaths,cpRowSnapshot,cpRowCaptureBase,cpRowTouch,cpRowTouchAction,cpRowSaveEligible,cpRowSavePlan,cpRowSaveDatePlan,
      cpRowApplyStored,cpRowApplyConflict,cpRowSaveSend,cpRowSaveRemoteApplied,rowSave:cpRowSave};`,ctx);
  return {ctx,api:ctx.api,requests,toasts,refreshed};
}
const row=()=>({_id:7,'Order Code':123,'Model Name':'M1','C.Code':'C1',Notes:'',NotesHtml:'','Ek Not':'','Ek NotHtml':'','Del. Type':'Gemi'});
const key='123|m1|c1';
// syncOverridesFromRow'un ürettiği gövde (bugünkü yol): ekrandaki bütün alanlar.
const fullBody=(r,ctx)=>({model:'M1',ccode:'C1',notes:{Notes:r.Notes,NotesHtml:r.NotesHtml,EkNot:r['Ek Not'],EkNotHtml:r['Ek NotHtml'],NotesAt:'x'},
  delType:r['Del. Type']||undefined,subManufacturer:r['Sub-Manufacturer']||'',noteColumns:ctx.state.overrides.noteColumnValues[key]});
// Bir düzenleme: markDirty (base görüntüsü) → yerel haritalar değişir (syncOverridesFromRow) → pushUndo.
function edit(ctx,api,r,changes){
  api.cpRowCaptureBase(r);
  const fields=Object.entries(changes).map(([column,value])=>{const prev=r[column];r[column]=value;return {key:column,prev,next:value};});
  ctx.state.overrides.notesmap[key]={...(ctx.state.overrides.notesmap[key]||{}),Notes:r.Notes,NotesHtml:r.NotesHtml,EkNot:r['Ek Not'],EkNotHtml:r['Ek NotHtml']};
  if(r['Del. Type'])ctx.state.overrides.delmap[key]=r['Del. Type'];
  ctx.state.overrides.submap[key]=r['Sub-Manufacturer']||'';
  ctx.state.overrides.noteColumnValues[key]={nc_a:r.nc_a||'',nc_b:r.nc_b||''};
  api.cpRowTouchAction({id:r._id,fields});
}
const ack=server=>body=>{
  const item=body.items[0];
  for(const [field,value] of Object.entries(item.patch)){
    if(field==='model'||field==='ccode')continue;
    if(value&&typeof value==='object')server[field]={...(server[field]||{}),...value};else server[field]=value;
  }
  return {applied:[{orderCode:item.orderCode,key,noop:false,current:JSON.parse(JSON.stringify(server))}],conflicts:[],revisions:{orders:5,suppFob:1}};
};

test('only touched units are sent: an untouched source/stale display value (Del. Type) is never written',async()=>{
  const r=row();const server={dates:{exFactory:null,retailDate:null,inStoreDate:null}};
  const {api,ctx,requests}=load({rows:[r],responses:[ack(server)]});
  // Del. Type 'Gemi' kaynaktan (kayıtlı değer yok); kullanıcı yalnız notu değiştirir.
  edit(ctx,api,r,{Notes:'yeni not'});
  const plan=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  assert.deepEqual(JSON.parse(JSON.stringify(plan)),{patch:{notes:{Notes:'yeni not',NotesHtml:''}},units:['notes:Notes']});
  await api.cpRowSaveSend(r,123,plan.patch,plan.units);
  const item=requests[0].body.items[0];
  assert.deepEqual(item.patch,{model:'M1',ccode:'C1',notes:{Notes:'yeni not',NotesHtml:''}});
  assert.deepEqual(item.base,{notes:{Notes:'',NotesHtml:''}},'base: düzenleme öncesi kayıtlı değer');
  assert.equal(Object.hasOwn(item.patch,'delType'),false,'dokunulmamış Del. Type gönderilmez');
  assert.equal(api.rowSave.units.size,0,'onaylanınca birim kaydı biter');
});

test('untouched column of another user is not overwritten: the remote patch updates maps, the stale display stays unsent',async()=>{
  const r=row();const server={delType:'Uçak',notes:{},dates:{exFactory:null,retailDate:null,inStoreDate:null}};
  const {api,ctx,requests}=load({rows:[r],responses:[ack(server)]});
  // B Del. Type'ı 'Uçak' yaptı; canlı yama haritayı güncelledi, ekran (lojistik parçadan türeyen) 'Gemi' kaldı.
  api.cpRowSaveRemoteApplied(r,{model:'M1',ccode:'C1',delType:'Uçak'});
  edit(ctx,api,r,{'Ek Not':'ek'});
  const plan=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  assert.deepEqual([...plan.units],['notes:EkNot']);
  await api.cpRowSaveSend(r,123,plan.patch,plan.units);
  assert.equal(Object.hasOwn(requests[0].body.items[0].patch,'delType'),false);
  assert.equal(server.delType,'Uçak','B\'nin değeri korunur');
});

test('a unit keeps its own base until its own ack: a date edit is not lost when a note save of the same row is acked first',async()=>{
  const r=row();const server={notes:{},dates:{exFactory:null,retailDate:null,inStoreDate:null}};
  const {api,ctx,requests}=load({rows:[r],responses:[ack(server),ack(server)]});
  edit(ctx,api,r,{Notes:'not'});
  // Tarih düzenlemesi: saveDateOverrides tarih haritası değişmeden önce birimi işaretler, sonra harita değişir.
  api.cpRowTouch(r,['Retail Date'],true);ctx.state.overrides.datemap[key]={retail:'2027-03-01'};
  const notePlan=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  await api.cpRowSaveSend(r,123,notePlan.patch,notePlan.units);   // not önce onaylanır
  const datePlan=api.cpRowSaveDatePlan(r,123,{retailDate:'2027-03-01'});
  assert.deepEqual(JSON.parse(JSON.stringify(datePlan)),{patch:{dates:{retailDate:'2027-03-01'}},units:['dates:retailDate']});
  await api.cpRowSaveSend(r,123,datePlan.patch,datePlan.units);
  assert.deepEqual(requests[1].body.items[0].base,{dates:{retailDate:null}},'tarih base\'i not onayıyla taşınmadı (yerel değere eşitlenip atlanmadı)');
  assert.equal(server.dates.retailDate,'2027-03-01');
});

test('consecutive saves of the same unit rebase on ack and never conflict with themselves; a second unit waits for its own ack',async()=>{
  const r=row();const server={delType:'Gemi',notes:{},dates:{exFactory:null,retailDate:null,inStoreDate:null}};
  const {api,ctx,requests}=load({rows:[r],responses:[ack(server),ack(server)]});
  ctx.state.overrides.delmap[key]='Gemi';
  edit(ctx,api,r,{'Del. Type':'Uçak'});
  const p1=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  const first=api.cpRowSaveSend(r,123,p1.patch,p1.units);
  edit(ctx,api,r,{'Del. Type':'Kamyon'});           // ilk kayıt yoldayken
  const p2=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  const second=api.cpRowSaveSend(r,123,p2.patch,p2.units);
  await Promise.all([first,second]);
  assert.equal(requests[0].body.items[0].base.delType,'Gemi');
  assert.equal(requests[1].body.items[0].base.delType,'Uçak','ikinci kayıt ilk kaydın onaylanmış değerini base alır');
  assert.equal(requests[0].headers['X-Client-Id'],'tab-1');
  assert.equal(ctx.state.storeRevisions.orders,5,'global revizyon izlenir (toplu işlemler kendi yazmalarıyla 409 almaz)');
  assert.equal(api.rowSave.inFlight.size,0);assert.equal(api.rowSave.units.size,0);
  assert.equal(ctx.state.overrides.delmap[key],'Kamyon');
});

test('conflict: server values of the sent units go back to the row and maps; the user is told; the base is not moved',async()=>{
  const r=row();
  const conflict=()=>({applied:[],conflicts:[{orderCode:123,key,fields:['delType'],
    current:{delType:'Tren',notes:{Notes:'',NotesHtml:'',EkNot:'',EkNotHtml:''},dates:{exFactory:null,retailDate:null,inStoreDate:null}}}],revisions:{orders:9}});
  const {api,ctx,toasts,refreshed,requests}=load({rows:[r],responses:[conflict,conflict]});
  ctx.state.overrides.delmap[key]='Gemi';
  edit(ctx,api,r,{'Del. Type':'Uçak',Notes:'benim'});
  const p1=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  const first=api.cpRowSaveSend(r,123,p1.patch,p1.units);
  edit(ctx,api,r,{'Del. Type':'Kamyon'});          // yoldayken yeni düzenleme
  const p2=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  await first;
  assert.equal(r['Del. Type'],'Tren');assert.equal(r.Notes,'','reddedilen kayıttaki bütün birimler sunucu değerine döner');
  assert.equal(ctx.state.overrides.delmap[key],'Tren');assert.equal(ctx.state.overrides.notesmap[key].Notes,'');
  assert.equal(toasts.length,1);assert.match(toasts[0],/başka bir kullanıcı/);assert.deepEqual(refreshed,[7]);
  assert.equal(ctx.reloaded,undefined,'kayıtlı değer bilindiği için tam yeniden yükleme yok');
  await api.cpRowSaveSend(r,123,p2.patch,p2.units);
  assert.equal(requests[1].body.items[0].base.delType,'Gemi','base çakışmayla taşınmaz: sıradaki kayıt da çakışır, başkasını ezmez');
  // Kayıtlı değeri olmayan alan (kaynağa dönmüş) → yeniden yükleme.
  const r2=row();const {api:api2,ctx:ctx2}=load({rows:[r2],responses:[()=>({applied:[],conflicts:[{orderCode:123,key,fields:['delType'],current:{dates:{}}}]})]});
  edit(ctx2,api2,r2,{'Del. Type':'Uçak'});const p3=api2.cpRowSavePlan(r2,123,fullBody(r2,ctx2));
  await api2.cpRowSaveSend(r2,123,p3.patch,p3.units);
  assert.equal(ctx2.reloaded,1);
});

test('remote live patch updates maps but not the base of a pending edit: the same unit then conflicts instead of overwriting',async()=>{
  const r=row();const {api,ctx,requests}=load({rows:[r],responses:[()=>({applied:[],conflicts:[],revisions:{}})]});
  edit(ctx,api,r,{nc_a:'benim'});
  const plan=api.cpRowSavePlan(r,123,fullBody(r,ctx));     // gövde hazır, kayıt sırada
  api.cpRowSaveRemoteApplied(r,{model:'M1',ccode:'C1',noteColumns:{nc_a:'uzak'},notes:{Notes:'uzak not',NotesHtml:''},dates:{retailDate:'2027-01-05'}});
  const snap=api.cpRowSnapshot(key,123);
  assert.equal(snap.noteColumns.nc_a,'uzak');assert.equal(snap.notes.Notes,'uzak not');assert.equal(snap.dates.retailDate,'2027-01-05');
  assert.deepEqual([...plan.units],['noteColumns:nc_a']);
  await api.cpRowSaveSend(r,123,plan.patch,plan.units);
  assert.deepEqual(requests[0].body.items[0].base,{noteColumns:{nc_a:''}},'base düzenleme öncesi değer; sunucu uzak değeri görünce çakışma döner');
  assert.deepEqual(requests[0].body.items[0].patch.noteColumns,{nc_a:'benim'},'yalnız dokunulan not sütunu');
  assert.equal(load({enabled:false}).api.cpRowSaveRemoteApplied(row(),{delType:'X'}),undefined);
});

test('existing path: licensor / Supp. FOB edits, bulk capture, unknown edits, missing identity and flag off',()=>{
  const r=row();const {api,ctx}=load({rows:[r]});
  edit(ctx,api,r,{Licensor:'LCW',Notes:'x'});
  assert.equal(api.cpRowSavePlan(r,123,fullBody(r,ctx)),null,'Licensor haritası markDirty öncesi değişir → bugünkü atomik yol');
  assert.equal(api.rowSave.units.size,0,'bugünkü yola giden gönderilmemiş birimler bırakılır');
  api.cpRowCaptureBase(r);r.Notes='otomatik';
  assert.equal(api.cpRowSavePlan(r,123,fullBody(r,ctx)),null,'dokunulan sütunu bilinmeyen düzenleme bugünkü yolda');
  edit(ctx,api,r,{'Retail Date':new Date()});
  assert.deepEqual(JSON.parse(JSON.stringify(api.cpRowSavePlan(r,123,fullBody(r,ctx)))),{skip:true},'yalnız tarih: not/tür gövdesi gönderilmez');
  assert.equal(api.cpRowSaveDatePlan(r,123,{retailDate:'2027-01-01'}),null,'tarih birimi işaretlenmemiş → bugünkü yol');
  assert.equal(load().api.cpRowSaveEligible(row(),{notes:{}}),true);
  assert.equal(load({enabled:false}).api.cpRowSaveEligible(row(),{notes:{}}),false);
  assert.equal(load({capturing:true}).api.cpRowSaveEligible(row(),{notes:{}}),false,'toplu yapıştırma atomik batch yolunda');
  assert.equal(load().api.cpRowSaveEligible({...row(),'C.Code':''},{notes:{}}),false,'kimliksiz satır');
  for(const field of ['suppFob','suppFobMeta','pricingRestore'])assert.equal(load().api.cpRowSaveEligible(row(),{notes:{},[field]:1}),false,field);
  const off=load({enabled:false,rows:[row()]});off.api.cpRowTouchAction({id:7,fields:[{key:'Notes'}]});
  assert.equal(off.api.rowSave.units.size,0);assert.equal(off.api.cpRowSavePlan(row(),123,{}),null);
});

test('a failed request keeps a newer pending edit of the same unit; a finished unit is dropped',async()=>{
  const r=row();const {api,ctx,requests}=load({rows:[r],responses:[Object.assign(new Error('ağ'),{status:0}),ack({dates:{}})]});
  edit(ctx,api,r,{Notes:'a'});const p1=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  const first=api.cpRowSaveSend(r,123,p1.patch,p1.units);
  edit(ctx,api,r,{Notes:'b'});const p2=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  await assert.rejects(first);
  await api.cpRowSaveSend(r,123,p2.patch,p2.units);
  assert.deepEqual(requests[1].body.items[0].base.notes,{Notes:'',NotesHtml:''},'başarısız kayıt base\'i taşımaz');
  assert.equal(api.rowSave.units.size,0);
});

test('edits never block the server paths with row save on (no 30k client recompute on a single edit); flag off keeps today\'s rule',()=>{
  const on=load();on.ctx.state.cpDirty=new Set([7]);on.ctx.pendingOverrideWriteCount=()=>2;on.api.rowSave.inFlight.set(key,1);
  assert.equal(on.api.cpEditsBlockServerPaths(),false);assert.equal(on.api.cpEditsBlockServerPaths(true),false,'bekleyen/yoldaki kayıt hesaplanmış yolu kapatmaz');
  const off=load({enabled:false});off.ctx.state.cpDirty=new Set();off.ctx.pendingOverrideWriteCount=()=>1;
  assert.equal(off.api.cpEditsBlockServerPaths(),false,'pencereli tablo: bugün yalnız kirli satır');
  assert.equal(off.api.cpEditsBlockServerPaths(true),true,'hesaplanmış sütunlar: bugün bekleyen yazma da');
  off.ctx.state.cpDirty=new Set([7]);assert.equal(off.api.cpEditsBlockServerPaths(),true);
});

test('unsaved-edit rule: flag on → only unacknowledged writes; flag off → any dirty row (today)',()=>{
  const on=load();on.ctx.state.cpDirty=new Set([7]);
  assert.equal(on.api.cpUnsavedRowEdits(),false,'onaylanmış kirli satır pencereli yolu kapatmaz');
  on.api.rowSave.inFlight.set(key,1);assert.equal(on.api.cpUnsavedRowEdits(),true);
  const off=load({enabled:false});off.ctx.state.cpDirty=new Set([7]);assert.equal(off.api.cpUnsavedRowEdits(),true);
});

test('hooks: markDirty captures before maps change; pushUndo / history / date saves mark touched units; saves branch on the plan',()=>{
  const wrapper=SOURCE.slice(SOURCE.indexOf('const _origMarkDirty = markDirty;'),SOURCE.indexOf('};',SOURCE.indexOf('const _origMarkDirty = markDirty;')));
  assert.ok(wrapper.indexOf('cpRowCaptureBase(row)')>0&&wrapper.indexOf('cpRowCaptureBase(row)')<wrapper.indexOf('syncOverridesFromRow(row)'));
  assert.match(extractFunction(SOURCE,'pushUndo'),/if\(!_cpPasteUndoBatch&&typeof cpRowTouchAction==='function'\)cpRowTouchAction\(action\);/);
  const history=extractFunction(SOURCE,'applyHistoryAction');
  assert.ok(history.indexOf('cpRowTouch(row,[...historyKeys])')>history.indexOf('markDirty(row._id)'),'geri al / yinele: markDirty görüntüsünden sonra');
  const dates=extractFunction(SOURCE,'saveDateOverrides');
  assert.ok(dates.indexOf('cpRowTouch(row,nextKeys,true)')>0&&dates.indexOf('cpRowTouch(row,nextKeys,true)')<dates.indexOf('computeDates(bucket)'),'tarih haritası değişmeden önce');
  assert.match(dates,/const rowPlan=typeof cpRowSaveDatePlan==='function'\?cpRowSaveDatePlan\(row,orderCode,dates\):null;\s*if\(rowPlan\)\{\s*if\(!rowPlan\.skip\)cpRowSaveSend\(row,orderCode,rowPlan\.patch,rowPlan\.units\)/);
  const sync=extractFunction(SOURCE,'syncOverrideToServer');
  assert.match(sync,/const rowPlan=typeof cpRowSavePlan==='function'\?cpRowSavePlan\(row,orderCode,body\):null;/);
  assert.match(sync,/\(rowPlan\.skip\?Promise\.resolve\(\):cpRowSaveSend\(row,orderCode,rowPlan\.patch,rowPlan\.units\)\)\s*:enqueueOverrideMutation\('orders',`\/api\/overrides\/\$\{orderCode\}`,\{method:'PATCH'/);
  assert.match(extractFunction(SOURCE,'applyRemoteRowPatch'),/cpRowSaveRemoteApplied\(row,patch\); \/\/ #1078\s*return row;/);
  assert.match(extractFunction(SOURCE,'cpReadModelSpec'),/if\(typeof cpEditsBlockServerPaths==='function'\?cpEditsBlockServerPaths\(\):Boolean\(state\.cpDirty&&state\.cpDirty\.size\)\)return \{ok:false,reason:'dirty'\};/);
  assert.match(extractFunction(SOURCE,'cpComputedEligible'),/return !\(typeof cpEditsBlockServerPaths==='function'\?cpEditsBlockServerPaths\(true\):Boolean\(state\.cpDirty&&state\.cpDirty\.size>0\)\|\|pendingOverrideWriteCount\(\)>0\);/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','public','user-storage.js'),'utf8'),/'bl\.cpRowSave\.'/);
});

test('ack of an earlier save does not overwrite a newer pending local value (note column sent again would be the old one)',async()=>{
  const r=row();let release;const gate=new Promise(resolve=>{release=resolve;});
  const server={noteColumns:{},dates:{}};
  const reply=ack(server);
  const {api,ctx,requests}=load({rows:[r],responses:[async body=>{await gate;return reply(body);},reply]});
  edit(ctx,api,r,{nc_a:'first'});
  const p1=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  const first=api.cpRowSaveSend(r,123,p1.patch,p1.units);
  edit(ctx,api,r,{nc_a:'second'});            // ilk kayıt yoldayken; harita 'second'
  release();await first;                      // ilk kaydın onayı
  assert.equal(ctx.state.overrides.noteColumnValues[key].nc_a,'second','bekleyen yerel değer ezilmedi');
  const p2=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  assert.equal(p2.patch.noteColumns.nc_a,'second');
  await api.cpRowSaveSend(r,123,p2.patch,p2.units);
  assert.equal(requests[1].body.items[0].base.noteColumns.nc_a,'first','base onaylanan sunucu değerine taşındı');
  assert.equal(server.noteColumns.nc_a,'second');
});

test('an ack without current values (old server / no-op) keeps the pending base instead of emptying it',async()=>{
  const r=row();let release;const gate=new Promise(resolve=>{release=resolve;});
  const bare=body=>({applied:body.items.map(item=>({orderCode:item.orderCode,key,noop:true})),conflicts:[]});
  const {api,ctx,requests}=load({rows:[r],responses:[async body=>{await gate;return bare(body);},bare]});
  ctx.state.overrides.delmap[key]='Gemi';
  edit(ctx,api,r,{'Del. Type':'Uçak'});const p1=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  const first=api.cpRowSaveSend(r,123,p1.patch,p1.units);
  edit(ctx,api,r,{'Del. Type':'Kamyon'});const p2=api.cpRowSavePlan(r,123,fullBody(r,ctx));
  release();await first;
  await api.cpRowSaveSend(r,123,p2.patch,p2.units);
  assert.equal(requests[1].body.items[0].base.delType,'Gemi','current yoksa base boşaltılmaz');
});

test('settleOverrideWrites also waits for row saves (refresh / bulk operations never race a flushed row save)',async()=>{
  let release;const rowQueue=new Promise(resolve=>{release=resolve;});
  const ctx=vm.createContext({window:{BLCpRowSave:{settled:()=>rowQueue}},flushPendingOverrideWrites(){ctx.flushed=true;},overrideMutationsSettled:async()=>{},Promise});
  vm.runInContext(extractFunction(SOURCE,'settleOverrideWrites')+';globalThis.settle=settleOverrideWrites;',ctx);
  let done=false;const waiting=ctx.settle().then(()=>{done=true;});
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(ctx.flushed,true);assert.equal(done,false,'satır kaydı bitmeden bariyer açılmadı');
  release();await waiting;assert.equal(done,true);
});

test('row save is ON by default; the preference "0" or window.BL_CP_ROW_SAVE=false turns it off (rollback)',()=>{
  const fresh=pref=>{const ctx=vm.createContext({window:{},localStorage:{getItem:()=>pref},state:{}});
    vm.runInContext(`${BLOCK};globalThis.on=cpRowSaveEnabled();`,ctx);return ctx.on;};
  assert.equal(fresh(null),true,'tercih yok → açık');
  assert.equal(fresh('1'),true);
  assert.equal(fresh('0'),false,'geri dönüş');
  assert.equal(load({enabled:false}).api.cpRowSaveEnabled(),false,'window.BL_CP_ROW_SAVE=false');
});

test('CP read-model requests: at most 2 in flight per tab; a row save drops queued reads (in-flight ones finish and are cached server-side)',async()=>{
  const LIMITER=SOURCE.slice(SOURCE.indexOf('const CP_RM_MAX_ACTIVE=2;'),SOURCE.indexOf('async function cpRMPost('));
  const started=[],signals=[];
  const ctx=vm.createContext({Promise,Error,Object,Set,JSON,AbortController,appLang:'tr',location:{},
    fetch:(url,opts)=>{started.push(url);signals.push(opts.signal);return new Promise((resolve,reject)=>{opts.signal.addEventListener('abort',()=>reject(new Error('AbortError')));});}});
  vm.runInContext(`${LIMITER};globalThis.api={cpRMRequest,cpRMAbortReads,net:cpRMNet};`,ctx);
  const results=[1,2,3,4].map(i=>ctx.api.cpRMRequest('/api/read-model/cp/query',{i}).then(()=>'ok',error=>error));
  await Promise.resolve();
  assert.equal(started.length,2,'en fazla 2 eşzamanlı');
  assert.equal(ctx.api.cpRMAbortReads(),2,'yalnız kuyruktaki 2 okuma düşer');
  const dropped=await Promise.all(results.slice(2));
  assert.ok(dropped.every(error=>error&&error.aborted===true&&error.code==='CP_RM_ABORTED'));
  assert.ok(signals.every(signal=>!signal.aborted),'yoldaki okumalar iptal edilmez');
  assert.equal(started.length,2,'düşen kuyruk işi hiç başlamadı');
  assert.equal(ctx.api.net.active,2);
  assert.match(extractFunction(SOURCE,'cpRowSaveSend'),/if\(typeof cpRMAbortReads==='function'\)cpRMAbortReads\(\);\s*let data;/);
  assert.match(SOURCE,/async function cpRMPost\(path,field,body\)\{return cpRMRequest\(path,await cpRMEnvelope\(field,body\)\);\}/);
});

test('computed-columns request goes through the limiter; a save abort is not an error (no session-wide fallback to the 30k client path) and is rescheduled after the save',()=>{
  const schedule=SOURCE.slice(SOURCE.indexOf("job.promise=(async()=>{"),SOURCE.indexOf("/* checklist-supplier-sync.js için sağlayıcı"));
  assert.match(schedule,/await cpRMLimitedFetch\('\/api\/read-model\/cp\/computed'/);
  assert.doesNotMatch(schedule,/await fetch\('\/api\/read-model\/cp\/computed'/);
  const abort=schedule.indexOf('if(error&&error.aborted)'),disable=schedule.indexOf('cpComputed.disabled=true');
  assert.ok(abort>0&&abort<disable,'iptal, oturum kapatmadan önce ele alınır');
  assert.match(extractFunction(SOURCE,'cpRowSaveSettled'),/if\(cpRowSave\.computedAborted\)\{cpRowSave\.computedAborted=false;_unifiedPriorityCache\.cp=null;void scheduleUnifiedPrioritiesForTable\('cp'\);\}/);
});

test('row save uses a short write debounce (250 ms); flag off keeps 500 / 400 ms',()=>{
  assert.equal(load().api.cpRowSaveDebounce(500),250);assert.equal(load({enabled:false}).api.cpRowSaveDebounce(500),500);
  assert.match(extractFunction(SOURCE,'syncOverrideToServer'),/typeof cpRowSaveDebounce==='function'\?cpRowSaveDebounce\(500\):500/);
  assert.match(extractFunction(SOURCE,'saveDateOverrides'),/typeof cpRowSaveDebounce==='function'\?cpRowSaveDebounce\(400\):400/);
});

test('a row edit never recomputes 30k decisions synchronously when row save is on (background job instead; save timer is not delayed)',()=>{
  assert.match(extractFunction(SOURCE,'refreshRowsEverywhere'),/computeDecisionsForRows==='function'\)cpEditPriorities\(\);/);
  const calls=[];const ctx=vm.createContext({cpRowSaveEnabled:()=>ctx.on,scheduleUnifiedPrioritiesForTable:key=>calls.push('async:'+key),syncUnifiedPrioritiesForTable:key=>calls.push('sync:'+key)});
  vm.runInContext(extractFunction(SOURCE,'cpEditPriorities')+';globalThis.run=cpEditPriorities;',ctx);
  ctx.on=true;ctx.run();ctx.on=false;ctx.run();
  assert.deepEqual(calls,['async:cp','sync:cp'],'açık: arka plan · kapalı: bugünkü eşzamanlı yol');
});

test('remote row patches repaint only the changed rows when row save is on (no full legacy render that recomputes 30k decisions)',()=>{
  assert.match(extractFunction(SOURCE,'applyRemoteRowPatches'),/if\(state\.cp\)typeof cpRowSaveEnabled==='function'&&cpRowSaveEnabled\(\)\?refreshRowsEverywhere\(\[\.\.\.touched\]\):renderCP\(\);/);
});
