'use strict';
// PREPARED ONLY. Root runs this through run.py after freezing the real app tree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),vm=require('node:vm');
const {promisify}=require('node:util'),{performance}=require('node:perf_hooks'),{Worker}=require('node:worker_threads');
const assert=require('node:assert/strict');
const APP='/workspace/buyerlog-post-main-acceptance/resources/app',SOURCE='/tmp/buyerlog-first-transition-Hxb1BB/local';
const SNAPSHOT=path.join(SOURCE,'model-snapshots/moderator.json.gz');
const SNAPSHOT_SHA='e858d85fd76a1db2858098b820a0c5e20e8466d3c3895e12ad6c93c9ab9530dd';
const MIB=1024*1024,MAX_SNAPSHOT=160*MIB,MAX_REPLICA=192*MIB,MAX_FULL=128*MIB;
const KEYS=['__CPX_SYNTH_WORKER_COST_A','__CPX_SYNTH_WORKER_COST_B'];
const DEFINITIONS=KEYS.map((header,index)=>({id:'synthetic_worker_cost_'+index,header,label:'Synthetic worker cost '+index,synthetic:true,percentageScale:0}));
const arg=name=>{const i=process.argv.indexOf(name);assert.ok(i>=0,'Missing '+name);return process.argv[i+1];};
const arm=arg('--arm'),out=path.resolve(arg('--out')),expectedDay=arg('--day');
assert.ok(['A','B'].includes(arm));assert.equal(process.env.READY_WORKER_COST_LOCK,'held');
assert.ok(out.startsWith(__dirname+path.sep+'runs'+path.sep));
assert.equal(process.env.TZ,'Europe/Istanbul');
const iso=()=>new Date().toISOString(),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;};
const memory=()=>({...process.memoryUsage(),atMs:performance.now()});
async function fileSha(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
function save(name,value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');assert.ok(bytes.length<2*MIB,'Bounded metadata only');fs.writeFileSync(path.join(out,name+'.writing'),bytes);fs.renameSync(path.join(out,name+'.writing'),path.join(out,name));}
function rowHash(rows){const h=crypto.createHash('sha256');h.update('[');rows.forEach((row,i)=>{if(i)h.update(',');h.update(JSON.stringify(row));});h.update(']');return h.digest('hex');}
function modelValue(ordinal,index){const variant=(ordinal+index)%11;if(variant===0)return 0;if(variant===1)return false;if(variant===2)return null;if(variant===3)return '';return ('synthetic ASAS model '+index+' ordinal '+ordinal+' | ').padEnd(index?256:192,index?'B':'A');}
const result={status:'running',arm,startedAt:iso(),pid:process.pid,app:APP,source:SNAPSHOT,sourceSha256:SNAPSHOT_SHA,
  classification:'30k synthetic ASAS parser → native shared pool/IPC cost; not application or thin-client latency',
  modelAugmentation:{keys:KEYS,definitions:DEFINITIONS,values:'ordinal-based, A192/B256 UTF8 ASCII characters; modulo11 0,false,null,empty-string preserved',beforeProjection:true},
  stages:[],ipc:[],workers:[],memory:[],date:{timezone:process.env.TZ,day:expectedDay,policy:'native Date and date normalization; reject day rollover, no clock replacement'}};
let service,pool,activeLease,monitor,stopping=false;
const workers=[],pendingMessages=new Map();
class ObservedWorker extends Worker{
  constructor(file,options){
    assert.equal(path.resolve(file),path.join(APP,'server/workers/compute-worker.js'));
    super(file,options);workers.push(this);
    const record={threadId:this.threadId,file,createdAt:iso(),resourceLimits:options.resourceLimits,exitedAt:null};result.workers.push(record);
    this.on('message',message=>{
      if(message?.type!=='result')return;
      const item=pendingMessages.get(message.id);if(!item)return;
      const at=performance.now();item.receivedAtMs=at;item.roundTripMs=at-item.postStartedAtMs;item.ok=message.ok===true;
      item.workerExecutionMs=message.metrics?.executionMs??null;
      item.roundTripMinusWorkerExecutionMs=item.workerExecutionMs===null?null:item.roundTripMs-item.workerExecutionMs;
      item.threadId=message.metrics?.threadId;item.outputBytes=message.metrics?.outputBytes;
      pendingMessages.delete(message.id);
    });
    this.once('exit',code=>{record.exitedAt=iso();record.exitCode=code;});
  }
  postMessage(message,transfer){
    if(message?.type!=='run')return super.postMessage(message,transfer);
    const item={id:message.id,task:message.task,transferCount:transfer?.length||0,
      inputTransferBytes:(transfer||[]).reduce((sum,buffer)=>sum+buffer.byteLength,0),postStartedAtMs:performance.now()};
    result.ipc.push(item);pendingMessages.set(message.id,item);
    super.postMessage(message,transfer);
    item.postReturnedAtMs=performance.now();item.nativePostCallMs=item.postReturnedAtMs-item.postStartedAtMs;
    item.transferredBuffersDetached=(transfer||[]).every(buffer=>buffer.byteLength===0);
  }
}
async function stage(name,fn){
  assert.equal(localDay(),expectedDay,'Date rollover; stop rather than compare different calendar days');
  const entry={name,startedAtMs:performance.now(),memoryBefore:memory()};result.stages.push(entry);
  try{const value=await fn();entry.wallMs=performance.now()-entry.startedAtMs;entry.memoryAfter=memory();entry.status='passed';return value;}
  catch(error){entry.wallMs=performance.now()-entry.startedAtMs;entry.status='failed';entry.error={code:error.code||null,message:error.message,computeMetrics:error.computeMetrics||null};throw error;}
}
async function job(task,descriptor,params,name=task){
  return stage(name,async()=>{
    const before=pool.stats(),lease=await service.run(task,descriptor,params,{timeoutMs:600000});
    const item=result.stages.at(-1);item.metrics={...lease.metrics,inputBytes:lease.metrics.paramsBytes+1024};
    item.poolBefore=before;item.poolAtReceipt=pool.stats();
    assert.ok(lease.metrics.threadId>0,'Actual native worker required');
    return lease;
  });
}
function normalizer(){
  const source=fs.readFileSync(path.join(APP,'public/app-main.js'),'utf8');
  const {extractFunction}=require(path.join(APP,'tests/helpers/app-main-functions'));
  const constants=[/const CP_BASELINE_DATE_KEYS = .*;/,/const CP_DATE_KEYS = .*;/,/const ISO_DAY_CACHE_MAX = .*;/,/const _isoDayCache = .*;/].map(pattern=>{const match=source.match(pattern);assert.ok(match);return match[0];});
  const names=['norm','toNum','dateOrdinal','normalizeTransitDelType','turknorm','makeDateOnly','dateOnlyFromDateObject','excelSerialToDateOnly','coerceDateLoose','normalizeCPDates','applyCpApprovalDate','cpLogisticSegments','cpLogisticHasDetails','rebuildCpLogisticCaches'];
  const code=[...constants,...names.map(name=>extractFunction(source,name)),'globalThis.normalize=normalizeCPDates;'].join('\n');
  const context=vm.createContext({Date,Map,Set,window:{},BLBusinessRules:require(path.join(APP,'public/business-rules'))});
  vm.runInContext(code,context,{filename:'current actual app date normalizer (post-timing verification only)'});
  result.normalizer={appMainSha256:sha(source),extractedCodeSha256:sha(code),functions:names};
  return context.normalize;
}
async function verify(fullBuffer,selectedBuffer,descriptor,params){
  const started=performance.now();
  const raw=await promisify(zlib.gunzip)(fullBuffer,{maxOutputLength:MAX_FULL}),full=JSON.parse(raw.toString('utf8'));
  assert.equal(full.rows.length,30000);const fullRowsSha=rowHash(full.rows),fullJsonSha=sha(raw);
  let restored=full,readyRawBytes=null;
  if(arm==='B'){
    const readyRaw=await promisify(zlib.gunzip)(selectedBuffer,{maxOutputLength:MAX_FULL+65536});readyRawBytes=readyRaw.length;
    const ready=JSON.parse(readyRaw.toString('utf8'));
    assert.equal(ready.profile,'orders-ready-model-v1');assert.equal(ready.rows.length,full.rows.length);
    assert.deepEqual(ready.projection.omittedKeys,KEYS);assert.equal(ready.projection.viewInfo.fullJsonSha256,fullJsonSha);
    assert.equal(ready.projection.viewInfo.sourceKey,descriptor.projectionKeys.orders);
    assert.equal(ready.projection.viewInfo.sourceGeneration,params.token.sourceGeneration);
    assert.equal(ready.projection.viewInfo.accessHash,params.token.accessHash);
    assert.deepEqual(Object.keys(ready).filter(k=>!['profile','projection'].includes(k)),Object.keys(full));
    for(const key of Object.keys(full))if(key!=='rows')assert.deepEqual(ready[key],full[key]);
    for(let ordinal=0;ordinal<full.rows.length;ordinal++){
      const original=full.rows[ordinal],thin=ready.rows[ordinal],row={};
      assert.deepEqual(Object.keys(thin),Object.keys(original).filter(key=>!KEYS.includes(key)));
      for(const key of KEYS){assert.equal(Object.hasOwn(thin,key),false);assert.equal(Object.hasOwn(original,key),true);}
      // Ordinals come directly from the untouched full row sequence. Business
      // IDs are never deduplication, matching, sorting or restoration keys.
      for(const key of Object.keys(original))row[key]=KEYS.includes(key)?original[key]:thin[key];
      assert.deepEqual(row,original);ready.rows[ordinal]=row;
    }
    delete ready.profile;delete ready.projection;restored=ready;
    assert.equal(rowHash(restored.rows),fullRowsSha);
  }
  const normalize=normalizer();normalize(full.rows);const normalizedSha=rowHash(full.rows);
  if(restored!==full){normalize(restored.rows);assert.equal(rowHash(restored.rows),normalizedSha);}
  const modelPresence=KEYS.map(key=>({key,present:full.rows.reduce((sum,row)=>sum+Number(Object.hasOwn(row,key)),0),
    zeros:full.rows.filter(row=>row[key]===0).length,falseValues:full.rows.filter(row=>row[key]===false).length,nullValues:full.rows.filter(row=>row[key]===null).length}));
  assert.ok(modelPresence.every(item=>item.present===30000&&item.zeros>0&&item.falseValues>0&&item.nullValues>0));
  return {status:'passed',rows:30000,fullJsonSha256:fullJsonSha,fullRawBytes:raw.length,fullRowsSha256:fullRowsSha,
    normalizedRowsSha256:normalizedSha,restoredByOriginalOrdinal:true,allOwnKeysAndNestedValuesCompared:arm==='B',modelPresence,
    verificationMs:performance.now()-started,readyRawBytes,fullGraphMaterializedAfterTiming:true};
}
async function shutdown(){
  activeLease?.release();activeLease=null;
  if(service){result.poolBeforeClose=service.stats();await service.close();result.poolAfterClose=service.stats();}
  result.nativeWorkerExitsVerified=workers.every(worker=>worker.threadId===-1);
  assert.equal(result.nativeWorkerExitsVerified,true,'Do not proceed until native workers exit');
}
process.on('SIGTERM',()=>{if(stopping)return;stopping=true;result.status='failed';result.error={code:'PARENT_STOP',message:'Parent stopped bounded measurement'};
  shutdown().catch(error=>{result.shutdownError=error.message;}).finally(()=>{clearInterval(monitor);save('result.json',result);process.exit(1);});});
(async()=>{
  assert.equal(localDay(),expectedDay);assert.equal(typeof global.gc,'function','Use declared --expose-gc, only outside timing');
  for(const suffix of ['.meta.json','.meta.json.bak'])assert.equal(fs.existsSync(SNAPSHOT+suffix),false,'New metadata must be separately pinned before use');
  assert.equal(await fileSha(SNAPSHOT),SNAPSHOT_SHA);
  const compressedStat=fs.statSync(SNAPSHOT);assert.equal(compressedStat.size,9977311);
  const handle=fs.openSync(SNAPSHOT,'r'),tail=Buffer.alloc(4);try{fs.readSync(handle,tail,0,4,compressedStat.size-4);}finally{fs.closeSync(handle);}
  assert.equal(tail.readUInt32LE(),129377850);assert.ok(tail.readUInt32LE()<=MAX_SNAPSHOT);
  // Source APIs read only this pre-existing synthetic snapshot. All library
  // temp/app/server paths, including user-data's import-time temp mkdir, are private.
  Object.assign(process.env,{BUYER_LOG_LOCAL_DATA_ROOT:SOURCE,BUYER_LOG_LOCAL_DB:path.join(out,'private/unused.db'),
    BUYER_LOG_TEMP_ROOT:path.join(out,'private/tmp'),BUYER_LOG_DATA_ROOT:path.join(out,'private/app'),
    BUYER_LOG_SERVER_DATA_ROOT:path.join(out,'private/server'),BUYER_LOG_AUTH_DATA_ROOT:path.join(out,'private/auth')});
  const {createComputePool}=require(path.join(APP,'server/lib/compute-pool'));
  const {createComputeService}=require(path.join(APP,'server/lib/compute-service'));
  const codec=require(path.join(APP,'server/lib/compute-source-codec'));
  // Exactly the production createComputeService pool defaults. Observer changes
  // neither worker source, resource limits, worker count nor byte admission.
  pool=createComputePool({WorkerClass:ObservedWorker,maxPendingBytes:512*MIB});
  fs.mkdirSync(path.join(out,'private'),{recursive:true});service=createComputeService({pool,root:path.join(out,'private')});
  result.productionAdmission=service.stats();
  result.memory.push({stage:'before-source-load',...memory()});
  let source=await stage('native-snapshot-load',()=>require(path.join(APP,'server/lib/model-snapshot')).loadModelSnapshotAsync('moderator'));
  assert.ok(source);assert.equal(source._snapshotMetrics.fallback,false);assert.equal(source.loadedAt,'2026-11-07T20:44:58.203Z');
  assert.equal(source.sources.asas,'Excel: ASAS - Demo.xlsx');assert.equal(source.asasOrders.length,30000);
  const rawFor=target=>source.asasOrdersByTarget?.[target]||source.asasOrders;
  let cp=rawFor('cp'),orders=rawFor('orders');
  assert.equal(orders.length,30000);assert.equal(cp.length,30000);
  const sameRows=cp.every((row,index)=>row===orders[index]);
  const sameAntrepo=(source.antrepoMapByTarget?.cp||source.antrepoMap)===(source.antrepoMapByTarget?.orders||source.antrepoMap);
  result.sourceTopology={rows:orders.length,sameRowsByOriginalOrdinal:sameRows,sameAntrepo,loadedAt:source.loadedAt,sources:source.sources};
  if(!sameRows||!sameAntrepo){
    result.blockedEligibility={reason:'actual source topology is not shared',...result.sourceTopology};
    throw Object.assign(Error('Native source topology cannot establish known Orders schema; no alias fabrication'),{code:'READY_COST_TOPOLOGY_UNKNOWN'});
  }
  await stage('augment-true-ASAS-model-extras',async()=>{
    for(let ordinal=0;ordinal<orders.length;ordinal++){
      const row=orders[ordinal];assert.ok(row&&typeof row==='object');
      row._cpExtra??={};for(let index=0;index<KEYS.length;index++){assert.equal(Object.hasOwn(row._cpExtra,KEYS[index]),false);row._cpExtra[KEYS[index]]=modelValue(ordinal,index);}
    }
  });
  const ownerId='moderator',generation='synthetic-ready-cost:'+SNAPSHOT_SHA.slice(0,20)+':model-extras-v1';
  let encoded=await stage('actual-V8-source-charge',async()=>codec.encode({ownerId,generation,source}));
  const encodedBytes=encoded.bytes.length,encodedSha=encoded.checksum;
  result.sourceCharge={encodedBytes,encodedSha256:encodedSha,uncompressedBytesPassedToSeed:encodedBytes,
    privateDiskReservationBytes:encodedBytes*2+MIB,encodedGraphAlreadyMaterialized:true};
  assert.ok(encodedBytes>0&&encodedBytes<=MAX_REPLICA,'Bounded probe replica limit; no downcharging or retry');
  const disk=fs.statfsSync(out);assert.ok(Number(disk.bavail)*Number(disk.bsize)>=encodedBytes*2+129*MIB,'Insufficient disk for honest source admission');
  encoded=null;global.gc();
  const seedStart=result.ipc.length;
  let descriptor=await stage('native-seed-source',()=>service.seedSource({ownerId,generation,source,uncompressedBytes:encodedBytes}));
  // Structured clone can change V8 packed/indexed encoding while preserving the
  // graph. The actual worker-produced replica checksum is the descriptor truth.
  assert.equal(await fileSha(descriptor.replicaFile),descriptor.checksum);
  result.sourceCharge.nativeReplicaBytes=fs.statSync(descriptor.replicaFile).size;
  result.sourceCharge.nativeReplicaSha256=descriptor.checksum;
  result.sourceCharge.poolAfterSeed=pool.stats();
  result.sourceCharge.seedIpc=result.ipc.slice(seedStart);
  result.descriptor={...descriptor,capabilitySha256:sha(descriptor.capability)};delete result.descriptor.capability;
  source=null;cp=null;orders=null;global.gc();
  result.memory.push({stage:'after-main-source-release',...memory()});
  const access=require(path.join(APP,'server/lib/compute-access')).createAccessContext({userId:ownerId,systemRole:'moderator',manageAll:true,
    viewScope:{all:true},editScopes:{all:true},authority:{},profiles:[]});
  const baseParams={modules:['orders'],overrides:{},horizons:{},cpAllowed:true,summaryAllowed:true,access,
    calendar:{configured:false},cpModelColumns:DEFINITIONS,moduleSchemaExposureCp:true,moduleSchemaTargetKnownCp:true,
    moduleSchemaBindingsKnownCp:true,moduleSchemaExposureOrders:true,moduleSchemaTargetKnownOrders:true,moduleSchemaBindingsKnownOrders:true};
  // Local diagnostic policy, explicitly bound to actual params and actual source.
  // It does not purport to be a live HTTP/session authorization decision.
  const contextHash=sha(JSON.stringify({policy:'synthetic-moderator-all-source-rows-v1',params:baseParams,sourceChecksum:descriptor.checksum,day:expectedDay}));
  const appVersion=JSON.parse(fs.readFileSync(path.join(APP,'package.json'),'utf8')).version;
  activeLease=await job('projection-plan',descriptor,{...baseParams,projectionContextHash:contextHash,appVersion});
  const plan=activeLease.value;result.plan=plan;activeLease.release();activeLease=null;
  assert.equal(plan.sourceProjectionKeys.orders,descriptor.projectionKeys.orders);
  result.projectionParams=baseParams;result.projectionContextHash=contextHash;
  global.gc();result.memory.push({stage:'before-measured-pipeline',...memory()});
  monitor=setInterval(()=>{const m=memory();if(!result.mainHeapSamplePeak||m.heapUsed>result.mainHeapSamplePeak.heapUsed)result.mainHeapSamplePeak=m;if(!result.rssSamplePeak||m.rss>result.rssSamplePeak.rss)result.rssSamplePeak=m;},100);
  const pipelineStart=performance.now();
  activeLease=await job('projections',descriptor,{...baseParams,...(arm==='B'?{collectModuleSchemas:true}:{})},arm==='A'?'native-full-projection':'native-full-plus-schema-projection');
  const fullValue=activeLease.value,fullBuffer=Buffer.from(fullValue.compressed.orders.buffer);
  assert.equal(fullValue.sourceProjectionKeys.orders,descriptor.projectionKeys.orders);
  const fullBytes=fullValue.compressed.orders.uncompressedBytes,fullChecksum=sha(fullBuffer);
  assert.ok(fullBytes>0&&fullBytes<=MAX_FULL);
  let selectedBuffer=fullBuffer,readyParams=null;
  if(arm==='B'){
    const schema=fullValue.moduleSchemas?.orders;
    if(schema?.status!=='known'){
      result.blockedEligibility={reason:'actual projection callback returned unknown/null schema',moduleSchemas:fullValue.moduleSchemas||null,fullGzipBytes:fullBuffer.length,fullJsonBytes:fullBytes};
      throw Object.assign(Error('No invented schema authority; native full cost retained'),{code:'READY_COST_SCHEMA_UNKNOWN'});
    }
    assert.equal(schema.rowCount,30000);
    const projectionPin={schemaVersion:2,cacheGeneration:'synthetic-page:'+sha(JSON.stringify([descriptor.checksum,plan.inputKeys.orders,contextHash,fullChecksum])).slice(0,32),
      sourceLoadedAt:descriptor.loadedAt,sourceRevisionKey:descriptor.checksum,module:'orders',moduleInputKey:plan.inputKeys.orders,
      sourceProjectionKey:descriptor.projectionKeys.orders,contextHash,checksum:fullChecksum,uncompressedBytes:fullBytes};
    const token={ownerId,actorId:ownerId,module:'orders',sourceGeneration:projectionPin.cacheGeneration,
      sourceRevision:sha(JSON.stringify([projectionPin.sourceRevisionKey,fullChecksum])),moduleInputKey:projectionPin.moduleInputKey,
      sourceProjectionKey:projectionPin.sourceProjectionKey,accessHash:access.accessHash,contextHash,planRevision:'0',requestGeneration:'cost-probe-1'};
    const viewInfo={ownerId,actorId:ownerId,sourceKey:descriptor.projectionKeys.orders,sourceGeneration:token.sourceGeneration,
      accessHash:access.accessHash,planEpoch:0,fullJsonBytes:fullBytes}; // No eager full JSON parse/hash on main.
    require(path.join(APP,'server/lib/projection-view-core')).bindProjectionPin(token,projectionPin);
    readyParams={projectionBuffer:fullBuffer,projectionCompressedBytes:fullBuffer.length,projectionBytes:fullBytes,
      projectionChecksum:fullChecksum,projectionPin,computeGeneration:descriptor.generation,token,viewInfo,schema,omittedKeys:KEYS};
    result.readyParameters={...readyParams,projectionBuffer:{bytes:fullBuffer.length,sha256:fullChecksum}};
    // Full gzip remains an actual retained input. Releasing this output lease is
    // correct only after that exact gzip is synchronously serialized by run().
    // Hold the original lease during admission/execution so native accounting is
    // conservative and cannot hide an overlapping retained output buffer.
    const fullLease=activeLease;activeLease=null;
    try{activeLease=await job('projection-ready-orders',descriptor,readyParams);}
    finally{fullLease.release();}
    if(activeLease.value.kind!=='ready'){
      result.blockedEligibility={reason:'native ready task returned full fallback',kind:activeLease.value.kind,nativeReason:activeLease.value.reason||null};
      throw Object.assign(Error('Legitimate full fallback is not a ready/eligible cost result'),{code:'READY_COST_FULL_FALLBACK'});
    }
    selectedBuffer=Buffer.from(activeLease.value.buffer);
    assert.equal(sha(selectedBuffer),activeLease.value.checksum);
    result.readyInfo=activeLease.value.info;
  }else assert.equal(Object.hasOwn(fullValue,'moduleSchemas'),false,'Ordinary full baseline must not collect schema');
  result.pipelineWallMs=performance.now()-pipelineStart;
  clearInterval(monitor);monitor=null;
  result.memory.push({stage:'after-measured-pipeline-before-parse',...memory()});
  result.output={fullGzipBytes:fullBuffer.length,fullGzipSha256:fullChecksum,fullJsonBytes:fullBytes,
    selectedGzipBytes:selectedBuffer.length,selectedGzipSha256:sha(selectedBuffer),selectedJsonBytes:arm==='B'?activeLease.value.uncompressedBytes:fullBytes};
  result.workerHeapAfterPipeline=[];
  for(const worker of workers)if(worker.threadId>0&&typeof worker.getHeapStatistics==='function'){
    // The pool unrefs idle workers. Keep this observer alive only while awaiting
    // its post-timing statistics; the measurement and production pool are unchanged.
    worker.ref();
    try{result.workerHeapAfterPipeline.push({threadId:worker.threadId,statistics:await worker.getHeapStatistics(),timing:'after measured pipeline'});}
    catch(error){result.workerHeapAfterPipeline.push({threadId:worker.threadId,unavailable:error.message});}
    finally{worker.unref();}
  }
  result.equivalence=await stage('post-timing-full-normalization-and-ordinal-restoration',()=>verify(fullBuffer,selectedBuffer,descriptor,readyParams));
  activeLease.release();activeLease=null;
  assert.equal(pool.stats().leasedOutputBytes,0);assert.equal(await fileSha(SNAPSHOT),SNAPSHOT_SHA,'Original snapshot remains unchanged');
  assert.equal(localDay(),expectedDay);result.status='passed';
})().catch(error=>{result.status='failed';result.error={name:error.name,code:error.code||null,message:error.message,stack:error.stack,computeMetrics:error.computeMetrics||null};process.exitCode=1;})
  .finally(async()=>{
    clearInterval(monitor);
    try{await shutdown();}catch(error){result.status='failed';result.shutdownError={code:error.code||null,message:error.message};process.exitCode=1;}
    result.finishedAt=iso();result.memory.push({stage:'after-native-close',...memory()});save('result.json',result);
    console.log(JSON.stringify({status:result.status,arm,pipelineWallMs:result.pipelineWallMs,error:result.error||null,nativeWorkerExitsVerified:result.nativeWorkerExitsVerified}));
  });
