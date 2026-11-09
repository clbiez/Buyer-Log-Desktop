'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn,spawnSync,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const repo=process.cwd(),app=path.join(repo,'resources/app'),out=path.join(repo,'docs/performance/backlog-recovery-date-panel'),root=fs.mkdtempSync(path.join(repo,'work/backlog-recovery-')),source=path.join(root,'source'),port=6479,base='http://127.0.0.1:'+port;
fs.mkdirSync(source);
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key);fs.mkdirSync(env[key],{recursive:true});}env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,updates:{enabled:false}}));
const password=crypto.randomBytes(24).toString('hex'),salt=crypto.randomBytes(16),hash='scrypt$'+salt.toString('hex')+'$'+crypto.scryptSync(password,salt,32).toString('hex');
const iam=require(path.join(app,'server/lib/iam-core'));fs.writeFileSync(path.join(env.BUYER_LOG_AUTH_DATA_ROOT,'user-access.json'),JSON.stringify(iam.migrateStore({_revision:1,users:[],moderator:{id:'moderator',username:'demo-admin',displayName:'Demo Administrator',role:'moderator',enabled:true,passwordHash:hash,pinHash:hash,credentialRevision:1}})));
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,page;const results=[];
const baseFiles=new Map(['backlog-overview.js','backlog-date-range.js','backlog-date-range.css','backlog-plan-actual.js'].map(file=>[file,execFileSync('git',['show','fad8578308c527274ab762b9ed8f371e8e033d99:resources/app/public/'+file],{cwd:repo,encoding:'utf8',maxBuffer:8000000})]));
const functional=process.argv.includes('--functional'),control=process.argv.includes('--control'),largeOnly=process.argv.includes('--large'),dateOnly=process.argv.includes('--date-only'),fallback=process.argv.includes('--fallback');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
for(let i=0;i<160;i++){try{if((await fetch(base+'/api/user-profiles')).ok)break;}catch{}await wait(250);}
const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
const api=async(url,opts={})=>{const r=await fetch(base+url,{...opts,headers:{cookie,'Content-Type':'application/json'}});assert.ok(r.ok,await r.clone().text());return r.json();};
browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
for(const count of ((functional||control&&!largeOnly)?[220]:[220,30000])){
 if(count===220){
 const gen=spawnSync(process.execPath,['scripts/generate-demo-data.js',source,'--rows',String(count),'--seed','7'],{cwd:app,encoding:'utf8'});assert.equal(gen.status,0,gen.stderr);

 await api('/api/refresh',{method:'POST',body:'{}'});for(let i=0;i<1200;i++){const s=await api('/api/refresh-status');if(!s.running)break;await wait(250);}
 }
 const report=await api('/api/backlog-export?format=json');
 const fixture=count===220?report:{...report,rows:Array.from({length:30000},(_,i)=>({...report.rows[i%report.rows.length],'Sipariş Kod':900000+i}))};
 const fixtureHash=crypto.createHash('sha256').update(JSON.stringify(fixture)).digest('hex');
 if(largeOnly&&count===220)continue;
 for(let round=0;round<(functional?1:3);round++)for(const variant of (functional?['candidate']:control?['base','base-control']:['base','candidate'])){
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});const [name,...v]=cookie.split('=');await context.addCookies([{name,value:v.join('='),url:base}]);
  await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');window.__tasks=[];new PerformanceObserver(l=>window.__tasks.push(...l.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
  if(fallback)await context.addInitScript(()=>{Element.prototype.moveBefore=undefined;});
  page=await context.newPage();let requests=0;page.on('request',r=>{if(/\/api\/backlog/.test(r.url()))requests++;});
  if(variant!=='candidate')for(const [file,body] of baseFiles)await page.route('**/'+file+'*',r=>r.fulfill({contentType:file.endsWith('.css')?'text/css':'application/javascript',body}));
  if(count===30000)await page.route('**/api/backlog-export?*',r=>new URL(r.request().url()).searchParams.get('format')==='json'?r.fulfill({json:fixture}):r.continue());
  const startup=performance.now();await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:1500}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.locator('[data-rn-close]').click({timeout:1000}).catch(()=>{});
  const startupMs=performance.now()-startup,first=performance.now();await page.evaluate(()=>switchTab('backlog'));
  await page.waitForFunction(()=>document.querySelector('#backlogOverviewBody .bpaHero'),null,{timeout:120000});
  const firstMs=performance.now()-first;await page.waitForTimeout(3500);const totals=await page.locator('#backlogOverviewBody .bpaHero').innerText();
  const scopeTimes=[];for(let i=0;i<(dateOnly?0:5);i++){scopeTimes.push(await page.evaluate(()=>{const start=performance.now();document.querySelector('[data-blv-importance="regular"]').click();document.querySelector('[data-blv-importance="all"]').click();document.getElementById('backlogOverviewBody').getBoundingClientRect();return performance.now()-start;}));await page.waitForTimeout(250);}
  // Each overview render schedules timeline rAF work. Drain that earlier scenario
  // before attributing tasks to the new date-panel interaction.
  await page.waitForTimeout(1000);
  const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const heapBefore=await cdp.send('Runtime.getHeapUsage');await cdp.send('Performance.enable');const cpuBefore=await cdp.send('Performance.getMetrics');const before=await cdp.send('Memory.getDOMCounters');
  const times=[];await cdp.send('Profiler.enable');await cdp.send('Profiler.start');const reqBefore=requests,mark=await page.evaluate(()=>performance.now());
  const selectors=variant==='candidate'?['[data-range-toggle]','[data-range-toggle]','[data-range-move="1"]','[data-range-move="-1"]']:dateOnly?['#backlogOverviewToggle','#backlogOverviewToggle','#backlogPlanActualMoveDown','#backlogPlanActualMoveUp']:[];
  for(let i=0;i<5;i++)for(const selector of selectors)times.push(await page.evaluate(selector=>{const start=performance.now(),button=document.querySelector(selector);button.focus({preventScroll:true});button.click();document.getElementById('view-backlog').getBoundingClientRect();return performance.now()-start;},selector));
  await page.waitForTimeout(250);const interactionEnd=await page.evaluate(()=>performance.now());const tasks=await page.evaluate(({mark,end})=>window.__tasks.filter(t=>t.start>=mark&&t.start<end),{mark,end:interactionEnd});await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');const heapAfter=await cdp.send('Runtime.getHeapUsage'),cpuAfter=await cdp.send('Performance.getMetrics');
  const profile=await cdp.send('Profiler.stop');if(variant==='candidate'&&round===0)fs.writeFileSync(path.join(out,'date-profile-'+count+'.json'),JSON.stringify(profile.profile));
  const result={count,fixtureHash,round,variant,startupMs,firstMs,totals,scopeTimes,newInteractionTimes:times,interactionRequests:requests-reqBefore,requests,interactionEnd,before,after,heapBefore,heapAfter,cpuBefore,cpuAfter,tasks};results.push(result);console.log(JSON.stringify(result));
  if(functional&&variant==='candidate'&&round===0&&count===220){
   // Persisted empty Special scope must keep All reachable after reload.
   await page.locator('[data-blv-importance="special"]').click();await page.locator('#backlogOverviewBody .bpaEmpty').waitFor();await page.reload({waitUntil:'domcontentloaded'});await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});await page.evaluate(()=>switchTab('backlog'));
   await page.waitForFunction(()=>document.querySelector('[data-blv-importance="all"]'),null,{timeout:60000});await page.locator('[data-blv-importance="all"]').click();await page.locator('#backlogOverviewBody .bpaEmpty').waitFor({state:'detached'});
   const native='input[type="date"][data-range-input="from"]';await page.locator(native).evaluate(el=>{el.value='2026-12-01';el.dispatchEvent(new Event('change',{bubbles:true}));});
   await page.locator('[data-range-toggle]').click();assert.equal(await page.locator('[data-range-summary]').innerText(),'');await page.locator('[data-range-move="1"]').click();assert.equal(await page.locator('[data-range-move="1"]').evaluate(el=>el===document.activeElement),true);await page.locator('[data-range-toggle]').click();assert.equal(await page.locator(native).inputValue(),'2026-12-01');
   await page.locator('[data-range-cancel]').click();await page.evaluate(()=>{document.getElementById('backlogInStoreFrom').value='2026-12-01';document.getElementById('backlogInStoreTo').value='2026-12-31';BLBacklogDateRange.sync();});await page.locator('[data-range-toggle]').click();assert.match(await page.locator('[data-range-summary]').innerText(),/2026/);
   await page.screenshot({path:path.join(app,'public/release-notes/next-assets/backlog-date-range-collapse.png')});
   for(const theme of ['light','dark'])for(const size of ['compact','standard','large','xl']){await page.evaluate(({theme,size})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=size;},{theme,size});assert.ok(await page.locator('[data-range-toggle]').isVisible());}
   await page.evaluate(()=>document.getElementById('backlogContent').style.display='none');await page.waitForTimeout(50);assert.ok(await page.locator('[data-range-toggle]').isVisible());await page.evaluate(()=>document.getElementById('backlogContent').style.display='block');
   await page.locator('[data-range-toggle]').click();for(let i=0;i<3;i++)await page.locator('[data-range-move="1"]').click();assert.equal(await page.locator('#backlogDateRange').evaluate(el=>el.previousElementSibling.className),'backlogPivotRadarWorkspace');
   for(let i=0;i<4;i++)await page.locator('[data-range-move="-1"]').click();
   await page.evaluate(()=>applyLanguage('en'));await page.waitForFunction(()=>document.querySelector('[data-range-toggle]').textContent.includes('Date range'));
   await page.locator('[data-range-toggle]').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('[data-range-toggle]').getAttribute('aria-expanded'),'false');await page.keyboard.press('Enter');
   await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-range-toggle]').click();await page.waitForTimeout(450);assert.ok(await page.locator('[data-range-body]').isHidden());await page.locator('[data-range-toggle]').click();await page.waitForTimeout(450);assert.ok(await page.locator('[data-range-body]').isVisible());
   await page.locator('[data-range-move="1"]').click();await page.locator('[data-range-toggle]').click();await page.reload({waitUntil:'domcontentloaded'});await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});await page.evaluate(()=>switchTab('backlog'));await page.locator('#backlogOverviewBody .bpaHero').waitFor({timeout:60000});assert.equal(await page.locator('[data-range-toggle]').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#backlogDateRange').evaluate(el=>el.previousElementSibling.id),'backlogOverview');
   await page.evaluate(()=>applyLanguage('tr'));
   await page.locator('[data-blv-importance="special"]').click();await page.locator('#backlogOverviewBody .bpaEmpty').waitFor();await page.screenshot({path:path.join(app,'public/release-notes/next-assets/backlog-empty-scope-recovery.png')});
  }
  assert.equal(result.interactionRequests,0);if(variant==='candidate')assert.ok(times.every(t=>t<=200));assert.ok(after.jsEventListeners<=before.jsEventListeners+2);
  await context.close();
 }
}
fs.writeFileSync(path.join(out,functional?(fallback?'functional-fallback-results.json':'functional-results.json'):dateOnly?'date-only-results.json':control?(largeOnly?'control-large-results.json':'control-results.json'):'browser-results.json'),JSON.stringify({base:'fad8578308c527274ab762b9ed8f371e8e033d99',candidate:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runtime:await browser.version(),results},null,2));
})().catch(async e=>{console.error(e);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error('Evidence:',root);if(page)console.error(await page.evaluate(()=>({date:(window.BLStorage||localStorage).getItem('lcw.backlog.dateRange.v1'),html:document.getElementById('backlogDateRange')?.outerHTML.slice(0,1200),parent:document.getElementById('backlogDateRange')?.parentElement.id})).catch(()=>null));fs.writeFileSync(path.join(out,'browser-partial.json'),JSON.stringify(results,null,2));process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill('SIGTERM');});
