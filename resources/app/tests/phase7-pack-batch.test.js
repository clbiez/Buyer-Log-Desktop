'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os');
const {createSharedImageStore}=require('../server/lib/shared-image-store');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-pack-batch-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));const store=id=>createSharedImageStore({getSharedSyncRoot:async()=>root,getDeviceId:()=>id});return {root,store};}
const entries=(count=200)=>Array.from({length:count},(_,i)=>({canonicalKey:'plm:'+i,source:'PLM',mimeType:'image/jpeg',buffer:Buffer.alloc(4096,i)}));
test('INT-05: publication groups append/fsync by content shard and keeps each locator readable',async t=>{
 const {store}=fixture(t),shared=store('a'),list=entries();let syncs=0;const open=fsp.open;
 fsp.open=async function(...args){const handle=await open.apply(this,args);if(String(args[0]).endsWith('.blpack')){const sync=handle.sync.bind(handle);handle.sync=async()=>{syncs++;return sync();};}return handle;};
 try{const result=await shared.publish(list);assert.equal(result.published,200);assert.ok(syncs<=16,`pack fsyncs: ${syncs}`);}finally{fsp.open=open;}
 for(const entry of list)assert.deepEqual(await shared.readObject(await shared.lookup(entry.canonicalKey)),entry.buffer);
 const duplicate=await shared.publish(list);assert.equal(duplicate.reused,200);
});
test('INT-05: a failed pack fsync cannot publish locators or a visible manifest',async t=>{
 const {root,store}=fixture(t),shared=store('a'),open=fsp.open;
 fsp.open=async function(...args){const handle=await open.apply(this,args);if(String(args[0]).endsWith('.blpack'))handle.sync=async()=>{throw Object.assign(Error('synthetic disk failure'),{code:'EIO'});};return handle;};
 try{await assert.rejects(shared.publish(entries(5)),{code:'EIO'});}finally{fsp.open=open;}
 assert.equal(fs.existsSync(path.join(root,'model-images','manifests','a.json')),false);
 assert.equal((await shared.listDeviceHeads()).length,0);
 assert.equal((await shared.publish(entries(5))).published,5);
 for(const entry of entries(5))assert.deepEqual(await shared.readObject(await shared.lookup(entry.canonicalKey)),entry.buffer);
});
for(const phase of ['pack-sync','packs','content-index','manifests','heads'])test(`INT-05: SIGKILL at ${phase} leaves no visible undurable image and restart can republish`,{timeout:20000},async t=>{
 const {root,store}=fixture(t),cp=require('node:child_process'),{once}=require('node:events');
 const child=cp.fork(path.join(__dirname,'helpers/phase7-pack-child.cjs'),[path.resolve(__dirname,'..'),root,phase,'crashed'],{stdio:['ignore','ignore','ignore','ipc']});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});const exited=once(child,'exit');
 const [message]=await once(child,'message');assert.equal(message.phase,phase);child.kill('SIGKILL');await exited;
 const restarted=store('crashed');assert.equal((await restarted.listDeviceHeads()).length,0);
 const report=await restarted.publish(entries(5));assert.equal(report.published,5);
 for(const entry of entries(5))assert.deepEqual(await restarted.readObject(await restarted.lookup(entry.canonicalKey)),entry.buffer);
});
test('INT-05: concurrent processes deduplicate the same bytes under shard leases',async t=>{
 const {root,store}=fixture(t),cp=require('node:child_process'),{once}=require('node:events');
 const jobs=['a','b'].map(device=>{const child=cp.fork(path.join(__dirname,'helpers/phase7-pack-child.cjs'),[path.resolve(__dirname,'..'),root,'complete',device],{stdio:['ignore','ignore','ignore','ipc']});const exited=once(child,'exit');return {child,exited,message:once(child,'message')};});
 t.after(()=>jobs.forEach(({child})=>{if(child.exitCode===null)child.kill('SIGKILL');}));
 const results=await Promise.all(jobs.map(async({exited,message})=>{const [result]=await message;assert.ok(result.done,JSON.stringify(result));await exited;return result.done;}));
 assert.equal(results.reduce((sum,item)=>sum+item.reused,0),5);
 for(const entry of entries(5))assert.deepEqual(await store('reader').readObject(await store('reader').lookup(entry.canonicalKey)),entry.buffer);
});
test('INT-05: short native writes are completed before publishing a locator',async t=>{
 const {store}=fixture(t),shared=store('a'),open=fsp.open;
 fsp.open=async function(...args){const handle=await open.apply(this,args);if(String(args[0]).endsWith('.blpack')){const write=handle.write.bind(handle);handle.write=(buffer,offset,length,position)=>write(buffer,offset,Math.min(17,length),position);}return handle;};
 try{assert.equal((await shared.publish(entries(2))).published,2);}finally{fsp.open=open;}
 for(const entry of entries(2))assert.deepEqual(await shared.readObject(await shared.lookup(entry.canonicalKey)),entry.buffer);
});
test('INT-05: pack rollover preserves the 64 MiB cap and exact slice offsets',async t=>{
 const {root,store}=fixture(t),shared=store('a'),list=entries(2).map((entry,i)=>({...entry,buffer:Buffer.alloc(33*1024*1024,i)}));
 await shared.publish(list);const records=[];
 for(const entry of list){const record=await shared.lookup(entry.canonicalKey);records.push(record);assert.ok(fs.statSync(path.join(root,'model-images',record.packPath)).size<=64*1024*1024);assert.deepEqual(await shared.readObject(record),entry.buffer);}
 assert.notEqual(records[0].packPath,records[1].packPath);assert.equal(records[0].packOffset,0);assert.equal(records[1].packOffset,0);
});
