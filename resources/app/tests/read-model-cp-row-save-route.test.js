'use strict';
/* WS5 (#1078) alt PR 3: POST /api/overrides/rows sözleşmesi — gövde doğrulaması, desteklenmeyen
   alan (Supp. FOB bugünkü yolda kalır), yetki kapıları, iki istemcinin aynı satırın farklı alanlarını
   kaydetmesi (ikisi de kalır), eski base ile aynı alan (200 + conflicts, current döner), yan etkilerin
   YALNIZ yazılan satırlar ve yalnız değişen alanlar için çalışması, server.js kaydı. */
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const express=require('express');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-cp-row-route-'));
Object.assign(process.env,{BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server-data'),BUYER_LOG_DATA_ROOT:path.join(root,'app-data'),
  BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local-data'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')});
const db=require('../server/db');
const {registerCpRowSaveRoute,validateItems}=require('../server/lib/read-model/cp-row-save');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));

function harness(){
  const calls={shared:0,cache:[],audit:[],live:[],dateSource:0};
  const app=express();app.use(express.json());
  app.use((req,_res,next)=>{req.currentUser={id:req.get('x-user')||'u1',displayName:'U'};next();});
  registerCpRowSaveRoute(app,{
    patchRows:(items,options)=>db.patchOrderOverrideRows(items,options),
    rejectUnauthorizedOrders:(req,res,codes)=>{if(codes.includes(9999)){res.status(403).json({ok:false,code:'ORDER_VIEW_ONLY'});return true;}return false;},
    rejectSharedOwnerWrites:(req,res,items)=>{if(items.some(item=>item.patch.dates&&req.currentUser.id==='viewer')){res.status(403).json({ok:false,code:'ORDER_SHARED_OWNER_ONLY'});return true;}return false;},
    ensureAutomaticDateSource:async()=>{calls.dateSource++;},
    assertAutomaticDatesReadOnly:(user,items)=>{if(items.some(item=>item.patch.dates&&item.patch.dates.exFactory==='2000-01-01'))throw Object.assign(new Error('auto'),{code:'AUTOMATIC_DATE_READ_ONLY',statusCode:409});},
    pageProjectionContext:()=>({contextHash:'h'}),
    queueProjectionCacheRowPatches:(user,before,items)=>{calls.cache.push(items);return true;},
    notifyShared:()=>{calls.shared++;},
    appendAudit:(user,action,target,detail)=>calls.audit.push({action,detail}),
    notifyLive:(req,rowPatches)=>calls.live.push({client:req.get('x-client-id'),rowPatches}),
    liveRowPatchesFor:items=>items.map(item=>({orderCode:item.orderCode,patch:item.patch})),
    noteActorOf:user=>({id:user.id,name:user.displayName}),
    apiError:(res,err)=>res.status(Number(err.statusCode)||500).json({ok:false,code:err.code}),
  });
  const server=app.listen(0);
  const post=(body,user='u1')=>fetch(`http://127.0.0.1:${server.address().port}/api/overrides/rows`,{method:'POST',
    headers:{'content-type':'application/json','x-user':user,'x-client-id':'tab-'+user},body:JSON.stringify(body)}).then(async res=>({status:res.status,body:await res.json()}));
  return {server,post,calls};
}
const row=(orderCode,patch,base)=>({orderCode,patch:{model:'M1',ccode:'C1',...patch},base});

test('validation: shape, row identity, unsupported fields (Supp. FOB stays on the existing path), dates',()=>{
  for(const bad of [null,{},{items:[]},{items:Array.from({length:501},()=>row(1,{},{}))},{items:[{orderCode:1,patch:{model:'M',ccode:'C'}}]},
    {items:[{orderCode:'x',patch:{model:'M',ccode:'C'},base:{}}]},{items:[{orderCode:1,patch:{model:'',ccode:'C'},base:{}}]},
    {items:[row(1,{dates:{exFactory:'2026/01/01'}},{})]},{items:[row(1,{dates:{shipConfirmationDate:'2026-01-01'}},{})]},{items:[row(1,{notes:'x'},{})]},
    {items:[row(1,{delType:{}},{})]}])
    assert.throws(()=>validateItems(bad),error=>error.statusCode===400,JSON.stringify(bad)?.slice(0,80));
  for(const field of ['suppFob','suppFobMeta','pricingRestore','imageRef','importance','shortage','expectedRevision'])
    assert.throws(()=>validateItems({items:[row(1,{[field]:1},{})]}),error=>error.code==='CP_ROW_SAVE_FIELD_UNSUPPORTED',field);
});

