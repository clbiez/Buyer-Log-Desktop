'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createComputePool}=require('./compute-pool');
const {captureAntrepoMetadata}=require('./compute-source-codec');
const {accessForTask}=require('./compute-task-access');
const {serializeForTransfer}=require('./compute-ipc');
const MiB=1024*1024;
function failure(code){
    const messages={COMPUTE_SOURCE_TOO_LARGE:['Kaynak kopyası bayt bütçesine sığmıyor.','Source replica exceeds the byte budget.',413],COMPUTE_SOURCE_OWNER_MISMATCH:['Kaynak sahibi uyuşmuyor.','Source owner mismatch.',403],COMPUTE_STALE_GENERATION:['Kaynak sürümü değişti.','Source generation changed.',409],COMPUTE_POOL_CLOSED:['Hesaplama havuzu kapalı.','Compute pool is closed.',503],COMPUTE_JOB_INVALID:['Geçersiz hesaplama isteği.','Invalid compute request.',400],COMPUTE_ABORTED:['Hesaplama iptal edildi.','Compute operation cancelled.',499],COMPUTE_TIMEOUT:['Hesaplama zaman aşımına uğradı.','Compute operation timed out.',504],COMPUTE_QUEUE_BUSY:['Hesaplama kuyruğu dolu; tekrar deneyin.','Compute queue is full; retry later.',503]};
  const [tr,en,statusCode]=messages[code];return Object.assign(Error(`${tr} / ${en}`),{code,statusCode,errorEn:en});
}
function createComputeService({pool,root,diskBudgetBytes=2*1024*MiB}={}){
  if(!Number.isSafeInteger(diskBudgetBytes)||diskBudgetBytes<1)throw Error('Invalid source replica byte budget');
  pool??=createComputePool({maxPendingBytes:512*MiB});
  const privateRoot=fs.mkdtempSync(path.join(root||os.tmpdir(),'buyerlog-source-replicas-'));
  fs.chmodSync(privateRoot,0o700);
  const records=new Map(),current=new Map(),preparing=new Map();let reservedDiskBytes=0,closed=false,closing,warming,authorityGeneration=0;
  const lflDescriptors=new WeakSet(),lflAdmissions=new Map();
  let localTail=Promise.resolve(),localPending=0;
  // A rejected worker admission has allocated no worker input. The source is
  // already resident in the server (or can be read from its verified personal
  // snapshot), so retain the pre-pool capacity without another structured clone.
  // Only this specific admission failure takes the serialized compatibility path.
  function locally(operation){
    if(localPending>=64)return Promise.reject(failure('COMPUTE_QUEUE_BUSY'));
    localPending++;
    const pending=localTail.then(async()=>{await new Promise(setImmediate);if(closed)throw failure('COMPUTE_POOL_CLOSED');return operation();}).finally(()=>{localPending--;});
    localTail=pending.then(()=>{},()=>{});return pending;
  }
  async function runLocal(task,record,params,options={}){
    const queuedAt=performance.now(),deadline=queuedAt+(options.timeoutMs??600000);
    const assertCurrent=()=>{
      if(closed)throw failure('COMPUTE_POOL_CLOSED');
      if(record.retired||current.get(record.owner)!==record.generation)throw failure('COMPUTE_STALE_GENERATION');
      if(options.signal?.aborted)throw failure('COMPUTE_ABORTED');
      if(performance.now()>deadline)throw failure('COMPUTE_TIMEOUT');
    };
    return locally(async()=>{
      assertCurrent();const started=performance.now(),transfer=[];
      const sourceIndependent=['projection-envelope','cp-image-registry','cp-shared-edit-codes'].includes(task);
      let source=record.liveSource||record.sourceRef?.deref();
      if(!source&&!sourceIndependent&&record.descriptor.replicaFile){
        source=require('./compute-source-codec').decode(await fs.promises.readFile(record.descriptor.replicaFile),record.descriptor);
      }else if(!source&&!sourceIndependent){
        source=await require('./model-snapshot').loadModelSnapshotAsync(record.owner);
      }
      assertCurrent();
      if(!sourceIndependent&&record.descriptor.loadedAt!=null&&String(source?.loadedAt||source?.savedAt||'')!==String(record.descriptor.loadedAt))throw failure('COMPUTE_STALE_GENERATION');
      const value=await require('../workers/compute-worker').execute(task,{ownerId:record.owner,source:record.descriptor,params:{...params}},transfer,source||{asasOrders:[],antrepoMap:{}});
      assertCurrent();
      const metadata=value.sourceMeta||value.runtimeMeta;
      return {value,metrics:{threadId:0,fallbackReason:'COMPUTE_JOB_TOO_LARGE',queueWaitMs:started-queuedAt,durationMs:performance.now()-started,
        outputBytes:transfer.reduce((sum,buffer)=>sum+buffer.byteLength,0)+(metadata?require('node:v8').serialize(metadata).byteLength*4:0)+1024},release(){}};
    });
  }
  const key=(owner,generation)=>JSON.stringify([String(owner),String(generation)]),poolOwner=owner=>'source:'+owner;
  async function discard(record){
    if(record.removing||record.pins||!record.retired)return;
    record.removing=true;
    try{
      if(record.descriptor.replicaFile)await fs.promises.rm(record.descriptor.replicaFile,{force:true,maxRetries:3,retryDelay:50});
      if(records.get(record.key)===record)records.delete(record.key);reservedDiskBytes-=record.diskBytes;record.diskBytes=0;
      record.liveSource=null;record.sourceRef=null;
    }catch{record.removing=false;/* Windows: açık native okuma bitene kadar baytlar ücretli kalır. */}
  }
  function advance(owner,generation){
    current.set(owner,generation);pool.setGeneration(poolOwner(owner),generation);
    // Cached output leases may outlive a refresh; they must not keep the old
    // resident source alive. A running local task already holds its own reference.
    for(const record of records.values())if(record.owner===owner&&record.generation!==generation){record.retired=true;record.liveSource=null;record.sourceRef=null;void discard(record);}
  }
  function retireSource(ownerId){
    const owner=String(ownerId||'');if(!owner)return;
    preparing.delete(owner);current.delete(owner);
    const retired='retired:'+crypto.randomBytes(16).toString('hex');
    pool.setGeneration(poolOwner(owner),retired);pool.setGeneration('prepare:'+owner,retired);
    for(const record of records.values())if(record.owner===owner){record.retired=true;record.liveSource=null;record.sourceRef=null;void discard(record);}
  }
  async function seedSource({ownerId,generation,source,uncompressedBytes,publish=true}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const owner=String(ownerId||''),version=String(generation||'');
    if(!owner||!version||!Number.isSafeInteger(uncompressedBytes)||uncompressedBytes<1)throw failure('COMPUTE_SOURCE_TOO_LARGE');
    const id=key(owner,version),known=records.get(id);if(known&&!known.retired)return known.ready;
    const diskBytes=uncompressedBytes*2+MiB;
    if(!Number.isSafeInteger(diskBytes)||reservedDiskBytes+diskBytes>diskBudgetBytes)throw failure('COMPUTE_SOURCE_TOO_LARGE');
    const replicaFile=path.join(privateRoot,crypto.randomBytes(24).toString('hex')+'.v8');
    const descriptor={ownerId:owner,generation:version,loadedAt:source.loadedAt||null,replicaFile,capability:crypto.randomBytes(24).toString('hex'),bytes:Math.max(64*MiB,uncompressedBytes*4)};
    const record={key:id,owner,generation:version,descriptor,diskBytes,pins:1,retired:false,liveSource:source};
    reservedDiskBytes+=diskBytes;records.set(id,record);preparing.set(owner,version);
    const preparationOwner='prepare:'+owner;pool.setGeneration(preparationOwner,version);
    record.ready=(async()=>{
      let lease;
      try{
        try{
          lease=await pool.run('seed-source',{ownerId:owner,generation:version,source,antrepoMetadata:captureAntrepoMetadata(source),replicaFile,maxBytes:diskBytes},
            {ownerKey:preparationOwner,generation:version,priority:'background',estimatedBytes:96*MiB+uncompressedBytes*12,inputBytes:uncompressedBytes*2});
        }catch(error){
          if(error?.code!=='COMPUTE_JOB_TOO_LARGE')throw error;
          await locally(()=>{
            if(preparing.get(owner)!==version)throw failure('COMPUTE_STALE_GENERATION');
            delete descriptor.replicaFile;descriptor.inlineSource=true;
            descriptor.projectionKeys=Object.freeze({...require('../workers/compute-worker').projectionSourceKeys(source)});
            reservedDiskBytes-=record.diskBytes;record.diskBytes=0;
          });
          Object.freeze(descriptor);if(publish)advance(owner,version);return descriptor;
        }
        if(preparing.get(owner)!==version)throw failure('COMPUTE_STALE_GENERATION');
        descriptor.checksum=lease.value.checksum;descriptor.loadedAt=lease.value.loadedAt;
        descriptor.projectionKeys=Object.freeze({...lease.value.projectionKeys});
        // The runtime owns this source. A weak reference avoids a second load
        // for a live fallback without extending an inactive user's lifetime.
        record.sourceRef=new WeakRef(source);record.liveSource=null;
        reservedDiskBytes-=record.diskBytes-lease.value.fileBytes;record.diskBytes=lease.value.fileBytes;
        Object.freeze(descriptor);if(publish)advance(owner,version);return descriptor;
      }catch(error){record.retired=true;throw error;}
      finally{lease?.release();record.pins--;void discard(record);}
    })();return record.ready;
  }
  async function publishSource(descriptor){
    const record=records.get(key(descriptor?.ownerId,descriptor?.generation));
    if(!record||record.descriptor.capability!==descriptor.capability)throw failure('COMPUTE_SOURCE_OWNER_MISMATCH');
    await record.ready;if(record.retired||preparing.get(record.owner)!==record.generation)throw failure('COMPUTE_STALE_GENERATION');
    advance(record.owner,record.generation);return descriptor;
  }
  async function coldSource({ownerId,generation,loadedAt=null,uncompressedBytes,replace=false}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const owner=String(ownerId||''),version=String(generation||''),id=key(owner,version);
    const existing=records.get(id);if(existing&&!existing.retired)return existing.ready;
    if(!replace&&current.has(owner)&&current.get(owner)!==version)throw failure('COMPUTE_STALE_GENERATION');
    if(!owner||!version||!Number.isSafeInteger(uncompressedBytes)||uncompressedBytes<1)throw failure('COMPUTE_SOURCE_TOO_LARGE');
    const descriptor=Object.freeze({ownerId:owner,generation:version,loadedAt,capability:crypto.randomBytes(24).toString('hex'),bytes:Math.max(64*MiB,uncompressedBytes*4)});
    const record={key:id,owner,generation:version,descriptor,diskBytes:0,pins:0,retired:false,ready:Promise.resolve(descriptor)};
    records.set(id,record);advance(owner,version);return descriptor;
  }
  async function run(task,descriptor,params={},options={}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const owner=String(descriptor?.ownerId||''),version=String(descriptor?.generation||''),record=records.get(key(owner,version));
    if(current.has(owner)&&current.get(owner)!==version)throw failure('COMPUTE_STALE_GENERATION');
    if(!record||record.descriptor.capability!==descriptor.capability)throw failure('COMPUTE_SOURCE_OWNER_MISMATCH');
    if(params.access&&String(params.access.userId)!==owner)throw failure('COMPUTE_SOURCE_OWNER_MISMATCH');
    if(current.get(owner)!==version||record.retired)throw failure('COMPUTE_STALE_GENERATION');
    await record.ready;record.pins++;
    try{
      // Küçük karar/sorgu DTO'su bir kez kodlanır. Kuyruk gerçek girdi
      // baytını ücretler; büyük ham kaynak bu yoldan tekrar taşınmaz.
      const jobParams=params.access?{...params,access:accessForTask(params.access,task,params)}:params;
      let lease,paramsSerializeMs=0,inputBytes=1024;
      if(record.descriptor.inlineSource)lease=await runLocal(task,record,jobParams,options);
      else{
        const encodeStarted=performance.now(),paramsBytes=serializeForTransfer(jobParams);
        paramsSerializeMs=performance.now()-encodeStarted;inputBytes=paramsBytes.byteLength+1024;
        const estimate=task==='cp-shared-edit-codes'?96*MiB+inputBytes*8:(task==='backlog-workbook'?256*MiB+record.descriptor.bytes*6:96*MiB+record.descriptor.bytes*3)+inputBytes*3;
        try{
          lease=await pool.run(task,{ownerId:owner,source:record.descriptor,paramsBytes},{ownerKey:poolOwner(owner),generation:version,priority:'interactive',
            ...options,estimatedBytes:estimate,inputBytes,transferList:[paramsBytes]});
        }catch(error){
          if(error?.code!=='COMPUTE_JOB_TOO_LARGE')throw error;
          lease=await runLocal(task,record,jobParams,options);
        }
      }
      if(current.get(owner)!==version||record.retired){lease.release();throw failure('COMPUTE_STALE_GENERATION');}
      let released=false;return {...lease,metrics:{...lease.metrics,paramsSerializeMs,paramsBytes:inputBytes-1024},release(){if(released)return;released=true;lease.release();record.pins--;void discard(record);}};
    }catch(error){record.pins--;void discard(record);throw error;}
  }
  function bindColdSource(descriptor,loadedAt,projectionKeys){
    const record=records.get(key(descriptor?.ownerId,descriptor?.generation));
    if(!record||record.descriptor.capability!==descriptor.capability)throw failure('COMPUTE_SOURCE_OWNER_MISMATCH');
    if(record.retired||current.get(record.owner)!==record.generation)throw failure('COMPUTE_STALE_GENERATION');
    if(record.descriptor.loadedAt&&String(record.descriptor.loadedAt)!==String(loadedAt))throw failure('COMPUTE_STALE_GENERATION');
    record.descriptor=Object.freeze({...record.descriptor,loadedAt:loadedAt||null,...(projectionKeys?{projectionKeys:Object.freeze({...projectionKeys})}:{})});return record.descriptor;
  }
  function warm(){
    if(warming)return warming;
    warming=Promise.allSettled(Array.from({length:pool.stats().maxWorkers},()=>pool.run('health',{},
      {ownerKey:'pool-warm',generation:'1',priority:'background',estimatedBytes:64*MiB,inputBytes:0}))).then(results=>{
      for(const result of results)if(result.status==='fulfilled')result.value.release();
      const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    });return warming;
  }
  async function runExcelUtility(task,payload,{ownerId='system',...options}={}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    if(!['previewFxWorkbookFromDirectories','loadFxWorkbookFromDirectories'].includes(task))throw failure('COMPUTE_JOB_INVALID');
    const started=performance.now(),encoded=serializeForTransfer({excelTask:task,excelPayload:payload}),inputBytes=encoded.byteLength+1024;
    const paramsSerializeMs=performance.now()-started,estimatedBytes=256*MiB+inputBytes*8;
    const lease=await pool.run('excel-utility',{paramsBytes:encoded,maxOutputBytes:estimatedBytes},
      {ownerKey:'utility:'+String(ownerId),generation:'1',...options,estimatedBytes,inputBytes,transferList:[encoded]});
    return {...lease,metrics:{...lease.metrics,paramsSerializeMs,paramsBytes:inputBytes-1024}};
  }
  async function runOffice(ownerId,job,options={}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    if(!ownerId||!['xlsx','pptx'].includes(job?.format))throw failure('COMPUTE_JOB_INVALID');
    const started=performance.now(),encoded=serializeForTransfer(job),inputBytes=encoded.byteLength+1024;
    if(inputBytes>128*MiB)throw failure('COMPUTE_SOURCE_TOO_LARGE');
    const cells=job.format==='xlsx'?(job.data.sheets||[]).reduce((sum,sheet)=>sum+(sheet.rows||[]).length*(sheet.columns||[]).length,0)
      :(job.data.slides||[]).reduce((sum,slide)=>sum+(slide.items||[]).length*16+(slide.table?.rows||[]).reduce((count,row)=>count+(Array.isArray(row)?row.length:0),0),0);
    const paramsSerializeMs=performance.now()-started,estimatedBytes=256*MiB+inputBytes*8+cells*2048;
    const lease=await pool.run('office-render',{paramsBytes:encoded,maxOutputBytes:estimatedBytes},
      {ownerKey:'output:'+String(ownerId),generation:'1',priority:'interactive',...options,estimatedBytes,inputBytes,transferList:[encoded]});
    return {...lease,metrics:{...lease.metrics,paramsSerializeMs,paramsBytes:inputBytes-1024}};
  }
  async function encodeLocalDbSnapshot(state){
    const started=performance.now();
    const local=fallbackReason=>({value:{buffer:require('./large-json').jsonToBuffer(state),revision:state.revision},
      metrics:{threadId:0,paramsSerializeMs:performance.now()-started,...(fallbackReason?{fallbackReason}:{})},release(){}});
    // The shared pool is an optimization, not a new prerequisite for durable
    // writes. Retain large-json capacity and JSON-compatible toJSON behavior.
    if(closed)return local('COMPUTE_POOL_CLOSED');
    let snapshotBytes;
    try{snapshotBytes=serializeForTransfer(state);}catch{return local('COMPUTE_INPUT_ENCODING');}
    const inputBytes=snapshotBytes.byteLength+1024;
    // Small checkpoints do not justify worker scheduling. Keep their old bytes.
    if(snapshotBytes.byteLength<256*1024)return local();
    const paramsSerializeMs=performance.now()-started,estimatedBytes=96*MiB+inputBytes*8;
    try{
      const lease=await pool.run('local-db-snapshot',{snapshotBytes,maxOutputBytes:estimatedBytes},
        {ownerKey:'local-db-snapshot',generation:'1',priority:'background',estimatedBytes,inputBytes,transferList:[snapshotBytes]});
      return {...lease,metrics:{...lease.metrics,paramsSerializeMs,paramsBytes:inputBytes-1024}};
    }catch(error){
      if(!['COMPUTE_JOB_TOO_LARGE','COMPUTE_QUEUE_BUSY','COMPUTE_POOL_CLOSED','COMPUTE_TIMEOUT','COMPUTE_WORKER_FAILED','COMPUTE_ESTIMATE_EXCEEDED'].includes(error?.code))throw error;
      snapshotBytes=null;return local(error.code);
    }
  }
  async function runEndeksmatikStatus(ownerId,descriptor){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const engine=require('./endeksmatik');
    if(!ownerId||![engine.PERSISTED_FILE,engine.DEFAULT_FILE].includes(descriptor?.file))throw failure('COMPUTE_JOB_INVALID');
    const ownerKey='endeksmatik-status:'+String(ownerId),generation=String(descriptor.tag||'');pool.setGeneration(ownerKey,generation);
    let handle,rawBytes;
    try{
      handle=await fs.promises.open(descriptor.file,'r');const stat=await handle.stat();
      if(stat.size<4)throw failure('COMPUTE_JOB_INVALID');
      const tail=Buffer.alloc(4);await handle.read(tail,0,4,stat.size-4);rawBytes=Math.max(MiB,tail.readUInt32LE(0));
    }finally{await handle?.close();}
    const paramsBytes=serializeForTransfer({descriptor,maxOutputLength:rawBytes}),inputBytes=paramsBytes.byteLength+1024;
    return pool.run('endeksmatik-legacy-status',{paramsBytes},{ownerKey,generation,priority:'interactive',estimatedBytes:96*MiB+rawBytes*8,inputBytes,transferList:[paramsBytes]});
  }
  async function collectionLflSource(ownerId){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const descriptor=await require('./compute-snapshot-descriptor').collectionLflDescriptor(ownerId);lflDescriptors.add(descriptor);return descriptor;
  }
  async function runCollectionLfl(task,descriptor,params={}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    if(!['collection-lfl-source-info','collection-lfl-references'].includes(task))throw failure('COMPUTE_JOB_INVALID');
    if(!lflDescriptors.has(descriptor)||String(params.access?.userId)!==descriptor.ownerId)throw failure('COMPUTE_SOURCE_OWNER_MISMATCH');
    const ownerKey='collection-lfl:'+descriptor.ownerId,generation=descriptor.generation;
    // Serialize only the check/admission. An old request cannot roll the pool
    // generation back while a newer snapshot is being admitted.
    const prior=lflAdmissions.get(ownerKey)||Promise.resolve();
    const admission=prior.catch(()=>{}).then(async()=>{
      await require('./compute-snapshot-descriptor').assertCollectionLflDescriptor(descriptor);
      if(closed)throw failure('COMPUTE_POOL_CLOSED');
      const started=performance.now(),paramsBytes=serializeForTransfer({...params,access:accessForTask(params.access,task)});
      const paramsSerializeMs=performance.now()-started,inputBytes=paramsBytes.byteLength+1024;
      pool.setGeneration(ownerKey,generation);
      const promise=pool.run(task,{ownerId:descriptor.ownerId,source:descriptor,paramsBytes},
        {ownerKey,generation,priority:'interactive',estimatedBytes:96*MiB+descriptor.bytes*3+inputBytes*3,inputBytes,transferList:[paramsBytes]});
      // Attach a rejection handler during admission without holding the lane
      // until execution finishes.
      promise.catch(()=>{});return {promise,paramsSerializeMs,inputBytes};
    });
    lflAdmissions.set(ownerKey,admission);
    let admitted;
    try{admitted=await admission;}finally{if(lflAdmissions.get(ownerKey)===admission)lflAdmissions.delete(ownerKey);}
    let lease;
    try{lease=await admitted.promise;}
    catch(error){
      // Admission rejected before a worker was allocated. Use the same serial
      // compatibility lane as other oversized reads, without a second source copy.
      if(error?.code!=='COMPUTE_JOB_TOO_LARGE')throw error;
      lease=await locally(async()=>{
        const assertCurrent=async()=>{
          if(closed)throw failure('COMPUTE_POOL_CLOSED');
          await require('./compute-snapshot-descriptor').assertCollectionLflDescriptor(descriptor);
        };
        await assertCurrent();const started=performance.now(),transfer=[];
        const source=await require('./model-snapshot').loadModelSnapshotAsync(descriptor.ownerId);
        await assertCurrent();
        const value=await require('../workers/compute-worker').execute(task,{ownerId:descriptor.ownerId,source:descriptor,
          params:{...params,access:accessForTask(params.access,task)}},transfer,source);
        await assertCurrent();
        return {value,metrics:{threadId:0,fallbackReason:'COMPUTE_JOB_TOO_LARGE',durationMs:performance.now()-started},release(){}};
      });
    }
    try{await require('./compute-snapshot-descriptor').assertCollectionLflDescriptor(descriptor);}
    catch(error){lease.release();throw error;}
    return {...lease,metrics:{...lease.metrics,paramsSerializeMs:admitted.paramsSerializeMs,paramsBytes:admitted.inputBytes-1024}};
  }
  async function hashAccessAuthority(authority,{onMetrics}={}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const generation=String(++authorityGeneration);
    pool.setGeneration('access-authority',generation);
    const assertCurrent=()=>{if(closed)throw failure('COMPUTE_POOL_CLOSED');if(String(authorityGeneration)!==generation)throw failure('COMPUTE_STALE_GENERATION');};
    const {bytes:encoded,...encodeMetrics}=await require('./compute-authority-codec').encodeAuthority(authority,{assertCurrent});
    assertCurrent();const inputBytes=encoded.byteLength+1024;
    let lease;
    try{
      lease=await pool.run('access-authority-hash',{authorityBytes:encoded},{ownerKey:'access-authority',generation,priority:'interactive',estimatedBytes:96*MiB+inputBytes*8,inputBytes,transferList:[encoded]});
    }catch(error){
      if(error?.code!=='COMPUTE_JOB_TOO_LARGE')throw error;
      lease=await locally(async()=>{
        assertCurrent();const value=await require('../workers/compute-worker').execute('access-authority-hash',{params:authority},[]);assertCurrent();
        return {value,metrics:{threadId:0,fallbackReason:'COMPUTE_JOB_TOO_LARGE'},release(){}};
      });
    }
    try{try{onMetrics?.({...lease.metrics,...encodeMetrics,paramsBytes:inputBytes-1024});}catch{}return lease.value.authorityHash;}
    finally{lease.release();}
  }
  function stats(){return {diskBudgetBytes,reservedDiskBytes,sourceFiles:[...records.values()].filter(record=>Boolean(record.descriptor.replicaFile)).length,liveSources:[...records.values()].filter(record=>Boolean(record.liveSource)).length,...pool.stats()};}
  function close(){
    if(closing)return closing;closed=true;
    closing=(async()=>{await pool.close();await localTail;await Promise.allSettled([...records.values()].map(record=>record.ready));await fs.promises.rm(privateRoot,{recursive:true,force:true,maxRetries:3,retryDelay:50});records.clear();current.clear();preparing.clear();reservedDiskBytes=0;})();return closing;
  }
  return {seedSource,publishSource,retireSource,coldSource,bindColdSource,run,runExcelUtility,runOffice,encodeLocalDbSnapshot,runEndeksmatikStatus,collectionLflSource,runCollectionLfl,hashAccessAuthority,warm,stats,close};
}
module.exports={createComputeService};
