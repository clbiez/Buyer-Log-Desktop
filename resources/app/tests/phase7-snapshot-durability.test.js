'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {createLocalDb}=require('../server/lib/local-db'),{jsonToBuffer}=require('../server/lib/large-json');
async function fixture(t,encodeSnapshot){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-snapshot-durable-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));const file=path.join(root,'BuyerLogLocal.db'),db=createLocalDb(file,{encodeSnapshot});await db.ensure();await db.queuePatch({id:'before',patch:{n:1}});return {root,file,db,wal:file+'.wal'};}
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:()=>resolve()};};
test('DS-08: encoder failure cannot rotate WAL or expose an uncommitted cached mutation',async t=>{
 const box=await fixture(t,async()=>{throw Object.assign(Error('synthetic encoding failure'),{code:'EIO'});});
 const before=await fsp.readFile(box.file),wal=await fsp.readFile(box.wal);
 await assert.rejects(box.db.transaction(state=>{state.records.uncommitted={n:9};}),{code:'EIO'});
 assert.deepEqual(await fsp.readFile(box.file),before);assert.deepEqual(await fsp.readFile(box.wal),wal);
 assert.equal((await box.db.read()).records.uncommitted,undefined);assert.equal((await createLocalDb(box.file).read()).records.before.n,1);
});
test('DS-08: returned generation mismatch rejects and releases bytes before any durable change',async t=>{
 let released=0;const box=await fixture(t,async state=>({value:{buffer:jsonToBuffer(state),revision:state.revision+1},release:()=>released++}));
 const before=await fsp.readFile(box.file),wal=await fsp.readFile(box.wal);
 await assert.rejects(box.db.transaction(()=>{}),{code:'DATA_INTEGRITY_ERROR'});assert.equal(released,1);
 assert.deepEqual(await fsp.readFile(box.file),before);assert.deepEqual(await fsp.readFile(box.wal),wal);
});
test('DS-08: the database lease covers async encoding and the following writer remains replayable',async t=>{
 const started=deferred(),resume=deferred();let released=0;
 const box=await fixture(t,async state=>{started.resolve();await resume.promise;return {value:{buffer:jsonToBuffer(state),revision:state.revision},release:()=>released++};});
 const checkpoint=box.db.transaction(()=>{});await Promise.race([started.promise,checkpoint.then(()=>{throw Error('checkpoint bypassed the encoder');})]);let completed=false;
 const next=box.db.queuePatch({id:'after',patch:{n:2}}).then(()=>completed=true);
 await new Promise(setImmediate);assert.equal(completed,false);assert.ok(fs.existsSync(box.wal));resume.resolve();await Promise.all([checkpoint,next]);
 assert.equal(released,1);const cold=await createLocalDb(box.file).read();assert.equal(cold.records.before.n,1);assert.equal(cold.records.after.n,2);
});
test('DS-08: changing the database location while encoding cannot checkpoint into the new location',async t=>{
 const started=deferred(),resume=deferred();let released=0;
 const box=await fixture(t,async state=>{started.resolve();await resume.promise;return {value:{buffer:jsonToBuffer(state),revision:state.revision},release:()=>released++};});
 const checkpoint=box.db.transaction(()=>{});const rejected=assert.rejects(checkpoint,{code:'DATA_INTEGRITY_ERROR'});rejected.catch(()=>{});await Promise.race([started.promise,checkpoint.then(()=>{throw Error('checkpoint bypassed the encoder');})]);
 const target=path.join(box.root,'other');box.db.setFolder(target);resume.resolve();await rejected;
 assert.equal(released,1);assert.equal(fs.existsSync(path.join(target,'BuyerLogLocal.db')),false);assert.ok(fs.existsSync(box.wal));
 assert.equal((await createLocalDb(box.file).read()).records.before.n,1);
});
