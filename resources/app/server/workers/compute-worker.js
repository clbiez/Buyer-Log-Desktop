'use strict';
const {parentPort,threadId}=require('node:worker_threads'),fs=require('node:fs'),zlib=require('node:zlib'),{promisify}=require('node:util');
const {performance}=require('node:perf_hooks'),codec=require('../lib/compute-source-codec'),tasks=require('../lib/compute-tasks');
const v8=require('node:v8');
const dates=require('../../public/date-dimension'),{createComputeSourceCache}=require('../lib/compute-source-cache');
const access=require('../lib/compute-access'),catalog=require('../lib/collection-catalog');
const {projectionRuntimeMeta}=require('../lib/projection-runtime-meta');
globalThis.BLCanonicalFields=require('../lib/canonical-fields');
const gzip=promisify(zlib.gzip),MiB=1024*1024;
const sourceFingerprints=new WeakMap();
function projectionSourceKeys(source){
  let keys=sourceFingerprints.get(source);
  if(!keys){keys=require('../lib/derived-input-keys').keys(source,'compute-source',null,{version:'1',day:'source'});sourceFingerprints.set(source,keys);}
  return keys;
}
const sourceCache=createComputeSourceCache({maxBytes:2*1024*MiB,loadSnapshot:async(owner,descriptor)=>{
  if(descriptor.replicaFile)return codec.decode(await fs.promises.readFile(descriptor.replicaFile),descriptor);
  const snapshot=await require('../lib/model-snapshot').loadModelSnapshotAsync(owner);
  if(snapshot&&!snapshot.loadedAt)snapshot.loadedAt=snapshot.savedAt||new Date().toISOString();
  return snapshot;
}});
async function compress(value,mode,transfer){
  const json=Buffer.from(tasks.serialize(value,mode)||'null','utf8'),compressed=await gzip(json,{level:4}),bytes=Uint8Array.from(compressed);
  transfer.push(bytes.buffer);return {buffer:bytes.buffer,uncompressedBytes:json.length};
}
function legacyValue(module,values,params,source={}){
  if(module==='cp')return {...values.cp,rows:access.sharedRows(params.access,values.cp?.rows||[])};
  if(module==='orders'){
    let catalogs=values['collection-catalog']?.catalogs;
    if(!catalog.collectionCatalogProjectionComplete(values['collection-catalog']))catalogs=catalog.buildCollectionCatalogs(values.orders?.rows||[]);
    return {loadedAt:params.metadata?.loadedAt||source.loadedAt||source.savedAt||null,sources:params.metadata?.sources||source.sources||{},orders:values.orders?.rows||[],collectionCatalogs:catalogs,pageCache:params.pageCache||{hit:false}};
  }
  return values[module];
}
async function execute(task,data,transfer){
  if(task==='health')return {ok:true};
  if(task==='seed-source'){
    const encoded=codec.encode({ownerId:data.ownerId,generation:data.generation,source:data.source,antrepoMetadata:data.antrepoMetadata});
    if(encoded.bytes.length>data.maxBytes)throw Object.assign(Error('Source replica byte admission exceeded'),{code:'COMPUTE_SOURCE_TOO_LARGE'});
    await fs.promises.writeFile(data.replicaFile,encoded.bytes,{flag:'wx',mode:0o600});
    return {checksum:encoded.checksum,fileBytes:encoded.bytes.length,loadedAt:data.source.loadedAt||null,projectionKeys:projectionSourceKeys(data.source)};
  }
  data.params=data.paramsBytes?v8.deserialize(Buffer.from(data.paramsBytes)):data.params||{};
  data.paramsBytes=null;
  if(task==='access-authority-hash')return {authorityHash:require('node:crypto').createHash('sha256').update(JSON.stringify(data.params)).digest('hex')};
  if(task==='cp-shared-edit-codes')return compress({ok:true,denied:access.sharedEditDeniedCodes(data.params.access,data.params.codes)},'api',transfer);
  if(task==='office-render'){
    const {format,data:document,options}=data.params;
    if(!['xlsx','pptx'].includes(format))throw Object.assign(Error('Invalid compute request'),{code:'COMPUTE_JOB_INVALID'});
    const buffer=format==='xlsx'?require('../lib/lcwai-output/output-xlsx').renderWorkbook(document,options):require('../lib/lcwai-output/output-pptx').renderPresentation(document,options);
    const bytes=Uint8Array.from(buffer);transfer.push(bytes.buffer);return {buffer:bytes.buffer};
  }
  if(task==='excel-utility'){
    if(!['previewFxWorkbookFromDirectories','loadFxWorkbookFromDirectories'].includes(data.params.excelTask))throw Object.assign(Error('Invalid compute request'),{code:'COMPUTE_JOB_INVALID'});
    dates.clearMerchCalendar();return require('./excel-worker').execute(data.params.excelTask,data.params.excelPayload);
  }
  if(task==='projection-envelope'){
    const values={};
    for(const [module,bytes] of Object.entries(data.params.cachedModules||{}))values[module]=JSON.parse((await promisify(zlib.gunzip)(Buffer.from(bytes))).toString('utf8'));
    if(data.params.legacyModule==='collection-catalog'&&!catalog.collectionCatalogProjectionComplete(values['collection-catalog']))return {needsRebuild:true};
    return compress(legacyValue(data.params.legacyModule,values,data.params),'api',transfer);
  }
  if(task==='cp-image-registry'){
    const cached=JSON.parse((await promisify(zlib.gunzip)(Buffer.from(data.params.cachedCp))).toString('utf8'));
    return compress({ok:true,...require('../lib/cp-image-startup-registry').scopedCpImageRegistry(cached.rows,data.params.overrides?.imagemap)},'api',transfer);
  }
  // Tarih motoru modül genelinde state tutar. Kalıcı worker her işin güncel
  // takvimini kurar; önceki kullanıcının/takvimin ayarını devralmaz.
  if(data.params?.calendar?.configured)dates.setMerchCalendar(data.params.calendar.calendar);else dates.clearMerchCalendar();
  const lease=await sourceCache.acquire(data.source,data.ownerId);
  try{
    const source=lease.snapshot||{asasOrders:[],antrepoMap:{}},params=data.params||{};
    if(task==='projection-plan')return {sourceMeta:projectionRuntimeMeta(source),sourceProjectionKeys:projectionSourceKeys(source),inputKeys:require('../lib/derived-input-keys').keys(source,params.projectionContextHash,tasks.withSourceOverrides(source,params).overrides,{version:params.appVersion})};
    if(task==='source-info')return {loadedAt:source.loadedAt||source.savedAt||null,runtimeMeta:projectionRuntimeMeta(source),sourceProjectionKeys:projectionSourceKeys(source),rows:source.asasOrders?.length||0,
      asasSourceFields:(source.asasOrdersByTarget?.backlog||source.asasOrders||[]).some(row=>row?._sourceFields&&Object.keys(row._sourceFields).length>0),
      antrepoSourceFields:Object.values(source.antrepoMapByTarget?.backlog||source.antrepoMap||{}).some(value=>(Array.isArray(value)?value:[value]).some(row=>row?._sourceFields&&Object.keys(row._sourceFields).length>0))};
    if(task==='projections'){
      if(params.catalogOrdersBuffer){const raw=await promisify(zlib.gunzip)(Buffer.from(params.catalogOrdersBuffer));params.catalogRows=JSON.parse(raw.toString('utf8')).rows||[];}
      const values=tasks.buildProjections(source,params),compressed={};
      for(const [module,value] of Object.entries(values))compressed[module]=await compress(value,'projection',transfer);
      const response=params.legacyModule?await compress(legacyValue(params.legacyModule,values,params,source),'api',transfer):null;
      return {compressed,sourceMeta:projectionRuntimeMeta(source),sourceProjectionKeys:projectionSourceKeys(source),...(response?{response}:{})};
    }
    if(task==='backlog-workbook'){
      const report=tasks.buildBacklog('export',source,params);
      const result=await require('./excel-worker').execute('writeBacklogWorkbook',{headers:report.headers,detailRows:report.rows,
        importanceValues:require('../../public/order-importance').excelValues(params.overrides?.importanceSettings),templatePath:require('node:path').join(__dirname,'../templates/BACKLOG.xlsx')});
      const bytes=Uint8Array.from(result.data);transfer.push(bytes.buffer);return {buffer:bytes.buffer};
    }
    if(task.startsWith('backlog-'))return compress(tasks.buildBacklog(task.slice(8),source,params),'api',transfer);
    throw Error('Unknown compute task');
  }finally{lease.release();}
}
let busy=false;
parentPort.on('message',async message=>{
  if(message?.type!=='run')return;
  if(busy){parentPort.postMessage({type:'result',id:message.id,ok:false});return;}
  busy=true;const start=performance.now(),transfer=[];
  try{
    const value=await execute(message.task,message.payload||{},transfer);
    const metadata=value.sourceMeta||value.runtimeMeta,metadataBytes=message.task==='excel-utility'?v8.serialize(value).byteLength:metadata?v8.serialize(metadata).byteLength:0,memory=process.memoryUsage();
    const outputBytes=transfer.reduce((sum,buffer)=>sum+buffer.byteLength,0)+metadataBytes*4+1024;
    if(message.payload?.maxOutputBytes&&outputBytes>message.payload.maxOutputBytes)throw Object.assign(Error('Compute output estimate exceeded'),{code:'COMPUTE_ESTIMATE_EXCEEDED'});
    parentPort.postMessage({type:'result',id:message.id,ok:true,value,metrics:{threadId,executionMs:performance.now()-start,
      retainedBytes:Math.max(sourceCache.stats().reservedBytes,memory.heapUsed+memory.arrayBuffers),outputBytes}},transfer);
  }catch(error){parentPort.postMessage({type:'result',id:message.id,ok:false,error:{code:error?.code||'COMPUTE_WORKER_FAILED'}});}
  finally{busy=false;}
});
