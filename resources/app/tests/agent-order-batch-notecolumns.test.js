'use strict';
/* Office order editor, multi-line edits and note-column definitions:
   - cp.orders.update.batch writes every line in one native override batch
     (one orders revision), verifies each line and undoes all lines in one write;
   - cp.notecolumns.update replaces the shared definition list like CP › Add
     Column; the inverse restores the exact list and the values the change
     pruned, and is refused once a value was entered in a column it removes. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-order-batch-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const db=require('../server/db'),{createToolRegistry}=require('../server/lib/agent-tool-registry');
const {registerOrderTools,BATCH_TOOL_ID,COLUMNS_TOOL_ID}=require('../server/lib/agent-order-tools');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const profile={id:'owner',enabled:true},actor={id:profile.id,name:'DEMO'};
const ctx={ownerId:profile.id,profile,approvalGranted:true,assertAuthority:()=>{},input:{officeJobId:'job-b',officeStepId:'step-b',officeAgentId:'agent-b'}};
const revision=()=>Number(db.loadOverrides()._revisions.orders)||0,defsRevision=()=>Number(db.loadOverrides()._revisions.noteColumnDefs)||0;
function tools(){
  const registry=createToolRegistry({userAccess:{profileById:()=>profile,hasArea:()=>true,hasCapability:()=>true,appendAudit:()=>{}},authorizeCapability:async()=>true});
  registerOrderTools(registry,{withAgentMutation:(_c,work)=>work(),
    snapshotOrders:async(_o,_p,entries)=>entries.map(entry=>{const ids=new Set((db.loadOverrides().noteColumnDefs||[]).map(def=>def.id));if(Object.keys(entry.patch.noteColumns||{}).some(id=>!ids.has(id)))throw Object.assign(new Error('OFFICE_NOTE_COLUMN_UNKNOWN'),{code:'OFFICE_NOTE_COLUMN_UNKNOWN',statusCode:422});return db.snapshotOrderOverride(entry.orderCode,entry.patch);}),
    updateOrders:async(_o,_p,items,rev,options)=>{const saved=db.patchOrderOverrides(items,rev,null,{actor,expectedNoteColumnDefsRevision:options.noteColumnDefsRevision});return {verified:saved.updated===items.length&&items.every(item=>db.verifyOrderOverridePatch(item.orderCode,item.patch,saved.revision)),revision:saved.revision};},
    restoreOrders:async(_o,_p,items,rev)=>db.restoreOrderOverrideReceipts(items.map(({orderCode,before,selector})=>({orderCode,receipt:before,selector})),rev,{actor}),
    currentOrderMaps:(code,selector)=>db.snapshotOrderOverride(code,selector||{}).patch.maps,
    noteColumns:{snapshot:ids=>db.noteColumnSnapshot(ids),normalize:columns=>db.normalizeNoteColumnDefs(columns),replace:(_p,columns,rev)=>db.replaceNoteColumnDefs(columns,rev),restore:(_p,snapshot,rev)=>db.restoreNoteColumnDefs(snapshot,rev)}});
  return registry;
}
const run=async(registry,id,args)=>{const dry=await registry.execute(id,args,{...ctx,dryRun:true});return {dry,done:await registry.execute(id,{...args,fingerprint:dry.fingerprint},ctx)};};

test('multi-line edit is one native batch, verified per line and undone in one write',async()=>{
  const registry=tools(),a=7300001,b=7300002;
  db.patchOrderOverride(a,{notes:{Notes:'DEMO eski not'}},revision(),null,{actor:{id:'peer',name:'Peer'}});
  const before=[db.snapshotOrderOverride(a,{}).patch.maps,db.snapshotOrderOverride(b,{}).patch.maps],start=revision();
  const args={entries:[{orderCode:a,notes:{Notes:'DEMO toplu not'},dates:{exFactory:'2026-11-20'}},{orderCode:b,subManufacturer:'DEMO ALT'}]};
  const {dry,done}=await run(registry,BATCH_TOOL_ID,args);
  assert.deepEqual(dry.preview.lines.map(l=>[l.orderCode,l.fields]),[[a,['notes','dates']],[b,['subManufacturer']]]);
  assert.equal(done.verified,true);assert.equal(done.data.lines,2);
  assert.equal(revision(),start+1,'one orders revision for the whole batch');
  assert.equal(db.loadOverrides().notesmap[a].Notes,'DEMO toplu not');assert.equal(db.loadOverrides().submap[b],'DEMO ALT');
  const undone=await registry.rollback(BATCH_TOOL_ID,done.rollbackToken,ctx);
  assert.equal(undone.verified,true);assert.equal(revision(),start+2);
  assert.deepEqual([db.snapshotOrderOverride(a,{}).patch.maps,db.snapshotOrderOverride(b,{}).patch.maps],before);
});

test('one invalid or duplicate line refuses the whole batch; a later peer edit refuses the undo',async()=>{
  const registry=tools(),a=7300011,b=7300012;
  await assert.rejects(registry.execute(BATCH_TOOL_ID,{entries:[{orderCode:a,notes:{Notes:'x'}},{orderCode:b,noteColumns:{invented:'y'}}]},{...ctx,dryRun:true}),{code:'OFFICE_NOTE_COLUMN_UNKNOWN'});
  await assert.rejects(registry.execute(BATCH_TOOL_ID,{entries:[{orderCode:a,notes:{Notes:'x'}},{orderCode:a,notes:{Notes:'y'}}]},{...ctx,dryRun:true}),{code:'OFFICE_TASK_INVALID'});
  await assert.rejects(registry.execute(BATCH_TOOL_ID,{entries:[{orderCode:a,model:'DEMO',notes:{Notes:'x'}}]},{...ctx,dryRun:true}),{code:'OFFICE_ORDER_IDENTITY'});
  const {done}=await run(registry,BATCH_TOOL_ID,{entries:[{orderCode:a,notes:{Notes:'DEMO a'}},{orderCode:b,notes:{Notes:'DEMO b'}}]});
  db.patchOrderOverride(b,{notes:{Notes:'DEMO peer'}},revision(),null,{actor:{id:'peer',name:'Peer'}});
  await assert.rejects(registry.rollback(BATCH_TOOL_ID,done.rollbackToken,ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.equal(db.loadOverrides().notesmap[a].Notes,'DEMO a','nothing was undone partially');
});

test('note-column definitions: add, rename and remove with exact inverse of pruned values',async()=>{
  db.replaceNoteColumnDefs([{id:'fit',label:'Fit notu'},{id:'pack',label:'Paket'}],defsRevision());
  db.patchOrderOverride(7300021,{noteColumns:{pack:'DEMO kutu',fit:'DEMO dar'}},revision(),null,{actor});
  const registry=tools(),before=db.loadOverrides().noteColumnDefs;
  await assert.rejects(registry.execute(COLUMNS_TOOL_ID,{columns:[{label:'A'},{label:'a'}]},{...ctx,dryRun:true}),{code:'OFFICE_TASK_INVALID'});
  await assert.rejects(registry.execute(COLUMNS_TOOL_ID,{columns:before.map(({id,label})=>({id,label}))},{...ctx,dryRun:true}),{code:'OFFICE_TASK_INVALID'});
  const args={columns:[{id:'fit',label:'Kalıp notu',labelEn:'Fit note'},{label:'DEMO Yeni'}]};
  const dry=await registry.execute(COLUMNS_TOOL_ID,args,{...ctx,dryRun:true});
  assert.deepEqual([dry.preview.changed,dry.preview.removed,dry.preview.removedValueLines],[['fit'],['pack'],1]);
  assert.equal(dry.preview.added.length,1);assert.equal(dry.preview.before,undefined);
  const done=await registry.execute(COLUMNS_TOOL_ID,{...args,fingerprint:dry.fingerprint},ctx);
  assert.equal(done.verified,true);
  assert.deepEqual(db.loadOverrides().noteColumnValues[7300021],{fit:'DEMO dar'},'removed column values are pruned natively');
  const undone=await registry.rollback(COLUMNS_TOOL_ID,done.rollbackToken,ctx);
  assert.equal(undone.verified,true);
  assert.deepEqual(db.loadOverrides().noteColumnDefs,before);
  assert.deepEqual(db.loadOverrides().noteColumnValues[7300021],{pack:'DEMO kutu',fit:'DEMO dar'});
});

test('note-column change is refused when a removed column got a value after preview, and its undo once an added column has values',async()=>{
  const registry=tools(),code=7300031,current=db.loadOverrides().noteColumnDefs;
  const args={columns:[...current.filter(def=>def.id!=='pack').map(({id,label})=>({id,label})),{label:'DEMO Sonra'}]};
  const dry=await registry.execute(COLUMNS_TOOL_ID,args,{...ctx,dryRun:true});
  db.patchOrderOverride(code,{noteColumns:{pack:'DEMO yeni değer'}},revision(),null,{actor});
  await assert.rejects(registry.execute(COLUMNS_TOOL_ID,{...args,fingerprint:dry.fingerprint},ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.equal(db.loadOverrides().noteColumnValues[code].pack,'DEMO yeni değer');
  const fresh=await registry.execute(COLUMNS_TOOL_ID,args,{...ctx,dryRun:true});
  const done=await registry.execute(COLUMNS_TOOL_ID,{...args,fingerprint:fresh.fingerprint},ctx);
  const added=fresh.preview.added[0];
  db.patchOrderOverride(code,{noteColumns:{[added]:'DEMO kullanıcı'}},revision(),null,{actor});
  await assert.rejects(registry.rollback(COLUMNS_TOOL_ID,done.rollbackToken,ctx),{code:'OFFICE_PREVIEW_CHANGED'});
  assert.equal(db.loadOverrides().noteColumnValues[code][added],'DEMO kullanıcı');
});
