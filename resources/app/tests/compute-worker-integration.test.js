'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),zlib=require('node:zlib');
const serverData=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-compute-native-data-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=serverData;
test.after(()=>fs.rmSync(serverData,{recursive:true,force:true}));
const {createComputePool}=require('../server/lib/compute-pool'),codec=require('../server/lib/compute-source-codec'),tasks=require('../server/lib/compute-tasks');
const {createComputeService}=require('../server/lib/compute-service');
const MiB=1024*1024;
function source(label='2026-04-05T00:00:00.000Z'){
  const rows=[{ocode:123,model:label,ccode:'R',colour:'Red',buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G',qty:10,kalan:5,fob:5,ex:new Date(2026,6,1),retail:new Date(2026,7,1),mb:new Date(2026,8,1),_sourceFields:{'Synthetic Column':'Value'}}];
  return {loadedAt:'r1',asasOrders:rows,asasOrdersByTarget:{cp:rows,orders:rows,backlog:rows},antrepoMap:{},lflRows:[]};
}
const params={overrides:{},horizons:{},cpAllowed:true,summaryAllowed:true,modules:['cp','orders','overview','order-summary','collection-catalog']};
function setup(t,options={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-compute-service-'));
  const workers=[],{Worker}=require('node:worker_threads');class ObservedWorker extends Worker{constructor(...args){super(...args);workers.push(this);}}
  const pool=createComputePool({WorkerClass:ObservedWorker,maxWorkers:1,memoryBudgetBytes:768*MiB,maxPendingBytes:256*MiB});
  const service=createComputeService({pool,root,diskBudgetBytes:32*MiB,...options});
  t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});return {pool,service,root,workers};
}
test('real persistent worker seeds an exact replica and sends ready gzip without returning raw records',async t=>{
  const {pool,service}=setup(t),raw=source();
  const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
  const stored=codec.decode(fs.readFileSync(descriptor.replicaFile),descriptor);assert.equal(stored.asasOrders[0].model,raw.asasOrders[0].model);assert.ok(stored.asasOrders[0].ex instanceof Date);
  const first=await service.run('projections',descriptor,params),second=await service.run('projections',descriptor,{...params,modules:['overview']});
  try{
    assert.equal(first.metrics.threadId,second.metrics.threadId);assert.equal(pool.stats().workerCount,1);
    assert.deepEqual(Object.keys(first.value.compressed).sort(),params.modules.slice().sort());
    const expected=tasks.buildProjections(raw,params);
    for(const [module,entry] of Object.entries(first.value.compressed)){
      assert.ok(entry.buffer instanceof ArrayBuffer);const text=zlib.gunzipSync(Buffer.from(entry.buffer)).toString('utf8');assert.equal(text,tasks.serialize(expected[module],'projection'));assert.equal(Buffer.byteLength(text),entry.uncompressedBytes);
    }
    assert.equal(first.value.asasOrders,undefined);assert.equal(service.stats().sourceFiles,1);assert.ok(pool.stats().leasedOutputBytes>0);
  }finally{first.release();second.release();}
  assert.equal(pool.stats().leasedOutputBytes,0);
});
test('generation changes refuse old jobs and owner mismatch is rejected before source access',async t=>{
  const {service}=setup(t),old=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});
  await assert.rejects(service.run('projections',{...old,ownerId:'other'},params),{code:'COMPUTE_SOURCE_OWNER_MISMATCH'});
  const next=await service.seedSource({ownerId:'a',generation:'g2',source:source('new'),uncompressedBytes:MiB});
  await assert.rejects(service.run('projections',old,params),{code:'COMPUTE_STALE_GENERATION'});
  const lease=await service.run('projections',next,{...params,modules:['cp']});lease.release();
});
test('disk admission refuses oversized source before creating files and close removes only its own replicas',async t=>{
  const {service,root}=setup(t,{diskBudgetBytes:1000});fs.writeFileSync(path.join(root,'unrelated.txt'),'Keep synthetic neighboring file');
  await assert.rejects(service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB}),{code:'COMPUTE_SOURCE_TOO_LARGE'});
  assert.equal(service.stats().sourceFiles,0);await service.close();assert.equal(fs.readFileSync(path.join(root,'unrelated.txt'),'utf8'),'Keep synthetic neighboring file');
});
test('native Backlog gzip equals the existing builder and refuses corrupted replicas',async t=>{
  const {service,workers}=setup(t),raw=source(),descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
  const data={overrides:{},horizons:{},headers:['Synthetic'],options:{},sourceColumns:[],includeSourceDetails:true,calendar:{configured:false},rowsRevision:'r'};
  const lease=await service.run('backlog-export',descriptor,data);
  try{assert.equal(zlib.gunzipSync(Buffer.from(lease.value.buffer)).toString('utf8'),tasks.serialize(tasks.buildBacklog('export',raw,data),'api'));}finally{lease.release();}
  // A replacement thread must re-read and authenticate the immutable bytes.
  await workers.at(-1).terminate();const bytes=fs.readFileSync(descriptor.replicaFile);bytes[bytes.length-1]^=1;fs.writeFileSync(descriptor.replicaFile,bytes);
  await assert.rejects(service.run('projections',descriptor,params),{code:'COMPUTE_SOURCE_CORRUPT'});
});
test('preparing a replacement keeps the published generation available until explicit publication',async t=>{
  const {service}=setup(t),old=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});
  const pending=await service.seedSource({ownerId:'a',generation:'g2',source:source('new'),uncompressedBytes:MiB,publish:false});
  const lease=await service.run('projections',old,{...params,modules:['overview']});lease.release();
  await assert.rejects(service.run('projections',pending,params),{code:'COMPUTE_STALE_GENERATION'});
  await service.publishSource(pending);
  const next=await service.run('projections',pending,{...params,modules:['overview']});next.release();
  await assert.rejects(service.run('projections',old,params),{code:'COMPUTE_STALE_GENERATION'});
});
test('queued request input is admitted by actual encoded bytes, including large parameter values',async t=>{
  const {pool,service}=setup(t),descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});
  const actualRun=pool.run.bind(pool);let charged=0,encodedBytes=0;
  pool.run=(task,payload,options)=>{charged=options.inputBytes;encodedBytes=payload.paramsBytes?.byteLength||0;return actualRun(task,payload,options);};
  const extra='Synthetic '.repeat(2*MiB),lease=await service.run('projections',descriptor,{...params,modules:['overview'],unused:extra});
  try{assert.ok(charged>=Buffer.byteLength(extra));assert.ok(encodedBytes>=Buffer.byteLength(extra));assert.ok(lease.metrics.paramsSerializeMs>=0);}
  finally{lease.release();}
});
test('legacy CP response and cached-envelope response preserve shared flags without loading raw source again',async t=>{
  const {service,workers}=setup(t),raw=source(),descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
  const policy=require('../server/lib/compute-access'),access=policy.createAccessContext({userId:'a',systemRole:'buyer',viewScope:{all:true},editScopes:{buyers:['Synthetic Buyer']},authority:{123:raw.asasOrders},profiles:[{id:'a',username:'Synthetic Buyer'}]});
  const request={...params,access,modules:['cp'],legacyModule:'cp'},lease=await service.run('projections',descriptor,request);
  const expected=tasks.buildProjections(raw,request).cp;expected.rows=policy.sharedRows(access,expected.rows);
  try{assert.equal(zlib.gunzipSync(Buffer.from(lease.value.response.buffer)).toString(),tasks.serialize(expected,'api'));}
  finally{lease.release();}
  const cached=lease.value.compressed.cp;
  await workers.at(-1).terminate();fs.writeFileSync(descriptor.replicaFile,'Synthetic damaged raw replica: cached scope remains authoritative');
  const transformed=await service.run('projection-envelope',descriptor,{access,legacyModule:'cp',cachedModules:{cp:cached.buffer}});
  try{
    const cachedRows=JSON.parse(zlib.gunzipSync(Buffer.from(cached.buffer)).toString());cachedRows.rows=policy.sharedRows(access,cachedRows.rows);
    assert.equal(zlib.gunzipSync(Buffer.from(transformed.value.buffer)).toString(),tasks.serialize(cachedRows,'api'));
  }finally{transformed.release();}
});
test('cold source identity is bound to verified metadata before any replacement thread can reload it',async t=>{
  const {service,workers}=setup(t),snapshots=require('../server/lib/model-snapshot'),owner='synthetic-cold-bound';
  const raw=source('Cold synthetic model');await snapshots.saveModelSnapshotAsync(owner,raw);
  const descriptor=await service.coldSource({ownerId:owner,generation:'provisional',uncompressedBytes:MiB});
  const first=await service.run('projections',descriptor,{...params,modules:['overview']});
  try{assert.equal(first.value.sourceMeta.loadedAt,'r1');assert.equal(first.value.sourceMeta.asasOrders,undefined);}
  finally{first.release();}
  const bound=service.bindColdSource(descriptor,'r1');assert.equal(bound.generation,descriptor.generation);assert.equal(bound.capability,descriptor.capability);assert.equal(bound.loadedAt,'r1');
  await snapshots.saveModelSnapshotAsync(owner,{...raw,loadedAt:'r2'});await workers.at(-1).terminate();
  await assert.rejects(service.run('projections',bound,{...params,modules:['overview']}),{code:'COMPUTE_STALE_GENERATION'});
});
test('cold projection planning computes existing reuse keys in the worker and returns only runtime metadata',async t=>{
  const {service}=setup(t),raw=source(),descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
  const lease=await service.run('projection-plan',descriptor,{overrides:{},projectionContextHash:'ctx',appVersion:'test'});
  try{assert.deepEqual(lease.value.inputKeys,require('../server/lib/derived-input-keys').keys(raw,'ctx',{}, {version:'test'}));assert.equal(lease.value.sourceMeta.loadedAt,'r1');assert.equal(lease.value.sourceMeta.asasOrders,undefined);}
  finally{lease.release();}
});
test('source fingerprints distinguish real CP updates and Backlog enrichment while ignoring LFL-only changes',async t=>{
  const {service}=setup(t),raw=source(),a=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});assert.ok(a.projectionKeys?.cp);
  const b=await service.seedSource({ownerId:'a',generation:'g2',source:{...raw,lflRows:[{changed:true}]},uncompressedBytes:MiB});assert.deepEqual(a.projectionKeys,b.projectionKeys);
  const backlog=raw.asasOrders.map(row=>({...row,_sourceFields:{...row._sourceFields,'New Backlog Header':'Synthetic'}}));
  const c=await service.seedSource({ownerId:'a',generation:'g3',source:{...raw,asasOrdersByTarget:{...raw.asasOrdersByTarget,backlog}},uncompressedBytes:MiB});
  assert.equal(c.projectionKeys.cp,a.projectionKeys.cp);assert.notEqual(c.projectionKeys.backlog,a.projectionKeys.backlog);
  const d=await service.seedSource({ownerId:'a',generation:'g4',source:{...raw,cpupdateOverrides:{suppfobmap:{123:12}}},uncompressedBytes:MiB});assert.notEqual(d.projectionKeys.cp,a.projectionKeys.cp);
});
test('generated demo ASAS/Antrepo/CP-update/LFL records keep real projection and Backlog bytes through the native pool',async t=>{
  const {service}=setup(t),XLSX=require('xlsx'),parse=require('../server/lib/parse'),policy=require('../server/lib/compute-access');
  require('../server/lib/workbook-parser-guards').install(XLSX);require('../public/excel-date-utils').installSheetJsHooks(XLSX);
  const demo=require('../scripts/generate-demo-data').build({rows:24,seed:19,today:new Date('2026-11-05T00:00:00Z')});
  const read=(aoa,name)=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),name);return XLSX.read(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),{type:'buffer',raw:true,cellDates:false,dense:true});};
  const asas=parse.parseASASWorkbook(read(demo.asas,'ASAS')),antrepo=parse.parseAntrepoWorkbook(read(demo.antrepo,'Antrepo'));
  const cpupdate=parse.parseCPUpdateWorkbook(read([['Supplier','PO','Manufacturer FOB'],['Synthetic imported supplier',4100000,12.35]],'CPUpdate'));
  const lfl=require('../server/lib/lfl').parseLFLWorkbook(read(demo.lfl,'LFL'));
  assert.equal(asas.orders.length,24);assert.ok(Object.keys(antrepo).length>0);assert.ok(lfl.rows.length>0);assert.ok(cpupdate.fob>0);
  const raw={loadedAt:'demo-r1',asasOrders:asas.orders,asasOrdersByTarget:{cp:asas.orders,orders:asas.orders,backlog:asas.orders},antrepoMap:antrepo,antrepoMapByTarget:{cp:antrepo,orders:antrepo,backlog:antrepo},antrepoHeaderInfo:parse.antrepoParseMeta(antrepo),cpupdateOverrides:cpupdate,lflRows:lfl.rows,lflMeta:lfl.meta};
  const access=policy.createAccessContext({userId:'a',systemRole:'moderator',manageAll:true,viewScope:{all:true},editScopes:{all:true},authority:{},profiles:[]});
  const data={...params,access,mergeSourceOverrides:true,overrides:{submap:{4100000:'Synthetic manual supplier'}}};
  const descriptor=await service.seedSource({ownerId:'a',generation:'demo-g1',source:raw,uncompressedBytes:MiB});
  const stored=codec.decode(fs.readFileSync(descriptor.replicaFile),descriptor);
  assert.deepEqual(stored.antrepoMap.__antrepoMeta,raw.antrepoMap.__antrepoMeta);assert.equal(stored.antrepoMap.__antrepoMeta,stored.antrepoHeaderInfo);
  const projected=await service.run('projections',descriptor,data);
  try{const expected=tasks.buildProjections(raw,data);assert.ok(expected.cp.rows.length>0);for(const module of params.modules)assert.equal(zlib.gunzipSync(Buffer.from(projected.value.compressed[module].buffer)).toString(),tasks.serialize(expected[module],'projection'));}
  finally{projected.release();}
  for(const includeSourceDetails of [false,true]){
    const request={...data,headers:['Synthetic'],options:{},sourceColumns:[],previewLimit:7,includeSourceDetails,rowsRevision:'demo-rows',calendar:{configured:false}};
    const lease=await service.run('backlog-export',descriptor,request);
    try{assert.equal(zlib.gunzipSync(Buffer.from(lease.value.buffer)).toString(),tasks.serialize(tasks.buildBacklog('export',raw,request),'api'));}
    finally{lease.release();}
  }
});

