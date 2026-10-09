'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createLocalDb } = require('../server/lib/local-db');
const { compare } = require('../server/lib/hlc');
const { coalescePendingEvents } = require('../server/lib/sync-package');
const policy = require('../server/lib/shared-sync-policy');
async function root(t) { const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-hlc-db-')); t.after(() => fsp.rm(dir, { recursive:true,force:true })); return dir; }
const owner = (id,userId) => ({ known:true,allowed:userId==='alice' });

test('local journal clocks are monotonic across rollback, batch writes and independent concurrent DB handles', async t => {
  const dir = await root(t), file = path.join(dir,'local.db');
  let physical = 2000;
  const a=createLocalDb(file,{clock:()=>physical}), b=createLocalDb(file,{clock:()=>physical});
  await a.queuePatch({id:'cp-order:1',patch:{suppFob:1}});
  physical=1000;
  await Promise.all([a.queuePatch({id:'cp-order:2',patch:{suppFob:2}}),b.queuePatch({id:'cp-order:3',patch:{suppFob:3}})]);
  await a.queuePatches([{id:'cp-order:4',patch:{suppFob:4}},{id:'cp-order:5',patch:{suppFob:5}}]);
  await a.tombstone({id:'cp-order:5'});
  const state=await a.read();
  assert.equal(state.journal.length,6);
  for(let i=1;i<state.journal.length;i++)assert.ok(compare(state.journal[i].hlc,state.journal[i-1].hlc)>0);
  assert.equal(state.hlc.wallMs,2000);
  assert.deepEqual(state.hlc,state.journal.at(-1).hlc);
});

test('WAL replay restores exact recorded local, remote and package clocks without physical clock calls', async t => {
  const dir=await root(t),file=path.join(dir,'local.db');
  const db=createLocalDb(file,{clock:()=>1000});
  await db.queuePatch({id:'cp-order:1',patch:{suppFob:1}});
  await db.applyDelta({eventId:'remote',id:'cp-order:2',deviceId:'b',localSequence:1,patch:{suppFob:2},hlc:{wallMs:2000,counter:4,node:'b'}});
  await db.applyPackage({packageId:'p1',sourceDeviceId:'b',firstSeq:2,lastSeq:3,events:[
    {eventId:'r2',id:'cp-order:3',deviceId:'b',localSequence:2,patch:{suppFob:3},hlc:{wallMs:3000,counter:4,node:'b'}},
    {eventId:'r3',id:'cp-order:4',deviceId:'b',localSequence:3,patch:{suppFob:4},hlc:{wallMs:3000,counter:5,node:'b'}},
  ]});
  const before=await db.read();
  const reopened=createLocalDb(file,{clock(){throw new Error('replay must not tick');}});
  const after=await reopened.read();
  assert.deepEqual(after.hlc,before.hlc);
  assert.deepEqual(after.records,before.records);
  assert.deepEqual(after.journal,before.journal);
  assert.deepEqual(after.syncCheckpoints,before.syncCheckpoints);
});

test('future remote clock advances local state and emits trace while exact duplicate receives do not tick', async t => {
  const dir=await root(t),traces=[];
  const db=createLocalDb(path.join(dir,'local.db'),{clock:()=>1000,trace:(code,detail)=>traces.push({code,detail})});
  const remote={eventId:'r',id:'cp-order:1',deviceId:'b',localSequence:1,patch:{suppFob:1},hlc:{wallMs:1000000,counter:2,node:'b'}};
  await db.applyDelta(remote);
  const before=(await db.read()).hlc;
  await db.applyDelta(remote);
  assert.deepEqual((await db.read()).hlc,before);
  assert.equal(traces.length,1);
  assert.equal(traces[0].code,'SYNC_HLC_CLOCK_SKEW');
  await db.queuePatch({id:'cp-order:2',patch:{suppFob:2}});
  assert.ok(compare((await db.read()).journal.at(-1).hlc,remote.hlc)>0);
});

test('same-owner concurrent shared field writes use HLC instead of misleading at timestamps', async t => {
  const dir=await root(t),a=createLocalDb(path.join(dir,'a.db'),{clock:()=>1000000}),b=createLocalDb(path.join(dir,'b.db'),{clock:()=>1000});
  a.setSharedOwnerResolver(owner);b.setSharedOwnerResolver(owner);
  await a.queuePatch({id:'cp-order:1',userId:'alice',at:'2026-10-09T10:00:00Z',patch:{suppFob:10}});
  await b.queuePatch({id:'cp-order:1',userId:'alice',at:'2026-10-09T12:00:00Z',patch:{suppFob:20}});
  const ae=(await a.read()).journal[0],be=(await b.read()).journal[0];
  await a.applyDelta(be);await b.applyDelta(ae);
  assert.equal((await a.read()).records['cp-order:1'].suppFob,10);
  assert.equal((await b.read()).records['cp-order:1'].suppFob,10);
  assert.equal((await a.read()).conflicts.length,0);
  assert.equal((await b.read()).conflicts.length,0);
});

test('legacy remote events retain at/device fallback and do not manufacture a physical receive stamp', async t => {
  const dir=await root(t),db=createLocalDb(path.join(dir,'local.db'),{clock(){throw new Error('legacy event has no HLC');}});
  await db.applyDelta({eventId:'old',id:'cp-order:1',deviceId:'old',localSequence:1,at:'2020-01-01',patch:{suppFob:3}});
  assert.equal((await db.read()).hlc,null);
});

test('email ID merge uses item clocks, preserves untouched clocks and carries metadata outside business patch', async t => {
  const dir=await root(t),a=createLocalDb(path.join(dir,'a.db'),{clock:()=>1000000}),b=createLocalDb(path.join(dir,'b.db'),{clock:()=>1000});
  const id='store:email-groups.json';
  await a.queuePatch({id,patch:{records:[{id:'x',email:'a@demo.invalid',updatedAt:'2020-01-01'}]}});
  await b.queuePatch({id,patch:{records:[{id:'x',email:'b@demo.invalid',updatedAt:'2030-01-01'},{id:'y',email:'y@demo.invalid',updatedAt:'2030-01-01'}]}});
  const ae=(await a.read()).journal[0],be=(await b.read()).journal[0];
  assert.ok(ae.listClocks.records.x.hlc);
  assert.equal(ae.patch._listOrders,undefined);
  assert.ok(policy.sanitizeDelta(ae).listClocks.records.x.hlc);
  await a.applyDelta(be);await b.applyDelta(ae);
  for(const db of [a,b]){
    const rows=(await db.read()).records[id].records;
    assert.equal(rows.find(row=>row.id==='x').email,'a@demo.invalid');
    assert.ok(rows.some(row=>row.id==='y'));
  }
  const before=(await a.read()).records[id],rowClock=before._listOrders.records.x;
  await a.queuePatch({id,patch:{records:[...before.records,{id:'z',email:'z@demo.invalid',updatedAt:'2020-01-01'}]}});
  const latest=(await a.read()).journal.at(-1);
  assert.deepEqual(latest.listClocks.records.x,rowClock);
  assert.ok(compare(latest.listClocks.records.z.hlc,rowClock.hlc)>0);
});

test('email delete and resurrection decisions use clocks and do not lose unrelated IDs', async t => {
  const dir=await root(t),a=createLocalDb(path.join(dir,'a.db'),{clock:()=>2000}),b=createLocalDb(path.join(dir,'b.db'),{clock:()=>1000});
  const id='store:email-groups.json';
  await a.queuePatch({id,patch:{records:[{id:'x',email:'a',updatedAt:'2030-01-01'},{id:'y',email:'y',updatedAt:'2030-01-01'}]}});
  await b.applyDelta((await a.read()).journal[0]);
  await a.queuePatch({id,patch:{records:[{id:'y',email:'y',updatedAt:'2030-01-01'}],deletedRecords:{x:'2020-01-01'}}});
  await b.applyDelta((await a.read()).journal.at(-1));
  assert.deepEqual((await b.read()).records[id].records.map(row=>row.id),['y']);
  await b.queuePatch({id,patch:{records:[{id:'x',email:'restored',updatedAt:'2010-01-01'},{id:'y',email:'y',updatedAt:'2030-01-01'}]}});
  await a.applyDelta((await b.read()).journal.at(-1));
  assert.equal((await a.read()).records[id].records.find(row=>row.id==='x').email,'restored');
});

test('coalesced events carry the greatest HLC stamp while source sequence boundaries remain unchanged',()=>{
  const events=[{eventId:'a',id:'cp-order:1',deviceId:'a',localSequence:1,patch:{suppFob:1},hlc:{wallMs:2000,counter:3,node:'a'}},{eventId:'b',id:'cp-order:1',deviceId:'a',localSequence:2,patch:{suppFob:2},hlc:{wallMs:1000,counter:4,node:'a'}}];
  const merged=coalescePendingEvents(events);
  assert.equal(merged.length,1);
  assert.deepEqual(merged[0].hlc,events[0].hlc);
  assert.equal(merged[0].sourceFirstSeq,1);assert.equal(merged[0].sourceLastSeq,2);
});

test('malformed late event clocks or item clocks reject the entire batch before state or WAL mutation',async t=>{
  const dir=await root(t),file=path.join(dir,'local.db'),db=createLocalDb(file,{clock:()=>1000});
  await db.queuePatch({id:'cp-order:seed',patch:{suppFob:1}});
  const before=await db.read(),wal=await fsp.readFile(file+'.wal');
  const valid={eventId:'new-valid',id:'cp-order:new',deviceId:'remote',localSequence:1,patch:{suppFob:2},hlc:{wallMs:2000,counter:1,node:'remote'}};
  for(const invalid of [
    {eventId:'bad',id:'cp-order:bad',deviceId:'remote',localSequence:2,patch:{suppFob:3},hlc:{wallMs:-1,counter:0,node:'remote'}},
    {eventId:'bad-list',id:'store:email-groups.json',deviceId:'remote',localSequence:2,patch:{records:[]},listClocks:{records:{x:{hlc:{wallMs:1,counter:Infinity,node:'remote'}}}}},
  ]){
    await assert.rejects(db.applyDeltas([valid,invalid]));
    await assert.rejects(db.applyPackage({packageId:'bad-package',sourceDeviceId:'remote',firstSeq:1,lastSeq:2,events:[valid,invalid]}));
    assert.deepEqual(await db.read(),before);
    assert.deepEqual(await fsp.readFile(file+'.wal'),wal);
  }
});

test('coalescing unions per-item clocks and retains the greatest clock independently for each ID',()=>{
  const h=(wallMs,node='a')=>({wallMs,counter:0,node});
  const a={eventId:'a',id:'store:email-groups.json',deviceId:'a',localSequence:1,patch:{records:[]},hlc:h(2000),listClocks:{records:{x:{hlc:h(3000)},y:{hlc:h(1000)}},deletedRecords:{z:{hlc:h(4000)}}}};
  const b={eventId:'b',id:'store:email-groups.json',deviceId:'a',localSequence:2,patch:{records:[]},hlc:h(2500),listClocks:{records:{x:{hlc:h(2000)},y:{hlc:h(3500)},n:{hlc:h(2200)}}}};
  const merged=coalescePendingEvents([a,b])[0];
  assert.deepEqual(merged.listClocks.records.x.hlc,h(3000));
  assert.deepEqual(merged.listClocks.records.y.hlc,h(3500));
  assert.deepEqual(merged.listClocks.records.n.hlc,h(2200));
  assert.deepEqual(merged.listClocks.deletedRecords.z.hlc,h(4000));
  assert.deepEqual(merged.hlc,h(2500));
});

test('checkpoint recovery observes imported CP and email clocks before a new local edit and persists them',async t=>{
 const dir=await root(t),file=path.join(dir,'restored.db'),db=createLocalDb(file,{clock:()=>1000});
 const records={
  'cp-order:1':{suppFob:10,_fieldOrders:{suppFob:{hlc:{wallMs:900000,counter:4,node:'remote'}}}},
  'store:email-groups.json':{records:[{id:'x'}],_listOrders:{records:{x:{hlc:{wallMs:900000,counter:5,node:'remote'}}}}}
 };
 await db.transaction(state=>{db.mergeCheckpointClockState(state,records);Object.assign(state.records,records);});
 const stamp=(await db.read()).hlc;assert.ok(compare(stamp,records['store:email-groups.json']._listOrders.records.x.hlc)>0);
 const reopened=createLocalDb(file,{clock(){throw new Error('snapshot replay must not tick');}});assert.deepEqual((await reopened.read()).hlc,stamp);
 await db.queuePatch({id:'cp-order:1',patch:{suppFob:20}});assert.ok(compare((await db.read()).journal.at(-1).hlc,stamp)>0);
});

test('business patch metadata cannot poison validated email item clocks',async t=>{
 const dir=await root(t),db=createLocalDb(path.join(dir,'email.db'),{clock:()=>1000});
 await db.applyDelta({eventId:'spoof',id:'store:email-groups.json',deviceId:'remote',localSequence:1,patch:{records:[{id:'x',updatedAt:'2026-01-01'}],_listOrders:{records:{x:{hlc:{wallMs:-1,counter:0,node:'bad'}}}}}});
 await db.applyDelta({eventId:'valid',id:'store:email-groups.json',deviceId:'remote',localSequence:2,patch:{records:[{id:'x',email:'valid',updatedAt:'2026-02-01'}]},hlc:{wallMs:2000,counter:0,node:'remote'},listClocks:{records:{x:{hlc:{wallMs:2000,counter:0,node:'remote'}}}}});
 const record=(await db.read()).records['store:email-groups.json'];assert.equal(record.records[0].email,'valid');assert.equal(record._listOrders.records.x.hlc.wallMs,2000);
});
test('late HLC exhaustion leaves cached and reopened DB equal with no partial batch/package writes',async t=>{
 const dir=await root(t),file=path.join(dir,'exhaust.db'),db=createLocalDb(file,{clock:()=>1000});
 await db.queuePatch({id:'seed',patch:{value:1}});const before=JSON.parse(JSON.stringify(await db.read())),wal=await fsp.readFile(file+'.wal');
 const events=[{eventId:'first',id:'new',deviceId:'remote',localSequence:1,patch:{value:1},hlc:{wallMs:2000,counter:0,node:'remote'}},{eventId:'last',id:'last',deviceId:'remote',localSequence:2,patch:{value:2},hlc:{wallMs:Number.MAX_SAFE_INTEGER,counter:Number.MAX_SAFE_INTEGER,node:'remote'}}];
 for(const apply of [()=>db.applyDeltas(events),()=>db.applyPackage({packageId:'exhausted',sourceDeviceId:'remote',firstSeq:1,lastSeq:2,events})]){
  await assert.rejects(apply(),/HLC representation exhausted/);assert.deepEqual(await db.read(),before);assert.deepEqual(await createLocalDb(file).read(),before);assert.deepEqual(await fsp.readFile(file+'.wal'),wal);
 }
});
