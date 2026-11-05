'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requestJson, summarizeHealth, parseStalls, validateMeasurement, installProbe, measureModules } = require('../scripts/lib/startup-benchmark');

test('benchmark retries only transient GET health/status failures, never refresh POST', async () => {
  for (const [url, method, attempts] of [['/api/health','GET',3],['/api/refresh-status','GET',3],['/api/refresh','POST',1],['/api/data','GET',1],['/api/health','POST',1]]) {
    let calls=0;
    await assert.rejects(requestJson('http://local'+url,{method},{fetchImpl:async()=>{calls++;throw Error('offline');},delayImpl:async()=>{}}),/offline/);
    assert.equal(calls,attempts,url+' '+method);
  }
  let calls=0;
  await assert.rejects(requestJson('http://local/api/refresh-status',{}, {fetchImpl:async()=>{calls++;return {ok:false,status:403,json:async()=>({code:'FORBIDDEN'})};}}),/403/);
  assert.equal(calls,1,'authorization failures must not be retried');
});

test('benchmark health quantiles retain failed attempts and separate refresh samples', () => {
  const samples=[{phase:'refresh',ms:20,status:200},{phase:'refresh',ms:100,status:200},{phase:'refresh',ms:900,error:'timeout'},{phase:'startup',ms:10,status:200}];
  assert.deepEqual(summarizeHealth(samples,'refresh'),{count:3,successful:2,failed:1,p50Ms:100,p95Ms:900,maxMs:900});
  assert.equal(summarizeHealth([], 'refresh').p95Ms,null);
});

test('benchmark parses runtime stalls without dropping the original evidence', () => {
  const line='[RUNTIME] event-loop-stall blockedMs=3721 cpuMs=4088 heapUsedMb=900';
  assert.deepEqual(parseStalls('noise\n'+line+'\n[RUNTIME] stall-profile top1 200ms parse'),[{line,blockedMs:3721,cpuMs:4088,heapUsedMb:900}]);
});

test('benchmark rejects stale generation, source revision and wrong row count', () => {
  const expected={rows:{orders:30000,cp:24982,koleksiyon:0,overview:30000},generation:'g1',sourceRevision:'r1',revisions:{orders:2,suppFob:3}};
  const valid={module:'orders',rows:30000,generation:'g1',sourceRevision:'r1',revisions:{orders:2,suppFob:3},projectionGenerations:['g1']};
  assert.doesNotThrow(()=>validateMeasurement(expected,valid));
  for (const patch of [{rows:29999},{generation:'g0'},{sourceRevision:'r0'},{revisions:{orders:1,suppFob:3}},{projectionGenerations:['g0']}]) assert.throws(()=>validateMeasurement(expected,{...valid,...patch}),/mismatch/i);
  assert.throws(()=>validateMeasurement(expected,{...valid,projectionGenerations:[]}),/missing/i);
});

test('benchmark records three distinct events, excludes user wait and fixes task window', () => {
  const old={window:global.window,performance:global.performance,PerformanceObserver:global.PerformanceObserver};
  let now=0,observe;const listeners={};
  global.window={addEventListener:(name,fn)=>listeners[name]=fn};
  Object.defineProperty(global,'performance',{configurable:true,value:{now:()=>now}});
  global.PerformanceObserver=class {constructor(fn){observe=fn;}observe(){} disconnect(){}};
  try {
    installProbe({sampleWindowMs:1000});
    now=100;listeners['bl:primary-screen-ready']();now=200;listeners['bl:startup-ready']();
    now=700;window.__startupProbe.continueAtMs=now;now=800;listeners['bl:startup-complete']();
    observe({getEntries:()=>[{startTime:900,duration:300},{startTime:1200,duration:100}]});
    const p=window.__startupProbe;
    assert.equal(p.primaryScreenReadyMs,100);assert.equal(p.startupReadyMs,200);assert.equal(p.startupCompleteMs,800);
    assert.equal(p.userWaitMs,500);assert.equal(p.systemStartupCompleteMs,300);
    assert.deepEqual(p.longTasks,[{startTime:900,duration:100}]);
  } finally {for(const [key,value] of Object.entries(old))Object.defineProperty(global,key,{configurable:true,writable:true,value});}
});

test('benchmark closes each renderer even if measurement or screenshot fails', async () => {
  const events=[];
  const context={newPage:async()=>{events.push('open');return {close:async()=>events.push('close')};}};
  await measureModules(context,['cp','orders'],async(page,module)=>{events.push(module);return module;});
  assert.deepEqual(events,['open','cp','close','open','orders','close']);
  events.length=0;
  await assert.rejects(measureModules(context,['cp','orders'],async()=>{throw Error('capture failed');}),/capture failed/);
  assert.deepEqual(events,['open','close']);
});
