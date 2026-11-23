'use strict';
/* CP satır kaydı: sahte çakışma (8.0.12 saha raporu). Kayıtlı tarih revizyonu (09.11.26 → 23.11.26) olan satırda
   tarihi değiştirmek, kimse satırı düzenlemezken "başka bir kullanıcı değiştirdi" uyarısı veriyor ve kaydetmiyordu.
   Kök neden: istemci base'i yerel override haritalarından okuyordu; haritalar oturum başında boştur (tam override
   belgesi istemciye gelmez) → önceki oturumda kaydedilmiş değeri olan her birimde base boş, sunucuda kayıtlı değer.
   Düzeltme: CP projeksiyon satırı kayıtlı değerleri `_cpStored` olarak taşır (yalnız kaydı olan satırlar), base
   oradan okunur; onay / çakışma / uzak yama / eski yoldaki kayıt onayı onu güncel tutar.
   Uçtan uca: gerçek app-main.js satır kaydı bloğu (vm) → gerçek db.patchOrderOverrideRows → gerçek
   cp-row-stored projeksiyon satırları. Gerçek eşzamanlı değişiklik HÂLÂ çakışmadır (yanlış negatif yok). */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-cp-row-stored-'));
Object.assign(process.env,{BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server-data'),BUYER_LOG_DATA_ROOT:path.join(root,'app-data'),
  BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local-data'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')});
const db=require('../server/db');
const stored=require('../server/lib/cp-row-stored');
const {rowPatchContext,applyStep}=require('../server/lib/projection-rewrite');
const {applyIncrementalProjectionPatch}=require('../server/lib/projection-row-patch');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

const SOURCE=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
const BLOCK=SOURCE.slice(SOURCE.indexOf("const CP_ROW_SAVE_STORAGE_KEY='bl.cpRowSave.v1';"),SOURCE.indexOf('window.BLCpRowSave={'));
const actor={id:'u1',name:'User 1'};
const json=value=>JSON.parse(JSON.stringify(value));

