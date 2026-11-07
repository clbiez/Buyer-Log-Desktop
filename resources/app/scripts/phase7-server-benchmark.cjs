'use strict';
// Synthetic, isolated workload. Run each arm in a fresh process; no business data.
const fs=require('node:fs'),fsp=fs.promises,path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
const [app,scenario]=process.argv.slice(2),load=file=>require(path.join(path.resolve(app),file));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-phase7-'));
for(const name of ['SERVER_DATA','DATA','LOCAL_DATA','TEMP'])process.env[`BUYER_LOG_${name}_ROOT`]=path.join(root,name);
process.env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function measured(work){
 const gaps=[];let previous=performance.now();
 const timer=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now;},10);
 // Keep the previous tick across the operation boundary: record full gaps,
 // including the intervals crossing start/end, without clipping them.
 await wait(30);gaps.length=0;const start=performance.now();
 const result=await work();const ms=performance.now()-start;
 await wait(25);clearInterval(timer);gaps.sort((a,b)=>a-b);
 return {ms,eventLoopGapMaxMs:Math.max(...gaps),eventLoopGapP95Ms:gaps[Math.max(0,Math.ceil(gaps.length*.95)-1)],timerSamples:gaps.length,...result};
}
async function main(){
 let result;
 if(scenario==='snapshot'){
  const {createLocalDb}=load('server/lib/local-db'),service=load('server/lib/compute-runtime').getComputeService(),db=createLocalDb(path.join(root,'db','BuyerLogLocal.db'),{encodeSnapshot:state=>service.encodeLocalDbSnapshot(state)});
  const state=await db.ensure();state.deviceId='synthetic-device';
  for(let i=0;i<30000;i++)state.records['synthetic:'+i]={model:'Model '+i,price:i/100,colour:'Kırmızı',note:'synthetic '.repeat(24),_revision:1};
  // Keep the durable writer, verification and WAL rotation in the measured path.
  await load('server/lib/compute-runtime').getComputeService().warm();
  result=await measured(async()=>{await db.transaction(()=>{});return {};});
  result.bytes=fs.statSync(db.file).size;result.sha256=sha(fs.readFileSync(db.file));
  assert.deepEqual((await createLocalDb(db.file).read()).records,state.records);
 }else if(scenario==='local-images'){
  const shared=load('server/lib/shared-image-store').createSharedImageStore({getSharedSyncRoot:async()=>root,getDeviceId:()=> 'fixture'});
  const records={};for(let i=0;i<300;i++)records['plm:'+i]={canonicalKey:'plm:'+i,source:'PLM',status:'UNAVAILABLE',revision:1};
  for(let i=0;i<10;i++)for(const folder of ['heads','manifests']){const dir=path.join(root,'model-images',folder);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'peer'+i+'.json'),JSON.stringify({deviceId:'peer'+i,revision:1,records}));}
  let available=0,lookups=0,heads=0,reads=0;
  const originalRead=fsp.readFile,originalDir=fsp.readdir;fsp.readFile=async function(...args){reads++;return originalRead.apply(this,args);};fsp.readdir=async function(...args){heads++;return originalDir.apply(this,args);};
  const distribution=load('server/lib/model-image-distribution').createModelImageDistribution({sharedStore:{...shared,available:async()=>{available++;return shared.available();},lookupMany:async(...args)=>{lookups++;return shared.lookupMany(...args);}},getImage:()=>({id:'local'}),ownership:{loadOwnership:()=>({}),canWriteAutomatic:()=>({allowed:true}),getEntry:()=>null}});
  const requests=Array.from({length:300},(_,i)=>({plmId:String(i+1000)})),imagemap=Object.fromEntries(requests.map(row=>['plm:'+row.plmId,'ci_local']));
  result=await measured(async()=>{const value=await distribution.plan(requests,{source:'PLM',mode:'missing',imagemap});assert.equal(value.local.length,300);return {available,lookups,heads,reads,counts:value.counts};});
 }else if(scenario==='pack'){
  const shared=load('server/lib/shared-image-store').createSharedImageStore({getSharedSyncRoot:async()=>root,getDeviceId:()=> 'fixture'});
  const entries=Array.from({length:200},(_,i)=>({canonicalKey:'plm:'+i,source:'PLM',mimeType:'image/jpeg',buffer:Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(4096,i)])}));
  let opens=0,syncs=0,reads=0,writes=0;const original=fsp.open,read=fsp.readFile;
  fsp.readFile=async function(...args){reads++;return read.apply(this,args);};
  fsp.open=async function(...args){opens++;const h=await original.apply(this,args),sync=h.sync.bind(h),write=h.write.bind(h),writeFile=h.writeFile.bind(h);h.sync=async()=>{syncs++;return sync();};h.write=async(...a)=>{writes++;return write(...a);};h.writeFile=async(...a)=>{writes++;return writeFile(...a);};return h;};
  result=await measured(async()=>({report:await shared.publish(entries),opens,syncs,reads,writes}));
  for(const entry of entries)assert.deepEqual(await shared.readObject(await shared.lookup(entry.canonicalKey)),entry.buffer);
  result.verified=entries.length;
 }else if(scenario==='parser'||scenario==='parser-queue'){
  const cp=require('node:child_process'),fork=cp.fork,children=[];
  cp.fork=function(file,args,options){const child=fork.call(this,file,args,{...options,env:{...options.env,NODE_OPTIONS:`${options.env.NODE_OPTIONS||''} --require ${JSON.stringify(path.join(__dirname,'phase7-parser-probe.cjs'))}`}});child.on('message',message=>{if(message.phase7PeakRssKiB)children.push(message.phase7PeakRssKiB);});return child;};
  const files=Array.from({length:5},(_,i)=>({name:'report'+i+'.eml',buffer:Buffer.from('From: fixture@example.invalid\r\nTo: test@example.invalid\r\nSubject: Synthetic '+i+'\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSynthetic report body')}));
  let staged=0;
  if(scenario==='parser'){
   result=await measured(async()=>{const out=await load('server/lib/test-reports/isolated-extract').processFiles(files,{stage:()=>String(++staged)});return {files:out.files.length,staged};});
   assert.equal(result.files,5);
  }else{
   const client=load('server/lib/parser-process-client').createParserClient({workerFile:path.join(app,'tests/helpers/parser-process-fixture.cjs')});
   result=await measured(async()=>{const jobs=Array.from({length:5},()=>client.run('spin',{ms:100},{priority:'background'}));const started=performance.now();const interactive=client.run('echo',{}, {priority:'interactive'}).then(()=>performance.now()-started);const queueMs=await interactive;await Promise.all(jobs);return {interactiveQueueAndExecutionMs:queueMs};});
  }
  result.spawnCount=children.length;result.childPeakRssKiB=Math.max(...children);
 }else if(scenario.startsWith('upload')){
  const count=scenario==='upload-1'?1:5;
  let active=0,peak=0,sent=0;
  const engine=load('server/lib/lcwai/lcwai-engine').createLcwAiEngine({auth:{},client:{uploadFile:async(_,file)=>{active++;peak=Math.max(peak,active);await wait(40);active--;if(scenario==='upload-error'&&file.name==='2')throw Error('synthetic upload failure');return {id:file.name};},sendMessage:async(_,input)=>{sent++;assert.equal(input.attachments.length,count);return {text:'{}'};}}});
  result=await measured(async()=>{let failed=false;try{await engine.askWithFiles('synthetic',{source:'test',task:'synthetic',files:Array.from({length:count},(_,i)=>({name:String(i)}))});}catch(error){assert.equal(error.message,'synthetic upload failure');failed=true;}assert.equal(failed,scenario==='upload-error');if(failed)assert.equal(sent,0);return {peak,sent,failed,simulatedNetwork:true};});
 }else if(scenario.startsWith('backup-')){
  const changed=Number(scenario.slice(7)),entries=Array.from({length:100},(_,i)=>({name:'data/'+i+'.bin',sourcePath:path.join(root,i+'.bin')}));
  for(const [i,entry] of entries.entries())fs.writeFileSync(entry.sourcePath,Buffer.alloc(512*1024,i));
  for(let i=0;i<changed;i++)fs.writeFileSync(entries[i].sourcePath,Buffer.alloc(512*1024,i+1));
  let readBytes=0,writtenBytes=0;const originalRead=fs.createReadStream,originalWrite=fs.createWriteStream,originalOpen=fsp.open;
  fsp.open=async function(...args){const handle=await originalOpen.apply(this,args),read=handle.read.bind(handle);handle.read=async(...params)=>{const result=await read(...params);readBytes+=result.bytesRead;return result;};return handle;};
  fs.createReadStream=function(...args){const stream=originalRead.apply(this,args);stream.on('data',bytes=>{readBytes+=bytes.length;});return stream;};
  fs.createWriteStream=function(...args){const stream=originalWrite.apply(this,args),write=stream.write.bind(stream);stream.write=function(bytes,...rest){writtenBytes+=bytes.length;return write(bytes,...rest);};return stream;};
  const archive=load('server/lib/backup-archive');let output;
  result=await measured(async()=>{output=await archive.createBackupArchive({entries,manifest:{synthetic:true},filename:'synthetic.zip'});return {readBytes,writtenBytes,archiveBytes:output.size,sourceBytes:100*512*1024,changedPercent:changed};});
  // Independent restore and content comparison, outside the timing window.
  const restored=path.join(root,'restore');await archive.extractBackupArchive(output.path,restored);
  for(const entry of entries)assert.equal(sha(fs.readFileSync(path.join(restored,entry.name))),sha(fs.readFileSync(entry.sourcePath)));
  result.verified=entries.length;result.tempPeakBytes=result.writtenBytes;await output.cleanup();
 }else throw Error('Unknown scenario');
 const resource=process.resourceUsage();
 const sources=['server/lib/local-db.js','server/lib/compute-service.js','server/workers/compute-worker.js','server/lib/model-image-distribution.js','server/lib/shared-image-store.js','server/lib/parser-process-client.js','server/workers/file-parser-process.js','server/lib/test-reports/isolated-extract.js','server/lib/backup-archive.js','server/lib/lcwai/lcwai-engine.js'];
 return {scenario,base:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),sourceSha256:Object.fromEntries(sources.map(file=>[file,sha(fs.readFileSync(path.join(app,file)))])),node:process.version,platform:process.platform,cpus:os.availableParallelism(),...result,processPeakRssKiB:resource.maxRSS};
}
main().then(value=>{process.stdout.write(JSON.stringify(value)+'\n');}).catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{try{await load('server/lib/compute-runtime').closeComputeService();}finally{await fsp.rm(root,{recursive:true,force:true});}});
