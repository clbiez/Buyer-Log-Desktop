'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const repo=process.cwd(), app=path.join(repo,'resources/app'), root=path.join(repo,'work/plm-progress');
const port=6467,base=`http://127.0.0.1:${port}`;
const runRoot=path.join(root,'browser-data');fs.mkdirSync(runRoot,{recursive:true});
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(runRoot,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']) {env[key]=path.join(runRoot,key);fs.mkdirSync(env[key],{recursive:true});}
fs.mkdirSync(path.join(runRoot,'source'),{recursive:true});
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(runRoot,'source')}));
const log=fs.openSync(path.join(runRoot,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser;
const samples=[],control=process.argv.includes('--control');
const imageJob={id:'demo-images',kind:'plm-images',scope:'orders',label:'Demo models',status:'running',phase:'Görseller indiriliyor',running:true,total:952,processed:0,succeeded:0,failed:0,remaining:952,percent:0,activeModel:'',elapsedMs:100000,stageElapsedMs:12000,ratePerMinute:0,etaMs:null,failureCount:0,stage:'committing',stageCurrent:0,stageTotal:0};
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{} await new Promise(r=>setTimeout(r,250));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-plm-123',password:'demo-plm-123'})});
 assert.equal(login.status,200,await login.clone().text());
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const round of [0,1,2])for(const variant of (control?['base','base-control']:['base','candidate'])){
  const context=await browser.newContext({viewport:{width:1360,height:900},reducedMotion:'reduce'});
  const [name,...value]=login.headers.get('set-cookie').split(';')[0].split('=');
  await context.addCookies([{name,value:value.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');window.__longTasks=[];new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
  let job={...imageJob},jobRequests=0;
  const page=await context.newPage();
  if(variant!=='candidate')for(const [file,backup] of [['app-main.js','base-app-main.js'],['plm-operations.js','base-plm-operations.js']])await page.route(`**/${file}*`,r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,backup),'utf8')}));
  await page.route('**/api/plm-jobs',r=>{jobRequests++;return r.fulfill({json:{jobs:[job]}});});
  const start=performance.now();await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.BLPerf&&typeof window.switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:1500}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  const startupMs=performance.now()-start;
  await page.evaluate(()=>switchTab('orders'));
  await page.waitForFunction(()=>window.BLPlmOps,null,{timeout:30000});
  const openAt=await page.evaluate(()=>performance.now());
  const firstMs=await page.evaluate(()=>{const start=performance.now();BLPlmOps.open();document.querySelector('#plmOpsPanel').getBoundingClientRect();return performance.now()-start;});
  await page.waitForTimeout(100);
  const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');
  const beforeCycles=await cdp.send('Memory.getDOMCounters');
  const cycleTimes=[];
  for(let i=0;i<5;i++)cycleTimes.push(await page.evaluate(()=>{BLPlmOps.close();const start=performance.now();BLPlmOps.open();document.querySelector('#plmOpsPanel').getBoundingClientRect();return performance.now()-start;}));
  const refreshTimes=[];
  for(let i=0;i<5;i++)refreshTimes.push(await page.evaluate(async()=>{const start=performance.now();await BLPlmOps.refresh();document.querySelector('#plmOpsPanel').getBoundingClientRect();return performance.now()-start;}));
  await cdp.send('HeapProfiler.collectGarbage');
  const afterCycles=await cdp.send('Memory.getDOMCounters');
  const memory=await page.evaluate(()=>({heap:performance.memory?.usedJSHeapSize,longTasks:window.__longTasks}));
  const comparableRequests=jobRequests;
  if(variant==='candidate'&&round===0){
   for(const lang of ['tr','en']){
    await page.evaluate(lang=>applyLanguage(lang),lang);
    await page.evaluate(()=>BLPlmOps.refresh());
    let phase=await page.locator('#plmOpsPanel .plmOpsPhase').innerText();
    assert.match(phase,lang==='tr'?/kaydediliyor/:/Saving images/);
    assert.doesNotMatch(phase,/2074306/);
    assert.equal(await page.locator('#plmOpsPanel [role="progressbar"]').getAttribute('aria-valuenow'),null);
    assert.doesNotMatch(await page.locator('#plmOpsPanel .plmOpsStats').innerText(),/ETA|Tahmini kalan/);
    if(lang==='tr')await page.screenshot({path:path.join(app,'public/release-notes/next-assets/plm-accurate-progress.png')});
    else await page.screenshot({path:path.join(root,'plm-progress-en.png')});
   }
   job={...imageJob,stage:'downloading',stageCurrent:473,stageTotal:474,activeModel:'2074306'};
   await page.evaluate(()=>BLPlmOps.refresh());assert.match(await page.locator('#plmOpsPanel .plmOpsLine').innerText(),/473\/474.*99/);
   job={...imageJob,stage:'releasing'};await page.evaluate(()=>BLPlmOps.refresh());assert.match(await page.locator('#plmOpsPanel .plmOpsPhase').innerText(),/Releasing shared storage locks/);
   job={...imageJob,status:'succeeded',running:false,processed:952,succeeded:952,remaining:0,percent:100};await page.evaluate(()=>BLPlmOps.refresh());assert.match(await page.locator('#plmOpsPanel .plmOpsPhase').innerText(),/Completed/);
   assert.equal(await page.locator('#plmOpsPanel .plmOpsActive').count(),0);
   job={...imageJob,kind:'plm-sync',stage:'',processed:4,total:10,remaining:6,percent:40,phase:'Demo sync',etaMs:1000};await page.evaluate(()=>BLPlmOps.refresh());assert.match(await page.locator('#plmOpsPanel .plmOpsLine').innerText(),/4\/10/);
  }
  job={...imageJob,running:false,status:'succeeded'};await page.evaluate(async()=>{await BLPlmOps.refresh();BLPlmOps.close();});
  const requestsAtClose=jobRequests;await page.waitForTimeout(1200);assert.equal(jobRequests,requestsAtClose,'poller stopped after final close');
  samples.push({round,variant,startupMs,firstMs,cycleTimes,refreshTimes,jobRequests:comparableRequests,requestsAfterClose:jobRequests-requestsAtClose,openAt,beforeCycles,afterCycles,...memory});
  console.log(JSON.stringify(samples.at(-1)));await context.close();
 }
 fs.writeFileSync(path.join(root,control?'browser-control.json':'browser-results.json'),JSON.stringify(samples,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');});
