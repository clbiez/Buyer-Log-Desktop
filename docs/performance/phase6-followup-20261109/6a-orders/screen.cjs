'use strict';

// Isolated rejection screen. Never imported by the product or test runner.
// Run under flock, with an empty temporary root as the sole argument.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const repo=path.resolve(__dirname,'../../../..');
const app=path.join(repo,'resources/app');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const median=values=>{const sorted=[...values].sort((a,b)=>a-b),mid=Math.floor(sorted.length/2);return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};

function child(file){
  assert.equal(typeof global.gc,'function');
  const samples=[];
  for(let cycle=0;cycle<6;cycle++){
    global.gc();
    const before=process.memoryUsage(),cpu=process.cpuUsage(),start=performance.now();
    const text=fs.readFileSync(file,'utf8'),readEnd=performance.now();
    let rows=JSON.parse(text).rows;const parsed=performance.now();
    // Exact row copy expression in the current ensureOrdersLoaded; normalization
    // mirrors the delete loop in buildOrdersFilters. UI/pricing are NOT timed.
    rows=rows.map(row=>({...row,_canEdit:false}));
    for(const row of rows){delete row.Priority;delete row._actionPriorityReasons;delete row._actionPrioritySignals;delete row._calculationStatus;}
    const materialized=performance.now(),memory=process.memoryUsage();
    let full=JSON.stringify({rows});const end=performance.now();
    const outputHash=hash(full),cpuDelta=process.cpuUsage(cpu);
    const sample={cycle,mode:cycle===0?'fresh-process':'warm',readMs:readEnd-start,parseMs:parsed-readEnd,
      materializeMs:materialized-parsed,firstFullJsonMs:end-materialized,totalMs:end-start,
      cpuMs:(cpuDelta.user+cpuDelta.system)/1000,heapAtMaterialized:memory.heapUsed,
      rssAtMaterialized:memory.rss,heapBefore:before.heapUsed,rows:rows.length,outputHash};
    rows=null;full=null;global.gc();sample.heapAfterRelease=process.memoryUsage().heapUsed;
    samples.push(sample);
  }
  return {samples,maxRssBytes:process.resourceUsage().maxRSS*1024};
}
if(process.argv[2]==='--child'){
  console.log(JSON.stringify(child(process.argv[3])));return;
}

const root=path.resolve(process.argv[2]||'');
assert.ok(root.startsWith('/tmp/6a-orders-'),'temporary root required');
fs.mkdirSync(root,{recursive:true});
const archive=path.join(repo,'docs/performance-program/fixtures/source-30000-seed7-20261105.tar.gz');
const archiveHash=hash(fs.readFileSync(archive));
assert.equal(archiveHash,'5913414603984b02b1c30b87f1f9231da3718ab797a007f4bd14067ec6cd5c70');
const fixture=path.join(root,'fixture');fs.mkdirSync(fixture);
execFileSync('tar',['xzf',archive,'-C',fixture]);
Object.assign(process.env,{
  BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),
  BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')
});
const parse=require(path.join(app,'server/lib/parse'));
const compute=require(path.join(app,'server/lib/compute-tasks'));
const XLSX=require(path.join(app,'node_modules/xlsx'));
const asas=parse.parseASASWorkbook(XLSX.readFile(path.join(fixture,'ASAS - Demo.xlsx'))).orders;
const antrepo=parse.parseAntrepoWorkbook(XLSX.readFile(path.join(fixture,'Antrepo - Demo.xlsx')));
assert.equal(asas.length,30000);
const start=performance.now();
const projection=compute.buildProjections({asasOrders:asas,antrepoMap:antrepo},{modules:['orders'],overrides:{}}).orders;
const buildMs=performance.now()-start;
const main=compute.serialize(projection,'projection');
const fields=Object.keys(projection.rows[0]);
const removedCounts={Priority:0,_canEdit:0};
const omitStart=performance.now();
for(const row of projection.rows){for(const key of Object.keys(removedCounts)){if(Object.hasOwn(row,key))removedCounts[key]++;delete row[key];}}
const omitMs=performance.now()-omitStart;
const candidate=compute.serialize(projection,'projection');
for(const [variant,text] of Object.entries({main,candidate}))fs.writeFileSync(path.join(root,variant+'.json'),text);
const zlib=require('node:zlib');
const payload={};
for(const [variant,text] of Object.entries({main,candidate}))payload[variant]={sha256:hash(text),uncompressedBytes:Buffer.byteLength(text),gzipBytes:zlib.gzipSync(text).length};
const results={sourceSha:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  runtime:process.versions,platform:process.platform,arch:process.arch,cpus:require('node:os').availableParallelism(),
  concurrency:1,archiveHash,sourceHashes:Object.fromEntries(['ASAS - Demo.xlsx','Antrepo - Demo.xlsx','LFL - Demo.xlsx'].map(name=>[name,hash(fs.readFileSync(path.join(fixture,name)))])),
  rows:asas.length,fields,removedCounts,buildMs,omitMs,payload,runs:[]};
fs.writeFileSync(path.join(__dirname,'screen-results.json'),JSON.stringify(results,null,2)+'\n');
// A/A uses identical Main bytes. Independent fresh processes; warm cycles are
// kept within each process. Alternating order avoids monotonic drift bias.
for(const [kind,sequence] of [['AA',['main','main','main','main','main','main']],['AB',['main','candidate','candidate','main','main','candidate']]]){
  for(let i=0;i<sequence.length;i++){
    const variant=sequence[i];
    const run=spawnSync(process.execPath,['--expose-gc',__filename,'--child',path.join(root,variant+'.json')],{encoding:'utf8',maxBuffer:2e6});
    const record={kind,pair:Math.floor(i/2)+1,position:i%2,variant,status:run.status,signal:run.signal,stderr:run.stderr};
    if(run.status===0)Object.assign(record,JSON.parse(run.stdout));else record.stdout=run.stdout;
    results.runs.push(record);
    fs.writeFileSync(path.join(__dirname,'screen-results.json'),JSON.stringify(results,null,2)+'\n');
    console.log(JSON.stringify({kind,pair:record.pair,variant,status:record.status,coldTotalMs:record.samples?.[0].totalMs}));
    assert.equal(run.status,0,'failed samples are retained');
  }
}
const outputHashes=new Set(results.runs.flatMap(run=>run.samples.map(s=>s.outputHash)));
assert.equal(outputHashes.size,1,'normalized complete JSON equality');
results.normalizedOutputHash=[...outputHashes][0];
results.summary={};
for(const kind of ['AA','AB'])for(const variant of ['main','candidate'])for(const mode of ['fresh-process','warm']){
  const samples=results.runs.filter(r=>r.kind===kind&&r.variant===variant).flatMap(r=>r.samples.filter(s=>s.mode===mode));
  if(!samples.length)continue;
  results.summary[`${kind}/${variant}/${mode}`]=Object.fromEntries(['readMs','parseMs','materializeMs','firstFullJsonMs','totalMs','cpuMs','heapAtMaterialized','rssAtMaterialized','heapAfterRelease'].map(metric=>[metric,{median:median(samples.map(s=>s[metric])),min:Math.min(...samples.map(s=>s[metric])),max:Math.max(...samples.map(s=>s[metric]))}]));
}
fs.writeFileSync(path.join(__dirname,'screen-results.json'),JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify({normalizedOutputHash:results.normalizedOutputHash,payload,buildMs,omitMs}));