// Yeni oturum: boş override haritaları; satırlar sunucu projeksiyonundan (paylaşılan belgeyle) gelir.
function client(rows){
  const requests=[],toasts=[];
  const ctx=vm.createContext({console,JSON,Object,Array,Map,Set,Promise,Number,String,Boolean,Error,Date,
    window:{BL_CP_ROW_SAVE:true,BL_CLIENT_ID:'tab-1',isCapturingOverrideBatch:()=>false,dispatchEvent(){},BLPerf:null},
    localStorage:{getItem:()=>null},CustomEvent:class{constructor(type){this.type=type;}},
    state:{cp:{rows},cpDirty:new Set(),overrides:{notesmap:{},delmap:{},submap:{},licensormap:{},noteColumnValues:{},datemap:{}},storeRevisions:{orders:0}},
    appLang:'tr',CP_NOTE_COLUMN_DEFS:[],requests,toasts,
    // Gerçek sunucu karşılaştırması (rota katmanı yok): istemcinin gönderdiği base olduğu gibi.
    fetchJSON:async(url,opts)=>{const body=JSON.parse(opts.body);requests.push(body);return json(db.patchOrderOverrideRows(body.items,{actor}));},
    lineIdentity:row=>row['Model Name']&&row['C.Code']?{model:row['Model Name'],ccode:row['C.Code']}:{},
    showToast:message=>toasts.push(message),refreshRowEverywhere(){},loadFromServer:async()=>{},
    invalidateUnifiedPriorityDecisions(){},applyFormulas(){},syncCpProductionLogisticSegment(){},coerceDateLoose:value=>value,
    pendingOverrideWriteCount:()=>0,currentActiveTab:()=>'overview',notifyOverrideSaveError(){}});
  vm.runInContext(`${extractFunction(SOURCE,'turknorm')}
    ${extractFunction(SOURCE,'lineKeyOfRow')}
    function overrideSyncKey(row,orderCode){return lineKeyOfRow(row)||String(orderCode==null?'':orderCode);}
    ${extractFunction(SOURCE,'remotePatchMatches')}
    ${BLOCK}
    globalThis.api={cpRowSnapshot,cpRowCaptureBase,cpRowTouch,cpRowTouchAction,cpRowSavePlan,cpRowSaveDatePlan,cpRowSaveSend,cpRowSaveRemoteApplied,cpRowLegacyAcked,rowSave:cpRowSave};`,ctx);
  return {ctx,api:ctx.api,requests,toasts};
}
// Sunucunun CP projeksiyonu: kaynak satır + paylaşılan belgeden kayıtlı değerler.
function projectedRow(orderCode,extra={}){
  const row={_id:1,'Order Code':orderCode,'Model Name':'Model A','C.Code':'K01',Notes:'',NotesHtml:'','Ek Not':'','Ek NotHtml':'','Del. Type':'Gemi',...extra};
  return stored.attachCpRowStored([row],db.loadOverrides())[0];
}
const lineKey=orderCode=>db.overrideWriteKey(orderCode,{model:'Model A',ccode:'K01'});
// Tarih düzenlemesi (saveDateOverrides sözleşmesi): birim işaretlenir → yalnız dokunulan tarih alanı gider.
async function editDate(api,row,field,column,value){
  api.cpRowTouch(row,[column],true);
  const plan=api.cpRowSaveDatePlan(row,row['Order Code'],{[field]:value});
  return api.cpRowSaveSend(row,row['Order Code'],plan.patch,plan.units);
}
// Not / Del. Type düzenlemesi (markDirty → syncOverridesFromRow → pushUndo sözleşmesi).
async function editColumns(ctx,api,row,changes){
  api.cpRowCaptureBase(row);
  const fields=Object.entries(changes).map(([column,value])=>{const prev=row[column];row[column]=value;return {key:column,prev,next:value};});
  const key=ctx.lineKeyOfRow(row);
  // syncOverridesFromRow: haritalar ekrandaki değerle dolar (Del. Type kaynaktan gelse bile).
  ctx.state.overrides.notesmap[key]={Notes:row.Notes,NotesHtml:row.NotesHtml,EkNot:row['Ek Not'],EkNotHtml:row['Ek NotHtml']};
  ctx.state.overrides.delmap[key]=row['Del. Type'];
  api.cpRowTouchAction({id:row._id,fields});
  const body={model:row['Model Name'],ccode:row['C.Code'],notes:{Notes:row.Notes,NotesHtml:row.NotesHtml,EkNot:row['Ek Not'],EkNotHtml:row['Ek NotHtml']},delType:row['Del. Type']};
  const plan=api.cpRowSavePlan(row,row['Order Code'],body);
  return plan&&!plan.skip?api.cpRowSaveSend(row,row['Order Code'],plan.patch,plan.units):null;
}

test('stored date override from an earlier session: editing the date saves (no false conflict)',async()=>{
  // Önceki oturum (ya da başka cihaz): Ex-factory 23.11.26 olarak revize edildi.
  db.patchOrderOverrideRows([{orderCode:7001,patch:{model:'Model A',ccode:'K01',dates:{exFactory:'2026-11-23'}},base:{dates:{exFactory:null}}}],{actor});
  const row=projectedRow(7001);
  assert.deepEqual(json(row._cpStored),{dates:{exFactory:'2026-11-23'}},'projeksiyon kayıtlı tarihi taşır');
  const {api,requests,toasts}=client([row]);
  const data=await editDate(api,row,'exFactory','Ex-factory','2026-11-30');
  assert.deepEqual(requests[0].items[0].base,{dates:{exFactory:'2026-11-23'}},'base kullanıcının gördüğü kayıtlı değer');
  assert.deepEqual(data.conflicts,[]);assert.deepEqual(toasts,[]);
  assert.equal(db.loadOverrides().datemap[lineKey(7001)].ex,'2026-11-30');
  // İkinci düzenleme onaylanan değeri base alır.
  await editDate(api,row,'exFactory','Ex-factory','2026-12-07');
  assert.equal(requests[1].items[0].base.dates.exFactory,'2026-11-30');
  assert.equal(db.loadOverrides().datemap[lineKey(7001)].ex,'2026-12-07');assert.deepEqual(toasts,[]);
});

