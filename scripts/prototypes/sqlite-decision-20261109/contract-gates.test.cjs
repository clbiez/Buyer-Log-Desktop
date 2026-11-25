'use strict';
// Acceptance tests deliberately expose unimplemented production contracts.
// A failing gate is decision evidence, never changed into an expected pass.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {open}=require('./adapters.cjs');
const {event}=require('./workload.cjs');
async function pair(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bl-sqlite952-gates-'));
 const a=path.join(root,'local'),b=path.join(root,'sqlite');await fs.mkdir(a);await fs.mkdir(b);
 const stores=[open('local',a),open('sqlite',b)];
 t.after(async()=>{stores.forEach(s=>s.close());await fs.rm(root,{recursive:true,force:true});});
 for(const s of stores){await s.ensure();await s.initialize();}
 return stores;
}
test('scalar null/zero/false/empty preserve business patch values',async t=>{
 const [a,b]=await pair(t),e={...event(0,10000),patch:{v:null,z:0,f:false,e:''}};
 await a.queuePatch(e);await b.queuePatch(e);assert.deepEqual(await a.records(),await b.records());
});
test('full read envelope API must exist on SQLite',async t=>{
 const [a,b]=await pair(t);assert.equal(typeof a.db.read,'function');assert.equal(typeof b.read,'function');
});
test('delete/tombstone API must exist on SQLite',async t=>{
 const [a,b]=await pair(t);assert.equal(typeof a.db.tombstone,'function');assert.equal(typeof b.tombstone,'function');
});
test('remote conflict/owner API must exist on SQLite',async t=>{
 const [a,b]=await pair(t);assert.equal(typeof a.db.applyDelta,'function');
 for(const name of ['applyDelta','setSharedOwnerResolver','listConflicts','resolveConflict']) assert.equal(typeof b[name],'function',name);
});
test('ACK is distinct from upload and must exist on SQLite',async t=>{
 const [a,b]=await pair(t);assert.equal(typeof a.db.markAcknowledged,'function');
 for(const name of ['markAcknowledged','markAcknowledgedThrough','unacknowledgedCount']) assert.equal(typeof b[name],'function',name);
});
test('explicit baseRevision changes global revision identically',async t=>{
 const [a,b]=await pair(t),e={...event(0,10000),baseRevision:99};
 await a.queuePatch(e);await b.queuePatch(e);assert.deepEqual(await a.records(),await b.records());
});
test('API receipt conflict metadata is identical',async t=>{
 const [a,b]=await pair(t),e=event(0,10000);
 assert.deepEqual(await a.queuePatch(e),await b.queuePatch(e));
});
test('uploaded journal metadata survives persistence identically',async t=>{
 const [a,b]=await pair(t),e=event(0,10000);
 for(const db of [a,b]){await db.queuePatch(e);await db.markSynced([e.eventId]);}
 const expected=(await a.db.read()).journal.find(x=>x.eventId===e.eventId);
 const actual=JSON.parse(b.db.prepare('SELECT body FROM events WHERE event_id=?').get(e.eventId).body);
 assert.equal(actual.uploaded,expected.uploaded,'Persisted journal upload status');
 assert.equal(actual.synced,expected.synced,'Persisted journal synced status');
});
