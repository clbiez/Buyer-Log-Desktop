'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {sqlite}=require(process.env.SQLITE_R3_AUDIT_ADAPTER||'./sqlite-compat.cjs');
function fixture(t,n){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'incr-r3-')),s=sqlite(path.join(dir,'audit.sqlite'));
 t.after(()=>{s.close();fs.rmSync(dir,{recursive:true,force:true});});s.initialize();
 s.queuePatches(Array.from({length:n},(_,i)=>({id:`r:${i}`,eventId:`e:${i}`,patch:{value:i}})));
 s.db.exec('CREATE TEMP TABLE audit(tab TEXT,op TEXT,id TEXT)');
 for(const [table,key] of [['records','id'],['events','event_id'],['meta','key']])for(const op of ['INSERT','UPDATE','DELETE'])s.db.exec(`CREATE TEMP TRIGGER audit_${table}_${op} AFTER ${op} ON ${table} BEGIN INSERT INTO audit VALUES('${table}','${op}',${op==='DELETE'?'old':'new'}.${key}); END`);
 return {s,changes:()=>s.db.prepare('SELECT * FROM audit').all(),clear:()=>s.db.exec('DELETE FROM audit')};
}
for(const n of [20,2000])test(`actual SQL audit bounds changed rows at ${n} records/events`,t=>{
 const {s,changes,clear}=fixture(t,n);const patch={id:'r:0',eventId:'patch',patch:{value:9}};
 s.queuePatch(patch);assert.deepEqual(changes().map(r=>[r.tab,r.id]).sort(),[['records','r:0'],['events','patch'],['meta','envelope']].sort());
 clear();s.queuePatch(patch);assert.equal(changes().length,0,'duplicate has no DML');
 s.queuePatches([{id:'r:1',eventId:'batch1',patch:{value:8}},{id:'r:2',eventId:'batch2',patch:{value:7}}]);
 assert.equal(changes().filter(r=>r.tab==='records').length,2);assert.equal(changes().filter(r=>r.tab==='events').length,2);
 clear();s.tombstone({id:'r:1',eventId:'delete'});assert.deepEqual(changes().filter(r=>r.tab==='records').map(r=>[r.op,r.id]),[['DELETE','r:1']]);
 clear();s.markSynced(['e:0','e:1']);assert.deepEqual(changes().filter(r=>r.tab==='events').map(r=>r.id).sort(),['e:0','e:1']);
 clear();s.markAcknowledged(['e:0']);assert.deepEqual(changes().filter(r=>r.tab==='events').map(r=>r.id),['e:0']);
 clear();s.markAcknowledgedThrough(2);assert.deepEqual(changes().filter(r=>r.tab==='events').map(r=>r.id),['e:1']);
 clear();s.markAcknowledgedThrough(2);assert.equal(changes().length,0);
 clear();const delta={id:'r:3',eventId:'remote',deviceId:'peer',localSequence:1,revision:9000,baseRevision:0,patch:{value:100}};
 const receipt=s.applyDelta(delta);assert(changes().filter(r=>r.tab==='records').every(r=>r.id==='r:3'));assert(changes().filter(r=>r.tab==='events').every(r=>r.id==='remote'));
 clear();s.resolveConflict(receipt.conflicts[0].conflictId,'incoming');assert(changes().filter(r=>r.tab==='records').every(r=>r.id==='r:3'));assert.equal(changes().filter(r=>r.tab==='events').length,1);
});
test('multirow SQL failure rolls back record, event, envelope and audit then retry commits once',t=>{
 const {s,changes,clear}=fixture(t,20),before=s.read();
 s.db.exec("CREATE TEMP TRIGGER fail_second BEFORE INSERT ON events WHEN new.event_id='fail' BEGIN SELECT RAISE(ABORT,'injected'); END");
 const items=[{id:'r:0',eventId:'ok',patch:{value:8}},{id:'r:1',eventId:'fail',patch:{value:9}}];
 assert.throws(()=>s.queuePatches(items),/injected/);assert.deepEqual(s.read(),before);assert.equal(changes().length,0);assert.equal(s.db.isTransaction,false);
 s.db.exec('DROP TRIGGER fail_second');s.queuePatches(items);assert.equal(changes().filter(r=>r.tab==='events').length,2);
 clear();s.queuePatches(items);assert.equal(changes().length,0);
});
test('inherited keys are never persisted as candidate rows and TEXT-affinity metadata does not trigger no-op writes',t=>{
 const {s,changes,clear}=fixture(t,20);
 const item={id:'r:0',eventId:'numeric',patch:{kind:0,state:false,owner:0}};s.queuePatch(item);clear();s.queuePatch(item);assert.equal(changes().length,0);
 s.markAcknowledged(['constructor','toString']);assert.equal(changes().length,0);assert.equal(s.db.prepare("SELECT count(*) n FROM events WHERE event_id IN ('constructor','toString')").get().n,0);
});
