'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,spawnSync,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const repo=process.cwd(),app=path.join(repo,'resources/app'),out=path.join(repo,'docs/performance/backlog-recovery-date-panel'),root=fs.mkdtempSync(path.join(repo,'work/backlog-recovery-')),source=path.join(root,'source'),port=6479,base='http://127.0.0.1:'+port;
fs.mkdirSync(source);
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key);fs.mkdirSync(env[key],{recursive:true});}env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,page;const results=[];
const baseFiles=new Map(['backlog-overview.js','backlog-date-range.js','backlog-date-range.css','backlog-plan-actual.js'].map(file=>[file,execFileSync('git',['show','9e667430:resources/app/public/'+file],{cwd:repo,encoding:'utf8',maxBuffer:8000000})]));
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
for(let i=0;i<160;i++){try{if((await fetch(base+'/api/user-profiles')).ok)break;}catch{}await wait(250);}
const password=crypto.randomBytes(24).toString('hex'),login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
const api=async(url,opts={})=>{const r=await fetch(base+url,{...opts,headers:{cookie,'Content-Type':'application/json'}});assert.ok(r.ok,await r.clone().text());return r.json();};
browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
for(const count of [220,30000]){
 const gen=spawnSync(process.execPath,['scripts/generate-demo-data.js',source,'--rows',String(count),'--seed','7'],{cwd:app,encoding:'utf8'});assert.equal(gen.status,0,gen.stderr);
 const fixtureHash=crypto.createHash('sha256').update(fs.readFileSync(path.join(source,'ASAS.xlsx'))).digest('hex');
 await api('/api/refresh',{method:'POST',body:'{}'});for(let i=0;i<1200;i++){const s=await api('/api/refresh-status');if(!s.running)break;await wait(250);}
 for(let round=0;round<3;round++)for(const variant of ['base','candidate']){
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});const [name,...v]=cookie.split('=');await context.addCookies([{name,value:v.join('='),url:base}]);
  await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');window.__tasks=[];new PerformanceObserver(l=>window.__tasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
  page=await context.newPage();let requests=0;page.on('request',r=>{if(/\/api\/backlog/.test(r.url()))requests++;});
  if(variant==='base')for(const [file,body] of baseFiles)await page.route('**/'+file+'*',r=>r.fulfill({contentType:file.endsWith('.css')?'text/css':'application/javascript',body}));
  const startup=performance.now();await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:1500}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.locator('[data-rn-close]').click({timeout:1000}).catch(()=>{});
  const startupMs=performance.now()-startup,first=performance.now();await page.evaluate(()=>switchTab('backlog'));
  await page.waitForFunction(()=>document.querySelector('#backlogOverviewBody .blvImportanceScope'),null,{timeout:120000});
  const firstMs=performance.now()-first;await page.waitForTimeout(800);
  const scopeTimes=[];for(let i=0;i<5;i++)scopeTimes.push(await page.evaluate(()=>{const start=performance.now();document.querySelector('[data-blv-importance="regular"]').click();document.querySelector('[data-blv-importance="all"]').click();document.getElementById('backlogOverviewBody').getBoundingClientRect();return performance.now()-start;}));
  const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters');
  const times=[];const reqBefore=requests,mark=await page.evaluate(()=>performance.now());
  if(variant==='candidate'){
   for(let i=0;i<5;i++)times.push(await page.evaluate(()=>{const start=performance.now();document.querySelector('[data-range-toggle]').click();document.getElementById('backlogDateRange').getBoundingClientRect();document.querySelector('[data-range-toggle]').click();document.querySelector('[data-range-move="1"]').click();document.querySelector('[data-range-move="-1"]').click();document.getElementById('backlogDateRange').getBoundingClientRect();return performance.now()-start;}));
  }
  await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');
  const tasks=await page.evaluate(mark=>window.__tasks.filter(t=>t.start>=mark),mark);
  const result={count,fixtureHash,round,variant,startupMs,firstMs,scopeTimes,newInteractionTimes:times,interactionRequests:requests-reqBefore,requests,before,after,tasks};results.push(result);console.log(JSON.stringify(result));
  if(variant==='candidate'&&round===0&&count===220){
   // Persisted empty Special scope must keep All reachable after reload.
   await page.locator('[data-blv-importance="special"]').click();await page.locator('#backlogOverviewBody .bpaEmpty').waitFor();await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('[data-blv-importance="all"]'),null,{timeout:60000});await page.locator('[data-blv-importance="all"]').click();await page.locator('#backlogOverviewBody .blvHero').waitFor({timeout:10000}).catch(async()=>assert.ok(await page.locator('#backlogOverviewBody').innerText()));
   const native='[data-range-input="from"]';await page.locator(native).evaluate(el=>{el.value='2026-12-01';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('[data-range-toggle]').click();assert.equal(await page.locator('[data-range-summary]').innerText(),'');await page.locator('[data-range-move="1"]').click();await page.locator('[data-range-toggle]').click();assert.equal(await page.locator(native).inputValue(),'2026-12-01');
   await page.locator('[data-range-cancel]').click();await page.evaluate(()=>{document.getElementById('backlogInStoreFrom').value='2026-12-01';document.getElementById('backlogInStoreTo').value='2026-12-31';BLBacklogDateRange.sync();});await page.locator('[data-range-toggle]').click();assert.match(await page.locator('[data-range-summary]').innerText(),/2026/);
   await page.screenshot({path:path.join(app,'public/release-notes/next-assets/backlog-date-range-collapse.png')});
   for(const theme of ['light','dark'])for(const size of ['compact','standard','large','xl']){await page.evaluate(({theme,size})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiSize=size;},{theme,size});assert.ok(await page.locator('[data-range-toggle]').isVisible());}
   await page.evaluate(()=>document.getElementById('backlogContent').style.display='none');await page.waitForTimeout(50);assert.ok(await page.locator('[data-range-toggle]').isVisible());await page.evaluate(()=>document.getElementById('backlogContent').style.display='block');
   await page.locator('[data-range-toggle]').click();for(let i=0;i<4;i++)await page.locator('[data-range-move="1"]').click({force:true});assert.equal(await page.locator('#backlogDateRange').evaluate(el=>el.previousElementSibling.className),'backlogPivotRadarWorkspace');
   for(let i=0;i<4;i++)await page.locator('[data-range-move="-1"]').click({force:true});
   await page.locator('[data-blv-importance="special"]').click();await page.locator('#backlogOverviewBody .bpaEmpty').waitFor();await page.screenshot({path:path.join(app,'public/release-notes/next-assets/backlog-empty-scope-recovery.png')});
  }
  assert.equal(result.interactionRequests,0);assert.ok(times.every(t=>t<=200));assert.ok(after.jsEventListeners<=before.jsEventListeners+2);
  await context.close();
 }
}
fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({base:'9e667430',candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime:await browser.version(),results},null,2));
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence:',root);fs.writeFileSync(path.join(out,'browser-partial.json'),JSON.stringify(results,null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill('SIGTERM');});
