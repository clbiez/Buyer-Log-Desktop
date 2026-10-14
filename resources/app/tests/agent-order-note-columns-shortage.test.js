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
  const adapter=source.slice(source.indexOf('  snapshotOrder: async (ownerId, profile, orderCode, patch, preloadedRows=null) => {'),source.indexOf('  restoreOrder: async (_ownerId'));
  assert.match(adapter,/OFFICE_NOTE_COLUMN_UNKNOWN/);
  assert.match(adapter,/const beforeContext=pageProjectionContext\(profile\);\n    const saved = patchOrderOverride/);
  assert.match(adapter,/rewriteProjectionCacheForRowPatches\(profile,beforeContext,\[\{orderCode,patch\}\]\)/);
});

test('Office cp.order.update (contract v2) binds approval to the live order snapshot and restores through a bound inverse',async()=>{
  const {registerOrderTools}=require('../server/lib/agent-order-tools');
  const office={id:'office-owner',enabled:true,areas:['cp']};
  const tools=createToolRegistry({userAccess:{profileById:()=>office,hasArea:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  registerOrderTools(tools,{
    withAgentMutation:(_ctx,work)=>work(),
    snapshotOrder:async(_o,_p,code,patch)=>{const ids=new Set((db.loadOverrides().noteColumnDefs||[]).map(def=>def.id));if(Object.keys(patch.noteColumns||{}).some(id=>!ids.has(id)))throw Object.assign(new Error('OFFICE_NOTE_COLUMN_UNKNOWN'),{code:'OFFICE_NOTE_COLUMN_UNKNOWN'});return db.snapshotOrderOverride(code,patch);},
    updateOrder:async(_o,_p,code,patch,revision,options={})=>{const saved=db.patchOrderOverride(code,patch,revision,null,{actor:{id:office.id},expectedNoteColumnDefsRevision:options.noteColumnDefsRevision});return{ok:true,verified:db.verifyOrderOverridePatch(code,patch,saved.revision),revision:saved.revision};},
    restoreOrder:async(_o,_p,code,receipt,revision,selector)=>db.restoreOrderOverrideReceipt(code,receipt,revision,selector,{actor:{id:office.id}}),
    currentOrderMaps:(code,selector)=>db.snapshotOrderOverride(code,selector||{}).patch.maps,
  });
  const meta=tools.get('cp.order.update');
  assert.equal(meta.contractVersion,2);assert.equal(meta.approval,true);assert.equal(meta.rollbackable,true);
  const code=7100005,input={officeJobId:'job-1',officeStepId:'step-1',officeAgentId:'agent-1'};
  const ctx={ownerId:office.id,profile:office,input,approvalGranted:true,assertAuthority:()=>{}};
  const args={orderCode:code,noteColumns:{pack:'karton 6'},shortage:{marked:true,qty:4}};
  await assert.rejects(tools.execute('cp.order.update',{orderCode:code},{...ctx,dryRun:true}),{code:'OFFICE_TASK_INVALID'});
  const preview=await tools.execute('cp.order.update',args,{...ctx,dryRun:true});
  assert.deepEqual(preview.preview.fields,['noteColumns','shortage']);
  // A concurrent edit after the preview invalidates the approval.
  db.patchOrderOverride(code,{notes:{Notes:'peer'}},revision(),null,{actor:{id:'peer'}});
  await assert.rejects(tools.execute('cp.order.update',{...args,fingerprint:preview.fingerprint},ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  const before=db.snapshotOrderOverride(code,{}).patch.maps;
  const fresh=await tools.execute('cp.order.update',args,{...ctx,dryRun:true});
  const result=await tools.execute('cp.order.update',{...args,fingerprint:fresh.fingerprint},ctx);
  assert.equal(result.verified,true);assert.ok(/^[a-f0-9]{32}$/.test(result.rollbackToken.artifactId));
  assert.equal(result.rollbackToken.before,undefined,'prior override data lives in the bound artifact, not the token');
  assert.equal(db.loadOverrides().noteColumnValues[code].pack,'karton 6');
  await assert.rejects(tools.rollback('cp.order.update',result.rollbackToken,{...ctx,input:{...input,officeStepId:'other'}}),{code:'OFFICE_ROLLBACK_INVALID'});
  const restored=await tools.rollback('cp.order.update',result.rollbackToken,ctx);
  assert.equal(restored.verified,true);
  assert.deepEqual(db.snapshotOrderOverride(code,{}).patch.maps,before);
});

test('a line needs model AND colour; one alone is refused instead of writing the order-level override',async()=>{
  const {registerOrderTools}=require('../server/lib/agent-order-tools');
  const office={id:'office-owner',enabled:true,areas:['cp']},tools=createToolRegistry({userAccess:{profileById:()=>office,hasArea:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  let forbidden=false;
  registerOrderTools(tools,{withAgentMutation:(_c,w)=>w(),snapshotOrder:async()=>{if(forbidden)throw Object.assign(new Error('x'),{code:'ORDER_SHARED_OWNER_ONLY'});return db.snapshotOrderOverride(7100006,{});},updateOrder:async()=>({}),restoreOrder:async()=>({}),currentOrderMaps:()=>({})});
  const ctx={ownerId:office.id,profile:office,input:{officeJobId:'j',officeStepId:'s'},approvalGranted:true,assertAuthority:()=>{}};
  await assert.rejects(tools.execute('cp.order.update',{orderCode:7100006,model:'M1',notes:{Notes:'x'}},{...ctx,dryRun:true}),{code:'OFFICE_ORDER_IDENTITY'});
  await assert.rejects(tools.execute('cp.order.update',{orderCode:7100006,ccode:'C1',notes:{Notes:'x'}},{...ctx,dryRun:true}),{code:'OFFICE_ORDER_IDENTITY'});
  forbidden=true;
  await assert.rejects(tools.execute('cp.order.update',{orderCode:7100006,dates:{exFactory:'2026-11-01'}},{...ctx,dryRun:true}),{code:'OFFICE_ORDER_SHARED_OWNER'});
  const legacy=registry();
  await assert.rejects(legacy.execute('app.order.update',{orderCode:7100006,expectedRevision:revision(),model:'M1',notes:{Notes:'x'}},{ownerId:profile.id,profile,approvalGranted:true}),{code:'OFFICE_ORDER_IDENTITY'});
});

test('note-column values are CAS-bound to the column definitions the preview saw',()=>{
  const code=7100007,defs=defsRevision();
  db.replaceNoteColumnDefs([{id:'pack',label:'Paket'},{id:'extra',label:'Ek'}],defs);
  assert.throws(()=>db.patchOrderOverride(code,{noteColumns:{pack:'x'}},revision(),null,{expectedNoteColumnDefsRevision:defs}),{code:'REVISION_CONFLICT'});
  assert.equal(db.loadOverrides().noteColumnValues[code],undefined);
  db.patchOrderOverride(code,{noteColumns:{pack:'x'}},revision(),null,{expectedNoteColumnDefsRevision:defsRevision()});
  assert.equal(db.loadOverrides().noteColumnValues[code].pack,'x');
});

test('Office inverse is refused when the line changed after the effect, even without a new local revision',async()=>{
  const {registerOrderTools}=require('../server/lib/agent-order-tools');
  const office={id:'office-owner',enabled:true,areas:['cp']},tools=createToolRegistry({userAccess:{profileById:()=>office,hasArea:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  let overlay=null;
  registerOrderTools(tools,{withAgentMutation:(_c,w)=>w(),snapshotOrder:async(_o,_p,code,patch)=>db.snapshotOrderOverride(code,patch),
    updateOrder:async(_o,_p,code,patch,rev)=>{const saved=db.patchOrderOverride(code,patch,rev,null,{actor:{id:office.id}});return{verified:true,revision:saved.revision};},
    restoreOrder:async(_o,_p,code,receipt,rev,selector)=>db.restoreOrderOverrideReceipt(code,receipt,rev,selector,{}),
    currentOrderMaps:(code,selector)=>overlay||db.snapshotOrderOverride(code,selector||{}).patch.maps});
  const ctx={ownerId:office.id,profile:office,input:{officeJobId:'j2',officeStepId:'s2'},approvalGranted:true,assertAuthority:()=>{}};
  const args={orderCode:7100008,notes:{Notes:'agent'}},fresh=await tools.execute('cp.order.update',args,{...ctx,dryRun:true});
  const done=await tools.execute('cp.order.update',{...args,fingerprint:fresh.fingerprint},ctx);
  overlay={...db.snapshotOrderOverride(7100008,{}).patch.maps,notesmap:{Notes:'peer via hub'}};
  await assert.rejects(tools.rollback('cp.order.update',done.rollbackToken,ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  overlay=null;assert.equal((await tools.rollback('cp.order.update',done.rollbackToken,ctx)).verified,true);
});
