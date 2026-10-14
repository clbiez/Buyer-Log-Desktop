'use strict';
/* Agent order editor: note-column values and the shortage mark use the native
   override service, are read back, and their inverse restores the exact prior
   state. Receipts captured before these fields existed keep restoring. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-order-columns-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),{createToolRegistry}=require('../server/lib/agent-tool-registry');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const profile={id:'owner',enabled:true},ctx={ownerId:profile.id,profile,approvalGranted:true};
function registry(){
  return createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,appendAudit:()=>{}},
    snapshotOrder:async(_o,_p,code,patch)=>{const ids=new Set((db.loadOverrides().noteColumnDefs||[]).map(def=>def.id));if(Object.keys(patch.noteColumns||{}).some(id=>!ids.has(id)))throw Object.assign(new Error('OFFICE_NOTE_COLUMN_UNKNOWN'),{code:'OFFICE_NOTE_COLUMN_UNKNOWN'});return db.snapshotOrderOverride(code,patch);},
    updateOrder:async(_o,_p,code,patch,revision)=>{const saved=db.patchOrderOverride(code,patch,revision,null,{actor:{id:profile.id,name:'Demo'}});return{...saved,ok:true,verified:db.verifyOrderOverridePatch(code,patch,saved.revision)};},
    restoreOrder:async(_o,_p,code,receipt,revision,selector)=>db.restoreOrderOverrideReceipt(code,receipt,revision,selector,{actor:{id:profile.id}})});
}
const revision=()=>Number(db.loadOverrides()._revisions.orders)||0;
const defsRevision=()=>Number(db.loadOverrides()._revisions.noteColumnDefs)||0;

test('note-column value and shortage mark are written, verified and exactly restored',async()=>{
  db.replaceNoteColumnDefs([{id:'fit',label:'Fit notu'},{id:'pack',label:'Paket'}],defsRevision());
  const tools=registry(),code=7100001;
  db.patchOrderOverride(code,{noteColumns:{pack:'eski paket'}},revision(),null,{actor:{id:'peer'}});
  const before=db.snapshotOrderOverride(code,{});
  await assert.rejects(tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),noteColumns:{invented:'x'}},ctx),{code:'OFFICE_NOTE_COLUMN_UNKNOWN'});
  await assert.rejects(tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),shortage:{qty:3}},ctx),{code:'OFFICE_TOOL_SCHEMA'});
  await assert.rejects(tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),noteColumns:{fit:'x'.repeat(2001)}},ctx),{code:'OFFICE_TOOL_SCHEMA'});
  const preview=await tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),noteColumns:{fit:'Bel dar'},shortage:{marked:true,qty:12}},{...ctx,dryRun:true});
  assert.equal(preview.dryRun,true);assert.deepEqual(preview.patch.noteColumns,{fit:'Bel dar'});
  const result=await tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),noteColumns:{fit:'Bel dar',pack:''},shortage:{marked:true,qty:12}},ctx);
  assert.equal(result.verified,true);
  const ov=db.loadOverrides();
  assert.deepEqual(ov.noteColumnValues[code],{fit:'Bel dar'});
  assert.equal(ov.shortagemap[code].qty,12);assert.equal(ov.shortagemap[code].by,'owner');
  const restored=await tools.rollback('app.order.update',result.rollbackToken,ctx);
  assert.equal(restored.verified,true);
  assert.deepEqual(db.snapshotOrderOverride(code,{}).patch.maps,before.patch.maps);
  assert.equal(db.loadOverrides().shortagemap[code],undefined);
});

test('unmarking shortage is verified and its inverse brings the original mark back',async()=>{
  const tools=registry(),code=7100002;
  db.patchOrderOverride(code,{shortage:{marked:true,qty:5}},revision(),null,{actor:{id:'peer',name:'Peer'}});
  const original=db.loadOverrides().shortagemap[code];
  const result=await tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),shortage:false},ctx);
  assert.equal(result.verified,true);assert.equal(db.loadOverrides().shortagemap[code],undefined);
  await tools.rollback('app.order.update',result.rollbackToken,ctx);
  assert.deepEqual(db.loadOverrides().shortagemap[code],original);
});

test('inverse is refused after the note-column definitions changed, so pruned values are not resurrected',async()=>{
  const tools=registry(),code=7100003;
  const result=await tools.execute('app.order.update',{orderCode:code,expectedRevision:revision(),noteColumns:{fit:'geçici'}},ctx);
  db.replaceNoteColumnDefs([{id:'pack',label:'Paket'}],defsRevision());
  await assert.rejects(tools.rollback('app.order.update',result.rollbackToken,ctx),{code:'REVISION_CONFLICT'});
  assert.equal(db.loadOverrides().noteColumnValues[code],undefined);
});

test('legacy five-map receipts still restore, and a mixed receipt is refused',async()=>{
  const code=7100004,before=db.snapshotOrderOverride(code,{});
  const legacy={key:before.patch.key,maps:Object.fromEntries(['notesmap','submap','licensormap','delmap','datemap'].map(name=>[name,before.patch.maps[name]]))};
  db.patchOrderOverride(code,{notes:{Notes:'agent note'}},revision(),null,{actor:{id:'owner'}});
  const restored=db.restoreOrderOverrideReceipt(code,legacy,revision(),{},{actor:{id:'owner'}});
  assert.equal(restored.verified,true);assert.equal(db.loadOverrides().notesmap[code],undefined);
  const mixed={...legacy,maps:{...legacy.maps,shortagemap:null}};
  assert.throws(()=>db.restoreOrderOverrideReceipt(code,mixed,revision(),{},{}),{code:'OFFICE_ROLLBACK_INVALID'});
  const current=db.snapshotOrderOverride(code,{}).patch;delete current.noteColumnDefsRevision;
  assert.throws(()=>db.restoreOrderOverrideReceipt(code,current,revision(),{},{}),{code:'OFFICE_ROLLBACK_INVALID'});
});

test('agent order adapter rewrites the screen cache like the HTTP editor and refuses unknown columns',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
  const adapter=source.slice(source.indexOf('  snapshotOrder: async (ownerId, profile, orderCode, patch) => {'),source.indexOf('  restoreOrder: async (_ownerId'));
  assert.match(adapter,/OFFICE_NOTE_COLUMN_UNKNOWN/);
  assert.match(adapter,/const beforeContext=pageProjectionContext\(profile\);\n    const saved = patchOrderOverride/);
  assert.match(adapter,/rewriteProjectionCacheForRowPatches\(profile,beforeContext,\[\{orderCode,patch\}\]\)/);
});
