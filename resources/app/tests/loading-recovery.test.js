'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'../public',file),'utf8');

test('worker dependency failure is a protocol error rather than an uncaught exception',()=>{
  const messages=[],scope={performance,importScripts(){throw new Error('NetworkError');},postMessage:m=>messages.push(m)};
  scope.self=scope;
  assert.doesNotThrow(()=>vm.runInNewContext(read('cp-decision-worker.js'),scope));
  scope.onmessage({data:{id:1,type:'begin',payload:{}}});
  assert.equal(messages[0].id,1);assert.equal(messages[0].ok,false);
});

test('a stalled worker startup promptly releases the queue to canonical computation',async()=>{
  const Runtime=require('../public/cp-decision-runtime'),Engine=require('../public/cp-readiness-engine');
  let terminated=0;
  const runtime=Runtime.create({contextKey:()=>1,analyzeRow:Engine.analyzeOrder,summarize:Engine.summarizeAnalyses,
    workerStartTimeoutMs:10,workerFactory:()=>({postMessage(){},terminate(){terminated++;}})});
  const rows=Array.from({length:128},(_,i)=>({'Order Code':String(i),'Order Quantity':10})),context={today:20000};
  try{
    const result=await Promise.race([runtime.computeAsync(rows,context),new Promise((_,reject)=>{
      const timer=setTimeout(()=>reject(new Error('startup stayed pending')),200);timer.unref();
    })]);
    assert.deepEqual(result,Engine.analyze(rows,context));assert.equal(terminated,1);assert.equal(runtime.getStats().fallbackJobs,1);
  }finally{runtime.dispose();}
});

function script(){const listeners=new Map();return{src:'',dataset:{},addEventListener:(t,f)=>listeners.set(t,f),removeEventListener:t=>listeners.delete(t),remove(){this.removed=true;},fire:t=>listeners.get(t)?.()};}
test('stalled lazy scripts reject and require reload so late execution cannot be duplicated',async()=>{
  const elements=[],timers=new Map();let timerId=0;
  const document={baseURI:'http://buyerlog/',readyState:'complete',currentScript:{src:''},scripts:[],createElement:script,
    head:{appendChild(el){elements.push(el);document.scripts.push(el);}}};
  const scope={document,URL,performance,queueMicrotask,setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)};
  scope.window=scope;vm.runInNewContext(read('perf-runtime.js'),scope);
  const first=scope.BLPerf._loadScript('data-management.js');
  const failure=assert.rejects(first,error=>error.code==='BL_SCRIPT_TIMEOUT');assert.equal(timers.size,1,'pending script must have a deadline');
  [...timers.values()][0]();await failure;
  assert.equal(elements[0].removed,true);elements[0].fire('load');
  await assert.rejects(scope.BLPerf._loadScript('data-management.js'),error=>error.code==='BL_SCRIPT_TIMEOUT');
  assert.equal(elements.length,1);assert.equal(timers.size,0);
  const failed=scope.BLPerf._loadScript('other.js');
  const rejected=assert.rejects(failed);elements[1].fire('error');await rejected;
  const retry=scope.BLPerf._loadScript('other.js');elements[2].fire('load');
  assert.equal(await retry,elements[2]);assert.equal(timers.size,0);
});

test('Data Management bounds both response and body waits and isolates optional failures',async()=>{
  const source=read('data-management.js'),start=source.indexOf('  async function readLoadPayload(');
  assert.ok(start>=0);
  const scope={AbortController,T:tr=>tr,setTimeout:fn=>setTimeout(fn,10),clearTimeout,
    fetch:async(_url,{signal})=>({ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))})};
  vm.runInNewContext(source.slice(start,source.indexOf('  async function runLoad()',start)),scope);
  await assert.rejects(scope.readLoadPayload('/overview'),/Sunucu zamanında/);
  assert.equal(await scope.readLoadPayload('/optional',true),null);
  scope.fetch=async()=>({ok:true,json:async()=>({ok:true,revision:1})});
  assert.equal((await scope.readLoadPayload('/overview')).revision,1);
  scope.fetch=async()=>({ok:false,json:async()=>({ok:false,error:'not authorized'})});
  await assert.rejects(scope.readLoadPayload('/overview'),/not authorized/);
  assert.equal(await scope.readLoadPayload('/optional',true),null);
});