test('image registry decodes only authorized compressed CP rows in the common worker',async t=>{
 const {service}=setup(t),descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});
 const rows=[{'PLM ID':'000215013.0','C.Code':'C01'},{'PLM ID':'400','C.Code':'B02'}];
 const imagemap={'plm:215013|colour:C01':'ci_front','plm:215013|colour:C01|name:BLACK':'ci_named','plm:215013':'ci_legacy','plm:400|colour:B02':'','plm:900|colour:A01':'ci_other_user'};
 fs.writeFileSync(descriptor.replicaFile,'Synthetic damaged raw replica: image registry must use only verified cached CP rows');
 const lease=await service.run('cp-image-registry',descriptor,{cachedCp:zlib.gzipSync(JSON.stringify({rows})),overrides:{imagemap}});
 try{const actual=JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.buffer)));assert.deepEqual(actual,JSON.parse(JSON.stringify({ok:true,...require('../server/lib/cp-image-startup-registry').scopedCpImageRegistry(rows,imagemap)})));assert.equal(actual.imagemap['plm:900|colour:A01'],undefined);}
 finally{lease.release();}
});

test('native map and selected lazy details share source generation and keep Backlog target isolation',async t=>{
 globalThis.BLCanonicalFields=require('../server/lib/canonical-fields');
 const {service}=setup(t),raw=source('Synthetic Backlog');raw.asasOrdersByTarget.cp=[{...raw.asasOrders[0],model:'CP-only'}];
 const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:raw,uncompressedBytes:MiB});
 const data={overrides:{},horizons:{},headers:[],options:{},sourceColumns:[],includeSourceDetails:true,calendar:{configured:false},rowsRevision:'rows',sourceRevision:'g1'};
 const thin=await service.run('backlog-export',descriptor,{...data,mapProjection:true});
 try{assert.equal(zlib.gunzipSync(Buffer.from(thin.value.buffer)).toString(),tasks.serialize(tasks.buildBacklog('export',raw,{...data,mapProjection:true})));}finally{thin.release();}
 const selector={identities:[{orderCode:123,modelName:'Synthetic Backlog',colourCode:'R'}]};
 const details=await service.run('backlog-map-details',descriptor,{...data,selector,expectedSourceRevision:'g1'});
 try{const result=JSON.parse(zlib.gunzipSync(Buffer.from(details.value.buffer)));assert.ok(result.rows.length>0);assert.ok(result.rows.every(row=>row._detailSource));assert.equal(result.rows[0]['Model Adı'],'Synthetic Backlog');}
 finally{details.release();}
 await assert.rejects(service.run('backlog-map-details',descriptor,{...data,selector,expectedSourceRevision:'old'}),{code:'COMPUTE_STALE_GENERATION'});
});

