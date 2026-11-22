'use strict';
// İşçiye sığmayan kaynak (gerçek kullanıcı: 655 MiB açık snapshot) sunucu iş parçacığında
// hesaplanırken her istek 655 MiB'lık snapshot'ı diskten yeniden okuyup ayrıştırıyordu
// (sunucu aynı veriyi zaten bellekte tutarken; 10+ sn'lik kilitler). Bellekteki aynı sürüm
// (loadedAt eşit) kullanılır; diskten okuma yalnız eşleşme yokken ve kooperatif yapılır.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-compute-local-reuse-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])process.env[key]=path.join(root,key);
const {createComputeService}=require('../server/lib/compute-service');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access'),snapshots=require('../server/lib/model-snapshot');
const MiB=1024*1024;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function source(label){
  const rows=[{ocode:123,model:label,ccode:'R',colour:'Red',buyer:'Alice',qty:10,kalan:5,fob:5,ex:new Date(2026,6,1)}];
  return {loadedAt:label,asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};
}
const context=()=>access.createAccessContext({userId:'a',systemRole:'buyer',viewScope:{buyers:['Alice']},editScopes:{buyers:['Alice']},authority:{123:[{buyer:'Alice'}]},profiles:[]});
const params=()=>({access:context(),overrides:{},horizons:{},modules:['cp','orders'],calendar:{configured:false}});
const unpack=entry=>JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)));
// İşçi kabul etmez: yerel (kapasite) yol.
const capacityPool=()=>({setGeneration(){},stats:()=>({maxWorkers:1}),close:async()=>{},
  run:async()=>{throw Object.assign(Error('too large'),{code:'COMPUTE_JOB_TOO_LARGE'});}});
function spyLoads(t){
  const original=snapshots.loadModelSnapshotAsync,calls=[];
  snapshots.loadModelSnapshotAsync=async(...args)=>{calls.push(args);return original(...args);};
  t.after(()=>{snapshots.loadModelSnapshotAsync=original;});
  return calls;
}

test('capacity-path reads use the in-memory source of the same generation instead of re-reading the snapshot',async t=>{
  await snapshots.saveModelSnapshotAsync('a',source('DISK-1'));
  const live=source('DISK-1');live.asasOrders[0].model='LIVE';live.asasOrdersByTarget={cp:live.asasOrders,orders:live.asasOrders,backlog:live.asasOrders};
  const asked=[];
  const service=createComputeService({pool:capacityPool(),root,localSourceFor:(owner,descriptor)=>{asked.push([owner,descriptor.loadedAt]);return live;}});
  t.after(()=>service.close());
  const loads=spyLoads(t);
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-1',loadedAt:'DISK-1',uncompressedBytes:MiB});
  for(let i=0;i<3;i++){
    const lease=await service.run('projections',descriptor,params());
    try{assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'LIVE');}
    finally{lease.release();}
  }
  assert.equal(loads.length,0,'the persisted snapshot is not re-read for every request');
  assert.deepEqual(asked,[['a','DISK-1']],'the in-memory source is resolved once per generation');
  assert.deepEqual(unpack((await service.run('projections',descriptor,params())).value.compressed.cp),JSON.parse(tasks.serialize(tasks.buildProjections(live,params()).cp,'projection')));
});

test('without a matching in-memory generation the snapshot is read cooperatively',async t=>{
  await snapshots.saveModelSnapshotAsync('a',source('DISK-B'));
  const service=createComputeService({pool:capacityPool(),root,localSourceFor:()=>source('OTHER-GENERATION')});
  t.after(()=>service.close());
  const loads=spyLoads(t);
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-b',loadedAt:'DISK-B',uncompressedBytes:MiB});
  const lease=await service.run('projections',descriptor,params());
  try{assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'DISK-B');}finally{lease.release();}
  assert.equal(loads.length,1);
  assert.equal(typeof loads[0][1]?.yieldControl,'function','snapshot parse yields to the event loop');
});

test('server gives the capacity path its in-memory runtime of the same generation without creating cache entries',()=>{
  const server=fs.readFileSync(path.join(__dirname,'..','server','server.js'),'utf8');
  const wiring=server.slice(server.indexOf('setLocalSourceProvider((ownerId, descriptor) => {'),server.indexOf('});',server.indexOf('setLocalSourceProvider((ownerId, descriptor) => {')));
  assert.match(wiring,/sourceCaches\.get\(sourceUserId\(ownerId\)\)/,'reads the cache without cacheForUser side effects');
  assert.match(wiring,/String\(runtime\.loadedAt\) !== String\(descriptor && descriptor\.loadedAt\)/,'only the same generation is reused');
  assert.match(wiring,/return runtimeSnapshotPayload\(runtime\);/);
  assert.match(server,/async function saveRuntimeModelSnapshot\(id, runtime\) \{\s*if \(!runtime \|\| !runtime\.loadedAt\) return null;\s*const payload = runtimeSnapshotPayload\(runtime\);/,'the snapshot and the capacity path use the same fields');
  const runtimeModule=fs.readFileSync(path.join(__dirname,'..','server','lib','compute-runtime.js'),'utf8');
  assert.match(runtimeModule,/localSourceFor:\(owner,descriptor\)=>localSourceProvider\?\.\(owner,descriptor\)\|\|null/);
});
