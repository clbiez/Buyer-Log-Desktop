'use strict';
// NONFORMAL diagnostic instrumentation. No renderer/business function replacement.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const packet=__dirname,manifest=JSON.parse(fs.readFileSync(path.join(packet,'prepared-manifest.json'),'utf8'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(manifest.observer.path)),manifest.observer.sha256);
// Use the ACTUAL existing observer unchanged; its context.close captures full rows.
const observer=require(manifest.observer.path);
const directory=path.resolve(process.env.ORDERS_DIAGNOSTIC_DIR||'');
assert.ok(directory.startsWith(packet+path.sep+'runs'+path.sep));
const MAX_TRACE=64*1024*1024,CATEGORIES=['devtools.timeline','v8.execute','toplevel'];
const COMPLETION="['passed','failed'].includes(window.__benchmarkFirstTransition?.status)";
function save(name,value){const target=path.join(directory,name),temporary=target+'.partial';fs.writeFileSync(temporary,JSON.stringify(value,null,2)+'\n');fs.renameSync(temporary,target);}
async function bounded(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Diagnostic cleanup deadline: '+label)),30000);})]);}finally{clearTimeout(timer);}}
function installDiagnosticObservation(){
 // Native marks remain in the Performance Timeline; no BLPerf method is wrapped.
 const d=window.__ordersRegressionTrace={longTasks:[],modulePreparationEvents:[],lifecycle:[]};
 const taskObserver=new PerformanceObserver(list=>{for(const t of list.getEntries())d.longTasks.push({startTime:t.startTime,duration:t.duration});});
 taskObserver.observe({type:'longtask',buffered:true});
 d.flushTasks=()=>{for(const t of taskObserver.takeRecords())d.longTasks.push({startTime:t.startTime,duration:t.duration});};
 window.addEventListener('bl:module-preparation',event=>d.modulePreparationEvents.push({atMs:performance.now(),snapshot:JSON.parse(JSON.stringify(event.detail??null))}));
 for(const name of ['bl:primary-screen-ready','bl:startup-ready','bl:startup-complete'])window.addEventListener(name,()=>d.lifecycle.push({name,atMs:performance.now()}));
}
async function snapshot(page,label){
 const value=await page.evaluate(label=>{
  const d=window.__ordersRegressionTrace;d?.flushTasks?.();
  const marks=performance.getEntriesByType('mark').map(e=>({name:e.name,startTime:e.startTime,duration:e.duration}));
  const measures=performance.getEntriesByType('measure').map(e=>({name:e.name,startTime:e.startTime,duration:e.duration}));
  return {label,observedAtMs:performance.now(),timeOrigin:performance.timeOrigin,activeTab:document.body?.dataset.activeTab||null,
   timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
   allPerformanceMarks:marks,allPerformanceMeasures:measures,
   blPerfTimeline:window.BLPerf?.timeline?.()||[],blPerfOrigin:window.BLPerf?.origin?.()??null,blPerfSummary:window.BLPerf?.snapshot?.()||{},
   blPerfTimelineLimit:80,modulePreparationSummary:window.BLModulePreparation?.snapshot?.()||null,
   modulePreparationEvents:d?.modulePreparationEvents||[],lifecycle:d?.lifecycle||[],allObservedLongTasks:d?.longTasks||[],
   nativeFirstTransition:window.__benchmarkFirstTransition||null,nativeStartup:window.__startupProbe||null,
   rows:{cp:typeof state==='undefined'?null:state.cp?.rows?.length??null,orders:typeof state==='undefined'?null:state.orders?.rows?.length??null},
   sharedUi:{blur:document.querySelector('.blWorkspaceBlur')?.dataset.blur??null,headerLabels:document.querySelectorAll('#ordersTable .blGroupFollowLabel').length}};
 },label);
 save(label+'-actual-marks-and-preparation.json',value);return value;
}
exports.chromium={launch:async options=>{
 const browser=await observer.chromium.launch(options),createContext=browser.newContext.bind(browser);
 let contexts=0;
 browser.newContext=async options=>{
  assert.equal(++contexts,1,'single Orders context required');
  const context=await createContext({...options,timezoneId:'Europe/Istanbul'}),newPage=context.newPage.bind(context),observerClose=context.close.bind(context);
  let pages=0,record=null,closePromise=null;
  context.newPage=async()=>{
   assert.equal(++pages,1,'single real page required');
   const page=await newPage(),goto=page.goto.bind(page),wait=page.waitForFunction.bind(page);
   const cdp=await context.newCDPSession(page);
   let started=false,profilerStarted=false,traceStarted=false,stopped=false,stopPromise=null,traceComplete=false,traceFd=null,traceBytes=0,events=0;
   let traceFailed=false,traceDataLoss=false,fatalError=null,first=true,completionWaits=0,resolveFatal;
   const fatal=new Promise(resolve=>{resolveFatal=resolve;});
   const state={classification:manifest.classification,categories:CATEGORIES,samplingIntervalUs:1000,maxTraceBytes:MAX_TRACE,status:'prepared',boundary:'before native goto through native first-transition completion; stops BEFORE native result evaluate and full-row/schema JSON',traceEvents:0,traceBytes:0,errors:[]};
   function persist(){save('instrumentation.json',state);}
   function fail(error){
    const e=error instanceof Error?error:Error(String(error));
    if(!fatalError){fatalError=e;state.errors.push({message:e.message,at:new Date().toISOString()});state.status='failed';persist();resolveFatal(e);}
   }
   async function watch(promise){return Promise.race([promise,fatal.then(error=>{throw error;})]);}
   let traceDoneResolve;const traceDone=new Promise(resolve=>{traceDoneResolve=resolve;});
   cdp.on('Tracing.bufferUsage',value=>{
    // Fail before a record-until-full buffer can silently lose the interval.
    state.maxTraceBufferFraction=Math.max(state.maxTraceBufferFraction||0,Number(value.percentFull)||0,Number(value.value)||0);
    if(state.maxTraceBufferFraction>=0.80){traceFailed=true;fail(Error('Trace buffer reached 80%; diagnostic is incomplete'));void stop('trace-buffer-limit').catch(fail);}
   });
   cdp.on('Tracing.dataCollected',({value})=>{
    if(traceFd===null)return;
    for(const event of value){
     if(traceFailed){state.eventsNotRetained=(state.eventsNotRetained||0)+1;continue;}
     try{
      const bytes=Buffer.from((first?'':',\n')+JSON.stringify(event));
      if(traceBytes+bytes.length+4096>MAX_TRACE){traceFailed=true;state.eventsNotRetained=(state.eventsNotRetained||0)+1;fail(Error('Trace reached 64 MiB; partial evidence retained, no success claim'));void stop('trace-byte-limit').catch(fail);continue;}
      fs.writeSync(traceFd,bytes);traceBytes+=bytes.length;events++;first=false;
     }catch(error){traceFailed=true;fail(error);void stop('trace-write-failure').catch(fail);}
    }
   });
   cdp.on('Tracing.tracingComplete',value=>{
    traceComplete=true;traceDataLoss=!!value.dataLossOccurred;
    if(traceDataLoss){traceFailed=true;fail(Error('Chrome reported trace data loss'));}
    state.traceComplete=value;traceDoneResolve(value);
   });
   async function start(){
    assert.equal(started,false);started=true;state.status='starting';state.startedAt=new Date().toISOString();persist();
    try{
     traceFd=fs.openSync(path.join(directory,'timeline.trace.json.partial'),'wx');const header=Buffer.from('{"traceEvents":[\n');fs.writeSync(traceFd,header);traceBytes=header.length;
     await bounded(cdp.send('Profiler.enable'),'Profiler.enable');
     await bounded(cdp.send('Profiler.setSamplingInterval',{interval:1000}),'Profiler.setSamplingInterval');
     await bounded(cdp.send('Profiler.start'),'Profiler.start');profilerStarted=true;
     await bounded(cdp.send('Tracing.start',{transferMode:'ReportEvents',bufferUsageReportingInterval:500,traceConfig:{recordMode:'recordUntilFull',includedCategories:CATEGORIES,enableSampling:false,enableSystrace:false}}),'Tracing.start');traceStarted=true;
     state.status='recording';state.recordingBeforeGoto=true;persist();
    }catch(error){fail(error);throw error;}
   }
   async function stop(reason){
    if(stopPromise)return stopPromise;
    stopPromise=(async()=>{
     state.stopReason=reason;state.stopRequestedAt=new Date().toISOString();persist();
     const errors=[];
     // Send both stop commands before doing any renderer evaluation/JSON capture.
     const profile=profilerStarted?bounded(cdp.send('Profiler.stop'),'Profiler.stop'):Promise.resolve(null);
     const trace=traceStarted?bounded(cdp.send('Tracing.end').then(()=>traceDone),'Tracing.end/complete'):Promise.resolve(null);
     const settled=await Promise.allSettled([profile,trace]);
     if(settled[0].status==='fulfilled'&&settled[0].value){
      try{save('renderer.cpuprofile',settled[0].value.profile);state.cpuProfileComplete=true;}catch(error){errors.push(error);}
     }else if(settled[0].status==='rejected')errors.push(settled[0].reason);
     if(settled[1].status==='rejected')errors.push(settled[1].reason);
     if(traceFd!==null){
      try{
       const footer=Buffer.from('\n],"diagnosticMetadata":'+JSON.stringify({complete:traceComplete&&!traceFailed&&!traceDataLoss,categories:CATEGORIES,reason,maxTraceBytes:MAX_TRACE})+'}\n');
       if(traceBytes+footer.length<=MAX_TRACE){fs.writeSync(traceFd,footer);traceBytes+=footer.length;}
       fs.fsyncSync(traceFd);fs.closeSync(traceFd);traceFd=null;
       if(traceComplete&&!traceFailed&&!traceDataLoss)fs.renameSync(path.join(directory,'timeline.trace.json.partial'),path.join(directory,'timeline.trace.json'));
      }catch(error){errors.push(error);}
     }
     state.traceBytes=traceBytes;state.traceEvents=events;state.traceDataLoss=traceDataLoss;state.traceCompleteReceived=traceComplete;
     state.stopCommandsSettledBeforeSupplementalCapture=true;state.profileStoppedBeforeSupplementalCapture=!!state.cpuProfileComplete&&(!traceStarted||traceComplete);state.stoppedAt=new Date().toISOString();stopped=true;
     for(const error of errors)fail(error);
     if(!started||!profilerStarted||!traceStarted||!traceComplete||!state.cpuProfileComplete)fail(Error('Incomplete diagnostic instrumentation'));
     state.status=fatalError?'failed':'stopped';persist();
     return state;
    })();return stopPromise;
   }
   await page.addInitScript(installDiagnosticObservation);
   page.goto=async(...args)=>{
    const url=new URL(args[0]);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.search,'?module=overview');
    await start();return watch(goto(...args));
   };
   page.waitForFunction=async(...args)=>{
    const isCompletion=String(args[0]).includes(COMPLETION);
    if(isCompletion)completionWaits++;
    const result=await watch(wait(...args));
    if(isCompletion){
     await stop('native-first-transition-completed');
     // Original benchmark resumes result extraction only after CDP has stopped.
     await snapshot(page,'profile-boundary');
     if(fatalError)throw fatalError;
    }
    return result;
   };
   record={page,stop,state,check:()=>{assert.equal(completionWaits,1,'native completion wait must be intercepted exactly once');assert.equal(stopped,true);if(fatalError)throw fatalError;},detach:()=>bounded(cdp.detach(),'CDP detach')};
   return page;
  };
  context.close=async()=>{
   if(closePromise)return closePromise;
   closePromise=(async()=>{
   const failures=[];
   try{
    if(record){
     try{await record.stop('context-close-failure-fallback');}catch(error){failures.push(error);}
     try{await snapshot(record.page,'context-close');}catch(error){failures.push(error);}
     try{record.check();}catch(error){failures.push(error);}
     try{await record.detach();}catch(error){failures.push(error);}
    }else failures.push(Error('No real page was created'));
   }finally{
    // Unmodified observer performs its actual full-row/schema/cell capture here.
    try{await observerClose();}catch(error){failures.push(error);}
   }
   save('context-close-diagnostic.json',{observer:manifest.observer,actualSchemaObserverInvoked:true,profileStoppedBeforeObserver:!!(record?.state.cpuProfileComplete&&record?.state.traceCompleteReceived),failures:failures.map(error=>({message:error.message,stack:error.stack})),closedAt:new Date().toISOString()});
   if(failures.length)throw new AggregateError(failures,'Orders diagnostic capture failed; partial artifacts retained');
   })();return closePromise;
  };
  return context;
 };
 return browser;
}};
