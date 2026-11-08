'use strict';
// PREPARED ONLY. One existing production Excel Worker/client; no server/browser.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const threads=require('node:worker_threads'),{performance}=require('node:perf_hooks');
const {S,derive}=require('./observables.cjs'),pins=require('./source-pins.json');
const arg=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const label=arg('--label'),appArg=arg('--app-root');assert.ok(label&&/^[A-Za-z0-9_-]{1,80}$/.test(label));assert.ok(appArg,'Explicit actual app root required');
assert.equal(process.env.EXCEL_RECEIVE_COMMON_LOCK,'held');assert.equal(process.execArgv.length,0,'No inherited profiler/preload flags');assert.ok(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'No ambient Node injection');
const ambient=Object.keys(process.env).filter(k=>k.startsWith('BUYER_LOG_')&&process.env[k]);assert.equal(ambient.length,0,'Ambient app overrides present (names only): '+ambient.join(','));
const packet=__dirname,app=fs.realpathSync(path.resolve(appArg)),source=path.resolve(pins.source.directory),originalFile=path.join(source,pins.source.file),out=path.join(packet,'runs',label),profileEnabled=process.argv.includes('--profile');
const now=()=>process.hrtime.bigint(),textNs=n=>n.toString(),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const cpu=()=>typeof process.threadCpuUsage==='function'?process.threadCpuUsage():null;
const report={status:'preparing',scope:'actual native receiveMessageOnPort around genuine 30k Excel result; isolated idle-main diagnosis, not server throughput or gain',startedAt:new Date().toISOString(),node:{version:process.version,execPath:process.execPath,availableParallelism:os.availableParallelism()},referenceHead:pins.referenceHead,referenceAppTree:pins.referenceAppTree,appRoot:app,sourceSha256:pins.source.sha256,syntheticRows:30000,seed:7,profileEnabled,main:{},sourceMetrics:null,limitations:['No pure V8 deserialization/sender serialization/IPC queue/scheduling split is inferred.','One real parseAsasFile via current production client, not full refresh or a busy server.','Linux/Node only; Windows/Electron/source-service/cold OS disk behavior unmeasured.']};
let worker,client,heartbeat,profileSession,profileStarted=false;
const telemetry=new SharedArrayBuffer(S.SLOTS*8),slots=new BigInt64Array(telemetry);Atomics.store(slots,S.VERSION,1n);
function save(){if(!fs.existsSync(out))return;const temp=path.join(out,'report.json.partial');fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n');fs.renameSync(temp,path.join(out,'report.json'));}
function verify(){
 for(const [relative,pin] of Object.entries(pins.files))if(pin.requiredOnLaunch){const file=path.join(app,relative),stat=fs.statSync(file);assert.equal(stat.size,pin.bytes,relative);assert.equal(sha(fs.readFileSync(file)),pin.sha256,relative);}
 assert.equal(path.basename(source),'source');const fixture=path.dirname(source);assert.equal(path.dirname(fixture),'/tmp');assert.ok(path.basename(fixture).startsWith('buyerlog-startup-'));
 assert.equal(fs.realpathSync(source),source);assert.equal(fs.realpathSync(originalFile),originalFile);assert.ok(!fs.lstatSync(originalFile).isSymbolicLink());
 const markerBytes=fs.readFileSync(path.join(source,'benchmark-fixture.json'));assert.equal(sha(markerBytes),pins.source.markerSha256);
 const marker=JSON.parse(markerBytes);assert.equal(marker.synthetic,true);assert.equal(marker.rows,30000);assert.equal(marker.seed,7);assert.equal(marker.hashes[pins.source.file],pins.source.sha256);
 const stat=fs.statSync(originalFile);assert.equal(stat.size,pins.source.fileBytes);assert.ok(stat.size<=128*1024*1024);
 assert.equal(sha(fs.readFileSync(originalFile)),pins.source.sha256);
 const disk=fs.statfsSync(packet),free=Number(disk.bavail)*Number(disk.bsize),required=stat.size+128*1024*1024+(profileEnabled?64*1024*1024:0)+1024*1024;
 report.diskAdmission={freeBytes:free,requiredBytes:required,admitted:free>=required};assert.ok(free>=required,'Disk admission refused before copy/import/worker');
}
function privateEnvironment(){
 fs.mkdirSync(out,{recursive:true,mode:0o700});for(const name of ['input','data','app','local','tmp'])fs.mkdirSync(path.join(out,name),{mode:0o700});
 Object.assign(process.env,{TZ:'Europe/Istanbul',TMPDIR:path.join(out,'tmp'),TMP:path.join(out,'tmp'),TEMP:path.join(out,'tmp'),BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(out,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(out,'data'),BUYER_LOG_DATA_ROOT:path.join(out,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(out,'local'),BUYER_LOG_LOCAL_DB:path.join(out,'local/BuyerLogLocal.db'),BUYER_LOG_CONFIG_PATH:path.join(out,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(out,'tmp')});
 const file=path.join(out,'input',pins.source.file);fs.copyFileSync(originalFile,file);assert.equal(sha(fs.readFileSync(file)),pins.source.sha256);return file;
}
function startHeartbeat(){
 const h={periodMs:10,count:0,totalGapMs:0,maxGapMs:0,topGaps:[],receiveOverlaps:[]};let last=now();
 heartbeat=setInterval(()=>{const end=now(),start=last;last=end;const gap=Number(end-start)/1e6;h.count++;h.totalGapMs+=gap;h.maxGapMs=Math.max(h.maxGapMs,gap);
  const entry={startNs:textNs(start),endNs:textNs(end),gapMs:gap};h.topGaps.push(entry);h.topGaps.sort((a,b)=>b.gapMs-a.gapMs);h.topGaps.length=Math.min(h.topGaps.length,8);
  if(report.main.nativeReceiveEnterNs&&report.main.nativeReceiveExitNs&&start<=BigInt(report.main.nativeReceiveExitNs)&&end>=BigInt(report.main.nativeReceiveEnterNs))h.receiveOverlaps.push(entry);
 },h.periodMs);return h;
}
async function beginProfile(){
 if(!profileEnabled)return;const {Session}=require('node:inspector');profileSession=new Session();profileSession.connect();
 const send=(method,params={})=>new Promise((resolve,reject)=>profileSession.post(method,params,(error,result)=>error?reject(error):resolve(result)));
 profileSession.send=send;await send('Profiler.enable');await send('Profiler.setSamplingInterval',{interval:1000});
 report.main.profileStartRequestNs=textNs(now());await send('Profiler.start');report.main.profileStartedNs=textNs(now());profileStarted=true;
}
async function endProfile(){
 if(!profileSession)return;
 try{if(profileStarted){const {profile}=await profileSession.send('Profiler.stop');report.main.profileStoppedNs=textNs(now());const text=JSON.stringify(profile);assert.ok(Buffer.byteLength(text)<=64*1024*1024,'Main CPU profile exceeds prepared disk budget');fs.writeFileSync(path.join(out,'main.cpuprofile'),text);report.mainCpuProfile={file:path.join(out,'main.cpuprofile'),samplingIntervalUs:1000,startTime:profile.startTime,endTime:profile.endTime,scope:'main thread only; native opaque frames need symbolized follow-up, not exact deser attribution'};}}
 finally{profileStarted=false;profileSession.disconnect();profileSession=null;}
}
class ObservedWorker extends threads.Worker {
 constructor(file,options){
  assert.equal(path.resolve(file),path.join(app,'server/workers/excel-worker.js'));assert.equal(worker,undefined,'One actual Excel worker only');report.main.workerConstructorEnterNs=textNs(now());
  super(file,{...options,execArgv:['--require',path.join(packet,'worker-preload.cjs')],workerData:{...(options.workerData||{}),__blExcelRealReceiveProbe:{telemetry,expectedWorker:file}}});
  worker=this;report.main.workerConstructorExitNs=textNs(now());report.workerThreadId=this.threadId;
  this.prependListener('message',message=>{if(message?.type==='result-ready'&&message.id===Number(Atomics.load(slots,S.JOB)))report.main.controlCallbackEntryNs=textNs(now());});
  this.once('online',()=>{report.main.workerOnlineNs=textNs(now());});
  this.exited=new Promise(resolve=>this.once('exit',code=>{report.main.workerExitNs=textNs(now());report.workerExitCode=code;resolve();}));
 }
 postMessage(message,...rest){
  if(message?.task==='parseAsasFile'&&message.resultPort){Atomics.store(slots,S.JOB,BigInt(message.id));report.main.jobPostEnterNs=textNs(now());try{return super.postMessage(message,...rest);}finally{report.main.jobPostExitNs=textNs(now());}}
  return super.postMessage(message,...rest);
 }
 terminate(){report.main.workerTerminateEnterNs=textNs(now());return Promise.resolve(super.terminate()).then(value=>{report.main.workerTerminateExitNs=textNs(now());return value;});}
}
function importActualClient(){
 // The production file destructures this public native function at module load.
 // Restore the module export immediately afterwards; its one client retains the
 // observer, which invokes native exactly once and returns the SAME object.
 assert.equal(require.cache[path.join(app,'server/excel-worker-client.js')],undefined,'Fresh native client import required');
 const native=threads.receiveMessageOnPort,descriptor=Object.getOwnPropertyDescriptor(threads,'receiveMessageOnPort');
 let calls=0;
 function observed(port){
  assert.equal(++calls,1,'Unexpected extra actual receive');report.main.cpuBefore=cpu();report.main.nativeReceiveEnterNs=textNs(now());
  let value;try{value=native(port);return value;}
  finally{report.main.nativeReceiveExitNs=textNs(now());report.main.cpuAfter=cpu();report.main.nativeEnvelopeId=value?.message?.id??null;report.main.nativeReceiveCalls=calls;}
 }
 Object.defineProperty(threads,'receiveMessageOnPort',{...descriptor,value:observed});
 try{return require(path.join(app,'server/excel-worker-client.js')).createExcelWorkerClient({maxWorkers:1,WorkerClass:ObservedWorker});}
 finally{Object.defineProperty(threads,'receiveMessageOnPort',descriptor);}
}
(async()=>{
 assert.ok(!fs.existsSync(out),'Unique label required; no overwrite');verify();
 const git=require('node:child_process').execFileSync;report.launchHead=git('git',['--no-optional-locks','rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim();
 const privateFile=privateEnvironment();report.status='running';save();
 client=importActualClient();await beginProfile();report.heartbeat=startHeartbeat();await new Promise(resolve=>setTimeout(resolve,20));
 const eluBefore=performance.eventLoopUtilization();report.main.submitNs=textNs(now());
 const result=await client.runExcelTask('parseAsasFile',{fullPath:privateFile},{onMetrics:metrics=>{report.main.metricsCallbackNs=textNs(now());report.sourceMetrics=metrics;}});
 report.main.promiseResolvedNs=textNs(now());report.eventLoopUtilization=performance.eventLoopUtilization(eluBefore);await new Promise(resolve=>setTimeout(resolve,20));
 clearInterval(heartbeat);heartbeat=null;await endProfile();
 assert.equal(result.parsedAsas?.orders?.length,30000);assert.equal(report.sourceMetrics?.resultTransport,'message-port');assert.equal(report.main.nativeReceiveCalls,1);assert.equal(report.main.nativeEnvelopeId,Number(Atomics.load(slots,S.JOB)));
 report.resultShape={asasRows:result.parsedAsas.orders.length,lflRows:result.parsedLfl?.rows?.length??null,resultKeys:Object.keys(result)};
 assert.equal(sha(fs.readFileSync(privateFile)),pins.source.sha256);assert.equal(sha(fs.readFileSync(originalFile)),pins.source.sha256);report.inputBytesPreserved=true;
 report.telemetry=Array.from(slots,(_,i)=>Atomics.load(slots,i).toString());
 assert.equal(report.telemetry[S.PAYLOAD_COUNT],'1');assert.equal(report.telemetry[S.CONTROL_COUNT],'1');assert.equal(report.telemetry[S.POST_THREW],'0');
 report.observables=derive(report.telemetry,report.main,report.sourceMetrics);assert.equal(report.observables.causalOrderValid,true,'Missing/inconsistent native timing markers');
 assert.equal(client.getExcelWorkerStats().activeWorkers,0);report.finalClientStats=client.getExcelWorkerStats();report.status='passed';
})().catch(error=>{report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}).finally(async()=>{
 if(heartbeat)clearInterval(heartbeat);
 try{if(worker)await worker.exited;await endProfile();}catch(error){report.status='failed';report.cleanupError={message:error.message,stack:error.stack};process.exitCode=1;}
 report.telemetry=Array.from(slots,(_,i)=>Atomics.load(slots,i).toString());report.finishedAt=new Date().toISOString();save();console.log('Probe report: '+path.join(out,'report.json'));
});
