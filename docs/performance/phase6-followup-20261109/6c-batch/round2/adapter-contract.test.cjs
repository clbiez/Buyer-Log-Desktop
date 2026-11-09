'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), fsp = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const app = path.resolve(process.env.PHASE6C_APP);
const { createLocalDb } = require(path.join(app,'server/lib/local-db'));
const { createDeltaStore } = require(path.join(app,'server/lib/delta-store'));

async function box(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-6c-test-'));
  const db = createLocalDb(path.join(root,'local.db')); await db.ensure();
  const errors=[],store = createDeltaStore({localDb:db,onError:(stage,error)=>errors.push(error.code),onTrace:()=>{}}); await store.hydrate();
  t.after(async()=>{await store.flush();await fsp.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50});});
  return {db,store,errors};
}

test('6c: ordered heterogeneous patches share one journal turn and preserve per-event metadata',async t=>{
  const {db,store}=await box(t), calls=[];
  const queue=db.queuePatches;db.queuePatches=(items,options)=>{calls.push(items);return queue(items,options);};
  const patches=[
    {id:'a',patch:{dates:{retail:'2026-12-01'},notes:{Notes:'x'}},userId:'owner',subfields:{dates:['retail']}},
    {id:'b',patch:{shortage:false,suppFob:0,notes:null},userId:'other'},
    {id:'a',patch:{dates:{retail:'2026-12-01',mb:'2026-12-15'}},userId:'owner',subfields:{dates:['mb']}},
    {id:'b',patch:{shortage:false,suppFob:0,notes:null},userId:'other'},
  ];
  const pending=store.mirrorBatch('cp-order',patches);
  assert.deepEqual(store.readAllSync('cp-order').a.dates,patches[2].patch.dates,'staging stays synchronous');
  await pending;await store.flush();
  assert.equal(calls.length,1);assert.equal(calls[0].length,3,'same no-op suppression as sequential mirrors');
  const state=await db.read();assert.equal(state.journal.length,3);
  assert.deepEqual(state.journal.map(e=>[e.id,e.userId,e.subfields]),[
    ['cp-order:a','owner',{dates:['retail']}],['cp-order:b','other',undefined],['cp-order:a','owner',{dates:['mb']}],
  ]);
  assert.deepEqual((await createLocalDb(db.file).read()).journal,state.journal,'replay preserves event identities and order');
});

test('6c: owner validation failure preserves valid individual mirrors and rollback',async t=>{
  const {db,store,errors}=await box(t);
  db.setSharedOwnerResolver((id,user)=>({known:true,allowed:user==='owner'}));
  await store.mirrorBatch('cp-order',[
    {id:'allowed',patch:{dates:{ex:'2026-12-01'}},userId:'owner',subfields:{dates:['ex']}},
    {id:'denied',patch:{dates:{ex:'2026-12-02'}},userId:'foreign',subfields:{dates:['ex']}},
    {id:'notes',patch:{notes:{Notes:'personal'}},userId:'foreign'},
  ]);
  await store.flush();
  const state=await db.read();assert.ok(state.records['cp-order:allowed']);assert.ok(state.records['cp-order:notes']);
  assert.equal(state.records['cp-order:denied'],undefined);assert.equal(store.readAllSync('cp-order').denied,undefined);
  assert.deepEqual(errors,['ORDER_SHARED_OWNER_ONLY']);
});

