'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-compute-capacity-'));
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])process.env[key]=path.join(root,key);
const {createComputePool}=require('../server/lib/compute-pool'),{createComputeService}=require('../server/lib/compute-service');
const tasks=require('../server/lib/compute-tasks'),access=require('../server/lib/compute-access');
const MiB=1024*1024;
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
function setup(t){
  const pool=createComputePool({maxWorkers:1,memoryBudgetBytes:160*MiB,maxPendingBytes:64*MiB});
  const service=createComputeService({pool,root});t.after(()=>service.close());return {pool,service};
}
function source(label='CURRENT'){
  const rows=[{ocode:123,model:label,ccode:'R',colour:'Red',buyer:'Alice',qty:10,kalan:5,fob:5,ex:new Date(2026,6,1)},
    {ocode:999,model:'FOREIGN',ccode:'B',buyer:'Bob',qty:999,kalan:999,fob:99}];
  return {loadedAt:label,asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};
}
const context=()=>access.createAccessContext({userId:'a',systemRole:'buyer',viewScope:{buyers:['Alice']},editScopes:{buyers:['Alice']},authority:{123:[{buyer:'Alice'}]},profiles:[]});
const params=()=>({access:context(),overrides:{},horizons:{},modules:['cp','orders'],calendar:{configured:false}});
const unpack=entry=>JSON.parse(zlib.gunzipSync(Buffer.from(entry.buffer)));
test('LFL reference refresh survives worker admission limits with the same scoped summaries and source version',async t=>{
  const {service,pool}=setup(t),snapshots=require('../server/lib/model-snapshot'),Engine=require('../public/collection-lfl-engine');
  const row={orderCode:'DEMO-LFL',buyer:'Alice',season:'S6',mag:'CU4E',classification:'K',inStoreMonth:'2026-02',fob:10,quantity:100,country:'CHINA'};
  const raw={...source(),lflRows:[row,{...row,orderCode:'FOREIGN',buyer:'Bob',fob:999}],lflLoadedAt:'lfl-v1'};
  await snapshots.saveModelSnapshotAsync('a',raw);
  const descriptor=await service.collectionLflSource('a');
  const info=await service.runCollectionLfl('collection-lfl-source-info',descriptor,params());
  try{assert.deepEqual(info.value,{available:true,version:'lfl-v1'});assert.equal(info.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');}finally{info.release();}
  const lease=await service.runCollectionLfl('collection-lfl-references',descriptor,params());
  try{assert.deepEqual(unpack(lease.value),{references:Engine.buildReferences([row])});}finally{lease.release();}
  assert.equal(pool.stats().workerCount,0);assert.equal(pool.stats().leasedOutputBytes,0);
  await assert.rejects(service.runCollectionLfl('collection-lfl-references',descriptor,{...params(),access:{...context(),userId:'b'}}),{code:'COMPUTE_SOURCE_OWNER_MISMATCH'});
  await snapshots.saveModelSnapshotAsync('a',{...raw,lflLoadedAt:'lfl-v2'});
  await assert.rejects(service.runCollectionLfl('collection-lfl-references',descriptor,params()),{code:'COMPUTE_STALE_GENERATION'});
  const latest=await service.collectionLflSource('a'),updated=await service.runCollectionLfl('collection-lfl-source-info',latest,params());
  try{assert.equal(updated.value.version,'lfl-v2');}finally{updated.release();}
});
test('LFL capacity recovery rejects a source replaced during the disk read and does not hide execution failures',async t=>{
  const {service}=setup(t),snapshots=require('../server/lib/model-snapshot');
  await snapshots.saveModelSnapshotAsync('a',{...source(),lflLoadedAt:'v1'});
  const descriptor=await service.collectionLflSource('a'),load=snapshots.loadModelSnapshotAsync;
  snapshots.loadModelSnapshotAsync=async(...args)=>{const saved=await load(...args);await snapshots.saveModelSnapshotAsync('a',{...source(),lflLoadedAt:'v2'});return saved;};
  try{await assert.rejects(service.runCollectionLfl('collection-lfl-references',descriptor,params()),{code:'COMPUTE_STALE_GENERATION'});}
  finally{snapshots.loadModelSnapshotAsync=load;}
  const failed=createComputeService({root,pool:{setGeneration(){},run:async()=>{throw Object.assign(Error('failed'),{code:'COMPUTE_WORKER_FAILED'});},close:async()=>{}}});t.after(()=>failed.close());
  const latest=await failed.collectionLflSource('a');
  snapshots.loadModelSnapshotAsync=()=>{throw Error('execution failures must not hydrate a fallback');};
  try{await assert.rejects(failed.runCollectionLfl('collection-lfl-references',latest,params()),{code:'COMPUTE_WORKER_FAILED'});}
  finally{snapshots.loadModelSnapshotAsync=load;}
});
test('a source copy exceeding the worker budget still prepares and publishes the exact refresh',async t=>{
  const {service,pool}=setup(t),raw=source();
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:8*MiB,publish:false});
  await service.publishSource(descriptor);
  const lease=await service.run('projections',descriptor,params());
  try{
    assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');
    assert.deepEqual(unpack(lease.value.compressed.cp),JSON.parse(tasks.serialize(tasks.buildProjections(raw,params()).cp,'projection')));
    assert.equal(unpack(lease.value.compressed.orders).rows.length,1);
    assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'CURRENT');
    assert.equal(raw.asasOrdersByTarget.cp,raw.asasOrders);
    assert.ok(raw.asasOrders[0].ex instanceof Date);
  }finally{lease.release();}
  assert.equal(pool.stats().memoryBudgetBytes,160*MiB);
  assert.equal(pool.stats().workerCount,0,'oversized copies must not allocate a worker');
});
test('oversized reads recover with the same CP, Orders and Backlog engines and row scope',async t=>{
  const {service}=setup(t),raw=source(),descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
  for(const task of ['source-info','projection-plan','projections','backlog-export']){
    const data={...params(),headers:[],options:{},sourceColumns:[],sourceRevision:'g1',projectionContextHash:'demo',appVersion:'1'};
    const lease=await service.run(task,descriptor,data);
    try{
      assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE',task);
      if(task==='projections')assert.deepEqual(unpack(lease.value.compressed.orders),JSON.parse(tasks.serialize(tasks.buildProjections(raw,data).orders,'projection')));
      if(task==='backlog-export')assert.deepEqual(unpack(lease.value),JSON.parse(tasks.serialize(tasks.buildBacklog('export',raw,data))));
      if(task==='source-info')assert.equal(lease.value.loadedAt,'CURRENT');
    }finally{lease.release();}
  }
});
test('capacity recovery preserves owner, generation and cancellation gates',async t=>{
  const {service}=setup(t),first=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:8*MiB});
  await assert.rejects(service.run('projections',first,{...params(),access:{...context(),userId:'b'}}),{code:'COMPUTE_SOURCE_OWNER_MISMATCH'});
  const pending=service.run('projections',first,params());
  const rejected=assert.rejects(pending,{code:'COMPUTE_STALE_GENERATION'});
  await service.coldSource({ownerId:'a',generation:'invalidate',uncompressedBytes:MiB,replace:true});
  await rejected;
  await assert.rejects(service.run('projections',first,params()),{code:'COMPUTE_STALE_GENERATION'});
  const second=await service.seedSource({ownerId:'a',generation:'g2',source:source('NEW'),uncompressedBytes:8*MiB});
  const controller=new AbortController();controller.abort();
  await assert.rejects(service.run('projections',second,params(),{signal:controller.signal}),{code:'COMPUTE_ABORTED'});
  const lease=await service.run('projections',second,params());
  try{assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'NEW');}finally{lease.release();}
});
test('cold oversized reads verify the persisted personal snapshot and reject a replaced snapshot',async t=>{
  const {service}=setup(t),snapshots=require('../server/lib/model-snapshot');
  await snapshots.saveModelSnapshotAsync('a',source('DISK-1'));
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-1',loadedAt:'DISK-1',uncompressedBytes:MiB});
  const lease=await service.run('projections',descriptor,params());
  try{assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'DISK-1');}finally{lease.release();}
  await snapshots.saveModelSnapshotAsync('a',source('DISK-2'));
  await assert.rejects(service.run('projections',descriptor,params()),{code:'COMPUTE_STALE_GENERATION'});
});
test('authority hashing survives oversized admission and retains the exact authority digest',async t=>{
  const pool=createComputePool({memoryBudgetBytes:112*MiB,maxWorkers:1}),service=createComputeService({pool,root});t.after(()=>service.close());
  const authority={123:[{buyer:'Alice',merch:'M',ageGroup:'A',buyerGrup:'G'}]},expected=require('node:crypto').createHash('sha256').update(JSON.stringify(authority)).digest('hex');let metrics;
  assert.equal(await service.hashAccessAuthority(authority,{onMetrics:value=>{metrics=value;}}),expected);
  assert.equal(metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');assert.equal(pool.stats().workerCount,0);
});
test('worker execution failures remain failures and never silently use the capacity path',async t=>{
  const service=createComputeService({root,pool:{setGeneration(){},run:async()=>{throw Object.assign(Error('failed'),{code:'COMPUTE_WORKER_FAILED'});},close:async()=>{}}});t.after(()=>service.close());
  await assert.rejects(service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB}),{code:'COMPUTE_WORKER_FAILED'});
});
test('cached output leases do not retain old resident sources after the next refresh',async t=>{
  const {service}=setup(t),first=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:8*MiB});
  const held=await service.run('projections',first,params());
  try{
    assert.equal(service.stats().liveSources,1);
    await service.seedSource({ownerId:'a',generation:'g2',source:source('NEXT'),uncompressedBytes:8*MiB});
    assert.equal(service.stats().liveSources,1,'only the current source remains resident even while the previous output is cached');
  }finally{held.release();}
});
test('a successful worker replica releases its strong source reference',async t=>{
  const {service}=setup(t),raw=source();
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
  assert.ok(descriptor.replicaFile);assert.equal(service.stats().liveSources,0);
  const lease=await service.run('projections',descriptor,params());
  try{assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'CURRENT');}finally{lease.release();}
});
test('idle-owner retirement releases inline sources despite cached outputs and permits a fresh source',async t=>{
  const {service}=setup(t),first=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:8*MiB});
  const held=await service.run('projections',first,params());
  try{
    service.retireSource('a');assert.equal(service.stats().liveSources,0);
    await assert.rejects(service.run('projections',first,params()),{code:'COMPUTE_STALE_GENERATION'});
    const next=await service.seedSource({ownerId:'a',generation:'g1',source:source('RETURNED'),uncompressedBytes:8*MiB});
    assert.notEqual(next.capability,first.capability);
    const lease=await service.run('projections',next,params());
    try{assert.equal(unpack(lease.value.compressed.cp).rows[0]['Model Name'],'RETURNED');}finally{lease.release();}
  }finally{held.release();}
});
