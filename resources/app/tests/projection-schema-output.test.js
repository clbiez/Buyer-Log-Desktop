'use strict';

// UNRUN. Real application service/pool/worker/parser; opt-in callback metadata.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),v8=require('node:v8');
const APP=path.resolve(__dirname,'..');
const {createComputePool}=require(path.join(APP,'server/lib/compute-pool'));
const {createComputeService}=require(path.join(APP,'server/lib/compute-service'));
const tasks=require(path.join(APP,'server/lib/compute-tasks'));
const MiB=1024*1024,A='__CPX_SCHEMA_NATIVE_A';
function parameters(extra={}){return {modules:['orders'],overrides:{},horizons:{},cpAllowed:true,cpModelColumns:[{id:'schema_native_a',header:A,label:'Synthetic A',percentageScale:0,sourceMetadata:{zero:0,false:false,nil:null}}],
 moduleSchemaExposureCp:true,moduleSchemaTargetKnownCp:true,moduleSchemaBindingsKnownCp:true,moduleSchemaExposureOrders:true,moduleSchemaTargetKnownOrders:true,moduleSchemaBindingsKnownOrders:true,...extra};}
function source(topology='same'){
 const rows=[0,1].map(index=>({ocode:'0001',model:'Synthetic '+index,ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G',license:'',manufacturer:'Synthetic',season:'W7',countryRaw:'TURKIYE',qty:10,kalan:5,fob:0,ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_cpExtra:{[A]:index?false:0}}));
 const value={loadedAt:'synthetic-schema-native',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{}};
 if(topology==='rows')value.asasOrdersByTarget.cp=rows.map(row=>({...row}));
 if(topology==='antrepo')value.antrepoMapByTarget={cp:{},orders:{}};
 return value;
}
async function fixture(t,{topology,forbidCpBuild=false,failSchemaSource=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-schema-output-'));
 const {Worker}=require('node:worker_threads');class NativeWorker extends Worker{constructor(file,options){super(file,{...options,execArgv:[...(options.execArgv||[]),'--require',path.join(__dirname,'helpers/projection-schema-worker-preload.cjs')],workerData:{...options.workerData,projectionSchemaPreparation:{app:APP,forbidCpBuild,failSchemaSource}}});}}
 const pool=createComputePool({WorkerClass:NativeWorker,maxWorkers:1,memoryBudgetBytes:512*MiB,maxPendingBytes:256*MiB});
 const service=createComputeService({pool,root});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const raw=source(topology),descriptor=await service.seedSource({ownerId:'schema-owner',generation:'compute-schema-g1',source:raw,uncompressedBytes:1024});
 return {pool,service,raw,descriptor,run:params=>service.run('projections',descriptor,params)};
}
function compressedBytes(value){return Object.fromEntries(Object.entries(value.compressed).map(([module,entry])=>[module,Buffer.from(entry.buffer)]));}

test('explicit schema collection returns own Orders metadata alongside byte-identical full projection',async t=>{
 const f=await fixture(t),params=parameters(),control=await f.run(params);let expected;
 tasks.buildProjections(f.raw,params,{onSchemas:value=>{expected=value;}});
 let bytes;try{bytes=compressedBytes(control.value);assert.equal(Object.hasOwn(control.value,'moduleSchemas'),false);}finally{control.release();}
 const lease=await f.run({...params,collectModuleSchemas:true});try{
  assert.ok(lease.metrics.threadId>0);assert.deepEqual(lease.value.moduleSchemas,expected);
  assert.equal(lease.value.moduleSchemas.orders.status,'known');assert.equal(lease.value.moduleSchemas.cp,null);
  assert.deepEqual(compressedBytes(lease.value),bytes);
  const wire=JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.compressed.orders.buffer)));
  assert.equal(Object.hasOwn(wire,'moduleSchema'),false);assert.equal(Object.hasOwn(wire,'moduleSchemas'),false);
  assert.equal(lease.value.moduleSchemas.orders.rowCount,wire.rows.length);assert.deepEqual(Object.keys(lease.value.compressed),['orders']);
 }finally{lease.release();}
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('all nontrue collection switches retain the old output and do not invoke the callback source',async t=>{
 const f=await fixture(t,{failSchemaSource:true});let bytes;
 for(const collectModuleSchemas of [undefined,false,null,0,1,'true']){
  const params=parameters();if(collectModuleSchemas!==undefined)params.collectModuleSchemas=collectModuleSchemas;
  const lease=await f.run(params);try{assert.equal(Object.hasOwn(lease.value,'moduleSchemas'),false);const current=compressedBytes(lease.value);if(bytes)assert.deepEqual(current,bytes);else bytes=current;}finally{lease.release();}
 }
});

test('schema denial and unknown bindings remain null despite broad compute permission',async t=>{
 const f=await fixture(t);
 for(const extra of [{moduleSchemaExposureCp:false},{moduleSchemaBindingsKnownCp:false},{moduleSchemaTargetKnownOrders:null},{cpModelColumns:null}]){
  const lease=await f.run(parameters({...extra,collectModuleSchemas:true}));try{
   assert.deepEqual(lease.value.moduleSchemas,{cp:null,orders:null});
   assert.ok(JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.compressed.orders.buffer))).rows.length>0);
  }finally{lease.release();}
 }
});

test('distinct row identity or Antrepo topology cannot borrow shared CP definitions',async t=>{
 for(const topology of ['rows','antrepo']){
  const f=await fixture(t,{topology}),lease=await f.run(parameters({collectModuleSchemas:true}));try{assert.deepEqual(lease.value.moduleSchemas,{cp:null,orders:null});}finally{lease.release();}
 }
});

test('Orders-only schema collection succeeds with CP and shared parser builders trapped',async t=>{
 const f=await fixture(t,{forbidCpBuild:true}),lease=await f.run(parameters({collectModuleSchemas:true}));
 try{assert.equal(lease.value.moduleSchemas.orders.status,'known');assert.equal(lease.value.moduleSchemas.cp,null);assert.deepEqual(Object.keys(lease.value.compressed),['orders']);}finally{lease.release();}
});

test('collected schema metadata is charged in the existing output lease and release stays idempotent',async t=>{
 const f=await fixture(t),lease=await f.run(parameters({modules:['cp','orders'],collectModuleSchemas:true}));try{
  assert.equal(lease.value.moduleSchemas.cp.status,'known');assert.equal(lease.value.moduleSchemas.orders.status,'known');
  const metadata=v8.serialize({sourceMeta:lease.value.sourceMeta,moduleSchemas:lease.value.moduleSchemas}).byteLength;
  const transferred=Object.values(lease.value.compressed).reduce((sum,entry)=>sum+entry.buffer.byteLength,0);
  assert.ok(lease.metrics.outputBytes>=transferred+metadata*4,JSON.stringify({reported:lease.metrics.outputBytes,transferred,receivedMetadataBytes:metadata}));assert.equal(f.pool.stats().leasedOutputBytes,lease.metrics.outputBytes);
 }finally{lease.release();lease.release();}
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('callback-source error rejects the native job instead of publishing false schema authority',async t=>{
 const f=await fixture(t,{failSchemaSource:true});
 const full=await f.run(parameters());try{assert.ok(full.value.compressed.orders);assert.equal(Object.hasOwn(full.value,'moduleSchemas'),false);}finally{full.release();}
 await assert.rejects(f.run(parameters({collectModuleSchemas:true})),{code:'COMPUTE_WORKER_FAILED'});
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});
