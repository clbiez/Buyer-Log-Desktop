'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extractFunction}=require('./helpers/app-main-functions'),source=require('./helpers/server-source')(),{createComputeSourceCache}=require('../server/lib/compute-source-cache');
function setup({deferred=false}={}){
 const active={loadedAt:null,asasOrders:null},snapshot={loadedAt:'new',asasOrders:[{ocode:101,buyer:'Demo'}]},manifest={sourceLoadedAt:'old',sourceRevisionKey:'old-key'},publishedComputeSources=new Map();let loads=0,finish;
 const cache=createComputeSourceCache({maxBytes:1000,loadSnapshot:async owner=>{assert.equal(owner,'demo');loads++;if(deferred)await new Promise(resolve=>finish=resolve);return snapshot;}});
 const service={coldSource:async({ownerId,generation,loadedAt})=>({ownerId,generation,loadedAt,bytes:100,capability:'private'}),run:async(task,descriptor)=>{assert.equal(task,'source-info');const lease=await cache.acquire(descriptor,'demo');return {value:{loadedAt:'new',runtimeMeta:{loadedAt:'new'},sourceProjectionKeys:{cp:'new-cp'}},release:()=>lease.release()};},bindColdSource:(descriptor,loadedAt,projectionKeys)=>({...descriptor,loadedAt,projectionKeys})};
 const c={Object,Map,publishedComputeSources,coldComputeSourcesInFlight:new Map(),sourceUserId:()=> 'demo',cacheForUser:()=>active,computeSourceBase:()=>({active,manifest,key:active.loadedAt?'new-key':'old-key'}),projectionSourceRevision:metadata=>metadata.loadedAt?'new-key':'old-key',computeSnapshotByteEstimate:async()=>100,serverCompute:()=>service};
 vm.createContext(c);vm.runInContext(['computeSourceToken','acceptComputedMetadata','computeSourceFor'].map(name=>extractFunction(source,name)).join('\n')+';globalThis.get=computeSourceFor;globalThis.token=computeSourceToken;',c);
 return {c,cache,active,service,snapshot,loads:()=>loads,finish:()=>finish?.()};
}
test('cold recovery verifies disk snapshot identity instead of permanently binding an obsolete manifest timestamp',async()=>{
 const f=setup(),initial=f.c.token('demo'),descriptor=await f.c.get({id:'demo'});assert.equal(descriptor.loadedAt,'new');assert.equal(f.active.loadedAt,'new');assert.notEqual(f.c.token('demo'),initial,'stale callers must fail their original generation guard');
 const lease=await f.cache.acquire(descriptor,'demo');assert.equal(lease.snapshot.asasOrders.length,1);lease.release();assert.equal((await f.c.get({id:'demo'})).loadedAt,'new');assert.equal(f.loads(),1);f.cache.clear();
});
test('concurrent cold readers wait for one verified identity before exposing a descriptor',async()=>{
 const f=setup({deferred:true}),one=f.c.get({id:'demo'}),two=f.c.get({id:'demo'});let exposed=false;one.then(()=>exposed=true);two.then(()=>exposed=true);
 try{await new Promise(setImmediate);assert.equal(f.loads(),1);assert.equal(exposed,false);f.finish();const [a,b]=await Promise.all([one,two]);assert.equal(a.capability,b.capability);assert.equal(a.loadedAt,'new');assert.equal(b.loadedAt,'new');}finally{f.finish();await Promise.allSettled([one,two]);f.cache.clear();}
});
test('native snapshots recover an obsolete manifest and publish snapshot-free Excel fallback without empty or foreign Backlog rows',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-cold-recovery-native-'));
 process.env.BUYER_LOG_LOCAL_DATA_ROOT=path.join(root,'local');process.env.BUYER_LOG_SERVER_DATA_ROOT=path.join(root,'data');
 const snapshots=require('../server/lib/model-snapshot'),{createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service'),{createComputeReadService}=require('../server/lib/compute-read-service'),{createComputeReadGuard}=require('../server/lib/compute-read-guard'),policy=require('../server/lib/compute-access'),tasks=require('../server/lib/compute-tasks');
 const {Worker}=require('node:worker_threads'),workers=[];class ObservedWorker extends Worker{constructor(...args){super(...args);workers.push(this);}}
 const MiB=1024*1024,pool=createComputePool({WorkerClass:ObservedWorker,maxWorkers:1,memoryBudgetBytes:768*MiB}),service=createComputeService({pool,root,diskBudgetBytes:32*MiB}),readers=[];
 t.after(async()=>{readers.forEach(reader=>reader.clear());await service.close();fs.rmSync(root,{recursive:true,force:true});});
 for(const mode of ['obsolete-manifest','snapshot-free']){
  const owner='cold-demo-'+mode,rows=[{ocode:123,model:'Demo knit',ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G',qty:10,kalan:5,fob:5,ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_sourceFields:{'Synthetic Column':'Value'}}];rows.push({...rows[0],ocode:999,buyer:'Foreign Buyer'});
  const raw={loadedAt:'new',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};if(mode==='obsolete-manifest')await snapshots.saveModelSnapshotAsync(owner,raw);
  const f=setup(),c=f.c,profile={id:owner,enabled:true,status:'ACTIVE'};c.sourceUserId=()=>owner;c.serverCompute=()=>service;c.computeSnapshotByteEstimate=async(_id,metrics)=>metrics?.uncompressedBytes||MiB;c.crypto=require('node:crypto');c.saveModelSnapshotAsync=snapshots.saveModelSnapshotAsync;c.loadOverrides=()=>({asasSourceMode:'excel',antrepoSourceMode:'database'});c.ensureBacklogRuntime=async()=>Object.assign(f.active,raw);c.ensureDataLoaded=async()=>f.active;c.ensureBacklogSourceFields=async()=>{};
  vm.runInContext(['rememberComputeSource','saveRuntimeModelSnapshot','prepareComputeBacklog'].map(name=>extractFunction(source,name)).join('\n')+';globalThis.prepare=prepareComputeBacklog;',c);
  const access=policy.createAccessContext({userId:owner,systemRole:'buyer',manageAll:false,viewScope:{mode:'CUSTOM',buyers:['Synthetic Buyer']},editScopes:{},authority:{}});
  const data={headers:[],overrides:{},horizons:{},options:{},includeSourceDetails:true,access,sourceRevision:'demo-source',rowsRevision:'demo-rows'};
  const guard=createComputeReadGuard({sessionProfile:()=>profile,profileById:()=>profile,hasArea:()=>true,contextFor:()=>({contextHash:'demo-context'}),accessFor:()=>({accessHash:access.accessHash}),sourceTokenFor:id=>c.token(id)});
  c.computeReads=createComputeReadService({compute:service,guard,sourceFor:p=>c.get(p),paramsFor:(_p,_d,task)=>task==='source-info'?{}:data});readers.push(c.computeReads);
  if(mode==='obsolete-manifest')await assert.rejects(c.prepare({currentUser:profile}),{code:'COMPUTE_STALE_GENERATION'});
  await c.prepare({currentUser:profile});const descriptor=await c.get(profile);assert.equal(descriptor.loadedAt,'new');if(mode==='snapshot-free'){assert.ok(descriptor.replicaFile);assert.ok(fs.existsSync(snapshots.snapshotPath(owner)));}
  const lease=await c.computeReads.run({currentUser:profile},'backlog','backlog-export',{});
  try{const actual=zlib.gunzipSync(Buffer.from(lease.value.buffer)).toString();assert.equal(actual,tasks.serialize(tasks.buildBacklog('export',raw,data),'api'));const body=JSON.parse(actual);assert.ok(body.rows.length>0);assert.ok(body.rows.every(row=>row['Sipariş Kod']===123&&row.Buyer==='Synthetic Buyer'));}finally{lease.release();}
  // The service uses its own immutable descriptor, not caller-edited metadata.
  const unchanged=await service.run('source-info',{...descriptor,loadedAt:'old'},{});assert.equal(unchanged.value.loadedAt,'new');unchanged.release();
  if(mode==='obsolete-manifest'){
   await snapshots.saveModelSnapshotAsync(owner,{...raw,loadedAt:'changed-after-bind'});await Promise.all(workers.map(worker=>worker.terminate()));
   await assert.rejects(service.run('source-info',descriptor,{}),{code:'COMPUTE_STALE_GENERATION'});
  }
  c.computeReads.clear();f.cache.clear();
 }
});
