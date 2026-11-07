'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createProfilerController}=require('../server/lib/runtime-stall-profiler-worker');
const profile={startTime:0,endTime:10000,nodes:[{id:1,callFrame:{functionName:'synthetic',url:'file:///demo/server.js',lineNumber:1},children:[]}],samples:[1],timeDeltas:[10000]};
function setup(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-profiler-worker-')),calls=[],session={post(method,params,callback){calls.push({method,params});callback(null,method==='Profiler.stop'?{profile}:{});},disconnect(){calls.push({method:'disconnect'});}};return {root,calls,controller:createProfilerController({session,dir:root,keep:3,samplingUs:5000})};}
test('the profiler worker discards quiet samples locally and reuses the enabled profiler code cache',async()=>{
 const f=setup();try{await f.controller.execute('start');const result=await f.controller.execute('rotate');assert.deepEqual(result,{running:true,logs:[]});assert.equal(f.calls.filter(c=>c.method==='Profiler.enable').length,1);assert.equal(f.calls.filter(c=>c.method==='Profiler.disable').length,0);assert.equal(f.calls.filter(c=>c.method==='Profiler.start').length,2);assert.equal(f.calls.filter(c=>c.method==='Profiler.stop').length,1);assert.equal(f.calls.filter(c=>c.method==='Profiler.setSamplingInterval').length,2);assert.equal(fs.readdirSync(f.root).length,0);assert.doesNotMatch(JSON.stringify(result),/nodes|samples|callFrame/);await f.controller.execute('close');}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('real stalls retain exact profiles, bounded files and sanitized summaries without returning raw profile objects',async()=>{
 const f=setup();try{await f.controller.execute('start');for(let i=0;i<5;i++){const result=await f.controller.execute('capture',{blockedMs:12000});assert.ok(result.logs.some(s=>s.includes('[RUNTIME] stall-profile ')&&s.includes('blockedMs=12000')));assert.ok(result.logs.some(s=>s.includes('synthetic server.js:2')));assert.doesNotMatch(JSON.stringify(result),/callFrame|\/demo\//);await new Promise(setImmediate);}const files=fs.readdirSync(f.root);assert.equal(files.length,3);for(const file of files)assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,file))),profile);await f.controller.execute('close');assert.equal(f.calls.at(-1).method,'disconnect');}finally{fs.rmSync(f.root,{recursive:true,force:true});}
});
test('failed native profiler operations reject and do not claim a running profiler',async()=>{
 const c=createProfilerController({session:{post(method,params,cb){cb(Error('private path must not be returned'));},disconnect(){}}});await assert.rejects(c.execute('start'));assert.deepEqual(await c.execute('rotate'),{running:false,logs:[]});await assert.rejects(c.execute('unknown'));await c.execute('close');
});
test('native worker profiling rotates and captures actual main-thread samples without main-thread inspector calls or profile writes',async()=>{
 const inspector=require('node:inspector'),{createStallProfiler}=require('../server/lib/runtime-stall-profiler'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-profiler-native-'));
 const originalPost=inspector.Session.prototype.post,originalWrite=fs.writeFileSync,logs=[];let profiler;
 function beforeRotationNamed(){const until=performance.now()+90;while(performance.now()<until){Math.sqrt(Math.random());}}
 function afterRotationNamed(){const until=performance.now()+90;while(performance.now()<until){Math.sqrt(Math.random());}}
 try{
  inspector.Session.prototype.post=()=>assert.fail('native profiling must be controlled in the worker');fs.writeFileSync=function(file,...args){assert.ok(!String(file).endsWith('.cpuprofile'),'profile serialization and persistence must stay in the worker');return originalWrite.call(this,file,...args);};
  profiler=createStallProfiler({dir:root,log:line=>logs.push(line),windowMs:0});assert.ok(profiler);assert.equal(await profiler.start(),true);beforeRotationNamed();await profiler.rotate();assert.equal(fs.readdirSync(root).length,0);afterRotationNamed();await profiler.capture(12000);
  const files=fs.readdirSync(root);assert.equal(files.length,1);const data=JSON.parse(fs.readFileSync(path.join(root,files[0])));assert.ok(data.samples.length>0);assert.ok(data.nodes.some(n=>n.callFrame.functionName==='afterRotationNamed'));assert.ok(!data.nodes.some(n=>n.callFrame.functionName==='beforeRotationNamed'));assert.ok(logs.some(line=>line.includes('[RUNTIME] stall-profile ')));assert.ok(!logs.some(line=>line.includes('unavailable')));
 }finally{await profiler?.stop();inspector.Session.prototype.post=originalPost;fs.writeFileSync=originalWrite;fs.rmSync(root,{recursive:true,force:true});}
});
test('a failed or oversized profiler response closes profiling without leaking raw errors or leaving a request pending',async()=>{
 const wt=require('node:worker_threads'),{EventEmitter}=require('node:events'),original=wt.Worker,{createStallProfiler}=require('../server/lib/runtime-stall-profiler');
 let worker;class FakeWorker extends EventEmitter{constructor(file,options){super();worker=this;this.messages=[];this.terminated=0;assert.equal(options.resourceLimits.maxOldGenerationSizeMb,128);assert.deepEqual(options.execArgv,[]);}postMessage(m){this.messages.push(m);}ref(){}unref(){}terminate(){this.terminated++;return Promise.resolve(0);}}
 wt.Worker=FakeWorker;
 try{
  for(const failure of ['error','exit','raw-profile','huge-line']){
   const logs=[],p=createStallProfiler({log:line=>logs.push(line)}),start=p.start(),id=worker.messages[0].id;
   if(failure==='error')worker.emit('error',Error('private credential must not be logged'));
   else if(failure==='exit')worker.emit('exit',1);
   else worker.emit('message',{id,ok:true,running:true,logs:failure==='huge-line'?['x'.repeat(16385)]:[],...(failure==='raw-profile'?{profile}:{})});
   assert.equal(await start,false);assert.deepEqual(logs,['[RUNTIME] stall-profiler unavailable']);assert.ok(worker.terminated>0);await p.stop();
  }
 }finally{wt.Worker=original;}
});
test('overlapping rotations are single-flight and shutdown rejects new work while an existing command drains',async()=>{
 const wt=require('node:worker_threads'),{EventEmitter}=require('node:events'),original=wt.Worker,{createStallProfiler}=require('../server/lib/runtime-stall-profiler');let worker;
 class FakeWorker extends EventEmitter{constructor(){super();worker=this;this.messages=[];}postMessage(m){this.messages.push(m);}reply(index,running=true){this.emit('message',{id:this.messages[index].id,ok:true,running,logs:[]});}ref(){}unref(){}terminate(){return Promise.resolve(0);}}
 wt.Worker=FakeWorker;let p;
 try{p=createStallProfiler({windowMs:0});const start=p.start();worker.reply(0);assert.equal(await start,true);const first=p.rotate();await Promise.all(Array.from({length:20},()=>p.rotate()));assert.equal(worker.messages.length,2);const closing=p.stop();await p.capture(12000);assert.equal(worker.messages.length,3);worker.reply(1);await first;worker.reply(2,false);await closing;await p.rotate();assert.equal(worker.messages.length,3);}finally{await p?.stop();wt.Worker=original;}
});
test('shutdown keeps the native control worker referenced until its actual termination completes',async()=>{
 const wt=require('node:worker_threads'),{EventEmitter}=require('node:events'),original=wt.Worker,{createStallProfiler}=require('../server/lib/runtime-stall-profiler');let worker,finish;
 class FakeWorker extends EventEmitter{constructor(){super();worker=this;this.messages=[];this.referenced=false;}postMessage(m){this.messages.push(m);}reply(index,running){this.emit('message',{id:this.messages[index].id,ok:true,running,logs:[]});}ref(){this.referenced=true;}unref(){this.referenced=false;}terminate(){return new Promise(resolve=>{finish=resolve;});}}
 wt.Worker=FakeWorker;let p,closing;
 try{p=createStallProfiler({});const start=p.start();worker.reply(0,true);await start;closing=p.stop();worker.reply(1,false);await Promise.resolve();assert.equal(worker.referenced,true);finish(0);await closing;}finally{finish?.(0);await closing;wt.Worker=original;}
});
test('native profiler shutdown survives consecutive sessions in four concurrent processes',async()=>{
 const {spawn}=require('node:child_process'),helper=path.join(__dirname,'helpers/profiler-native-close.cjs'),moduleFile=path.join(__dirname,'../server/lib/runtime-stall-profiler.js');
 let next=0;const results=[];
 await Promise.all(Array.from({length:4},async()=>{
  while(next<24){
   const attempt=next++;
   results.push(await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[helper,moduleFile],{env:process.env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
    child.on('error',reject);child.on('close',(code,signal)=>resolve({attempt,code,signal,stdout,stderr}));
   }));
  }
 }));
 assert.equal(results.length,24);
 for(const result of results){
  assert.equal(result.signal,null,JSON.stringify(result));assert.equal(result.code,0,JSON.stringify(result));
  assert.equal(result.stderr,'',JSON.stringify(result));assert.equal(result.stdout,'completed 4 native profiler sessions\n',JSON.stringify(result));
 }
});