test('stored note / Del. Type from an earlier session: editing saves; the source Del. Type written into the local map is never the base',async()=>{
  db.patchOrderOverrideRows([{orderCode:7002,patch:{model:'Model A',ccode:'K01',notes:{Notes:'eski not',NotesHtml:'<b>eski not</b>'}},base:{notes:{Notes:'',NotesHtml:''}}}],{actor});
  const row=projectedRow(7002,{Notes:'eski not',NotesHtml:'<b>eski not</b>'});
  const {ctx,api,requests,toasts}=client([row]);
  const first=await editColumns(ctx,api,row,{Notes:'yeni not',NotesHtml:''});
  assert.deepEqual(requests[0].items[0].base,{notes:{Notes:'eski not',NotesHtml:'<b>eski not</b>'}});
  assert.deepEqual(first.conflicts,[]);
  // Not kaydı yerel delmap'e kaynaktaki 'Gemi'yi yazdı; sunucuda Del. Type kaydı yok. Del. Type düzenlemesi çakışmamalı.
  const second=await editColumns(ctx,api,row,{'Del. Type':'Uçak'});
  assert.equal(Object.hasOwn(requests[1].items[0].base,'delType'),true);assert.equal(requests[1].items[0].base.delType,'');
  assert.deepEqual(second.conflicts,[]);assert.deepEqual(toasts,[]);
  const ov=db.loadOverrides();
  assert.equal(ov.notesmap[lineKey(7002)].Notes,'yeni not');assert.equal(ov.delmap[lineKey(7002)],'Uçak');
});

test('a real concurrent change after the client saw the row is STILL a conflict (no false negative)',async()=>{
  db.patchOrderOverrideRows([{orderCode:7003,patch:{model:'Model A',ccode:'K01',dates:{exFactory:'2026-11-23'},notes:{Notes:'A',NotesHtml:''}},base:{dates:{exFactory:null},notes:{Notes:'',NotesHtml:''}}}],{actor});
  const row=projectedRow(7003,{Notes:'A'});
  const {ctx,api,toasts}=client([row]);
  // Kullanıcı satırı gördükten sonra başka bir yazar (canlı yaması bu sekmeye ulaşmadı) iki alanı da değiştirir.
  db.patchOrderOverrideRows([{orderCode:7003,patch:{model:'Model A',ccode:'K01',dates:{exFactory:'2026-12-01'},notes:{Notes:'B',NotesHtml:''}},base:{dates:{exFactory:'2026-11-23'},notes:{Notes:'A',NotesHtml:''}}}],{actor:{id:'u2',name:'User 2'}});
  const date=await editDate(api,row,'exFactory','Ex-factory','2026-11-30');
  assert.equal(date.conflicts.length,1);assert.deepEqual(date.conflicts[0].fields,['dates']);
  const note=await editColumns(ctx,api,row,{Notes:'C'});
  assert.equal(note.conflicts.length,1);assert.deepEqual(note.conflicts[0].fields,['notes']);
  assert.equal(toasts.length,2);
  const ov=db.loadOverrides();
  assert.equal(ov.datemap[lineKey(7003)].ex,'2026-12-01','başkasının değeri ezilmedi');assert.equal(ov.notesmap[lineKey(7003)].Notes,'B');
  // Çakışma sunucu değerini satıra ve kayıtlı değere getirir: kullanıcı onu görerek yeniden düzenleyebilir.
  assert.equal(row._cpStored.dates.exFactory,'2026-12-01');
  const retry=await editDate(api,row,'exFactory','Ex-factory','2026-11-30');
  assert.deepEqual(retry.conflicts,[]);assert.equal(db.loadOverrides().datemap[lineKey(7003)].ex,'2026-11-30');
});

