'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {createLocalDb}=require('../server/lib/local-db');
const {createSyncSettings,writeValidatedJson}=require('../server/lib/sync-settings');
const {buildHealthReport}=require('../server/lib/sync-health');
const policy=require('../server/lib/shared-sync-policy');
const {filterCollectionWorkspaceDeltas}=require('../server/lib/collection-replication');
const filter=items=>policy.filterDeltas(filterCollectionWorkspaceDeltas(items));
test('two real devices publish equal settled health outside receiver package directories',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-health-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const shared=path.join(root,'shared');await fs.mkdir(shared);
  async function device(name){
    const db=createLocalDb(path.join(root,name,'BuyerLogLocal.db'));db.setTransportFilter(item=>filter([item]).length===1);
    const sync=createSyncSettings({localDataRoot:path.join(root,name,'settings'),localDb:db,filterIncomingDeltas:filter,filterOutgoingDeltas:filter,
      onSyncCompleted:async status=>writeValidatedJson(path.join(shared,'BUYER_LOG_SYNC','health',`${encodeURIComponent(db.getDeviceId())}.json`),
        buildHealthReport({state:await db.read(),status,deviceId:db.getDeviceId(),userId:name,appVersion:'test'}))});
    await sync.save(shared);return {db,sync};
  }
  const a=await device('a'),b=await device('b');
  await a.db.queuePatch({id:'cp-order:123',patch:{suppFob:7,notes:'local'}});
  for(const d of [a,b,a,b]){const status=await d.sync.syncOnce();assert.equal(status.online,true,status.lastError);assert.equal(status.corruptPackages,0);}
  const files=await fs.readdir(path.join(shared,'BUYER_LOG_SYNC','health'));assert.equal(files.length,2);
  const reports=await Promise.all(files.map(f=>fs.readFile(path.join(shared,'BUYER_LOG_SYNC','health',f),'utf8').then(JSON.parse)));
  assert.equal(reports[0].sharedHash,reports[1].sharedHash);assert.ok(reports.every(x=>x.settled));
  const state=await b.db.read();assert.equal(state.records['cp-order:123'].notes,undefined);
});
test('optional health I/O failure cannot fail successful sync or its receipt',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-health-failure-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const shared=path.join(root,'shared');await fs.mkdir(shared);const db=createLocalDb(path.join(root,'db'));
  const trace=[];const sync=createSyncSettings({localDataRoot:path.join(root,'settings'),localDb:db,
    onSyncCompleted:async()=>{throw new Error('health mirror offline');},trace:(name)=>trace.push(name)});
  await sync.save(shared);await db.queuePatch({id:'cp-order:123',patch:{suppFob:7}});
  const status=await sync.syncOnce();assert.equal(status.online,true);assert.equal(status.pendingUpload,0);assert.ok(trace.includes('SYNC_HEALTH_FAILED'));
});
test('health and diff endpoints are moderator-only and health UI is lazy',()=>{
  const fsSync=require('node:fs'),server=fsSync.readFileSync(path.join(__dirname,'../server/server.js'),'utf8');
  assert.match(server,/app\.get\('\/api\/sync-health', userAccess\.requireModerator/);
  assert.match(server,/app\.get\('\/api\/sync-health\/diff', userAccess\.requireModerator/);
  assert.match(server,/devices:classified\.devices\.map\(\(\{ recordHashes, \.\.\.summary \}\)/);
  const main=fsSync.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  assert.match(main,/if\(window\.BLIsModerator\?\.\(\)\)\{/);
  assert.match(main,/if\(!health\.open\)return;[\s\S]{0,150}ensureFeature\?\.\('syncHealth'\)/);
});
test('health timeout leaves publications serialized and coalesces the newest pending report',async t=>{
  const keepAlive=setInterval(()=>{},1000);t.after(()=>clearInterval(keepAlive));
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-health-timeout-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const shared=path.join(root,'shared');await fs.mkdir(shared);const db=createLocalDb(path.join(root,'db'));
  let release;const blocked=new Promise(resolve=>{release=resolve;});const writes=[];
  const sync=createSyncSettings({localDataRoot:path.join(root,'settings'),localDb:db,networkTimeoutMs:500,
    onSyncCompleted:async result=>{if(!writes.length){writes.push('started');await blocked;}writes.push(result.lastSync);}});
  await sync.save(shared);const first=await sync.syncOnce();const second=await sync.syncOnce();
  assert.equal(first.online,true);assert.equal(second.online,true);assert.deepEqual(writes,['started']);
  release();for(let i=0;i<50&&writes.length<3;i++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.deepEqual(writes,['started',first.lastSync,second.lastSync]);
});
