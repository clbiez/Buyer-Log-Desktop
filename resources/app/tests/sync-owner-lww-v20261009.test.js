'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fsp=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createLocalDb}=require('../server/lib/local-db');
const {createOwnershipResolver}=require('../server/lib/cp-field-ownership');
const {createSimulation}=require('./helpers/sync-sim');
const {eventChecksum}=require('../server/lib/sync-package');
const resolve=createOwnershipResolver({1001:[{buyer:'Demo Owner'}]},[{id:'owner',username:'Demo Owner'},{id:'other',username:'Demo Other'}]);
const ownerOf=(id,userId)=>resolve({recordId:id,userId});
async function dbs(t){const root=await fsp.mkdtemp(path.join(os.tmpdir(),'bl-owner-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));return [0,1].map(i=>{const db=createLocalDb(path.join(root,String(i),'db'));db.setSharedOwnerResolver(ownerOf);return db;});}
test('legacy same-owner events retain at/device ties and causal writes ignore clock rollback',async t=>{
 const [a,b]=await dbs(t);await Promise.all([a.ensure(),b.ensure()]);
 for(const [db,value] of [[a,10],[b,20]])await db.queuePatch({id:'cp-order:1001',patch:{suppFob:value},userId:'owner',at:'2026-10-09T10:00:00Z'});
 const [ea]=await a.pending(10),[eb]=await b.pending(10);
 // Old senders have no HLC: retain the pre-HLC deterministic tie regression.
 for(const event of [ea,eb]){delete event.hlc;event.sha256=eventChecksum(event);}
 await a.applyDelta(eb);await b.applyDelta(ea);
 const expected=a.getDeviceId()>b.getDeviceId()?10:20;
 for(const db of [a,b]){const state=await db.read();assert.equal(state.records['cp-order:1001'].suppFob,expected);assert.equal(state.conflicts.filter(c=>!c.resolved).length,0);}
 await a.queuePatch({id:'cp-order:1001',patch:{suppFob:30},userId:'owner',at:'2026-10-09T09:00:00Z'});
 await b.applyDelta((await a.pending(10)).at(-1));assert.equal((await b.read()).records['cp-order:1001'].suppFob,30);
});
test('nonowner shared batch is denied before any mutation; local notes remain editable',async t=>{
 const [a]=await dbs(t);await a.ensure();
 await assert.rejects(a.queuePatches([{id:'cp-order:1001',patch:{notes:{Notes:'not committed'}},userId:'other'},{id:'cp-order:1001',patch:{suppFob:99},userId:'other'}]),e=>e.code==='ORDER_SHARED_OWNER_ONLY');
 assert.equal((await a.read()).records['cp-order:1001'],undefined);
 await a.queuePatch({id:'cp-order:1001',patch:{notes:{Notes:'local'}},userId:'other'});assert.equal((await a.read()).records['cp-order:1001'].notes.Notes,'local');
});
test('foreign remote owner is receipted without fields; missing actor stays compatible',async t=>{
 const [a,b]=await dbs(t);a.setSharedOwnerResolver(null);await Promise.all([a.ensure(),b.ensure()]);
 await a.queuePatch({id:'cp-order:1001',patch:{suppFob:99},userId:'other'});const [bad]=await a.pending(10);
 assert.equal((await b.applyDelta(bad)).applied,false);const state=await b.read();assert.equal(state.records['cp-order:1001'],undefined);assert.equal(state.syncCheckpoints[a.getDeviceId()],1);
 await a.queuePatch({id:'cp-order:1001',patch:{suppFob:12}});await b.applyDelta((await a.pending(10)).at(-1));assert.equal((await b.read()).records['cp-order:1001'].suppFob,12);
});
test('ownership decisions persist in WAL independently of a later IAM change',async t=>{
 const [a,b]=await dbs(t);await Promise.all([a.ensure(),b.ensure()]);
 await a.queuePatch({id:'cp-order:1001',patch:{suppFob:11},userId:'owner'});await b.applyDelta((await a.pending(10))[0]);
 for(const db of [a,b]){const reopened=createLocalDb(db.file);reopened.setSharedOwnerResolver(()=>({allowed:false,known:true}));assert.equal((await reopened.read()).records['cp-order:1001'].suppFob,11);}
});
test('owner rule retires old shared conflicts and keeps the verified owner value',async t=>{
 const [db]=await dbs(t);await db.ensure();await db.queuePatch({id:'cp-order:1001',patch:{suppFob:12},userId:'owner'});
 await db.transaction(state=>{state.conflicts.push({conflictId:'old',eventId:'foreign',id:'cp-order:1001',field:'suppFob',type:'field',current:12,incoming:99,resolved:false});state.appliedEvents.foreign={userId:'other'};});
 assert.equal(await db.retireOwnerConflicts(),1);const state=await db.read();assert.equal(state.records['cp-order:1001'].suppFob,12);assert.equal(state.conflicts[0].resolution,'owner-rule');
});
test('ten real replicas converge for concurrent edits from two devices of one owner',async t=>{
 const sim=await createSimulation({seed:4410,devices:10,clock:index=>1000+index});t.after(()=>sim.close());for(const device of sim.devices)device.db.setSharedOwnerResolver(ownerOf);
 await sim.syncRound();await sim.replicator.flush();
 await sim.devices[0].db.queuePatch({id:'cp-order:1001',patch:{suppFob:11},userId:'owner',at:'2026-10-09T10:00:00Z'});
 await sim.devices[1].db.queuePatch({id:'cp-order:1001',patch:{suppFob:22},userId:'owner',at:'2026-10-09T11:00:00Z'});
 await sim.syncRound();await sim.settle();
 for(const device of sim.devices){const state=await device.db.read();assert.equal(state.records['cp-order:1001'].suppFob,22);assert.equal(state.conflicts.filter(c=>!c.resolved).length,0);}
});
test('shared UI and API use central ownership while retaining ordinary edit scope',()=>{
 const fs=require('node:fs'),server=fs.readFileSync(path.join(__dirname,'../server/server.js'),'utf8'),ui=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
 assert.match(server,/cpDataAllowed \? sharedAccessRows\(cp, currentUser\)/);assert.match(server,/sharedOnly:true/);assert.match(server,/SYNC_OWNER_PATCH_REJECTED/);assert.match(server,/setSharedOwnerResolver/);assert.match(ui,/_canEditShared !== false/);assert.match(ui,/Only the order owner can edit shared fields/);
});
test('retiring an old conflict never replaces current data with an incoming actor of unknown identity',async t=>{
 const [db]=await dbs(t);await db.ensure();await db.queuePatch({id:'cp-order:1001',patch:{suppFob:12},userId:'owner'});
 await db.transaction(state=>{delete state.records['cp-order:1001']._fieldOrders;delete state.records['cp-order:1001']._fieldWriters;state.conflicts.push({conflictId:'old-unknown',eventId:'unknown-event',id:'cp-order:1001',field:'suppFob',type:'field',current:12,incoming:99,resolved:false});state.appliedEvents['unknown-event']={};});
 assert.equal(await db.retireOwnerConflicts(),1);assert.equal((await db.read()).records['cp-order:1001'].suppFob,12);
});
