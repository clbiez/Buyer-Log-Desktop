'use strict';

// Local synthetic sources only. Run each repetition in a fresh fixture root:
// CHROMIUM_PATH=/usr/bin/chromium node scripts/benchmark-startup-orders.js --rows 30000 --out /tmp/startup.json
// Reuse identical source bytes (not data/cache) with --source-fixture /tmp/buyerlog-startup-*/source.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {spawn,spawnSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {requestJson,summarizeHealth,parseStalls,validateMeasurement,installProbe,measureModules,compactRefreshStatus,readRendererMetrics,initializeBenchmarkState}=require('./lib/startup-benchmark');
const arg=(name,fallback)=>{const index=process.argv.indexOf(name);return index<0?fallback:process.argv[index+1];};
const APP=path.resolve(arg('--app-root',path.resolve(__dirname,'..')));
const count=Number(arg('--rows',30000)),sampleWindowMs=Number(arg('--sample-ms',10000));
const rendererTimeoutMs=Number(arg('--renderer-timeout-ms',900000));
const serverLoopProbe=process.argv.includes('--server-loop-probe');
if(!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(sampleWindowMs)||sampleWindowMs<1000)throw Error('Invalid rows or sample window');
if(!Number.isSafeInteger(rendererTimeoutMs)||rendererTimeoutMs<60000)throw Error('Invalid renderer timeout');
const requestedModules=arg('--module','')?[arg('--module','')]:['overview','koleksiyon','cp','orders'];
if(requestedModules.some(module=>!['overview','koleksiyon','cp','orders'].includes(module)))throw Error('Unsupported benchmark module');
const root=path.resolve(arg('--fixture-root','')||fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-')));
if(path.dirname(root)!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('buyerlog-startup-'))throw Error('Fixture must be a buyerlog-startup-* directory directly under system temp');
fs.mkdirSync(root,{recursive:true});
if(fs.lstatSync(root).isSymbolicLink()||fs.realpathSync(root)!==root)throw Error('Fixture root must not be a symbolic link');
const output=path.resolve(arg('--out',path.join(root,'measurement.json'))),logFile=path.join(root,'server.log');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let server,browser,cookie='',base,phase='setup',healthStopped=false,healthLoop,expected;
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),
  BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),
  BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp')};
const report={schemaVersion:3,synthetic:true,status:'running',startedAt:new Date().toISOString(),fixtureRoot:root,requestedRows:count,requestedModules,rendererTimeoutMs,
  harnessSha256:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  sampling:{startMs:0,endMs:sampleWindowMs,clock:'navigation performance.now; tasks clipped at window end'},measurements:[],healthSamples:[]};
