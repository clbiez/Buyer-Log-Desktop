'use strict';
// İşçiye sığmayan kaynak (gerçek kullanıcı: 655 MiB açık snapshot) sunucu iş parçacığında
// hesaplanırken her istek snapshot'ı diskten yeniden okuyup ayrıştırıyordu (açılışta istek
// başına 10+ sn). Okunan kaynak aynı sürüm için tutulur; sürüm değişince yeniden okunur ve
// okuma olay döngüsüne söz verir.
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
// İşçi kabul etmez: kapasite (sunucu iş parçacığı) yolu.
const capacityPool=()=>({setGeneration(){},stats:()=>({maxWorkers:1}),close:async()=>{},
  run:async()=>{throw Object.assign(Error('too large'),{code:'COMPUTE_JOB_TOO_LARGE'});}});
function spyLoads(t){
  const original=snapshots.loadModelSnapshotAsync,calls=[];
  snapshots.loadModelSnapshotAsync=async(...args)=>{calls.push(args);return original(...args);};
  t.after(()=>{snapshots.loadModelSnapshotAsync=original;});
  return calls;
}

test('capacity-path reads of one generation parse the persisted snapshot once, cooperatively',async t=>{
  await snapshots.saveModelSnapshotAsync('a',source('DISK-1'));
  const service=createComputeService({pool:capacityPool(),root});t.after(()=>service.close());
  const loads=spyLoads(t);
  const descriptor=await service.coldSource({ownerId:'a',generation:'disk-1',loadedAt:'DISK-1',uncompressedBytes:MiB});
  for(const task of ['source-info','projection-plan','projections','projections']){
    const data={...params(),projectionContextHash:'demo',appVersion:'1'};
    const lease=await service.run(task,descriptor,data);
    try{
      assert.equal(lease.metrics.fallbackReason,'COMPUTE_JOB_TOO_LARGE');
      if(task==='projections')assert.deepEqual(unpack(lease.value.compressed.cp),JSON.parse(tasks.serialize(tasks.buildProjections(source('DISK-1'),data).cp,'projection')));
    }finally{lease.release();}
  }
  assert.equal(loads.length,1,'one snapshot parse per generation, not per request');
  assert.equal(typeof loads[0][1]?.yieldControl,'function','the parse yields to the event loop');
});

test('a new generation re-reads the snapshot and the retired generation is released',async t=>{
  await snapshots.saveModelSnapshotAsync('a',source('DISK-2'));
  const service=createComputeService({pool:capacityPool(),root});t.after(()=>service.close());
  const loads=spyLoads(t);
  const first=await service.coldSource({ownerId:'a',generation:'disk-2',loadedAt:'DISK-2',uncompressedBytes:MiB});
  (await service.run('source-info',first,{})).release();
  await snapshots.saveModelSnapshotAsync('a',source('DISK-3'));
  const next=await service.coldSource({ownerId:'a',generation:'disk-3',loadedAt:'DISK-3',uncompressedBytes:MiB,replace:true});
  await assert.rejects(service.run('source-info',first,{}),{code:'COMPUTE_STALE_GENERATION'});
  const lease=await service.run('source-info',next,{});
  try{assert.equal(lease.value.loadedAt,'DISK-3');}finally{lease.release();}
  assert.equal(loads.length,2);
});

test('a metadata-only snapshot save (same content, new loadedAt) invalidates the kept source',async t=>{
  const same=label=>{const s=source('X');s.loadedAt=label;return s;};
  await snapshots.saveModelSnapshotAsync('a',same('META-1'));
  const service=createComputeService({pool:capacityPool(),root});t.after(()=>service.close());
  const descriptor=await service.coldSource({ownerId:'a',generation:'meta-1',loadedAt:'META-1',uncompressedBytes:MiB});
  (await service.run('source-info',descriptor,{})).release();
  await snapshots.saveModelSnapshotAsync('a',same('META-2'));
  await assert.rejects(service.run('source-info',descriptor,{}),{code:'COMPUTE_STALE_GENERATION'});
});
