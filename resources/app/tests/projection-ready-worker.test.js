'use strict';

// Real shared service/pool/worker regressions. The same first fixture recorded
// unknown-task RED before implementation; all assertions are preserved.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),v8=require('node:v8');
const APP=path.resolve(__dirname,'..');
const {createComputePool}=require(path.join(APP,'server/lib/compute-pool'));
const {createComputeService}=require(path.join(APP,'server/lib/compute-service'));
const tasks=require(path.join(APP,'server/lib/compute-tasks'));
const schemaApi=require(path.join(APP,'public/module-projection-schema'));
const MiB=1024*1024,A='__CPX_WORKER_A',B='__CPX_WORKER_B';
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function fixture(t,{extraKeys=0}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-ready-worker-'));
 const workers=[],{Worker}=require('node:worker_threads');class ObservedWorker extends Worker{constructor(...args){super(...args);workers.push(this);}}
 const pool=createComputePool({WorkerClass:ObservedWorker,maxWorkers:1,memoryBudgetBytes:512*MiB,maxPendingBytes:256*MiB});
 const service=createComputeService({pool,root});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const rows=[0,1].map(index=>({ocode:'0001',model:'Synthetic '+index,ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G',license:'',manufacturer:'Synthetic',season:'W7',countryRaw:'TURKIYE',qty:10,kalan:5,fob:0,
  opd:new Date(2026,0,1),ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_cpExtra:{[A]:index?null:0,[B]:index?0:false,__CPX_UNREGISTERED:'keep native unknown'}}));
 for(const row of rows)for(let index=0;index<extraKeys;index++)row._cpExtra['__CPX_UNREGISTERED_'+index]=index%2?false:0;
 const source={loadedAt:'2026-11-08T00:00:00.000Z',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows},antrepoMap:{}};
 const descriptor=await service.seedSource({ownerId:'demo-owner',generation:'compute-g1',source,uncompressedBytes:1024});
 const full=tasks.buildProjections(source,{modules:['orders'],overrides:{},horizons:{},cpAllowed:true}).orders;
 const raw=Buffer.from(tasks.serialize(full,'projection')),wire=JSON.parse(raw),projectionBuffer=zlib.gzipSync(raw,{level:4});
 const definitions=[{id:'worker_a',header:A,label:'Synthetic A',percentageScale:0,sourceMetadata:{zero:0,false:false,nil:null}},{id:'worker_b',header:B,label:'Synthetic B',scale:false}];
 const schema=schemaApi.build({module:'orders',rows:wire.rows,modelColumns:definitions,modelSchemaKnown:true,canExpose:true,scopePolicy:{schemaSource:'target',targetKnown:true,bindingsKnown:true,cpSchemaAllowed:true}});assert.ok(schema);
 const projectionPin={schemaVersion:2,cacheGeneration:'page-ready-g1',sourceLoadedAt:descriptor.loadedAt,sourceRevisionKey:'wire-source-r1',module:'orders',moduleInputKey:'orders-input-1',sourceProjectionKey:descriptor.projectionKeys.orders,contextHash:'context-1',checksum:sha(projectionBuffer),uncompressedBytes:raw.length};
 const token={ownerId:'demo-owner',actorId:'demo-actor',module:'orders',sourceGeneration:projectionPin.cacheGeneration,sourceRevision:sha(JSON.stringify([projectionPin.sourceRevisionKey,projectionPin.checksum])),moduleInputKey:projectionPin.moduleInputKey,sourceProjectionKey:projectionPin.sourceProjectionKey,accessHash:'access-1',contextHash:projectionPin.contextHash,planRevision:'0',requestGeneration:'request-1'};
 const viewInfo={ownerId:token.ownerId,actorId:token.actorId,sourceKey:token.sourceProjectionKey,sourceGeneration:token.sourceGeneration,accessHash:token.accessHash,planEpoch:0,fullJsonSha256:sha(raw),fullJsonBytes:raw.length};
 const params={projectionBuffer,projectionCompressedBytes:projectionBuffer.length,projectionBytes:raw.length,projectionChecksum:sha(projectionBuffer),projectionPin,computeGeneration:descriptor.generation,token,viewInfo,schema,omittedKeys:[A,B]};
 return {root,pool,service,workers,source,descriptor,wire,raw,params,run:extra=>service.run('projection-ready-orders',descriptor,{...params,...extra})};
}
function decoded(value){return JSON.parse(zlib.gunzipSync(Buffer.from(value.buffer)));}
async function rejected(f,extra,code){await assert.rejects(f.run(extra),{code});assert.equal(f.pool.stats().leasedOutputBytes,0);}

