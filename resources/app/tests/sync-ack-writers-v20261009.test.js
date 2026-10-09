'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createLocalDb}=require('../server/lib/local-db');const {createSyncSettings}=require('../server/lib/sync-settings');
async function topology(t){const root=await fsp.mkdtemp(path.join(os.tmpdir(),'bl-ack-writers-'));t.after(()=>fsp.rm(root,{recursive:true,force:true}));const shared=path.join(root,'shared');await fsp.mkdir(shared);const devices=[0,1].map(i=>{const db=createLocalDb(path.join(root,String(i),'db')),traces=[];const sync=createSyncSettings({localDb:db,localDataRoot:path.join(root,'settings'+i),trace:(name,detail)=>traces.push({name,detail})});return {db,sync,traces};});for(const d of devices){await d.sync.save(shared);await d.sync.syncOnce();}await devices[0].sync.syncOnce();return {root,shared,devices};}
test('three bundles from one source write exactly one checkpoint ACK and no package ACK',async t=>{
 const {shared,devices:[a,b]}=await topology(t);await a.db.queuePatches(Array.from({length:1200},(_,i)=>({id:'row'+i,patch:{v:i}})));assert.equal((await a.sync.syncOnce()).uploadedPackages,3);
 b.traces.length=0;assert.equal((await b.sync.syncOnce()).downloadedPackages,3);const writes=b.traces.filter(x=>x.name==='SYNC_CHECKPOINT_ACK_WRITTEN');assert.equal(writes.length,1);assert.equal(writes[0].detail.lastContiguousSequence,1200);
 const ackRoot=path.join(shared,'BUYER_LOG_SYNC','acks',encodeURIComponent(a.db.getDeviceId()));assert.deepEqual(await fsp.readdir(ackRoot),[encodeURIComponent(b.db.getDeviceId())+'.json']);
 assert.equal((await a.sync.syncOnce()).pendingAck,0);b.traces.length=0;assert.equal((await b.sync.syncOnce()).downloadedPackages,0);assert.equal(b.traces.filter(x=>x.name==='SYNC_CHECKPOINT_ACK_WRITTEN').length,0);
});
test('old peer package ACK stays readable and its old folder is pruned with the bundle',async t=>{
 const {shared,devices:[a]}=await topology(t);await a.db.queuePatch({id:'old-peer',patch:{v:1}});await a.sync.syncOnce();const source=encodeURIComponent(a.db.getDeviceId()),bundleRoot=path.join(shared,'BUYER_LOG_SYNC','changes',source,'bundles'),[name]=await fsp.readdir(bundleRoot);const packageId=name.replace(/\.sync\.gz$|\.ready$/,'').split('-').slice(2).join('-');
 const ackRoot=path.join(shared,'BUYER_LOG_SYNC','acks',source,'packages',packageId);await fsp.mkdir(ackRoot,{recursive:true});await fsp.writeFile(path.join(ackRoot,'old-reader.json'),JSON.stringify({version:2,lastSeq:1}));assert.equal((await a.sync.syncOnce()).pendingAck,0);
 await a.sync.saveRetentionDays(7);const old=new Date(Date.now()-8*86400000);await fsp.utimes(path.join(bundleRoot,name),old,old);assert.equal((await a.sync.syncOnce()).prunedPackages,1);await assert.rejects(fsp.stat(ackRoot),e=>e.code==='ENOENT');
});
test('business checkpoint publication and scheduling are both Moderator-only',()=>{
 const source=require('node:fs').readFileSync(path.join(__dirname,'../server/server.js'),'utf8');assert.match(source,/async function publishBusinessCheckpoint\(actorId=''\) \{\s*if \(!moderatorActiveOnThisDevice\(\)\)/);assert.match(source,/function scheduleBusinessCheckpointPublish[^]*?if\(!moderatorActiveOnThisDevice\(\) \|\| businessCheckpointTimer\)return/);assert.doesNotMatch(source,/BUSINESS_CHECKPOINT_PEER_INTERVAL_MS/);
});
