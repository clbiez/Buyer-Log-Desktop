'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { open } = require('./adapters.cjs');
const { CLOCK } = require('./workload.cjs');

// Control only generated wall time and operation UUIDs. No fields are stripped
// or renamed in receipts/state. Recovery/lease UUIDs retain their real source.
const RealDate = Date, realUuid = crypto.randomUUID;
let instant = CLOCK, serial = 0;
const fixtureTraces=[];
test.after(()=>{
  global.Date=RealDate;crypto.randomUUID=realUuid;
  if(process.env.SQLITE_COMPAT_TRACE_OUT)fs.writeFileSync(process.env.SQLITE_COMPAT_TRACE_OUT,JSON.stringify(fixtureTraces,null,2)+'\n');
});
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [instant])); }
  static now() { return instant; }
};
crypto.randomUUID = function () {
  const caller = new Error().stack.split('\n')[2];
  if (/local-db\.js:|compat-transitions\.cjs:|sqlite-compat\.cjs:/.test(caller)) {
    return `00000000-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
  }
  return realUuid();
};
const item = (n, extra = {}) => ({ id: 'record:r2', eventId: `r2-${n}`, at: new RealDate(CLOCK+n*1000).toISOString(), origin: 'compat-r2', userId: 'owner-a', patch: { value: n }, ...extra });
async function pair(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'sqlite-compat-r2-'));
  const dirs = ['local','sqlite'].map(n=>path.join(root,n));
  for (const d of dirs) await fsp.mkdir(d);
  let stores = dirs.map((d,i)=>open(i?'sqlite':'local',d));
  for (const s of stores) { await s.ensure(); await s.initialize(); }
  const raw = s=>s.read ? s : s.db;
  const trace={test:t.name,operations:[]};fixtureTraces.push(trace);
  let step = 0;
  async function both(method,...args) {
    let expected;
    instant = CLOCK + (++step)*10000;
    trace.operations.push({method,args:structuredClone(args),instant,uuidStart:step*100});
    for (let i=0;i<2;i++) {
      serial=step*100;
      const result = await raw(stores[i])[method](...structuredClone(args));
      if (!i) expected=structuredClone(result); else assert.deepEqual(result,expected,`${method} receipt step ${step}`);
    }
    await equal();
    return expected;
  }
  async function equal() {
    assert.deepEqual(await raw(stores[1]).read(),await raw(stores[0]).read(),'complete state envelope');
    assert.deepEqual(await stores[1].pending(10000),await stores[0].pending(10000),'pending metadata');
    assert.equal(await raw(stores[1]).unacknowledgedCount(),await raw(stores[0]).unacknowledgedCount());
    const state=await raw(stores[1]).read();
    for(const e of state.journal) {
      const row=stores[1].db.prepare('SELECT * FROM events WHERE event_id=?').get(e.eventId);
      assert.deepEqual(JSON.parse(row.body),e,'real SQL journal body');
      for(const key of ['uploaded','synced','acknowledged']) assert.equal(row[key],Number(e[key]),`SQL ${key}`);
    }
    return state;
  }
  async function reopen() {
    stores.forEach(s=>s.close());
    stores=dirs.map((d,i)=>open(i?'sqlite':'local',d));
    await equal();
  }
  t.after(async()=>{stores.forEach(s=>s.close());await fsp.rm(root,{recursive:true,force:true});});
  return { both,equal,reopen,dirs,get stores(){return stores;},raw };
}

test('complete empty and populated envelope, scalar/missing values, batch receipts and explicit revisions persist',async t=>{
  const p=await pair(t);await p.equal();
  await p.both('queuePatch',item(1,{patch:{value:null,zero:0,flag:false,empty:'',nested:{x:[0,false,null]}}}));
  const first=await p.both('queuePatch',item(2,{baseRevision:99,patch:{value:2}}));
  assert.equal(first.revision,100);assert.equal(first.localSequence,2);
  assert.equal(first.record.zero,0);assert.equal(first.record._fieldRevisions.value,100);
  const batch=await p.both('queuePatches',[item(3),item(3),item(4,{id:'other',patch:{value:false}}),null,{id:'',patch:{a:1}}]);
  assert.equal(batch.count,2);assert.equal(batch.results[1].duplicate,true);
  await p.both('queuePatch',item(1));await p.reopen();
});

test('delete, duplicate delete, repeated delete, resurrection and remote tombstone persist',async t=>{
  const p=await pair(t);await p.both('queuePatch',item(1));
  await p.both('tombstone',item(2));await p.both('tombstone',item(2));
  await p.both('tombstone',item(3));
  let s=await p.equal();assert.equal(s.records['record:r2'],undefined);assert.equal(s.tombstones['record:r2'].revision,3);
  await p.reopen();await p.both('queuePatch',item(4));
  s=await p.equal();assert.equal(s.tombstones['record:r2'],undefined);
  await p.both('applyDelta',{...item(5),patch:undefined,delete:true,baseRevision:4,revision:8,deviceId:'remote',localSequence:1});
  await p.reopen();
});

test('remote field/delete conflicts resolve with durable IDs, receipts, HLC and checkpoints',async t=>{
  const p=await pair(t);await p.both('queuePatch',item(1));
  const delta={...item(2),baseRevision:0,revision:7,deviceId:'remote',localSequence:2,seen:{},hlc:{wallMs:CLOCK+1,counter:0,node:'remote'}};
  const conflict=await p.both('applyDelta',delta);assert.equal(conflict.conflicts.length,1);
  assert.equal((await p.equal()).syncCheckpoints.remote,0);
  await p.reopen();
  await p.both('listConflicts');
  await p.both('resolveConflict',conflict.conflicts[0].conflictId,'incoming');
  assert.equal((await p.equal()).records['record:r2'].value,2);
  await p.both('applyDelta',delta);
  await p.both('applyDelta',{...item(9,{id:'other'}),revision:1,deviceId:'remote',localSequence:1});
  assert.equal((await p.equal()).syncCheckpoints.remote,2);
  const del=await p.both('applyDelta',{...item(10),delete:true,baseRevision:0,revision:30,deviceId:'delete-source',localSequence:1});
  assert.equal(del.conflicts[0].type,'delete');
  await p.both('resolveConflict',del.conflicts[0].conflictId,'current');
  await p.reopen();
});

test('owner denial, same-owner ordering, composite subfields, different-owner conflicts and receipt-only',async t=>{
  const p=await pair(t);
  const resolver=(_id,user)=>({known:true,allowed:user==='owner-a',authorityKnown:true});
  for(const s of p.stores)p.raw(s).setSharedOwnerResolver(resolver);
  const id='cp-order:r2';
  const before=await p.equal();
  for(const s of p.stores)await assert.rejects(async()=>p.raw(s).queuePatch(item(1,{id,userId:'stranger',patch:{suppFob:20}})),{code:'ORDER_SHARED_OWNER_ONLY'});
  assert.deepEqual(await p.equal(),before);
  await p.both('queuePatch',item(1,{id,patch:{dates:{ex:'2026-12-01',retail:'2026-12-10'},suppFob:20},subfields:{dates:['ex','retail']}}));
  await p.both('applyDelta',{...item(2,{id,userId:'stranger',patch:{suppFob:999,note:'denied whole event'}}),revision:8,baseRevision:0,deviceId:'unauthorized',localSequence:1});
  assert.equal((await p.equal()).records[id].suppFob,20);
  await p.both('applyDelta',{...item(3,{id,patch:{dates:{retail:'2026-12-20'}}}),subfields:{dates:['retail']},revision:9,baseRevision:0,deviceId:'owner-peer',localSequence:1,seen:{}});
  assert.equal((await p.equal()).records[id].dates.ex,'2026-12-01');
  assert.equal((await p.equal()).records[id].dates.retail,'2026-12-20');
  await p.both('applyDelta',{...item(4,{id:'receipt-only'}),revision:99,deviceId:'receipt-source',localSequence:1},{receiptOnly:true});
  assert.equal((await p.equal()).records['receipt-only'],undefined);
  await p.reopen();
});

test('ACK/upload order, partial through, foreign events and compacted ACK exceptions persist',async t=>{
  const p=await pair(t);
  await p.both('queuePatches',Array.from({length:1105},(_,n)=>item(n,{id:`r:${n}`})));
  await p.both('markAcknowledged',['r2-0','missing']);
  assert.equal(await p.raw(p.stores[1]).pendingCount(),1105,'ACK does not upload');
  await p.both('markSynced',['r2-0','r2-1']);
  await p.both('markAcknowledgedThrough',1);
  assert.equal((await p.equal()).journal[2].acknowledged,false,'through does not ACK unuploaded');
  await p.both('applyDelta',{...item(5000),deviceId:'foreign',localSequence:1,revision:5});
  await p.both('markSynced',Array.from({length:1105},(_,n)=>`r2-${n}`));
  await p.reopen();
  // Same compaction call shape via historical wrappers; compare every field.
  instant+=10000;for(const s of p.stores)await s.compact();await p.equal();
  await p.both('markAcknowledged',['r2-2']);
  assert((await p.equal()).syncLedger.acknowledgedEventIds['r2-2'],'per-event ACK survives journal pruning');
  await p.reopen();await p.both('markAcknowledgedThrough',50);
  const state=await p.equal();assert.equal(state.events['r2-5000'].origin,'remote');
  assert.equal(state.syncLedger.acknowledgedThrough,50);
  await p.reopen();await p.both('queuePatch',item(0,{id:'r:0'}));
});

test('SQLite-only fresh process reconstructs full state without JSON control files',async t=>{
  const p=await pair(t);await p.both('queuePatch',item(1));await p.both('markSynced',['r2-1']);await p.both('markAcknowledged',['r2-1']);
  await p.both('applyDelta',{...item(2),revision:8,baseRevision:0,deviceId:'fresh-remote',localSequence:2,seen:{}});
  await p.both('tombstone',item(3,{id:'deleted-in-fresh-process'}));
  const expected=await p.equal();p.stores[1].close();
  // A child directly imports only SQLite adapter, no createLocalDb module.
  const childEnv={...process.env};delete childEnv.NODE_TEST_CONTEXT;
  const output=path.join(p.dirs[1],'fresh-state.json');
  const result=spawnSync(process.execPath,[path.join(__dirname,'reopen-check.cjs'),path.join(p.dirs[1],'prototype.sqlite'),output],{encoding:'utf8',env:childEnv});
  assert.equal(result.error,undefined,'fresh process must launch without a spawn error');
  assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(await fsp.readFile(output,'utf8')),expected);
});

test('SQL abort rolls back record/event/revision/HLC/conflict/ACK metadata; five reopen cycles release handles',async t=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'sqlite-r2-cycles-'));
  t.after(()=>fsp.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'prototype.sqlite');let expected;
  const sqlHandles=()=>fs.readdirSync('/proc/self/fd').filter(fd=>{try{return fs.readlinkSync(`/proc/self/fd/${fd}`).startsWith(file);}catch{return false;}}).length;
  const timers=()=>process.getActiveResourcesInfo().filter(n=>n==='Timeout').length;
  for(let n=0;n<5;n++) {
    const baselineTimers=timers();
    const db=open('sqlite',root);await db.ensure();if(!n)await db.initialize();else assert.deepEqual(await db.read(),expected);
    await db.queuePatch(item(n,{id:`r:${n}`}));
    const before=await db.read();
    db.db.exec("CREATE TEMP TRIGGER abort_event BEFORE INSERT ON events WHEN NEW.event_id='forced-failure' BEGIN SELECT RAISE(ABORT,'isolated SQL fault'); END");
    const retry=item(50+n,{id:`retry:${n}`});
    assert.throws(()=>db.queuePatches([retry,item(99,{eventId:'forced-failure'})]),/isolated SQL fault/);
    assert.deepEqual(await db.read(),before,'all state remains unchanged after actual SQL write failure');
    assert.equal(db.db.isTransaction,false);
    db.db.exec('DROP TRIGGER abort_event');
    const retried=await db.queuePatch(retry);assert.equal(retried.duplicate,false);
    assert.equal(retried.localSequence,before.localSequence+1);assert.equal(retried.revision,before.revision+1);
    assert.equal((await db.queuePatch(retry)).duplicate,true,'accepted retry is applied once');
    await db.markSynced([`r2-${n}`]);await db.markAcknowledgedThrough(n+1);
    const statement=db.db.prepare('SELECT count(*) FROM events');
    expected=await db.read();db.close();db.close();assert.equal(sqlHandles(),0);
    assert.throws(()=>statement.get(),/finalized|closed/i);assert(timers()<=baselineTimers,'no pending timer work');
    assert.throws(()=>db.read(),/closed/i);
  }
});

test('returned read/record/receipt/pending/conflict objects and input patches cannot mutate SQLite state',async t=>{
  const p=await pair(t),db=p.stores[1];const e=item(1,{patch:{nested:{list:[1,2]}}});
  const receipt=await db.queuePatch(e),before=await db.read();
  e.patch.nested.list.push(3);receipt.record.nested.list.push(4);
  const read=await db.read();read.records['record:r2'].nested.list.push(5);read.syncLedger.ranges.push({bad:1});
  (await db.pending(1))[0].patch.nested.list.push(6);(await db.get('record:r2')).nested.list.push(7);
  assert.deepEqual(await db.read(),before);db.close();
  const fresh=open('sqlite',p.dirs[1]);assert.deepEqual(await fresh.read(),before);fresh.close();
});

test('different authorized owners conflict; current/custom/delete resolutions and rejected deltas preserve state',async t=>{
  const p=await pair(t);
  for(const s of p.stores)p.raw(s).setSharedOwnerResolver(()=>({known:true,allowed:true}));
  const id='cp-order:two-owners';
  await p.both('queuePatch',item(1,{id,patch:{suppFob:10}}));
  const remote=(n,extra={})=>({...item(n,{id,userId:'owner-b',patch:{suppFob:30}}),revision:n+10,baseRevision:0,deviceId:'owner-b-device',localSequence:n,seen:{},...extra});
  let receipt=await p.both('applyDelta',remote(2));assert.equal(receipt.conflicts.length,1);
  await p.both('resolveConflict',receipt.conflicts[0].conflictId,'current');
  assert.equal((await p.equal()).records[id].suppFob,10);
  receipt=await p.both('applyDelta',remote(3));
  await p.both('resolveConflict',receipt.conflicts[0].conflictId,'incoming',0);
  assert.equal((await p.equal()).records[id].suppFob,0);
  receipt=await p.both('applyDelta',remote(4,{delete:true}));
  const before=await p.equal();
  for(const s of p.stores)await assert.rejects(async()=>p.raw(s).resolveConflict(receipt.conflicts[0].conflictId,'invalid'),/seçimi/);
  assert.deepEqual(await p.equal(),before);
  await p.both('resolveConflict',receipt.conflicts[0].conflictId,'incoming');
  assert.equal((await p.equal()).records[id],undefined);
  const stable=await p.equal();
  for(const delta of [remote(7,{sha256:'bad'}),remote(8,{hlc:{wallMs:-1,counter:0,node:'bad'}}),remote(9,{coverFromSeq:10}),remote(10,{id:''})]) {
    for(const s of p.stores)await assert.rejects(async()=>p.raw(s).applyDelta(delta));
    assert.deepEqual(await p.equal(),stable);
  }
  await p.reopen();
});

test('SQL failure during conflict, upload, ACK or resolution leaves all tables and receipts unchanged',async t=>{
  const p=await pair(t),db=p.stores[1];await db.queuePatch(item(1));
  const delta={...item(2),revision:7,baseRevision:0,deviceId:'remote',localSequence:1,seen:{}};
  const before=await db.read();
  const fail=()=>db.db.exec("CREATE TEMP TRIGGER abort_save BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'state save fault'); END; CREATE TEMP TRIGGER abort_envelope BEFORE INSERT ON meta BEGIN SELECT RAISE(ABORT,'state save fault'); END");
  const drop=()=>db.db.exec('DROP TRIGGER abort_save; DROP TRIGGER abort_envelope');
  for(const apply of [()=>db.applyDelta(delta),()=>db.markSynced(['r2-1']),()=>db.markAcknowledged(['r2-1']),()=>db.markAcknowledgedThrough(1)]) {
    fail();assert.throws(apply,/state save fault/);drop();assert.deepEqual(await db.read(),before);assert.equal(db.db.isTransaction,false);
  }
  const receipt=await db.applyDelta(delta),conflicted=await db.read();
  const listed=await db.listConflicts();listed[0].incoming=999;
  assert.deepEqual(await db.read(),conflicted,'listed conflicts are isolated');
  fail();assert.throws(()=>db.resolveConflict(receipt.conflicts[0].conflictId,'incoming'),/state save fault/);drop();
  assert.deepEqual(await db.read(),conflicted,'resolution patch and conflict flag roll back together');
  db.close();const fresh=open('sqlite',p.dirs[1]);assert.deepEqual(await fresh.read(),conflicted);fresh.close();
});

test('two SQLite handles observe committed state and duplicate receipts without stale in-memory metadata',async t=>{
  const p=await pair(t),first=p.stores[1],second=open('sqlite',p.dirs[1]);t.after(()=>second.close());
  const a=await first.queuePatch(item(1));assert.deepEqual(await second.read(),await first.read());
  const duplicate=await second.queuePatch(item(1));assert.equal(duplicate.duplicate,true);assert.equal(duplicate.revision,a.revision);
  await second.markSynced(['r2-1']);assert.equal(await first.pendingCount(),0);assert.equal(await first.unacknowledgedCount(),1);
  await first.markAcknowledgedThrough(1);assert.equal(await second.unacknowledgedCount(),0);
  assert.deepEqual(await second.read(),await first.read());
});

test('batch CAS assertion and malformed/local-owner rejection leave both engines unchanged',async t=>{
  const p=await pair(t);await p.both('queuePatch',item(1));const before=await p.equal();
  for(const s of p.stores) {
    await assert.rejects(async()=>p.raw(s).queuePatches([item(2)],{assertCurrent(state){assert.deepEqual(state,before);throw Object.assign(Error('stale revision'),{code:'R2_CAS'});}}),{code:'R2_CAS'});
    await assert.rejects(async()=>p.raw(s).queuePatch({id:'',patch:{x:1}}),/record id/);
    p.raw(s).setSharedOwnerResolver(()=>({known:true,allowed:false}));
    await assert.rejects(async()=>p.raw(s).queuePatches([item(3),item(4,{id:'cp-order:denied',patch:{dates:null}})]),{code:'ORDER_SHARED_OWNER_ONLY'});
  }
  assert.deepEqual(await p.equal(),before);await p.reopen();
});