test('new task ready roundtrip uses actual worker and retains ordinary JSON/source ownership',async t=>{
 const f=await fixture(t),inputSha=sha(f.params.projectionBuffer),lease=await f.run();
 try{
  assert.equal(lease.value.kind,'ready');assert.ok(lease.metrics.threadId>0);
  const ready=decoded(lease.value);assert.equal(ready.profile,'orders-ready-model-v1');
  assert.equal(ready.projection.viewInfo.sourceGeneration,'page-ready-g1');assert.notEqual(f.descriptor.generation,ready.projection.viewInfo.sourceGeneration);
  assert.deepEqual(ready.rows.map(row=>row['Order Code']),f.wire.rows.map(row=>row['Order Code']));
  assert.equal(Object.hasOwn(ready.rows[0],A),false);assert.equal(Object.hasOwn(ready.rows[0],B),false);assert.equal(ready.rows[0].__CPX_UNREGISTERED,'keep native unknown');
  assert.equal(lease.value.checksum,sha(Buffer.from(lease.value.buffer)));assert.equal(lease.value.uncompressedBytes,zlib.gunzipSync(Buffer.from(lease.value.buffer)).length);
  assert.equal(sha(f.params.projectionBuffer),inputSha);assert.equal(f.source.asasOrders[0]._cpExtra[A],0);assert.equal(f.source.asasOrders[0]._cpExtra[B],false);
  assert.ok(f.pool.stats().leasedOutputBytes>0);
 }finally{lease.release();lease.release();}
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('ready task never reloads a source replica even on a new native thread',async t=>{
 const f=await fixture(t);await f.workers.at(-1).terminate();fs.writeFileSync(f.descriptor.replicaFile,'synthetic unavailable raw snapshot');
 const lease=await f.run();try{assert.equal(lease.value.kind,'ready');assert.ok(lease.metrics.threadId>0);}finally{lease.release();}
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('unknown schema and canonical registration return exact original gzip, with no full graph in output',async t=>{
 const f=await fixture(t);
 const nativeSchema=schemaApi.build({module:'orders',rows:f.wire.rows,modelColumns:[{header:'Order Code',label:'must remain native'}],modelSchemaKnown:true,canExpose:true,scopePolicy:{schemaSource:'target',targetKnown:true,bindingsKnown:true,cpSchemaAllowed:true}});
 for(const schema of [null,nativeSchema]){
  const lease=await f.run({schema});try{
   assert.equal(lease.value.kind,'full');assert.deepEqual(Buffer.from(lease.value.buffer),f.params.projectionBuffer);
   assert.equal(lease.value.checksum,f.params.projectionChecksum);assert.deepEqual(decoded(lease.value),f.wire);
   assert.equal(Object.hasOwn(lease.value,'fullWire'),false);assert.equal(Object.hasOwn(lease.value,'registryKeys'),false);
  }finally{lease.release();}
 }
});

test('same source compute generation and a different page generation are valid independent identities',async t=>{
 const f=await fixture(t);assert.notEqual(f.params.computeGeneration,f.params.token.sourceGeneration);
 const lease=await f.run();try{assert.equal(lease.value.kind,'ready');}finally{lease.release();}
 await rejected(f,{computeGeneration:'compute-stale'},'PROJECTION_VIEW_STALE');
 await rejected(f,{token:{...f.params.token,sourceGeneration:'page-stale'}},'PROJECTION_VIEW_STALE');
});

test('owner/module and each stable token/view/source binding fail closed',async t=>{
 const f=await fixture(t);
 await rejected(f,{token:{...f.params.token,ownerId:'other-owner'}},'COMPUTE_SOURCE_OWNER_MISMATCH');
 await rejected(f,{viewInfo:{...f.params.viewInfo,ownerId:'other-owner'}},'COMPUTE_SOURCE_OWNER_MISMATCH');
 await rejected(f,{token:{...f.params.token,module:'cp'}},'PROJECTION_VIEW_INVALID');
 for(const [key,value] of [['actorId','other-actor'],['accessHash','other-access'],['sourceKey','other-key'],['sourceGeneration','other-page'],['planEpoch',1]])await rejected(f,{viewInfo:{...f.params.viewInfo,[key]:value}},'PROJECTION_VIEW_STALE');
 for(const [key,value]of [['sourceLoadedAt','stale-clock'],['cacheGeneration','stale-page'],['sourceRevisionKey','other-r']])await rejected(f,{projectionPin:{...f.params.projectionPin,[key]:value}},'PROJECTION_VIEW_STALE');
 await rejected(f,{token:{...f.params.token,sourceRevision:'0'.repeat(64)}},'PROJECTION_VIEW_STALE');
 await rejected(f,{projectionPin:{...f.params.projectionPin,moduleInputKey:'other-input'}},'PROJECTION_VIEW_INVALID');
 await rejected(f,{projectionPin:{...f.params.projectionPin,contextHash:'other-context'}},'PROJECTION_VIEW_INVALID');
});

test('descriptor sourceProjectionKey proof cannot be replaced by mutually consistent token and pin',async t=>{
 const f=await fixture(t),key='forged-mutually-consistent-key';
 await rejected(f,{token:{...f.params.token,sourceProjectionKey:key},projectionPin:{...f.params.projectionPin,sourceProjectionKey:key},viewInfo:{...f.params.viewInfo,sourceKey:key}},'PROJECTION_VIEW_STALE');
});

test('exact compressed length and compressed SHA reject stale/corrupt bytes',async t=>{
 const f=await fixture(t);
 await rejected(f,{projectionCompressedBytes:f.params.projectionCompressedBytes+1},'PROJECTION_VIEW_STALE');
 await rejected(f,{projectionChecksum:'0'.repeat(64)},'PROJECTION_VIEW_STALE');
 const changed=Buffer.from(f.params.projectionBuffer);changed[changed.length-1]^=1;
 await rejected(f,{projectionBuffer:changed},'PROJECTION_VIEW_STALE');
 await rejected(f,{projectionCompressedBytes:64*MiB+1},'PROJECTION_VIEW_INVALID');
});

test('gunzip bound, actual raw length and full raw SHA are all enforced',async t=>{
 const f=await fixture(t);
 for(const delta of [-1,1]){
  const bytes=f.params.projectionBytes+delta;
  await rejected(f,{projectionBytes:bytes,projectionPin:{...f.params.projectionPin,uncompressedBytes:bytes},viewInfo:{...f.params.viewInfo,fullJsonBytes:bytes}},'PROJECTION_VIEW_STALE');
 }
 await rejected(f,{viewInfo:{...f.params.viewInfo,fullJsonSha256:'0'.repeat(64)}},'PROJECTION_VIEW_STALE');
 const invalid=Buffer.from('not gzip'),checksum=sha(invalid),pin={...f.params.projectionPin,checksum};
 const token={...f.params.token,sourceRevision:sha(JSON.stringify([pin.sourceRevisionKey,pin.checksum]))};
 await rejected(f,{projectionBuffer:invalid,projectionCompressedBytes:invalid.length,projectionChecksum:checksum,projectionPin:pin,token},'PROJECTION_VIEW_STALE');
});

test('unsupported raw size is rejected by projectionOnly service admission before worker dispatch',async t=>{
 const f=await fixture(t),run=f.pool.run.bind(f.pool);let dispatched=0;
 f.pool.run=(task,...rest)=>{if(task==='projection-ready-orders')dispatched++;return run(task,...rest);};
 for(const projectionBytes of [0,128*MiB+1,NaN])await rejected(f,{projectionBytes},'COMPUTE_JOB_INVALID');
 assert.equal(dispatched,0);
});

test('ready admission uses declared raw expansion and actual serialized parameter bytes',async t=>{
 const f=await fixture(t),run=f.pool.run.bind(f.pool);let admitted;
 f.pool.run=(task,payload,options)=>{if(task==='projection-ready-orders')admitted={payload,options};return run(task,payload,options);};
 const lease=await f.run();try{
  assert.equal(admitted.options.inputBytes,lease.metrics.paramsBytes+1024);
  assert.equal(admitted.options.estimatedBytes,96*MiB+f.params.projectionBytes*6+admitted.options.inputBytes*3);
  assert.ok(admitted.options.estimatedBytes<96*MiB+f.descriptor.bytes*3+admitted.options.inputBytes*3);
  assert.equal(admitted.options.transferList.length,1);
 }finally{lease.release();}
});

test('ready info and registry bytes are included in the existing transferred output lease charge',async t=>{
 const f=await fixture(t),lease=await f.run();try{
  const metadata=v8.serialize({info:lease.value.info,registryKeys:lease.value.registryKeys}).byteLength;
  assert.ok(lease.metrics.outputBytes>=Buffer.from(lease.value.buffer).length+metadata*4);
  assert.equal(f.pool.stats().leasedOutputBytes,lease.metrics.outputBytes);
 }finally{lease.release();}
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('byte-offset views hash only their exact gzip range and nonce never enters cached JSON',async t=>{
 const f=await fixture(t),padded=Buffer.concat([Buffer.from('before'),f.params.projectionBuffer,Buffer.from('after')]);
 const view=new DataView(padded.buffer,padded.byteOffset+6,f.params.projectionBuffer.length);
 const first=await f.run({projectionBuffer:view,viewInfo:{...f.params.viewInfo,requestNonce:'nonce-one'}});
 let body,checksum;try{assert.equal(first.value.kind,'ready');body=zlib.gunzipSync(Buffer.from(first.value.buffer)).toString();checksum=first.value.checksum;assert.equal(body.includes('nonce-one'),false);}finally{first.release();}
 const second=await f.run({token:{...f.params.token,requestGeneration:'request-two'},viewInfo:{...f.params.viewInfo,requestNonce:'nonce-two'}});
 try{assert.equal(zlib.gunzipSync(Buffer.from(second.value.buffer)).toString(),body);assert.equal(second.value.checksum,checksum);}finally{second.release();}
});

test('generation change after native completion rejects result and releases the ordinary output lease',async t=>{
 const f=await fixture(t),run=f.pool.run.bind(f.pool);let switched=false;
 f.pool.run=async(task,...rest)=>{const lease=await run(task,...rest);if(task==='projection-ready-orders'&&!switched){switched=true;await f.service.coldSource({ownerId:f.descriptor.ownerId,generation:'compute-g2',loadedAt:f.descriptor.loadedAt,uncompressedBytes:1024,replace:true});}return lease;};
 await assert.rejects(f.run(),{code:'COMPUTE_STALE_GENERATION'});assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('cold ready preparation derives the absent full JSON hash off-thread from exact verified gzip',async t=>{
 const f=await fixture(t),{fullJsonSha256,...withoutRawHash}=f.params.viewInfo;
 const lease=await f.run({viewInfo:withoutRawHash});
 try{
  assert.equal(lease.value.kind,'ready');assert.ok(lease.metrics.threadId>0);
  const ready=decoded(lease.value);
  assert.equal(ready.projection.viewInfo.fullJsonSha256,sha(f.raw));
  assert.equal(ready.projection.viewInfo.fullJsonSha256,fullJsonSha256);
  assert.equal(ready.projection.viewInfo.fullJsonBytes,f.raw.length);
  assert.equal(lease.value.info.viewInfo.fullJsonSha256,fullJsonSha256);
  assert.equal(Object.hasOwn(withoutRawHash,'fullJsonSha256'),false);
 }finally{lease.release();}
 await rejected(f,{viewInfo:{...withoutRawHash,fullJsonSha256:undefined}},'PROJECTION_VIEW_INVALID');
 await rejected(f,{viewInfo:{...withoutRawHash,fullJsonSha256:'0'.repeat(64)}},'PROJECTION_VIEW_STALE');
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});

test('large complete schema registry is charged after real IPC representation changes',async t=>{
 const f=await fixture(t,{extraKeys:400}),lease=await f.run();
 try{
  assert.equal(lease.value.kind,'ready');assert.ok(lease.value.registryKeys.length>450);
  const metadata=v8.serialize({info:lease.value.info,registryKeys:lease.value.registryKeys}).byteLength;
  const transferred=Buffer.from(lease.value.buffer).length;
  assert.ok(lease.metrics.outputBytes>=transferred+metadata*4,JSON.stringify({reported:lease.metrics.outputBytes,transferred,receivedMetadataBytes:metadata}));
  const rows=decoded(lease.value).rows;
  assert.equal(rows[0].__CPX_UNREGISTERED_0,0);assert.equal(rows[0].__CPX_UNREGISTERED_399,false);
 }finally{lease.release();}
 assert.equal(f.pool.stats().leasedOutputBytes,0);
});
