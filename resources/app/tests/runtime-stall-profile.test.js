'use strict';
/* Stall diagnostics: the profile summary names the functions that used the
   blocked time and their call chains, with app-relative paths only. */
const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeProfile}=require('../server/lib/runtime-pressure-monitor');

test('summary ranks self time per function and keeps local folders out of paths',()=>{
  const frame=(id,name,url,line)=>({id,callFrame:{functionName:name,url,lineNumber:line},children:[]});
  const root=frame(1,'(root)','',0),outer=frame(2,'loadInitialData','file:///C:/Users/someone/BuyerLog/app/server/server.js',7071),inner=frame(3,'buildRows','C:\\Users\\someone\\BuyerLog\\app\\server\\lib\\parse.js',99),idle=frame(4,'(idle)','',0);
  root.children=[2,4];outer.children=[3];
  const summary=summarizeProfile({nodes:[root,outer,inner,idle],samples:[3,3,3,2,4],timeDeltas:[1000000,1000000,1000000,500000,250000]});
  assert.equal(summary.functions[0].label,'buildRows server/lib/parse.js:100');
  assert.equal(summary.functions[0].ms,3000);
  assert.deepEqual(summary.stacks[0].chain,['buildRows server/lib/parse.js:100','loadInitialData server/server.js:7072']);
  assert.doesNotMatch(JSON.stringify(summary),/someone|Users/);
});
test('quiet rotation discards unused samples in the worker without materializing them on the main thread, while real stalls retain their profile',async()=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),inspector=require('node:inspector');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-runtime-profiler-')),calls=[],logs=[];
  const wt=require('node:worker_threads'),{EventEmitter}=require('node:events');
  const {createProfilerController}=require('../server/lib/runtime-stall-profiler-worker');
  const original={Session:inspector.Session,Worker:wt.Worker,setInterval:global.setInterval,clearInterval:global.clearInterval,now:Date.now};
  let clock=1000000,tick,monitor;
  const profile={startTime:0,endTime:10000,nodes:[{id:1,callFrame:{functionName:'synthetic',url:'file:///demo/server.js',lineNumber:1},children:[]}],samples:[1],timeDeltas:[10000]};
  class Session{
    connect(){}disconnect(){}
    post(method,params,callback){calls.push({method,params});callback(null,method==='Profiler.stop'?{profile}:{});}
  }
  class Worker extends EventEmitter{
    constructor(file,options){super();assert.match(file,/runtime-stall-profiler-worker\.js$/);this.controller=createProfilerController({session:new Session(),...options.workerData});this.queue=Promise.resolve();}
    postMessage(message){this.queue=this.queue.then(async()=>{const result=await this.controller.execute(message.operation,message.payload);this.emit('message',{id:message.id,ok:true,...result});});}
    ref(){}unref(){}terminate(){return Promise.resolve(0);}
  }
  inspector.Session=class{constructor(){assert.fail('the HTTP event loop must never create an inspector session');}};wt.Worker=Worker;Date.now=()=>clock;global.setInterval=callback=>{tick=callback;return {unref(){}};};global.clearInterval=()=>{};
  const flush=()=>new Promise(setImmediate);
  try{
    monitor=require('../server/lib/runtime-pressure-monitor').startRuntimePressureMonitor({now:()=>clock,cpu:()=>0,profileDir:root,log:line=>logs.push(line)});await flush();
    for(let i=0;i<12;i++){clock+=5000;tick();await flush();}
    assert.equal(calls.filter(call=>call.method==='Profiler.stop').length,1,'a quiet window is discarded inside the worker');
    assert.equal(calls.filter(call=>call.method==='Profiler.disable').length,0,'the enabled profiler code cache must survive a quiet rotation');
    assert.equal(calls.filter(call=>call.method==='Profiler.start').length,2);
    assert.equal(calls.filter(call=>call.method==='Profiler.setSamplingInterval').length,2);
    clock+=20000;tick();await flush();
    assert.equal(calls.filter(call=>call.method==='Profiler.stop').length,2,'a real stall still materializes its preceding samples in the worker');
    const files=fs.readdirSync(root).filter(file=>file.endsWith('.cpuprofile'));assert.equal(files.length,1);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,files[0]),'utf8')),profile);
    assert.ok(logs.some(line=>line.includes('[RUNTIME] stall-profile ')));
  }finally{
    await monitor?.stop();inspector.Session=original.Session;wt.Worker=original.Worker;global.setInterval=original.setInterval;global.clearInterval=original.clearInterval;Date.now=original.now;fs.rmSync(root,{recursive:true,force:true});
  }
});
