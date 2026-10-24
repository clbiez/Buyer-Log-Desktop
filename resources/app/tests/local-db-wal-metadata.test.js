'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createLocalDb}=require('../server/lib/local-db');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'buyerlog-wal-metadata-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const file=path.join(root,'BuyerLogLocal.db'),db=createLocalDb(file);await db.ensure();return {root,file,wal:file+'.wal',db};}

test('warm single-writer appends never reread the accumulated WAL to count entries',async t=>{
 const box=await fixture(t);await box.db.queuePatch({id:'warm',patch:{n:0}});
 const original=fs.readFile;let reads=0,bytes=0;
 fs.readFile=async function(file,...rest){const value=await original.call(this,file,...rest);if(String(file)===box.wal){reads++;bytes+=Buffer.byteLength(value);}return value;};
 try{for(let i=1;i<=120;i++)await box.db.queuePatch({id:'warm',patch:{n:i}});}finally{fs.readFile=original;}
 assert.equal(reads,0,`${reads} full WAL reads consumed ${bytes} bytes during warm appends`);
 assert.equal((await createLocalDb(box.file).read()).records.warm.n,120);
});

test('external writer invalidates both counters and cached business state',async t=>{
 const box=await fixture(t);await box.db.queuePatch({id:'shared',patch:{first:1}});
 await createLocalDb(box.file).queuePatch({id:'shared',patch:{second:2}});
 await box.db.queuePatch({id:'shared',patch:{third:3}});
 const cold=await createLocalDb(box.file).read();
 for(const key of ['first','second','third'])assert.equal(cold.records.shared[key],{first:1,second:2,third:3}[key]);
 assert.equal(cold.journal.length,3);
});

test('a failed partial append invalidates metadata and the next save repairs the actual tail',async t=>{
 const box=await fixture(t);await box.db.queuePatch({id:'safe',patch:{n:1}});
 const original=fs.open;
 fs.open=async (...args)=>{const handle=await original(...args);if(String(args[0])===box.wal&&args[1]==='a'){const write=handle.writeFile.bind(handle);handle.writeFile=async value=>{await write(String(value).slice(0,20));throw Object.assign(new Error('synthetic partial append'),{code:'EIO'});};}return handle;};
 try{await assert.rejects(box.db.queuePatch({id:'rejected',patch:{n:2}}),{code:'EIO'});}finally{fs.open=original;}
 assert.equal((await box.db.read()).records.rejected,undefined);
 await box.db.queuePatch({id:'after',patch:{n:3}});
 const cold=await createLocalDb(box.file).read();
 assert.equal(cold.records.safe.n,1);assert.equal(cold.records.after.n,3);assert.equal(cold.records.rejected,undefined);
 assert.ok((await fs.readdir(box.root)).some(name=>name.startsWith('BuyerLogLocal.db.wal.corrupt-')));
});

test('same-size WAL replacement with restored mtime cannot reuse stale counters or records',async t=>{
 const box=await fixture(t);await box.db.queuePatch({id:'old',patch:{n:1}});
 const before=await fs.stat(box.wal),entry=JSON.parse((await fs.readFile(box.wal,'utf8')).trim());
 entry.payload.id='new';
 entry.sha256=crypto.createHash('sha256').update(JSON.stringify({v:entry.v,op:entry.op,payload:entry.payload})).digest('hex');
 const replacement=box.wal+'.replacement';await fs.writeFile(replacement,JSON.stringify(entry)+'\n');
 await fs.utimes(replacement,before.atime,before.mtime);await fs.rename(replacement,box.wal);
 assert.equal((await fs.stat(box.wal)).size,before.size);
 await box.db.queuePatch({id:'after',patch:{n:2}});
 const cold=await createLocalDb(box.file).read();
 assert.equal(cold.records.old,undefined);assert.equal(cold.records.new.n,1);assert.equal(cold.records.after.n,2);
});

test('entry counter crosses the 2000-entry checkpoint boundary without losing 2100 durable saves',async t=>{
 const box=await fixture(t);
 for(let i=0;i<2100;i++)await box.db.queuePatch({id:'counter',patch:{n:i}});
 const snapshot=JSON.parse(await fs.readFile(box.file,'utf8'));
 assert.equal(snapshot.records.counter.n,2000,'checkpoint must happen when the entry limit is exceeded');
 const cold=await createLocalDb(box.file).read();
 assert.equal(cold.records.counter.n,2099);assert.equal(cold.journal.length,2100);
 assert.equal(cold.localSequence,2100);
});
