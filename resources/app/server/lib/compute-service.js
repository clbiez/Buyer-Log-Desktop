'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const {createComputePool}=require('./compute-pool');
const {captureAntrepoMetadata}=require('./compute-source-codec');
const {accessForTask}=require('./compute-task-access');
const {serializeForTransfer}=require('./compute-ipc');
const MiB=1024*1024;
function failure(code){
  const messages={COMPUTE_SOURCE_TOO_LARGE:['Kaynak kopyası bayt bütçesine sığmıyor.','Source replica exceeds the byte budget.',413],COMPUTE_SOURCE_OWNER_MISMATCH:['Kaynak sahibi uyuşmuyor.','Source owner mismatch.',403],COMPUTE_STALE_GENERATION:['Kaynak sürümü değişti.','Source generation changed.',409],COMPUTE_POOL_CLOSED:['Hesaplama havuzu kapalı.','Compute pool is closed.',503],COMPUTE_JOB_INVALID:['Geçersiz hesaplama isteği.','Invalid compute request.',400]};
  const [tr,en,statusCode]=messages[code];return Object.assign(Error(`${tr} / ${en}`),{code,statusCode,errorEn:en});
}
function createComputeService({pool,root,diskBudgetBytes=2*1024*MiB}={}){
  if(!Number.isSafeInteger(diskBudgetBytes)||diskBudgetBytes<1)throw Error('Invalid source replica byte budget');
  pool??=createComputePool({maxPendingBytes:512*MiB});
  const privateRoot=fs.mkdtempSync(path.join(root||os.tmpdir(),'buyerlog-source-replicas-'));
  fs.chmodSync(privateRoot,0o700);
  const records=new Map(),current=new Map(),preparing=new Map();let reservedDiskBytes=0,closed=false,closing,warming,authorityGeneration=0;
  const lflDescriptors=new WeakSet(),lflAdmissions=new Map(),oabAdmissions=new Map();
  const key=(owner,generation)=>JSON.stringify([String(owner),String(generation)]),poolOwner=owner=>'source:'+owner;
  async function discard(record){
    if(record.removing||record.pins||!record.retired)return;
    record.removing=true;
    try{
      if(record.descriptor.replicaFile)await fs.promises.rm(record.descriptor.replicaFile,{force:true,maxRetries:3,retryDelay:50});
      if(records.get(record.key)===record)records.delete(record.key);reservedDiskBytes-=record.diskBytes;record.diskBytes=0;
    }catch{record.removing=false;/* Windows: açık native okuma bitene kadar baytlar ücretli kalır. */}
  }
  function advance(owner,generation){
    current.set(owner,generation);pool.setGeneration(poolOwner(owner),generation);
    for(const record of records.values())if(record.owner===owner&&record.generation!==generation){record.retired=true;void discard(record);}
  }
  async function seedSource({ownerId,generation,source,uncompressedBytes,publish=true}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    const owner=String(ownerId||''),version=String(generation||'');
    if(!owner||!version||!Number.isSafeInteger(uncompressedBytes)||uncompressedBytes<1)throw failure('COMPUTE_SOURCE_TOO_LARGE');
    const id=key(owner,version),known=records.get(id);if(known)return known.ready;
    const diskBytes=uncompressedBytes*2+MiB;
    if(!Number.isSafeInteger(diskBytes)||reservedDiskBytes+diskBytes>diskBudgetBytes)throw failure('COMPUTE_SOURCE_TOO_LARGE');
    const replicaFile=path.join(privateRoot,crypto.randomBytes(24).toString('hex')+'.v8');
    const descriptor={ownerId:owner,generation:version,loadedAt:source.loadedAt||null,replicaFile,capability:crypto.randomBytes(24).toString('hex'),bytes:Math.max(64*MiB,uncompressedBytes*4)};
    const record={key:id,owner,generation:version,descriptor,diskBytes,pins:1,retired:false};
    reservedDiskBytes+=diskBytes;records.set(id,record);preparing.set(owner,version);
    const preparationOwner='prepare:'+owner;pool.setGeneration(preparationOwner,version);
    record.ready=(async()=>{
      let lease;
      try{
        lease=await pool.run('seed-source',{ownerId:owner,generation:version,source,antrepoMetadata:captureAntrepoMetadata(source),replicaFile,maxBytes:diskBytes},
          {ownerKey:preparationOwner,generation:version,priority:'background',estimatedBytes:96*MiB+uncompressedBytes*12,inputBytes:uncompressedBytes*2});
        if(preparing.get(owner)!==version)throw failure('COMPUTE_STALE_GENERATION');
        descriptor.checksum=lease.value.checksum;descriptor.loadedAt=lease.value.loadedAt;
        descriptor.projectionKeys=Object.freeze({...lease.value.projectionKeys});
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
    const existing=records.get(id);if(existing)return existing.ready;
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
      const encodeStarted=performance.now(),paramsBytes=serializeForTransfer(jobParams);
      const paramsSerializeMs=performance.now()-encodeStarted,inputBytes=paramsBytes.byteLength+1024;
      const estimate=task==='cp-shared-edit-codes'?96*MiB+inputBytes*8:(task==='backlog-workbook'?256*MiB+record.descriptor.bytes*6:96*MiB+record.descriptor.bytes*3)+inputBytes*3;
      const lease=await pool.run(task,{ownerId:owner,source:record.descriptor,paramsBytes},{ownerKey:poolOwner(owner),generation:version,priority:'interactive',
        ...options,estimatedBytes:estimate,inputBytes,transferList:[paramsBytes]});
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
  async function runOabMetadata(ownerId,operation,ref,{assertCurrent=()=>{}}={}){
    if(closed)throw failure('COMPUTE_POOL_CLOSED');
    if(!ownerId||!['seasons','mag','buyer-groups'].includes(operation)||typeof assertCurrent!=='function')throw failure('COMPUTE_JOB_INVALID');
    const metadata=require('./compute-oab-metadata'),ownerKey='oab-filter:'+String(ownerId),normalizedRef=operation==='seasons'?undefined:String(ref??'');
    if(normalizedRef&&Buffer.byteLength(normalizedRef)>4096)throw failure('COMPUTE_JOB_INVALID');
    // Stat ve kabul aynı kullanıcı için sıralıdır. Geciken eski bir stat
    // yeni filtre sürümünün generation'ını geri alamaz.
    const prior=oabAdmissions.get(ownerKey)||Promise.resolve();
    const admission=prior.catch(()=>{}).then(async()=>{
      await assertCurrent();const descriptor=await metadata.descriptor();await assertCurrent();
      if(closed)throw failure('COMPUTE_POOL_CLOSED');
      const started=performance.now(),paramsBytes=serializeForTransfer({operation,ref:normalizedRef,descriptor});
      const paramsSerializeMs=performance.now()-started,inputBytes=paramsBytes.byteLength+1024,estimatedBytes=96*MiB+descriptor.size*8+inputBytes*3;
      pool.setGeneration(ownerKey,descriptor.tag);
      const promise=pool.run('oab-static-metadata',{paramsBytes,maxOutputBytes:estimatedBytes},
        {ownerKey,generation:descriptor.tag,priority:'interactive',estimatedBytes,inputBytes,transferList:[paramsBytes]});
      promise.catch(()=>{});return {promise,descriptor,paramsSerializeMs,inputBytes};
    });
    oabAdmissions.set(ownerKey,admission);let admitted;
    try{admitted=await admission;}finally{if(oabAdmissions.get(ownerKey)===admission)oabAdmissions.delete(ownerKey);}
    const lease=await admitted.promise;
    try{
      await metadata.assertDescriptor(admitted.descriptor);await assertCurrent();
      return {...lease,metrics:{...lease.metrics,paramsSerializeMs:admitted.paramsSerializeMs,paramsBytes:admitted.inputBytes-1024}};
    }catch(error){lease.release();throw error;}
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
    const lease=await admitted.promise;
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
    const lease=await pool.run('access-authority-hash',{authorityBytes:encoded},{ownerKey:'access-authority',generation,priority:'interactive',estimatedBytes:96*MiB+inputBytes*8,inputBytes,transferList:[encoded]});
    try{try{onMetrics?.({...lease.metrics,...encodeMetrics,paramsBytes:inputBytes-1024});}catch{}return lease.value.authorityHash;}
    finally{lease.release();}
  }
  function stats(){return {diskBudgetBytes,reservedDiskBytes,sourceFiles:[...records.values()].filter(record=>Boolean(record.descriptor.replicaFile)).length,...pool.stats()};}
  function close(){
    if(closing)return closing;closed=true;
    closing=(async()=>{await pool.close();await Promise.allSettled([...records.values()].map(record=>record.ready));await fs.promises.rm(privateRoot,{recursive:true,force:true,maxRetries:3,retryDelay:50});records.clear();current.clear();preparing.clear();reservedDiskBytes=0;})();return closing;
  }
  return {seedSource,publishSource,coldSource,bindColdSource,run,runExcelUtility,runOffice,runOabMetadata,runEndeksmatikStatus,collectionLflSource,runCollectionLfl,hashAccessAuthority,warm,stats,close};
}
module.exports={createComputeService};
