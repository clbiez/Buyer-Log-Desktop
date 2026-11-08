'use strict';
// Run only under the shared flock. No server, network, storage or credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib'),Module=require('node:module');
const {performance}=require('node:perf_hooks');
const APP=path.resolve(__dirname,'../../../resources/app');
const {fixture,coldFixture,actual,candidate,promotion,headers,hostFunction,seams}=require(path.join(APP,'tests/fixtures/orders-projection-client/runtime.cjs'));
const {build}=require(path.join(APP,'scripts/generate-demo-data.js'));
const parse=require(path.join(APP,'server/lib/parse.js'));
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const samples={},counters={captureCalls:0,textHashCalls:0,byteHashCalls:0};
const memory=()=>process.memoryUsage();
function record(name,ms){(samples[name]??=[]).push(ms);}
async function timed(name,fn){const at=performance.now();const value=await fn();record(name,performance.now()-at);return value;}
async function digest(bytes){return Buffer.from(await crypto.webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');}
const textHash=async value=>{counters.textHashCalls++;return timed(value.length>1000000?'callback.fullTextEncodeAndHash':'callback.metadataTextEncodeAndHash',()=>digest(new TextEncoder().encode(value)));};
const byteHash=async bytes=>{counters.byteHashCalls++;return timed('callback.byteHash',()=>digest(bytes));};
const rowsFrom=(matrix,offset)=>matrix.slice(offset+1).map(row=>Object.fromEntries(matrix[offset].map((key,index)=>[key,row[index]??null])));
const file=path.join(APP,'public/orders-projection-client.js');
const source=fs.readFileSync(file,'utf8');
function observeRows(){
  // Exact production loop, with only two clock calls around it. Report this
  // diagnostic separately from the unmodified module's total accept timing.
  const start='const allowed=new Set(r.plan.fields),union=new Set();';
  const end="check(r.plan.fields.every(k=>union.has(k)),'MISSING_RETAINED_RAW_KEY');";
  assert.equal(source.split(start).length,2);assert.equal(source.split(end).length,2);
  const observed=source.replace(start,'const __rowStart=performance.now();'+start)
    .replace(end,end+"module.rowTimes.push(performance.now()-__rowStart);");
  const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(APP);m.rowTimes=[];m._compile(observed,file);
  return {api:m.exports,times:m.rowTimes};
}
async function main(){
  const setupStart=performance.now(),before=memory();
  const demo=build({rows:30000,seed:7,today:new Date('2026-11-07T12:00:00.000Z')});
  const demoSha=hash(JSON.stringify(demo));
  const asas=parse.parseASASRows(rowsFrom(demo.asas,2)).orders;
  const antrepo=parse.parseAntrepoRows(rowsFrom(demo.antrepo,0));
  const defs=['PROBE','UNUSED','ZERO','FALSE','NULL','VISIBLE','SHARED'].map(id=>actual.modelDef(id,id==='PROBE'?'Probe':id==='SHARED'?'Shared':id));
  // True parser rows, augmented before actual Orders projection construction.
  // Bounded synthetic model values are explicit, not a historical fixture claim.
  asas.forEach((row,ordinal)=>{
    row._cpExtra??={};
    defs.forEach((definition,index)=>{
      if(index===2&&ordinal%3===0)return; // sparse own presence
      row._cpExtra[definition.header]=[0,false,null,'',('synthetic model '+index+' row '+ordinal+' | ').padEnd(192+index*16,'x')][(ordinal+index)%5];
    });
  });
  const orders=parse.buildOrdersRowsFromASAS(asas,antrepo,{});
  assert.equal(orders.length,30000);
  let baseOptions;
  const f=await fixture({rows:orders,modelDefinitions:defs,clientApi:{create(options){baseOptions=options;return candidate.create(options);}}});
  const capture=()=>{counters.captureCalls++;const at=performance.now();try{return f.capture();}finally{record('callback.capture',performance.now()-at);}};
  const options={...baseOptions,readCurrent:capture,sha256:textHash};
  const makeClient=api=>api.create(options);
  const initialize=client=>client.initializeFull({metadata:f.metadata,afterMetadata:actual.clone(f.metadata),headers:headers(f.h),fullWire:f.f.full,rawText:f.rawText});
  const client=makeClient(candidate);
  assert.equal((await initialize(client)).mode,'full-initialized');
  assert.equal((await f.initialize()).mode,'full-initialized');
  // Construct ready bytes once, through the actual server builder. No fake
  // rows or projected key annotation, and no timing credit for producer work.
  const wire=await f.ready();
  const request=await client.prepare(f.metadata,'native_nonce');assert.equal(request.mode,'ready',request.reason);
  const originalFullSha=hash(JSON.stringify(f.f.full)),originalReady=JSON.stringify(wire.payload);
  const setupMs=performance.now()-setupStart,afterSetup=memory();
  const rawBytes=Buffer.from(f.rawText),readyBytes=Buffer.from(originalReady);
  const fullGzip=zlib.gzipSync(rawBytes,{level:4}),readyGzip=zlib.gzipSync(readyBytes,{level:4});
  const schema=f.metadata.schema,omitted=request.body.omittedModelKeys;
  for(let i=0;i<wire.payload.rows.length;i++){
    const original=f.f.full.rows[i],row=wire.payload.rows[i];
    assert.deepEqual(Object.keys(row),Object.keys(original).filter(k=>!omitted.includes(k)));
    for(const key of Object.keys(row))assert.deepEqual(row[key],original[key]);
  }
  // First two are warmups; clear all timing arrays before the measured cohort.
  for(let i=0;i<2;i++){await client.prepare(f.metadata,'native_nonce');await client.accept(request,wire);}
  for(const key of Object.keys(samples))samples[key]=[];
  counters.captureCalls=counters.textHashCalls=counters.byteHashCalls=0;
  const measuredBefore=memory();
  for(let i=0;i<9;i++){
    await timed('captureOnly',capture);
    const next=await timed('prepareWarm',()=>client.prepare(f.metadata,'native_nonce'));assert.equal(next.mode,'ready');
    const accepted=await timed('acceptReady',()=>client.accept(request,wire));assert.equal(accepted.mode,'ready');
    await timed('assertCurrent',()=>accepted.assertCurrent());
    assert.equal((await timed('initializeFull',()=>initialize(makeClient(candidate)))).mode,'full-initialized');
    await timed('rawFullHash',()=>digest(rawBytes));
    await timed('rawReadyHash',()=>digest(readyBytes));
    await timed('parseFull',()=>JSON.parse(f.rawText));
    await timed('parseReady',()=>JSON.parse(originalReady));
  }
  const observed=observeRows(),observedClient=makeClient(observed.api);
  assert.equal((await initialize(observedClient)).mode,'full-initialized');
  const observedRequest=await observedClient.prepare(f.metadata,'native_nonce');assert.equal(observedRequest.mode,'ready');
  for(let i=0;i<9;i++)await observedClient.accept(observedRequest,wire);
  samples.rowValidationOnly=observed.times;
  // Reuse the original packet's real user-storage adapter and cold capture on
  // this same 30k fixture. The hydration promise is locally resolved, without
  // pretending it proves remote preference synchronization.
  let coldOptions;
  const waitCold=hostFunction('waitOrdersColdEligibility',{
    authHydrationPromise:Promise.resolve({applied:0,pushed:0}),cpLoadPromise:null},seams);
  await coldFixture({baseFixture:f,clientApi:{create(value){
    coldOptions={...value,readCurrent:capture,sha256:textHash,waitCold};return candidate.create(coldOptions);
  }}});
  const auditReads=coldOptions.captureCold().reads.length;
  for(let i=0;i<9;i++){
    const cold=candidate.create(coldOptions);
    assert.equal((await timed('prepareColdActualEmptyStorage',()=>cold.prepare(f.metadata,'native_nonce'))).mode,'ready');
  }
  // Full-parent adapter + real promotion. Includes stream allocation, adapter
  // raw hash, helper byte copy + second raw hash, parse, per-row shape checks,
  // selection/ordinal checks and publication. Normalizer is explicitly identity.
  const router=fs.readFileSync(path.join(APP,'server/lib/orders-ready-http.js'),'utf8');
  const extra=hostFunction('fullParentHeaders',{Buffer,stale:()=>Error('stale')},router)(f.metadata.token,
    {pin:{uncompressedBytes:rawBytes.length},schema:{rowCount:orders.length}});
  const live={token:f.metadata.token,fullGzipChecksum:f.h['X-Orders-Full-Gzip-Sha256'],guardStamp:f.metadata.guardStamp,
    sessionId:'measurement-session',planHash:request.body.planHash,pageContextSha256:f.h['X-Orders-Page-Context-Sha256'],
    broadContextSha256:f.h['X-Orders-Broad-Context-Sha256'],nonce:()=> 'parent_nonce',assertCurrent(){}};
  const expected={ownerId:live.token.ownerId,sessionId:live.sessionId,sourceId:live.token.sourceProjectionKey,generation:live.token.sourceGeneration,
    accessHash:live.token.accessHash,scopeHash:live.guardStamp,module:'orders',planHash:live.planHash,
    fullProjectionChecksum:hash(rawBytes),fullByteLength:rawBytes.length,rowCount:orders.length};
  const adapter=candidate.createFetchFull({promotionApi:promotion,sha256Bytes:byteHash,live:()=>live,
    fetch:async()=>new Response(rawBytes,{headers:headers(f.h,{...extra,'X-Orders-View-Mode':'full','X-Orders-Request-Nonce':'parent_nonce'})})});
  for(let i=0;i<5;i++){
    let state={kind:'thin',rows:wire.payload.rows,selectedRows:[wire.payload.rows.at(-1)],identity:expected,requiredKeys:[],
      ordinals:Array.from({length:orders.length},(_,index)=>index),mutationRevision:0,selectionRevision:0,dirty:false};
    const controller=promotion.create({snapshot:()=>state,fetchFull:adapter,isCurrent:()=>true,
      normalize:async rows=>({rows,ordinals:Array.from({length:rows.length},(_,index)=>index)}),
      publish:(next,{expected,assertCurrent})=>{assert.strictEqual(state,expected);assertCurrent();return state=next;}});
    const result=await timed('promoteFullIdentityNormalizer',()=>controller.ensure());
    assert.equal(hash(JSON.stringify(result.rows)),hash(JSON.stringify(f.f.full.rows)));
    assert.strictEqual(result.selectedRows[0],result.rows.at(-1));
  }
  assert.equal(hash(JSON.stringify(f.f.full)),originalFullSha);assert.equal(JSON.stringify(wire.payload),originalReady);
  const summary={};
  for(const [name,values] of Object.entries(samples)){
    const sorted=[...values].sort((a,b)=>a-b);
    summary[name]={n:values.length,medianMs:sorted[Math.floor(sorted.length/2)],minMs:sorted[0],maxMs:sorted.at(-1)};
  }
  const report={status:'passed',classification:'helper-only cost, no application speed or activation claim',
    baseSha:'d66c1f803097af5991616f0420392e1027888f2e',moduleSha256:hash(source),harnessSha256:hash(fs.readFileSync(__filename)),
    environment:{node:process.version,versions:process.versions,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0].model,
      cpuCount:os.cpus().length,cpuQuota:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),memoryLimit:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),timezone:process.env.TZ,at:new Date().toISOString()},
    fixture:{synthetic:true,generatorSeed:7,generatorDay:'2026-11-07',demoSha256:demoSha,rows:orders.length,
      rawKeyUnion:schema.rowKeys.length,retainedKeyUnion:schema.rowKeys.length-omitted.length,omitted,
      fullRawBytes:rawBytes.length,readyRawBytes:readyBytes.length,fullRawSha256:hash(rawBytes),readyRawSha256:hash(readyBytes),
      fullControlGzipBytes:fullGzip.length,readyControlGzipBytes:readyGzip.length,controlGzipLevel:4,
      retainedOwnKeys:wire.payload.rows.reduce((sum,row)=>sum+Object.keys(row).length,0),
      modelAugmentation:'seven registered model keys; 192..288 characters/0/false/null/empty; ZERO sparse every third row before native projection'},
    setup:{wallMs:setupMs,before,afterSetup},memory:{measuredBefore,after:memory(),note:'point observations, no retained-heap or peak-memory benefit claimed'},
    coldAudit:{actualUserStorage:true,nativeSyntheticKeys:f.window.BLStorage.native.length,auditReads,hydration:'locally resolved promise; no remote success proof'},
    counters,summary,samples,limitations:[
      'Linux Node WebCrypto and loopback-free Response streams; no browser UI, Electron or network timing.',
      'Actual generator + parsers + native Orders builder run outside client timings; no worker or server performance claim.',
      'Cold timing uses actual user-storage migration/capture on synthetic empty native storage and locally resolved wait; browser storage and pending hydration latency remain root integration work.',
      'initializeFull includes actual zero-formula migration; initialized nonempty-formula activation remains gated.',
      'Promotion includes two raw hash passes, all row validation and identity normalizer; real hydration/UI work is additional.',
      'rowValidationOnly is an in-memory instrumented copy with unchanged production loop, two clock calls; acceptReady is unmodified.',
      'No before/after optimization cohort; timings establish costs and cannot establish a speed improvement.'
    ]};
  fs.writeFileSync(path.join(__dirname,'measurement.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,fixture:report.fixture,summary},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