test('a remote live patch the user saw becomes the base; this tab\'s legacy-path ack updates only the units it wrote',async()=>{
  const row=projectedRow(7004);
  assert.equal(Object.hasOwn(row,'_cpStored'),false,'kaydı olmayan satır alan taşımaz (kompakt)');
  const {ctx,api,toasts}=client([row]);
  // Başka sekme Ex-factory yazar; canlı yama satıra uygulanır (kullanıcı yeni değeri görür).
  const patch={model:'Model A',ccode:'K01',dates:{exFactory:'2026-12-10'}};
  db.patchOrderOverrideRows([{orderCode:7004,patch,base:{dates:{exFactory:null}}}],{actor:{id:'u2'}});
  api.cpRowSaveRemoteApplied(row,patch);
  assert.deepEqual(json(api.cpRowSnapshot(row).dates),{exFactory:'2026-12-10',retailDate:null,inStoreDate:null});
  assert.deepEqual((await editDate(api,row,'exFactory','Ex-factory','2026-12-12')).conflicts,[]);
  // Eski yol (ör. Licensor kaydı not ve Del. Type'ı da yazar): onay yanıtındaki belgeden yalnız yazılan birimler.
  const legacy={model:'Model A',ccode:'K01',delType:'Tren',licensor:'LCW'};
  const saved=db.patchOrderOverride(7004,legacy,null,null,{actor});
  db.patchOrderOverrideRows([{orderCode:7004,patch:{model:'Model A',ccode:'K01',notes:{Notes:'görülmemiş',NotesHtml:''}},base:{notes:{Notes:'',NotesHtml:''}}}],{actor:{id:'u2'}});
  api.cpRowLegacyAcked('/api/overrides/7004',JSON.stringify(legacy),{overrides:saved.overrides});
  assert.equal(row._cpStored.delType,'Tren');assert.equal(row._cpStored.licensor,'LCW');
  assert.equal(api.cpRowSnapshot(row).notes.Notes,'','yazılmayan birim (görülmemiş başka değer) base olmaz');
  assert.deepEqual((await editColumns(ctx,api,row,{'Del. Type':'Kamyon'})).conflicts,[]);
  assert.equal((await editColumns(ctx,api,row,{Notes:'benim'})).conflicts.length,1,'görülmemiş not: çakışma');
  assert.equal(toasts.length,1);
});

test('projection: only rows with stored values carry _cpStored; the value equals the server comparison (shared document, not the CP-update layer)',()=>{
  db.patchOrderOverrideRows([{orderCode:7005,patch:{model:'Model A',ccode:'K01',subManufacturer:'Kayıtlı',noteColumns:{},dates:{retailDate:'2027-02-01'}},base:{}}],{actor});
  db.patchOrderOverride(7006,{subManufacturer:'Sipariş bazlı'},null,null,{actor}); // eski sipariş kodu anahtarı
  const shared=db.loadOverrides();
  const rows=[7005,7006,7007].map((code,i)=>({_id:i,'Order Code':code,'Model Name':'Model A','C.Code':'K01'}));
  // CP-update dosyası alt üreticisi (kullanıcı çalışma alanı) satırda görünür ama kayıtlı değer değildir.
  const effective={...shared,submap:{7007:'Dosyadan',...shared.submap}};
  stored.attachCpRowStored(rows,shared);
  for(const row of rows){
    const key=lineKey(row['Order Code']),current=stored.currentOrderLineValues(shared,row['Order Code'],key);
    if(!row._cpStored){assert.equal(row['Order Code'],7007);assert.equal(effective.submap[7007],'Dosyadan');continue;}
    for(const [field,value] of Object.entries(row._cpStored))assert.deepEqual(value,field==='dates'?Object.fromEntries(Object.entries(current.dates).filter(([,v])=>v)):current[field],field);
  }
  assert.deepEqual(json(rows[0]._cpStored),{subManufacturer:'Kayıtlı',dates:{retailDate:'2027-02-01'}});
  assert.deepEqual(json(rows[1]._cpStored),{subManufacturer:'Sipariş bazlı'},'eski sipariş kodu anahtarı satır anahtarına tohumdur');
  // Kayıtlı değer silinince alan da düşer.
  rows[0]._cpStored={stale:true};stored.attachCpRowStored([rows[2]],shared);assert.equal(Object.hasOwn(rows[2],'_cpStored'),false);
});

