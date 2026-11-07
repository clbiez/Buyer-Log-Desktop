'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-lfl-source-version-'));
for(const [name,folder] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_TEMP_ROOT:'temp'}))process.env[name]=path.join(root,folder);
delete process.env.BUYER_LOG_AUTH_DATA_ROOT;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
const server=fs.readFileSync(require.resolve('../server/server.js'),'utf8');
function hydrate(snapshot){
 const start=server.indexOf('function hydrateSnapshotPayload('),end=server.indexOf('\nfunction hydrateModelSnapshot(',start);
 const context={sourceUserId:()=> 'demo',cacheForUser:()=>({}),withFabricDimensions:meta=>meta,replaceUserCache:(_id,value)=>value,userAccess:{syncProfiles(){}},
  collectionLflSourceVersion:value=>require('../server/lib/collection-lfl-source-version').collectionLflSourceVersion(value)};
 vm.createContext(context);vm.runInContext(server.slice(start,end),context);return context.hydrateSnapshotPayload('demo',snapshot);
}
test('snapshot presence without LFL retains the same version/availability in MAIN and the native worker',async t=>{
 const {createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service');
 const snapshot=require('../server/lib/model-snapshot'),policy=require('../server/lib/compute-access');
 fs.mkdirSync(path.join(root,'workers'),{recursive:true});
 const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:768*1024*1024,maxPendingBytes:256*1024*1024});
 const service=createComputeService({pool,root:path.join(root,'workers')});t.after(()=>service.close());
 const access=policy.createAccessContext({userId:'demo',systemRole:'moderator',viewScope:{},authority:{},profiles:[]});
 for(const [name,patch] of [['missing-lfl',{lflLoadedAt:null}],['explicit-lfl',{lflLoadedAt:'2026-11-05T12:00:00.000Z'}],['saved-only',{loadedAt:null,lflLoadedAt:null}]]){
  await snapshot.saveModelSnapshotAsync('demo',{loadedAt:'2026-11-04T12:00:00.000Z',asasOrders:[],antrepoMap:{},lflRows:[],...patch});
  const persisted=await snapshot.loadModelSnapshotAsync('demo'),main=hydrate(persisted);
  const descriptor=await service.collectionLflSource('demo'),lease=await service.runCollectionLfl('collection-lfl-source-info',descriptor,{access});
  try{
   assert.ok(lease.metrics.threadId>0);
   assert.deepEqual(lease.value,{available:true,version:main.lflLoadedAt},name);
   assert.equal(main.lflRows.length,0,name+' preserves snapshot availability without inventing LFL rows');
   if(name==='missing-lfl')assert.equal(lease.value.version,'2026-11-04T12:00:00.000Z');
  }finally{lease.release();}
 }
 assert.equal(pool.stats().leasedOutputBytes,0);
});
test('MAIN hydration and worker source-info resolve the version with one shared helper',()=>{
 const worker=fs.readFileSync(require.resolve('../server/workers/compute-worker.js'),'utf8');
 assert.match(server,/lflLoadedAt:\s*collectionLflSourceVersion\(snapshot\)\s*\|\|\s*new Date\(\)\.toISOString\(\)/);
 assert.match(worker,/version=collectionLflSourceVersion\(source\)/);
 assert.doesNotMatch(worker,/source\.lflLoadedAt\|\|source\.loadedAt\|\|source\.savedAt/);
 const {collectionLflSourceVersion:version}=require('../server/lib/collection-lfl-source-version');
 for(const source of [null,undefined,{}, {lflLoadedAt:null,loadedAt:null,savedAt:null}])assert.equal(version(source),null);
 assert.equal(version({lflLoadedAt:'lfl',loadedAt:'model',savedAt:'saved'}),'lfl');
 assert.equal(version({lflLoadedAt:null,loadedAt:'model',savedAt:'saved'}),'model');
 assert.equal(version({lflLoadedAt:null,loadedAt:null,savedAt:'saved'}),'saved');
});
