'use strict';
// A completed F0 demo fixture is copied; its archived evidence is never modified.
// This is a separate interactive scenario, not a replacement for the F0 cohort.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),net=require('node:net'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const {installProbe,requestJson,summarizeHealth,parseStalls}=require('./lib/startup-benchmark');
const probe=require('./lib/server-loop-probe');
const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const app=path.resolve(arg('--app-root',path.resolve(__dirname,'..'))),seedFile=path.resolve(arg('--seed-report',''));
const root=path.resolve(arg('--fixture-root',path.join(os.tmpdir(),'buyerlog-startup-server-openings-'+Date.now())));
const output=path.resolve(arg('--out',path.join(root,'openings.json'))),settleMs=10000,timeoutMs=Number(arg('--timeout-ms',900000));
if(!Number.isSafeInteger(timeoutMs)||timeoutMs<60000)throw Error('Invalid opening timeout');
let server,browser,page,healthLoop,healthStopped=false,cookie='',base,phase='setup';
const report={schemaVersion:1,synthetic:true,status:'running',startedAt:new Date().toISOString(),fixtureRoot:root,seedReport:seedFile,settleMs,timeoutMs,measurements:[],healthSamples:[],requests:[],errors:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
function backlogScreenReady(){
  const delivery=window.BLBacklogAnalysis?._state,toggle=document.getElementById('backlogOverviewToggle');
  const overviewReady=!toggle||toggle.getAttribute('aria-expanded')!=='true'||Boolean(document.querySelector('#backlogOverviewBody .bpaHero'));
  return document.body.dataset.activeTab==='backlog'&&typeof lastBacklogData!=='undefined'&&lastBacklogData?.totalRows>0
    &&Boolean(document.querySelector('#backlogTreeTable tbody tr'))&&delivery?.rows?.length===lastBacklogData.totalRows
    &&!delivery.loading&&!delivery.error&&delivery.parity?.match===true&&overviewReady;
}
function assertNoFatalServerErrors(log){
  if(/\b(?:uncaughtException|unhandledRejection)\s*:/i.test(log))throw Error('Fatal server exception during the opening scenario');
}
function assertServerShutdown(result){
  if(result.forced||!(result.code===0||(result.code===null&&['SIGTERM','SIGINT'].includes(result.signal))))throw Error('Server shutdown failed during the opening scenario');
}
function persist(){
  if(fs.existsSync(root)){
    const events=probe.readProbeEvents(root,{requireStopped:Boolean(server&&(server.exitCode!==null||server.signalCode))});report.serverLoopProbe={observerSha256:probe.observerSha256(),events,
      measurements:report.measurements.map(m=>({scenario:m.scenario,...probe.summarizeGaps(events,{startMs:m.startedAtMs,endMs:m.observedAtMs??Date.now()})}))};
    report.health={endpoint:'/api/health',...summarizeHealth(report.healthSamples,null,'/api/health')};
    report.stalls=fs.existsSync(path.join(root,'interactive-server.log'))?parseStalls(fs.readFileSync(path.join(root,'interactive-server.log'),'utf8')):[];
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.partial',JSON.stringify(report,null,2)+'\n');
}
async function stop(){
  if(!server)return;
  let forced=false;
  if(server.exitCode===null&&!server.signalCode){
    const done=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await Promise.race([done,delay(10000)]);
    if(server.exitCode===null&&!server.signalCode){forced=true;server.kill('SIGKILL');await done;}
  }
  report.serverExit={code:server.exitCode,signal:server.signalCode,forced};
}
async function record(scenario,action,read){
  phase=scenario;const measurement={scenario,startedAtMs:Date.now()};report.measurements.push(measurement);persist();process.stdout.write('Opening: '+scenario+'\n');
  try{
    await action();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    measurement.readyAtMs=Date.now();measurement.readyMs=measurement.readyAtMs-measurement.startedAtMs;
    measurement.state=await read();await delay(settleMs);measurement.observedAtMs=Date.now();
    measurement.resources=await page.evaluate(()=>performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname.startsWith('/api/')).map(e=>({path:new URL(e.name).pathname,ms:e.duration,decodedBytes:e.decodedBodySize,encodedBytes:e.encodedBodySize})));
    await page.screenshot({path:path.join(root,scenario+'.png'),timeout:timeoutMs});
  }finally{measurement.observedAtMs??=Date.now();persist();}
}
(async()=>{
  try{
    if(!fs.existsSync(seedFile))throw Error('A completed synthetic F0 report is required');
    const seed=JSON.parse(fs.readFileSync(seedFile,'utf8'));
    if(seed.synthetic!==true||seed.status!=='passed'||!seed.finishedAt||!seed.fixture?.synthetic)throw Error('Only a completed, validated synthetic seed is accepted');
    const original=probe.assertSyntheticFixture(seed.fixtureRoot);
    if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('buyerlog-startup-')||fs.existsSync(root))throw Error('A new synthetic fixture directly under temp is required');
    fs.mkdirSync(root);
    for(const part of ['source','data','local','app'])if(fs.existsSync(path.join(original,part)))await fs.promises.cp(path.join(original,part),path.join(root,part),{recursive:true,errorOnExist:true,force:false});
    for(const [file,hash] of Object.entries(seed.fixture.hashes)){
      if(path.basename(file)!==file||sha(fs.readFileSync(path.join(root,'source',file)))!==hash)throw Error('Source bytes changed');
    }
    report.fixture=seed.fixture;report.expected=seed.expected;report.seedRevision=seed.revision;
    Object.assign(report,{revision:execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim(),harnessSha256:sha(fs.readFileSync(__filename)),platform:process.platform,node:process.version,
      availableParallelism:os.availableParallelism(),cpuQuota:fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),memoryLimitBytes:fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim()});
    const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));base='http://127.0.0.1:'+port;
    const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'data'),BUYER_LOG_AUTH_DATA_ROOT:path.join(root,'data'),BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_LOCAL_DB:path.join(root,'local','BuyerLogLocal.db'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_TEMP_ROOT:path.join(root,'tmp'),BUYER_LOG_BENCHMARK_LOOP_ROOT:root};
    // Kaynak yolu context hash'in parçasıdır. Arşivdeki sentetik kaynak yalnız
    // okunur; refresh gönderilmez, tüm çalışma/yazma kökleri yeni kopyadadır.
    fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(original,'source')}));
    const log=fs.openSync(path.join(root,'interactive-server.log'),'wx');server=spawn(process.execPath,['--require',path.join(__dirname,'lib/server-loop-probe.js'),path.join(app,'server/server.js')],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
    let ready=false;for(let i=0;i<120;i++){
      if(server.exitCode!==null)throw Error('Server exited before readiness');
      try{await requestJson(base+'/api/status');ready=true;break;}catch(_){}await delay(250);
    }if(!ready)throw Error('Server startup timeout');
    const password='synthetic-startup-only-123',login=await fetch(base+'/api/user-login',{method:'POST',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password,newPassword:password})});
    if(!login.ok)throw Error('Synthetic login failed: '+login.status);cookie=String(login.headers.get('set-cookie')||'').split(';')[0];
    healthLoop=(async()=>{while(!healthStopped){try{await requestJson(base+'/api/health',{}, {onAttempt:sample=>report.healthSamples.push({...sample,endpoint:'/api/health',phase,startedAt:new Date().toISOString()})});}catch(_){}await delay(500);}})();
    browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});report.chromium=browser.version();
    const context=await browser.newContext({viewport:{width:1600,height:1000}}),split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
    await context.route('https://**',route=>route.abort());
    await context.addInitScript(()=>{
      localStorage.setItem('bl.user.moderator.bl.releaseNotes.lastSeenStable.v1','99.0.0');
      localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');
    });
    page=await context.newPage();await page.addInitScript(installProbe,{sampleWindowMs:10000,logEvents:false});
    page.on('pageerror',error=>report.errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
    report.projectionGenerations=[];
    page.on('response',response=>{
      const url=new URL(response.url());
      if(url.pathname.startsWith('/api/backlog'))report.requests.push({path:url.pathname,query:url.search,status:response.status(),atMs:Date.now()});
      if(url.pathname.startsWith('/api/page-projection/')&&response.status()===200)report.projectionGenerations.push(response.headers()['x-page-cache-generation']||'');
    });
    await record('overview-global-flow',async()=>{
      await page.goto(base+'/?module=overview',{waitUntil:'domcontentloaded',timeout:120000});
      await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupReadyMs),null,{timeout:timeoutMs});
      await page.evaluate(()=>BLBootGuard.continue({intentAtMs:window.__startupProbe.startupReadyMs}));
      await page.waitForFunction(()=>Number.isFinite(window.__startupProbe?.startupCompleteMs),null,{timeout:timeoutMs});
      const notes=page.locator('dialog[open] [data-rn-close]');if(await notes.isVisible())await notes.click();
      await page.locator('#globalFlowMapWidget').scrollIntoViewIfNeeded({timeout:timeoutMs});
      await page.waitForFunction(()=>{const map=window.BLOverviewGlobalFlow?.engineState();return map?.filtered>0&&!map.earthLoading;},null,{timeout:timeoutMs});
    },()=>page.evaluate(()=>({overviewRows:state.overviewSummary?.rows.length,flow:BLOverviewGlobalFlow.engineState(),lifecycle:window.__startupProbe})));
    if(report.measurements[0].state.overviewRows!==seed.expected.rows.overview)throw Error('Overview row count differs from validated seed');
    await record('backlog',async()=>{
      await page.locator('nav.tabs button[data-tab="backlog"]').click({timeout:timeoutMs});
      await page.waitForFunction(backlogScreenReady,null,{timeout:timeoutMs});
    },()=>page.evaluate(()=>({rows:lastBacklogData.totalRows,orders:lastBacklogData.totalOrders,qty:lastBacklogData.totalQty,domRows:document.querySelectorAll('#backlogTreeTable tbody tr').length,
      deliveryRows:BLBacklogAnalysis._state.rows.length,deliveryParity:BLBacklogAnalysis._state.parity.match})));
    if(report.errors.length)throw Error('Renderer errors occurred');
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'local/page-cache/moderator/manifest.json'),'utf8'));
    if(manifest.sourceRevisionKey!==seed.expected.sourceRevision||manifest.activeGeneration!==seed.expected.generation||report.projectionGenerations.some(value=>value!==manifest.activeGeneration))throw Error('Source or projection generation changed during the opening scenario');
    assertNoFatalServerErrors(fs.readFileSync(path.join(root,'interactive-server.log'),'utf8'));
    report.correctness='passed';persist();report.responsivenessPassed=report.serverLoopProbe.measurements.every(m=>m.gapsOver200ms===0);
    report.status=report.responsivenessPassed?'passed':'failed';if(!report.responsivenessPassed)process.exitCode=1;
    report.limitations=['Separate sequential interactive scenario: Overview plus visible Global Flow, followed by Backlog; each window extends 10 seconds after actual ready state.','Linux headless Chromium; no Windows/Electron or cold OS disk cache claim.','Full timer gaps, including the normal 10 ms interval, are compared against 200 ms.','The seed is copied; no refresh mutation is sent in this scenario.'];
  }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
  finally{
    healthStopped=true;if(healthLoop)await healthLoop;
    try{await browser?.close();}finally{
      await stop();
      try{if(report.serverExit)assertServerShutdown(report.serverExit);if(fs.existsSync(path.join(root,'interactive-server.log')))assertNoFatalServerErrors(fs.readFileSync(path.join(root,'interactive-server.log'),'utf8'));}
      catch(error){report.correctness='failed';report.status='failed';report.error={message:error.message,stack:error.stack};process.exitCode=1;}
      report.finishedAt=new Date().toISOString();persist();fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');process.stdout.write('Report: '+output+'\n');
    }
  }
})();