test('projection cache row patch keeps _cpStored current (CP module only; context carries only the patched orders)',()=>{
  const patch={model:'Model A',ccode:'K01',dates:{inStoreDate:'2027-03-03'}};
  db.patchOrderOverrideRows([{orderCode:7008,patch,base:{}}],{actor});
  const shared=db.loadOverrides(),items=[{orderCode:7008,patch}];
  const context=rowPatchContext({...shared,submap:{...shared.submap,7008:'Dosyadan'}},items,shared);
  assert.deepEqual(Object.keys(context.cpRowStored.datemap),[lineKey(7008)],'yalnız yamalanan sipariş');
  assert.equal(Object.hasOwn(context.cpRowStored.submap,'7008'),false,'CP-update katmanı kayıtlı değer değil');
  const fresh=()=>({_id:0,'Order Code':7008,'Model Name':'Model A','C.Code':'K01','In-Store (Model Budget)':'2027-01-01'});
  const cp={rows:[fresh()]},orders={rows:[fresh()]};
  applyStep('cp',cp,{items,context});applyStep('orders',orders,{items,context});
  assert.deepEqual(cp.rows[0]._cpStored,{dates:{inStoreDate:'2027-03-03'}});
  assert.equal(Object.hasOwn(orders.rows[0],'_cpStored'),false,'Orders satırı taşımaz');
  // Bağlamsız (eski çağıran) yama kaydı bozmaz; kayıt kalkınca alan düşer.
  const row={...fresh(),_cpStored:{dates:{inStoreDate:'2027-03-03'}}};
  applyIncrementalProjectionPatch(row,patch,{transitRules:[]},true,{cpStored:true});
  assert.deepEqual(row._cpStored,{dates:{inStoreDate:'2027-03-03'}});
  const clear={model:'Model A',ccode:'K01',dates:{inStoreDate:null}};
  db.patchOrderOverrideRows([{orderCode:7008,patch:clear,base:{dates:{inStoreDate:'2027-03-03'}}}],{actor});
  applyStep('cp',cp,{items:[{orderCode:7008,patch:clear}],context:rowPatchContext(db.loadOverrides(),[{orderCode:7008,patch:clear}])});
  assert.equal(Object.hasOwn(cp.rows[0],'_cpStored'),false);
});

test('wiring: projection builders, row patch paths and the page-cache context hash',()=>{
  const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const tasks=read('server/lib/compute-tasks.js'),server=read('server/server.js');
  assert.match(tasks,/const sharedOverrides=data\.overrides\|\|\{\};\s*data=withSourceOverrides\(source,data\);/,'paylaşılan belge CP-update katmanından önce');
  assert.match(tasks,/cpRowStored\.attachCpRowStored\(pair\.cp,sharedOverrides\);/);
  assert.match(server,/cp = startup \? null : cpRowStoredLib\.attachCpRowStored\(projected\.cpRows, sharedForBuild\);/);
  assert.match(server,/rowPatchContext\(overrides,clean,shared\)/);
  assert.match(server,/cpRowStored:cpRowStoredLib\.pickCpRowStoredMaps\(shared,items\.map\(item=>item\.orderCode\)\)/);
  assert.match(server,/cpRowStoredVersion: 1,/,'eski önbellek satırları _cpStored taşımaz: bağlam değişir');
  assert.match(read('server/lib/read-model/cp-computed-task.js'),/applyIncrementalProjectionPatch\(raw,item\.patch,overrides,true,\{cpStored:true\}\)/);
  assert.match(read('public/override-sync.js'),/window\.BLCpRowSave\?\.legacyAcked\?\.\(url,opts\.body,data\)/);
  assert.match(SOURCE,/legacyAcked:cpRowLegacyAcked,/);
  assert.doesNotMatch(extractFunction(SOURCE,'cpRowSnapshot'),/state\.overrides/,'base yerel haritalardan okunmaz');
});