test('HTTP: two clients edit different fields of the same row; both stay. Stale same-field save → 200 with conflicts and current; side effects only for written rows',async()=>{
  const {server,post,calls}=harness();
  try{
    const a=await post({items:[row(7001,{notes:{Notes:'A',NotesHtml:''}},{notes:{Notes:'',NotesHtml:''}})]},'a');
    assert.equal(a.status,200);assert.equal(a.body.applied[0].noop,false);assert.equal(a.body.applied[0].current.notes.Notes,'A');
    assert.equal(a.body.overrides,undefined,'tam belge dönmez');
    // B, A'nın notunu görmeden (base boş not) teslimat tipini yazar: notu ezmez.
    const b=await post({items:[row(7001,{delType:'Gemi',notes:{Notes:'',NotesHtml:''}},{delType:'',notes:{Notes:'',NotesHtml:''}})]},'b');
    assert.equal(b.status,200);assert.deepEqual(b.body.conflicts,[]);
    const key=db.overrideWriteKey(7001,{model:'M1',ccode:'C1'}),ov=db.loadOverrides();
    assert.equal(ov.notesmap[key].Notes,'A');assert.equal(ov.delmap[key],'Gemi');
    // Canlı olay yalnız B'nin değiştirdiği alanı taşır (not yok).
    assert.deepEqual(calls.live.at(-1),{client:'tab-b',rowPatches:[{orderCode:7001,patch:{model:'M1',ccode:'C1',delType:'Gemi'}}]});
    // B eski notla notu yazmaya çalışır: çakışma, A'nın notu kalır.
    const stale=await post({items:[row(7001,{notes:{Notes:'B',NotesHtml:''}},{notes:{Notes:'',NotesHtml:''}}),row(7002,{delType:'Uçak'},{delType:''})]},'b');
    assert.equal(stale.status,200);
    assert.equal(stale.body.conflicts.length,1);assert.equal(stale.body.conflicts[0].orderCode,7001);
    assert.deepEqual(stale.body.conflicts[0].fields,['notes']);assert.equal(stale.body.conflicts[0].current.notes.Notes,'A');
    assert.equal(db.loadOverrides().notesmap[key].Notes,'A');
    // Yan etkiler yalnız yazılan satır (7002) için.
    assert.deepEqual(calls.cache.at(-1).map(item=>item.orderCode),[7002]);
    assert.deepEqual(calls.live.at(-1).rowPatches.map(item=>item.orderCode),[7002]);
    // Değişiklik yoksa (idempotent) yan etki yok.
    const before={live:calls.live.length,shared:calls.shared,cache:calls.cache.length};
    const noop=await post({items:[row(7002,{delType:'Uçak'},{delType:''})]},'b');
    assert.equal(noop.body.applied[0].noop,true);
    assert.deepEqual({live:calls.live.length,shared:calls.shared,cache:calls.cache.length},before);
    // Yalnız çakışma: denetim kaydı, canlı olay yok.
    const onlyConflict=await post({items:[row(7001,{notes:{Notes:'C',NotesHtml:''}},{notes:{Notes:'x',NotesHtml:''}})]},'b');
    assert.equal(onlyConflict.body.conflicts.length,1);assert.equal(calls.live.length,before.live);
    assert.equal(calls.audit.at(-1).action,'ORDER_ROW_CONFLICT');
  }finally{server.close();}
});

test('HTTP: permission gates and automatic date protection run before any write',async()=>{
  const {server,post,calls}=harness();
  try{
    const revision=db.loadOverrides()._revisions.orders;
    assert.equal((await post({items:[row(9999,{delType:'Gemi'},{delType:''})]})).status,403);
    assert.equal((await post({items:[row(7101,{dates:{retailDate:'2027-01-01'}},{dates:{retailDate:null}})]},'viewer')).status,403);
    const auto=await post({items:[row(7101,{dates:{exFactory:'2000-01-01'}},{dates:{exFactory:null}})]});
    assert.equal(auto.status,409);assert.equal(auto.body.code,'AUTOMATIC_DATE_READ_ONLY');
    assert.ok(calls.dateSource>=1,'Ex-factory kaynağı kontrol için hazırlanır');
    const bad=await post({items:[row(7101,{suppFob:4},{})]});
    assert.equal(bad.status,400);assert.equal(bad.body.code,'CP_ROW_SAVE_FIELD_UNSUPPORTED');
    assert.equal(db.loadOverrides()._revisions.orders,revision,'reddedilen isteklerde hiçbir şey yazılmadı');
  }finally{server.close();}
});

test('server.js registers the route with the same gates and side effects as the existing override routes',()=>{
  const src=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
  const i=src.indexOf("require('./lib/read-model/cp-row-save').registerCpRowSaveRoute(app,{");
  assert.ok(i>0);
  const block=src.slice(i,src.indexOf('});',i));
  for(const name of ['rejectUnauthorizedOrders','rejectSharedOwnerWrites','assertAutomaticDatesReadOnly','pageProjectionContext','queueProjectionCacheRowPatches','liveRowPatchesFor','noteActorOf'])
    assert.match(block,new RegExp(`\\b${name}\\b`),name);
  assert.match(block,/sharedRevisionStore\.update\('cpOverrides'/);
  assert.match(block,/liveEvents\.notifyChange\('orders',requestClientId\(req\),\{rowPatches:patches\}\)/);
  assert.match(block,/patchOrderOverrideRows/);
  // Oturum kapısı (requireSelection) /api altındaki rotalardan önce kurulur.
  const gate=src.indexOf('app.use(userAccess.requireSelection);');
  assert.ok(gate>0&&gate<i,'oturum kapısı (requireSelection) rotadan önce kurulur');
});