test('prepared authority hash runs in the same common worker and releases its lease',async t=>{
 const {service,pool}=setup(t),authority={101:[{buyer:'Synthetic Buyer',merch:'M',ageGroup:'A',buyerGrup:'G'}]};let metrics;
 const expected=require('node:crypto').createHash('sha256').update(JSON.stringify(authority)).digest('hex');
 assert.equal(await service.hashAccessAuthority(authority,{onMetrics:value=>{metrics=value;}}),expected);
 assert.ok(metrics.threadId>0);assert.ok(metrics.paramsSerializeMs>=0);assert.ok(metrics.paramsBytes>0);assert.equal(pool.stats().leasedOutputBytes,0);
 const ready=await service.runOffice('a',{format:'xlsx',data:require('../server/lib/lcwai-output/output-contracts').normalizeWorkbook({title:'Demo',sheets:[{name:'Demo',columns:[{header:'Order',type:'text'}],rows:[['Synthetic']]}]}).data,options:{date:new Date('2026-11-05T00:00:00Z')}});
 try{assert.equal(ready.metrics.threadId,metrics.threadId);}finally{ready.release();}
});

test('native CP code hints equal the canonical resolver without hydrating raw source records',async t=>{
 const {service}=setup(t),policy=require('../server/lib/compute-access');
 const descriptor=await service.seedSource({ownerId:'a',generation:'g1',source:source(),uncompressedBytes:MiB});fs.writeFileSync(descriptor.replicaFile,'Synthetic unreadable source: ownership uses the authority directory');
 const authority={101:[{buyer:'Alice'}],102:[{buyer:'Alice'},{buyer:'Bob'}],104:[{buyer:'Bob'}]},profiles=[{id:'a',username:'Alice'},{id:'b',username:'Bob'}],codes=[' 101 ','101','000101','102','104','404','../101'];
 for(const systemRole of ['buyer','manager','moderator']){
  const access=policy.createAccessContext({userId:'a',systemRole,manageAll:true,authority,profiles});
  const lease=await service.run('cp-shared-edit-codes',descriptor,{access,codes});
  try{assert.deepEqual(JSON.parse(zlib.gunzipSync(Buffer.from(lease.value.buffer))),{ok:true,denied:policy.sharedEditDeniedCodes(access,codes)});}finally{lease.release();}
 }
});
test('authority IPC encoding yields before admission and keeps exact hashes across split rows and special keys',async t=>{
 const {service,pool}=setup(t),authority={};
 for(let i=0;i<1100;i++)authority[String(i+100)]=[{buyer:'Synthetic '+i,merch:'M',ageGroup:'A',buyerGrup:'G'}];
 authority.long=Array.from({length:900},(_,i)=>i%3?{buyer:'Demo '+i}:null);authority.empty=[];
 Object.defineProperty(authority,'__proto__',{value:[{buyer:'Synthetic prototype key'}],enumerable:true});
 const expected=require('node:crypto').createHash('sha256').update(JSON.stringify(authority)).digest('hex');
 let turns=0,admissions=0,metrics;const tick=()=>{turns++;if(!admissions)setImmediate(tick);};setImmediate(tick);
 const run=pool.run;pool.run=(task,payload,options)=>{
  admissions++;assert.ok(turns>=4,'authority encoding must yield in bounded row batches before admission');
  assert.ok(payload.authorityBytes instanceof ArrayBuffer);assert.equal(payload.paramsBytes,undefined);
  assert.equal(options.inputBytes,payload.authorityBytes.byteLength+1024);
  return run(task,payload,options);
 };
 assert.equal(await service.hashAccessAuthority(authority,{onMetrics:value=>{metrics=value;}}),expected);
 assert.ok(metrics.paramsChunks>=8);assert.ok(metrics.maxSerializeSliceMs>=0);assert.equal(admissions,1);
 assert.equal(pool.stats().leasedOutputBytes,0);assert.equal(Object.getPrototypeOf(authority),Object.prototype);
});
test('an obsolete authority encoding stops before admission while the latest directory remains usable',async t=>{
 const {service,pool}=setup(t),authority=Object.fromEntries(Array.from({length:1100},(_,i)=>[String(i),[{buyer:'Synthetic '+i}]]));
 let admissions=0;const run=pool.run;pool.run=(...args)=>{admissions++;return run(...args);};
 const obsolete=service.hashAccessAuthority(authority).then(value=>({value}),error=>({error}));
 const latest=service.hashAccessAuthority({7:[{buyer:'Latest synthetic buyer'}]});
 assert.equal((await obsolete).error?.code,'COMPUTE_STALE_GENERATION');
 assert.equal(await latest,require('node:crypto').createHash('sha256').update(JSON.stringify({7:[{buyer:'Latest synthetic buyer'}]})).digest('hex'));
 assert.equal(admissions,1,'superseded partial encoding must not reach the worker pool');
});
test('legacy metadata is decoded in the common worker without a raw order source and rejects replaced files',async t=>{
 const {service}=setup(t),engine=require('../server/lib/endeksmatik'),file=engine.PERSISTED_FILE;
 fs.mkdirSync(path.dirname(file),{recursive:true});const old=fs.existsSync(file)?fs.readFileSync(file):null;
 t.after(()=>old?fs.writeFileSync(file,old):fs.rmSync(file,{force:true}));
 const snapshot={schemaVersion:1,months:['202601'],records:[],fx:{},season:'DEMO',generatedAt:'2026-11-05T00:00:00Z'};
 fs.writeFileSync(file,zlib.gzipSync(JSON.stringify(snapshot)));
 const expected=engine.legacyStatus(),stat=fs.statSync(file),descriptor={file,usingDefault:false,tag:[stat.mtimeMs,stat.ctimeMs,stat.size,stat.ino].join(':')};
 const lease=await service.runEndeksmatikStatus('viewer',descriptor);
 try{assert.deepEqual(lease.value.status,expected);assert.ok(lease.metrics.threadId>0);}finally{lease.release();}
 fs.writeFileSync(file,zlib.gzipSync(JSON.stringify({...snapshot,season:'DEMO CHANGED'})));
 await assert.rejects(service.runEndeksmatikStatus('viewer',descriptor),{code:'COMPUTE_STALE_GENERATION'});
});
