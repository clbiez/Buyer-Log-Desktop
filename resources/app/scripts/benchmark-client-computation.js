'use strict';
// Her çağrı taze süreçtir. Yalnız iş yükü süresi ölçülür; modül/fixture kurulumu dışarıdadır.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib'),crypto=require('node:crypto');
const assert=require('node:assert/strict'),{Worker}=require('node:worker_threads'),{createRequire}=require('node:module');
const {performance}=require('node:perf_hooks'),{execFileSync}=require('node:child_process');
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const app=path.resolve(arg('--app-root',path.join(__dirname,'..'))),kind=arg('--case',''),output=arg('--out','');
assert.ok(['catalog','sort','reader'].includes(kind));assert.ok(output);
const requireApp=createRequire(path.join(app,'package.json')),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function block(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return source.slice(a,b);}
function serverCatalog(){
  const source=fs.readFileSync(path.join(app,'server/server.js'),'utf8'),common=path.join(app,'server/lib/collection-catalog.js');
  return new Function('canonicalFields','BLBusinessRules','collectionCatalog',block(source,'const COLLECTION_CATALOG_FIELDS','async function buildResponse')+';return {buildCollectionCatalogs,collectionCatalogProjectionComplete,COLLECTION_CATALOG_SCHEMA_VERSION};')(
    requireApp('./server/lib/canonical-fields'),requireApp('./public/business-rules'),fs.existsSync(common)?requireApp(common):null);
}
async function workerCatalog(buffer){
  const worker=new Worker(path.join(app,'server/projection-worker.js'),{workerData:{modules:['collection-catalog'],catalogOrdersBuffer:buffer}});
  try{return await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('worker exit '+code));});});}
  finally{await worker.terminate();}
}
async function catalog(){
  const root=fs.realpathSync(arg('--fixture-root',''));
  assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('buyerlog-startup-'));
  const marker=JSON.parse(fs.readFileSync(path.join(root,'source/benchmark-fixture.json'),'utf8'));
  assert.equal(marker.synthetic,true);assert.equal(marker.rows,30000);
  for(const [file,hash] of Object.entries(marker.hashes)){
    assert.equal(path.basename(file),file);assert.equal(sha(fs.readFileSync(path.join(root,'source',file))),hash);
  }
  const cache=path.join(root,'local/page-cache/moderator'),manifest=JSON.parse(fs.readFileSync(path.join(cache,'manifest.json'),'utf8'));
  assert.match(manifest.activeGeneration,/^[a-z0-9-]+$/i);
  const buffer=fs.readFileSync(path.join(cache,manifest.activeGeneration,'orders.json.gz')),api=serverCatalog();
  const beforeHeap=process.memoryUsage().heapUsed,started=performance.now();
  const result=await workerCatalog(buffer);assert.equal(result.ok,true,result.error);
  const workerRoundTripMs=performance.now()-started;
  let compressed=Buffer.from(result.compressed['collection-catalog'].buffer),value=JSON.parse(zlib.gunzipSync(compressed));
  const workerSchema=value.catalogSchemaVersion,repairStarted=performance.now();
  const repaired=!api.collectionCatalogProjectionComplete(value);
  if(repaired){
    // Mevcut sunucu v3'e geri dönüş: Orders'ı aç, canonical kataloğu yeniden kur.
    const orders=JSON.parse(zlib.gunzipSync(buffer)).rows;
    assert.equal(orders.length,30000);
    value={catalogs:api.buildCollectionCatalogs(orders),catalogSchemaVersion:api.COLLECTION_CATALOG_SCHEMA_VERSION};
    compressed=zlib.gzipSync(JSON.stringify(value),{level:4});
  }
  const finished=performance.now(),elapsedMs=finished-started,repairMs=finished-repairStarted;
  assert.equal(value.catalogSchemaVersion,3);assert.ok(Array.isArray(value.catalogs.manufacturer));
  return {elapsedMs,workerRoundTripMs,workerMs:result.metrics.workerMs,repairMs,repaired,workerSchema,
    finalSchema:value.catalogSchemaVersion,finalFields:Object.keys(value.catalogs),outputSha256:sha(JSON.stringify(value)),outputBytes:compressed.length,
    sourceRows:marker.rows,fixtureHashes:marker.hashes,inputOrdersCompressedBytes:buffer.length,beforeHeapBytes:beforeHeap,afterHeapBytes:process.memoryUsage().heapUsed};
}
function sort(){
  const api=requireApp('./public/chronological-values');
  const values=Array.from({length:30000},(_,i)=>i%11===0?['S7','W6','June 2027'][i%3]:['Ürün ','Factory ','İPLİK ','A-'][i%4]+((i*104729)%30011));
  const beforeHeap=process.memoryUsage().heapUsed,started=performance.now();
  const orders=[1,-1].map(direction=>values.slice().sort((a,b)=>api.compareChronologicalValues(a,b,direction)));
  const elapsedMs=performance.now()-started;
  return {elapsedMs,rows:values.length,directions:[1,-1],outputSha256:sha(JSON.stringify(orders)),beforeHeapBytes:beforeHeap,afterHeapBytes:process.memoryUsage().heapUsed};
}
function reader(){
  const api=requireApp('./public/collection-model-groups');
  const rows=Array.from({length:5000},(_,i)=>({id:i+1,modelGroupId:String(Math.floor(i/3)),modelGroupRole:i%3?'variant':'parent',quantity:i,
    modelSharedValues:i%3?{}:{fabric:'F'+Math.floor(i/3),not:'Note '+i,pricing:{Manufacturer:String(i/10)},targetPrice:i,endeksmatikData:{value:i}},
    variantOverrides:i%7?{}:{not:'',targetPrice:0,pricing:null,flag:false}}));
  const source=fs.readFileSync(path.join(app,'public/app-main.js'),'utf8');
  const read=new Function('window','kolRows','kolWorkspaceRevision',block(source,'function kolEffectiveValue','function kolEffectiveEndeksmatikRow')+';return kolEffectiveValue;')({BLCollectionModelGroups:api},rows,7);
  const fields=['fabric','quantity','not','pricing','targetPrice','endeksmatikData','flag'];
  const beforeHeap=process.memoryUsage().heapUsed,started=performance.now(),values=[];
  for(const row of rows)for(const field of fields)values.push(read(row,field));
  const elapsedMs=performance.now()-started;
  return {elapsedMs,rows:rows.length,fields,reads:values.length,outputSha256:sha(JSON.stringify(values)),beforeHeapBytes:beforeHeap,afterHeapBytes:process.memoryUsage().heapUsed};
}
(async()=>{
  const result=kind==='catalog'?await catalog():kind==='sort'?sort():reader();
  const runtimePaths=['public/app-main.js','public/chronological-values.js','public/collection-model-groups.js','server/server.js','server/projection-worker.js','server/lib/collection-catalog.js'];
  const sourceHashes=Object.fromEntries(runtimePaths.map(file=>[file,fs.existsSync(path.join(app,file))?sha(fs.readFileSync(path.join(app,file))):null]));
  const report={synthetic:true,case:kind,status:'passed',appRoot:app,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),
    workingTreeDirty:Boolean(execFileSync('git',['status','--porcelain','--untracked-files=normal','--',...runtimePaths],{cwd:app,encoding:'utf8'}).trim()),runtimeSourceHashes:sourceHashes,
    harnessSha256:sha(fs.readFileSync(__filename)),
    node:process.version,v8:process.versions.v8,icu:process.versions.icu,platform:process.platform,cpu:os.cpus()[0]?.model,
    availableParallelism:os.availableParallelism(),heapSampling:'uncollected; no forced GC',...result};
  fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(kind+': '+result.elapsedMs.toFixed(3)+' ms; '+result.outputSha256);
})().catch(error=>{console.error(error);process.exitCode=1;});