test('6c: delayed/error mirror stays in flush and cannot rollback a later stage',async t=>{
  const {db,store,errors}=await box(t);let release;
  const gate=new Promise(resolve=>{release=resolve;}),queue=db.queuePatches;
  let first=true;db.queuePatches=async(...args)=>{if(first){first=false;await gate;throw Object.assign(new Error('disk'),{code:'ENOSPC'});}return queue(...args);};
  const a=store.mirrorBatch('cp-order',[{id:'a',patch:{notes:{Notes:'old'}}},{id:'b',patch:{notes:null}}]);
  const b=store.mirror('cp-order',{a:{notes:{Notes:'new'}}});let flushed=false;const flush=store.flush().then(()=>{flushed=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(flushed,false);release();
  await Promise.all([a,b,flush]);assert.deepEqual(errors,['ENOSPC','ENOSPC']);
  assert.equal(store.readAllSync('cp-order').a.notes.Notes,'new');assert.equal(store.readAllSync('cp-order').b,undefined);
  assert.equal((await db.read()).records['cp-order:a'].notes.Notes,'new');
});

test('6c: two journal writers and duplicate delivery preserve events, receipts and subfields',async t=>{
  const {db,store}=await box(t),peer=createLocalDb(db.file),other=createDeltaStore({localDb:peer,onTrace:()=>{}});
  await other.hydrate();
  await Promise.all([
    store.mirrorBatch('cp-order',[{id:'line',patch:{notes:{Notes:'A'}}},{id:'another',patch:{shortage:false}}]),
    other.mirror('cp-order',{line:{dates:{retail:'2026-12-01'}}},{userId:'owner',subfields:{dates:['retail']}}),
  ]);
  await Promise.all([store.flush(),other.flush()]);
  const state=await createLocalDb(db.file).read();assert.equal(state.journal.length,3);
  assert.equal(state.records['cp-order:line'].notes.Notes,'A');assert.equal(state.records['cp-order:line'].dates.retail,'2026-12-01');
  const observer=createLocalDb(path.join(path.dirname(db.file),'observer.db'));await observer.ensure();
  const first=await observer.applyDeltas(state.journal),second=await observer.applyDeltas(state.journal);
  assert.equal(first.applied,3);assert.equal(second.duplicates,3);
  assert.equal((await observer.read()).records['cp-order:line'].notes.Notes,'A');
});

test('6c: real patchOrderOverrides preserves JSON ACK, conflicts and mirror failure isolation',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-6c-db-'));
  const variables={BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local')};
  const previous=Object.fromEntries(Object.keys(variables).map(key=>[key,process.env[key]]));
  const serverRoot=path.join(app,'server')+path.sep;
  const reset=()=>{for(const key of Object.keys(require.cache))if(key.startsWith(serverRoot))delete require.cache[key];};
  Object.assign(process.env,variables);reset();
  const primary=require(path.join(app,'server/db')),{createLocalDb:makeDb}=require(path.join(app,'server/lib/local-db')),{createDeltaStore:makeStore}=require(path.join(app,'server/lib/delta-store'));
  const local=makeDb(path.join(root,'local','local.db'));await local.ensure();const errors=[],store=makeStore({localDb:local,onTrace:()=>{},onError:(stage,error)=>errors.push(error.code)});await store.hydrate();primary.attachDeltaStore(store);
  t.after(async()=>{await store.flush();primary.attachDeltaStore(null);for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}reset();await fsp.rm(root,{recursive:true,force:true,maxRetries:30,retryDelay:50});});
  const queue=local.queuePatches,calls=[];local.queuePatches=(items,options)=>{calls.push(items);return queue(items,options);};
  for(const count of [1,100,1000]){
    const items=Array.from({length:count},(_,i)=>({orderCode:810000+i,patch:{notes:{Notes:`n${count}-${i}`},dates:i%2?{retailDate:'2026-12-01'}:{inStoreDate:null},suppFob:0,shortage:false}}));
    const before=calls.length,ack=primary.patchOrderOverrides(items,null,null,{actor:{id:'owner'}});assert.equal(ack.updated,count);await store.flush();
    assert.equal(calls.slice(before).filter(items=>items[0].entityType==='cp-order').length,1,'one CP queuePatches invocation');
    const json=JSON.parse(fs.readFileSync(path.join(root,'server','overrides.json'),'utf8'));
    assert.deepEqual(json.notesmap,ack.overrides.notesmap);assert.equal(json.suppfobmap['810000'],0);
    const state=await local.read();assert.equal(state.records['cp-order:810000'].notes.Notes,`n${count}-0`);
  }
  const saved=primary.loadOverrides(),before=calls.length;
  assert.throws(()=>primary.patchOrderOverrides([{orderCode:810000,patch:{notes:{Notes:'stale'}}}],saved._revisions.orders+1),e=>e.code==='REVISION_CONFLICT');
  await store.flush();assert.equal(calls.length,before);
  local.queuePatches=(items,options)=>items[0].entityType==='cp-order'?Promise.reject(Object.assign(new Error('disk'),{code:'ENOSPC'})):queue(items,options);
  const ack=primary.patchOrderOverrides([{orderCode:810000,patch:{notes:{Notes:'primary survives'}}}]);assert.equal(ack.updated,1);await store.flush();
  assert.equal(primary.loadOverrides().notesmap['810000'].Notes,'primary survives');assert.deepEqual(errors,['ENOSPC']);
  assert.equal((await local.read()).records['cp-order:810000'].notes.Notes,saved.notesmap['810000'].Notes,'failed mirror did not persist');
  const callCount=calls.length,rename=fs.renameSync;fs.renameSync=(from,to)=>{if(String(to)===path.join(root,'server','overrides.json'))throw Object.assign(new Error('disk full'),{code:'ENOSPC'});return rename(from,to);};
  try{assert.throws(()=>primary.patchOrderOverrides([{orderCode:810000,patch:{notes:{Notes:'must not mirror'}}}]),/disk full/);}finally{fs.renameSync=rename;}
  await store.flush();assert.equal(calls.length,callCount,'failed primary save must not dispatch mirrors');
});
