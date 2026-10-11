'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-resource-authoritative-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT'])process.env[key]=root;
const {createLocalDb}=require('../server/lib/local-db'),{createDeltaStore}=require('../server/lib/delta-store');
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));let seq=0;
function isolated(name){const file=require.resolve(name),instance=new Module(file,module);instance.filename=file;instance.paths=Module._nodeModulePaths(path.dirname(file));instance._compile(fs.readFileSync(file,'utf8'),file);return instance.exports;}
async function pair(mode){const file=path.join(root,'db'+(++seq),'BuyerLogLocal.db'),a=createDeltaStore({localDb:createLocalDb(file),mode}),b=createDeltaStore({localDb:createLocalDb(file),mode});await a.hydrate();await b.hydrate();return {a,b};}
for(const mode of ['delta','delta-only']){
 test(mode+': legacy inverse restores the readable built-in default through the real durable journal',async()=>{
  const {a}=await pair(mode),engine=isolated('../server/lib/endeksmatik');fs.rmSync(engine.PERSISTED_FILE,{force:true});engine.attachDeltaStore(a);const prior=engine.loadSnapshot({force:true}).snapshot;
  await engine.saveSnapshot({...prior,season:'CHANGED',generatedAt:new Date().toISOString()});await engine.restoreLegacyReceipt(prior,'legacy',true,{expectedFingerprint:engine.sourceFingerprint()});
  await a.hydrate();assert.deepEqual(engine.loadSnapshot({force:true}).snapshot,prior);assert.equal(engine.legacyStatus().usingDefault,true);assert.equal(fs.existsSync(engine.PERSISTED_FILE),false);
 });
 test(mode+': independent Endeksmatik runtimes reject stale previews and changes during backup',async()=>{
  const {a,b}=await pair(mode),first=isolated('../server/lib/endeksmatik'),second=isolated('../server/lib/endeksmatik');first.attachDeltaStore(a);second.attachDeltaStore(b);
  const snapshot=require('../server/lib/endeksmatik-model').parseWorkbookBuffer(require('./helpers/endeksmatik-fixture').buildEndeksmatikWorkbook(),'race.xlsx');await first.saveSet(snapshot);await b.hydrate();const preview=first.sourceFingerprint();await second.renameSet(snapshot.id,'SECOND RUNTIME');
  await assert.rejects(first.renameSet(snapshot.id,'STALE',{expectedFingerprint:preview}),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(first.readSetSnapshot(snapshot.id).label,'SECOND RUNTIME');
  const fresh=first.sourceFingerprint();await assert.rejects(first.renameSet(snapshot.id,'BACKUP STALE',{expectedFingerprint:fresh,beforeMutation:()=>b.mirror('endeksmatik',{['set:'+snapshot.id]:{label:'DURING BACKUP'}})}),{code:'OFFICE_PREVIEW_CHANGED'});assert.equal(first.readSetSnapshot(snapshot.id).label,'DURING BACKUP');
 });
 test(mode+': guarded FX refresh preserves another runtime currency and rejects old revision',async()=>{
  const {a,b}=await pair(mode),first=isolated('../server/db'),second=isolated('../server/db');first.attachDeltaStore(a);second.attachDeltaStore(b);
  await first.mutateSharedResource('fx',options=>first.saveFx({base:'USD',currencies:['USD','TRY'],months:{'2026-10':{USD:1,TRY:40}}},null,null,options));const prior=first.loadFx();await b.hydrate();
  await second.mutateSharedResource('fx',options=>second.saveFx({base:'USD',currencies:['USD','TRY','EUR'],months:{'2026-10':{USD:1,TRY:41,EUR:.9}}},prior._revision,null,options));
  await assert.rejects(first.mutateSharedResource('fx',options=>first.saveFx({...prior,months:{'2026-10':{USD:1,TRY:42}}},prior._revision,null,options)),{code:'REVISION_CONFLICT'});
  assert.equal(first.loadFx().months['2026-10'].EUR,.9);assert.equal(first.loadFx().months['2026-10'].TRY,41);
 });
 test(mode+': section mutations preserve unrelated override fields and global revision',async()=>{
  const {a,b}=await pair(mode),first=isolated('../server/db'),second=isolated('../server/db');first.attachDeltaStore(a);second.attachDeltaStore(b);
  await first.mutateSharedResource('overrides',options=>first.replaceTransitRules([{id:'base',delType:'Sea',days:10}],null,null,options));await b.hydrate();
  const expectedOrders=second.loadOverrides()._revisions.orders+1;await second.mutateSharedResource('overrides',options=>{const current=second.loadOverrides();current.notesmap['DEMO']={Notes:'OTHER USER NOTE',NotesBy:'other',NotesByName:'Other buyer'};current._revisions.orders++;return second.saveOverrides(current,current._revision,options);});
  const royaltyRev=first.loadOverrides()._revisions.pricingRules;
  await first.mutateSharedResource('overrides',options=>first.replacePricingRules([{id:'r',licensor:'Demo',license:'Demo',royalty:5}],royaltyRev,options));assert.deepEqual(first.loadOverrides().notesmap.DEMO,{Notes:'OTHER USER NOTE',NotesBy:'other',NotesByName:'Other buyer'});assert.equal(first.loadOverrides()._revisions.orders,expectedOrders);
 });
 test(mode+': manufacturer record CAS sees another runtime edit and leaves its lock intact',async()=>{
  const {a,b}=await pair(mode),first=isolated('../server/lib/email-groups-store'),second=isolated('../server/lib/email-groups-store');first.attachDeltaStore(a);second.attachDeltaStore(b);const me={id:'a',name:'A'},other={id:'b',name:'B'};
  const created=await first.mutateSharedResource(options=>first.createRecord({manufacturer:'DEMO'},me,null,options));await b.hydrate();await second.mutateSharedResource(options=>second.acquireLock(created.record.id,other,options));
  await assert.rejects(first.mutateSharedResource(options=>first.acquireLock(created.record.id,me,{...options,expectedRevision:created.revision})),{code:'EMAIL_RECORD_LOCKED'});assert.equal(first.loadStore().records.find(r=>r.id===created.record.id).lock.userId,'b');
 });
}
test('durable source CAS closes changes after refresh and before the actual WAL write',async()=>{
 const {a,b}=await pair('delta-only'),first=isolated('../server/db'),second=isolated('../server/db');first.attachDeltaStore(a);second.attachDeltaStore(b);
 await first.mutateSharedResource('fx',options=>first.saveFx({base:'USD',currencies:['USD','TRY'],months:{'2026-10':{USD:1,TRY:40}}},null,null,options));await b.hydrate();
 await assert.rejects(first.mutateSharedResource('fx',async options=>{const prior=first.loadFx();await second.mutateSharedResource('overrides',async()=>{
   // Incoming sync commits directly to the shared journal, without the FX service lease.
   await b.mirror('store',{[first.deltaStoreId(path.join(require('../server/user-data').SERVER_DATA_ROOT,'fx-rates.json'))]:require('../server/lib/delta-store').toDocumentRecord({...prior,_revision:prior._revision+1,months:{'2026-10':{USD:1,TRY:41,EUR:.9}}})});
  });return first.saveFx({...prior,months:{'2026-10':{USD:1,TRY:42}}},prior._revision,null,options);}),{code:'OFFICE_PREVIEW_CHANGED'});
 await a.hydrate();assert.equal(first.loadFx().months['2026-10'].EUR,.9);assert.equal(first.loadFx().months['2026-10'].TRY,41);
});