function persist(){
  report.health={all:summarizeHealth(report.healthSamples,null,'/api/health'),refresh:summarizeHealth(report.healthSamples,'refresh','/api/health')};
  report.statusProbe={endpoint:'/api/status',all:summarizeHealth(report.healthSamples,null,'/api/status'),refresh:summarizeHealth(report.healthSamples,'refresh','/api/status')};
  report.health.endpoint='/api/health';report.health.readinessEndpoint='/api/status';
  report.health.observedStatuses=[...new Set(report.healthSamples.filter(sample=>sample.endpoint==='/api/health').map(sample=>sample.status))];
  report.health.endpointAvailable=report.healthSamples.some(sample=>sample.endpoint==='/api/health'&&sample.status===200);
  const log=fs.existsSync(logFile)?fs.readFileSync(logFile,'utf8'):'';
  report.stalls=parseStalls(log);
  if(serverLoopProbe){
    const probe=require('./lib/server-loop-probe'),events=probe.readProbeEvents(root);
    report.serverLoopProbe={enabled:true,observerSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'lib/server-loop-probe.js'))).digest('hex'),...probe.summarizeGaps(events),events,
      files:fs.readdirSync(root).filter(file=>/^event-loop-probe-\d+\.jsonl$/.test(file)),
      modules:report.measurements.map(m=>({module:m.module,navigationStartedAtMs:m.navigationStartedAtMs,observedAtMs:m.observedAtMs,
        ...probe.summarizeGaps(events,{startMs:m.navigationStartedAtMs,endMs:m.observedAtMs})}))};
  }
  const profiles=path.join(root,'local','logs','stall-profiles');
  report.diagnostics={serverLog:logFile,stallProfileLines:log.split(/\r?\n/).filter(line=>line.includes('[RUNTIME] stall-profile')),
    stallProfiles:fs.existsSync(profiles)?fs.readdirSync(profiles).filter(file=>file.endsWith('.cpuprofile')).map(file=>path.join(profiles,file)):[]};
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.partial',JSON.stringify(report,null,2)+'\n');
}
async function api(url,options={}){return requestJson(base+url,{...options,headers:{cookie,'Content-Type':'application/json',...options.headers}});}
async function health(){
  const observedPhase=phase,startedAt=new Date().toISOString();
  for(const endpoint of ['/api/health','/api/status'])try{await requestJson(base+endpoint,{}, {onAttempt:sample=>report.healthSamples.push({...sample,endpoint,phase:observedPhase,startedAt})});}catch(_){}
}
async function start(){
  const started=performance.now(),log=fs.openSync(logFile,'a');
  const serverArgs=[path.join(APP,'server/server.js')];
  if(serverLoopProbe){serverArgs.unshift('--require',path.join(__dirname,'lib/server-loop-probe.js'));env.BUYER_LOG_BENCHMARK_LOOP_ROOT=root;}
  server=spawn(process.execPath,serverArgs,{cwd:APP,env,stdio:['ignore',log,log]});fs.closeSync(log);
  let spawnError;server.on('error',error=>{spawnError=error;});
  for(let i=0;i<80;i++){
    if(spawnError)throw spawnError;if(server.exitCode!==null)throw Error('Server exited: '+server.exitCode);
    try{await api('/api/status');return performance.now()-started;}catch(_){}
    await delay(250);
  }
  throw Error('Server startup timed out');
}
async function stop(){
  if(!server||server.exitCode!==null)return;
  const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');
  await Promise.race([done,delay(10000)]);if(server.exitCode===null){server.kill('SIGKILL');await done;}
}
async function login(){
  const password='synthetic-startup-only-123';
  // Mutations never retry, including login and refresh.
  const response=await fetch(base+'/api/user-login',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password,newPassword:password})});
  if(!response.ok)throw Error('Synthetic login failed: '+response.status);
  cookie=String(response.headers.get('set-cookie')||'').split(';')[0];
}
function manifest(){return JSON.parse(fs.readFileSync(path.join(root,'local','page-cache','moderator','manifest.json'),'utf8'));}
function identity(){const m=manifest();return {generation:m.activeGeneration,sourceRevision:m.sourceRevisionKey};}
async function rendererRss(){
  const cdp=await browser.newBrowserCDPSession();
  try{const {processInfo}=await cdp.send('SystemInfo.getProcessInfo');
    return processInfo.filter(p=>p.type==='renderer').reduce((total,p)=>{
      try{const match=fs.readFileSync('/proc/'+p.id+'/status','utf8').match(/^VmRSS:\s+(\d+)/m);return total+(match?Number(match[1])*1024:0);}catch(_){return total;}
    },0);
  }finally{await cdp.detach();}
}
async function open(context,page,module){
  try{
  const errors=[],projectionGenerations=[];
  const network=await context.newCDPSession(page);await network.send('Network.enable');
  await network.send('Network.setBlockedURLs',{urls:['https://*']});
  network.on('Network.responseReceived',({response})=>{
    if(new URL(response.url).pathname.startsWith('/api/page-projection/')&&response.status===200){
      const header=Object.entries(response.headers).find(([key])=>key.toLowerCase()==='x-page-cache-generation');
      projectionGenerations.push(header?.[1]||'');
    }
  });
  page.on('pageerror',error=>{errors.push(error.message);(report.rendererErrors??=[]).push({module,message:error.message});console.error(module+' page error: '+error.message);});
  page.on('console',message=>{const text=message.text();if(text.startsWith('BENCHMARK_LIFECYCLE ')){(report.lifecycleEvents??=[]).push({module,...JSON.parse(text.slice(20))});console.log(module+' '+text);persist();}});
  await page.addInitScript(installProbe,{sampleWindowMs,logEvents:true});
  // Observe the application's existing parse; never clone or parse a 72 MB response twice.
  await page.addInitScript(()=>{
    const original=Response.prototype.json;
    Response.prototype.json=async function(...args){
      const value=await original.apply(this,args);
      if(new URL(this.url,location.href).pathname==='/api/data'&&value.pageCache){
        window.__startupProbe.initialGeneration=value.pageCache.generation;
      }
      return value;
    };
  });
  const started=performance.now(),navigationStartedAtMs=Date.now();
  await page.goto(base+'/?module='+module,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.primaryScreenReadyMs)&&Number.isFinite(window.__startupProbe?.startupReadyMs),null,{timeout:rendererTimeoutMs,polling:100});
  await page.evaluate(()=>{window.__startupProbe.continueIntentAtMs=window.__startupProbe.startupReadyMs;window.__startupProbe.continueAtMs=performance.now();window.BLBootGuard?.continue({intentAtMs:window.__startupProbe.continueIntentAtMs});});
  await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupCompleteMs),null,{timeout:rendererTimeoutMs,polling:100});
  if(module==='orders')await page.waitForFunction(()=>state.orders?.rows.length>0&&document.querySelector('#ordersTable tbody tr[data-id]'),null,{timeout:rendererTimeoutMs,polling:100});
  if(module==='cp')await page.waitForFunction(()=>state.cp?.rows.length>0&&document.querySelector('#cpTable tbody tr[data-id]'),null,{timeout:rendererTimeoutMs,polling:100});
  const elapsedMs=performance.now()-started;
  await page.waitForFunction(ms=>performance.now()>=ms,sampleWindowMs,{timeout:rendererTimeoutMs,polling:100});
  const data=await page.evaluate(module=>{
    const p=window.__startupProbe;
    return {module,primaryScreenReadyMs:p.primaryScreenReadyMs,startupReadyMs:p.startupReadyMs,startupCompleteMs:p.startupCompleteMs,
      userWaitMs:p.userWaitMs,continueDispatchDelayMs:p.continueDispatchDelayMs,systemStartupCompleteMs:p.systemStartupCompleteMs,primaryToGateMs:p.startupReadyMs-p.primaryScreenReadyMs,
      initialGeneration:p.initialGeneration,
      rows:module==='orders'?state.orders?.rows.length:module==='cp'?state.cp?.rows.length:module==='koleksiyon'?kolRows.length:state.overviewSummary?.rows.length,
      revisions:{orders:Number(state.storeRevisions.orders)||0,suppFob:Number(state.storeRevisions.suppFob)||0},
      domRows:document.querySelectorAll(module==='orders'?'#ordersTable tbody tr[data-id]':module==='cp'?'#cpTable tbody tr[data-id]':'#kolTable tbody tr[data-id]').length,
      longTaskCount:p.longTasks.length,longTaskTotalMs:p.longTasks.reduce((sum,task)=>sum+task.duration,0),maxLongTaskMs:Math.max(0,...p.longTasks.map(task=>task.duration)),
      resources:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/api/data')||entry.name.includes('/api/page-projection/')).map(entry=>({path:new URL(entry.name).pathname,ms:entry.duration,decodedBytes:entry.decodedBodySize,encodedBytes:entry.encodedBodySize})),
      timeline:window.BLPerf?.timeline?.()};
  },module);
  Object.assign(data,await readRendererMetrics(context,page,rendererTimeoutMs));
  const measurement={...data,navigationStartedAtMs,observedAtMs:Date.now(),projectionGenerations:[data.initialGeneration,...projectionGenerations].filter(Boolean),elapsedMs,rendererRssBytes:await rendererRss(),errors};
  // Save the failed observation before validation throws.
  report.measurements.push(measurement);persist();Object.assign(measurement,identity());persist();validateMeasurement(expected,measurement);
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close()));
  await page.screenshot({path:path.join(root,module+'.png'),timeout:rendererTimeoutMs});
  await network.detach();
  return measurement;
  }catch(error){
    report.failedPage={module,message:error.message};
    let timer;
    try{report.failedPage.state=await Promise.race([page.evaluate(()=>({probe:window.__startupProbe,active:document.body?.dataset.activeTab,gate:document.getElementById('blBootGuard')?.dataset.ready,detail:document.querySelector('[data-boot-detail]')?.textContent})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Diagnostic evaluation timed out')),5000);})]);}catch(diagnosticError){report.failedPage.diagnosticError=diagnosticError.message;}finally{clearTimeout(timer);}
    persist();throw error;
  }
}
async function measureSameTab(context){
  const page=await context.newPage();
  try{
    const overview=await open(context,page,'overview');
    // The Overview entry here is a separate same-tab scenario, not a module repetition.
    report.measurements.pop();
    await page.waitForFunction(()=>window.BLPerf?.timeline?.().some(mark=>mark.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:600000});
    const warmup=await page.evaluate(()=>window.BLPerf.timeline().filter(mark=>/^BACKGROUND_WARMUP_/.test(mark.name))),switches=[];
    for(const [module,selector] of [['cp','#cpTable tbody tr[data-id]'],['orders','#ordersTable tbody tr[data-id]'],['koleksiyon','#view-koleksiyon']]){
      const result=await page.evaluate(([module,selector])=>new Promise((resolve,reject)=>{
        const started=performance.now();switchTab(module);
        const tick=()=>{
          if(document.body.dataset.activeTab===module&&document.querySelector(selector))return requestAnimationFrame(()=>requestAnimationFrame(()=>resolve({ms:performance.now()-started,rows:module==='cp'?state.cp?.rows.length:module==='orders'?state.orders?.rows.length:kolRows.length})));
          if(performance.now()-started>180000)return reject(Error(module+' switch timed out'));setTimeout(tick,20);
        };tick();
      }),[module,selector]);
      if(result.rows!==expected.rows[module])throw Error(module+' same-tab rows mismatch');
      switches.push({module,...result});console.log('same-tab '+module+': '+Math.round(result.ms)+' ms');
      await page.screenshot({path:path.join(root,'same-tab-'+module+'.png')});
    }
    return {overview,warmup,switches,rendererRssBytes:await rendererRss()};
  }finally{await page.close();}
}
function prepareFixture(){
  const source=path.join(root,'source'),shared=arg('--source-fixture','');
  if(shared){
    const resolved=fs.realpathSync(shared);
    if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'buyerlog-startup-')||path.basename(resolved)!=='source')throw Error('Shared fixture must be a synthetic temp source directory');
    const metadata=JSON.parse(fs.readFileSync(path.join(resolved,'benchmark-fixture.json'),'utf8'));
    if(metadata.synthetic!==true||metadata.rows!==count)throw Error('Shared fixture row count mismatch');
    fs.cpSync(resolved,source,{recursive:true});
  }else if(!fs.existsSync(path.join(source,'ASAS - Demo.xlsx'))){
    fs.mkdirSync(source,{recursive:true});
    const generated=spawnSync(process.execPath,[path.join(__dirname,'generate-demo-data.js'),source,'--rows',String(count),'--seed','7'],{cwd:APP,encoding:'utf8'});
    if(generated.status!==0)throw Error(generated.stderr||'Demo generation failed');
    const hashes=Object.fromEntries(fs.readdirSync(source).filter(file=>file.endsWith('.xlsx')).sort().map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex')]));
    fs.writeFileSync(path.join(source,'benchmark-fixture.json'),JSON.stringify({synthetic:true,rows:count,seed:7,hashes},null,2));
  }
  const metadata=JSON.parse(fs.readFileSync(path.join(source,'benchmark-fixture.json'),'utf8'));
  if(metadata.synthetic!==true||metadata.rows!==count)throw Error('Fixture row count mismatch');
  for(const [file,hash] of Object.entries(metadata.hashes))if(path.basename(file)!==file||crypto.createHash('sha256').update(fs.readFileSync(path.join(source,file))).digest('hex')!==hash)throw Error('Fixture checksum mismatch: '+file);
  report.fixture=metadata;return source;
}
(async()=>{
  try{
    const revision=spawnSync('git',['rev-parse','HEAD'],{cwd:APP,encoding:'utf8'}).stdout.trim();
    Object.assign(report,{platform:process.platform,node:process.version,revision,cpu:os.cpus()[0]?.model,cpuCount:os.cpus().length,
      availableParallelism:os.availableParallelism(),cpuQuota:fs.existsSync('/sys/fs/cgroup/cpu.max')?fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim():null,
      memoryLimitBytes:fs.existsSync('/sys/fs/cgroup/memory.max')?fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim():null});
    const source=prepareFixture();report.fixtureConditions=initializeBenchmarkState(root);
    const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:source,host:'127.0.0.1'}));
    phase='initial-start';await start();await login();
    healthLoop=(async()=>{while(!healthStopped){await health();await delay(500);}})();
    if(!process.argv.includes('--skip-refresh')){
      phase='refresh';const started=performance.now();await api('/api/refresh',{method:'POST',body:'{}'});
      let refreshed=false;
      for(let i=0;i<900;i++){report.refresh=compactRefreshStatus(await api('/api/refresh-status'));persist();if(!report.refresh.running){if(report.refresh.error)throw Error(JSON.stringify(report.refresh.error));refreshed=true;break;}await delay(500);}
      if(!refreshed||!report.refresh.jobId)throw Error('Synthetic refresh timed out or returned no job');report.refreshWallMs=performance.now()-started;
    }
    phase='validate';
    const initial=await api('/api/data?mode=initial'),m=manifest(),rows={koleksiyon:0};
    if(!m.sourceRevisionKey||!m.activeGeneration||!m.sourceLoadedAt)throw Error('Missing source revision/generation');
    if(report.refresh?.loadedAt!==undefined&&report.refresh.loadedAt!==m.sourceLoadedAt)throw Error('Refresh source revision mismatch');
    for(const module of ['cp','orders','overview']){
      const file=path.join(root,'local','page-cache','moderator',m.activeGeneration,module+'.json.gz'),bytes=fs.readFileSync(file);
      if(crypto.createHash('sha256').update(bytes).digest('hex')!==m.modules[module].checksum)throw Error(module+' cache checksum mismatch');
      rows[module]=JSON.parse(zlib.gunzipSync(bytes)).rows.length;
    }
    if(rows.orders!==count||rows.cp<1)throw Error('Fixture/cache row count mismatch');
    expected={rows,...identity(),revisions:{orders:Number(initial.storeRevisions.orders)||0,suppFob:Number(initial.storeRevisions.suppFob)||0}};
    report.expected=expected;persist();
    phase='restart';healthStopped=true;await healthLoop;await stop();report.backendStartupMs=await start();await login();
    phase='startup';healthStopped=false;healthLoop=(async()=>{while(!healthStopped){await health();await delay(500);}})();
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox',...(process.env.STARTUP_DEBUG_PORT?['--remote-debugging-port='+process.env.STARTUP_DEBUG_PORT]:[])]});report.chromium=browser.version();
    const context=await browser.newContext({viewport:{width:1600,height:1000}}),split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
    // Every page, including same-tab scenario, closes before the next measurement.
    if(!process.argv.includes('--skip-same-tab'))report.sameTab=await measureSameTab(context);
    await measureModules(context,requestedModules,(page,module)=>open(context,page,module));
    report.status='passed';report.limitations=['Linux headless Chromium; Windows/Electron, antivirus and cold OS disk cache are not measured.',
      'Collection workspace is empty synthetic data. RSS sums include shared renderer pages, not unique physical memory.',
      'Health probes are serial every 500 ms after completion; timeouts/errors are retained in quantiles, not discarded.',
      'Long tasks use a fixed navigation window; startup events outside it remain separate timings.',
      ...(!report.health.endpointAvailable?['This revision has no /api/health handler. Reported health latencies are failed HTTP round trips (404), not a successful health endpoint. Readiness uses /api/status.']:[])];
  }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};throw error;
  }finally{
    healthStopped=true;if(healthLoop)await healthLoop;
    try{if(browser)await browser.close();}finally{await stop();report.finishedAt=new Date().toISOString();persist();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log('Report: '+output+'; retained diagnostics: '+root);}
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
