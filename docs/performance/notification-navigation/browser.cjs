'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const repo=process.cwd(),app=path.join(repo,'resources/app'),root=path.join(repo,'work/notification-navigation'),port=6471,base=`http://127.0.0.1:${port}`;
const data=path.join(root,'browser-data');fs.mkdirSync(data,{recursive:true});const env={...process.env};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT','BUYER_LOG_AUTH_DATA_ROOT']){env[key]=path.join(data,key);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_CONFIG_PATH=path.join(data,'config.json');fs.mkdirSync(path.join(data,'source'),{recursive:true});fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(data,'source')}));
const crypto=require('node:crypto'),salt=crypto.randomBytes(16),hash=`scrypt$${salt.toString('hex')}$${crypto.scryptSync('demo-notify-123',salt,32).toString('hex')}`;
fs.writeFileSync(path.join(env.BUYER_LOG_AUTH_DATA_ROOT,'user-access.json'),JSON.stringify(require(path.join(app,'server/lib/iam-core')).migrateStore({_revision:1,users:[],moderator:{id:'moderator',username:'admin',displayName:'Demo Admin',title:'Moderator',role:'moderator',enabled:true,passwordHash:hash,pinHash:hash}})));
const log=fs.openSync(path.join(data,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser;
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'demo-notify-123',newPassword:'demo-notify-123'})});assert.equal(login.status,200,await login.clone().text());
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});const samples=[];
 const variants=process.argv.includes('--functional-only')?['candidate']:process.argv.includes('--control')?['base','base-control']:['base','candidate'];
 for(let round=0;round<(process.argv.includes('--functional-only')?1:3);round++)for(const variant of variants){
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});const [name,...v]=login.headers.get('set-cookie').split(';')[0].split('=');await context.addCookies([{name,value:v.join('='),domain:'127.0.0.1',path:'/'}]);
 await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');window.__longTasks=[];new PerformanceObserver(list=>__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});});
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(variant!=='candidate')for(const file of ['app-main.js','checklist-supplier-sync.js'])await page.route(`**/${file}*`,r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(root,'base-'+file),'utf8')}));
 let requests=0;page.on('request',r=>{if(r.url().includes('/api/'))requests++;});
 const start=performance.now();await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.openNotificationHistory==='function',null,{timeout:60000});await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:1500}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});const startupMs=performance.now()-start;
 await page.evaluate(()=>{_notificationHistoryState={items:Array.from({length:250},(_,i)=>({id:'demo-'+i,message:'Demo notification '+i,kind:'toast',read:true,createdAt:'2026-11-09T10:00:00Z'}))};});
 await page.waitForTimeout(1500);
 const firstOpenMs=await page.evaluate(()=>{const t=performance.now();openNotificationHistory();document.getElementById('notificationHistoryList').getBoundingClientRect();return performance.now()-t;});
 await page.locator('[data-notification-close]').first().click();const cycleTimes=[];const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters');
 const interactionStart=await page.evaluate(()=>performance.now());const requestStart=requests;
 for(let i=0;i<5;i++){cycleTimes.push(await page.evaluate(()=>{const t=performance.now();openNotificationHistory();document.getElementById('notificationHistoryList').getBoundingClientRect();return performance.now()-t;}));await page.locator('[data-notification-close]').first().click();}
 const plainToastTimes=[];for(let i=0;i<20;i++)plainToastTimes.push(await page.evaluate(()=>{const t=performance.now();const close=showToast('Demo adjacent notice');close({immediate:true});return performance.now()-t;}));const plainToastMs=[...plainToastTimes].sort((a,b)=>a-b)[10];
 await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');assert.equal(await page.locator('#notificationHistoryModal').count(),0);const interactionEnd=await page.evaluate(()=>performance.now());const interactionTasks=await page.evaluate(({start,end})=>__longTasks.filter(t=>t.start>=start&&t.start<end),{start:interactionStart,end:interactionEnd});
 samples.push({round,variant,startupMs,firstOpenMs,cycleTimes,plainToastMs,plainToastTimes,before,after,interactionRequests:requests-requestStart,interactionTasks});
 if(!process.argv.includes('--perf-only')&&variant==='candidate'&&round===0){
  await page.evaluate(async()=>{await BLPerf.ensureFeature('cpAssistant');await ensureCpLoaded();state.cp.rows=Array.from({length:30000},(_,i)=>({_id:i+1,'Order Code':String(8000000+i),'Model Name':'DEMO MODEL '+i,'C.Code':'001',Category:'T-shirt'}));state.cp.rows[29999]={'_id':30000,'Order Code':'8123456','Model Name':'DEMO SET','C.Code':'002',Category:"2'li Takım",_canEdit:true};});
  // Render the actual current module with a small visible synthetic filter; target is at the end of 30k rows.
  await page.evaluate(()=>{document.getElementById('cpSearch').value='8123456';switchTab('cp');renderCP();});
  await page.waitForTimeout(400);
  await page.route('**/api/checklist-supplier/answers',async r=>{const entries=r.request().postDataJSON().entries;const entry=entries.find(e=>e.itemId==='tests~part~B')||entries[0];return r.fulfill({status:400,json:{error:'Define the set roster before updating a component.',code:'CHECKLIST_COMPONENTS_INVALID',orderKey:entry.orderKey,itemId:entry.itemId}});});
  const failure=await page.evaluate(async()=>{
   const row=state.cp.rows[29999],analysis=BLCpReadinessEngine.analyzeOrder(row);window.__notifyDemoKey=analysis.orderKey;
   // The failing response is supplied by this fixture; the exact metadata originates in the store unit test.
   BLCpAssistant.setChecklistAnswer(analysis,'tests~part~B','approved');
   try{await BLChecklistSupplierSync.syncAnswerChanges();}catch(error){showToast((appLang==='en'?'Checklist save is pending: ':'Checklist kaydı bekliyor: ')+error.message,{target:error.notificationTarget,duration:0});return {target:error.notificationTarget,key:analysis.orderKey};}
  });
  console.log('failure',JSON.stringify(failure));
  // A separate explicit notification verifies history persistence and translated rendering without relying on background timing.
  await page.evaluate(()=>{for(const n of document.querySelectorAll('[data-ui-feedback]'))n._uiFeedbackClose?.({immediate:true});_notificationHistoryState={items:[]};showToast('Set parçası kaydedilemedi. Önce set parçalarını kontrol edin.',{duration:0,target:{module:'cp',lineKey:'8123456|DEMO SET|002',itemId:'tests~part~B',fieldTr:'Testler · B',fieldEn:'Tests · B'}});});
  await page.screenshot({path:path.join(app,'public/release-notes/next-assets/notification-record-navigation.png')});
  const scanMs=await page.evaluate(()=>{const at=performance.now();state.cp.rows.find(row=>lineKeyOfRow(row)==='8123456|DEMO SET|002');return performance.now()-at;});console.log('scanMs',scanMs);const navCdp=await context.newCDPSession(page);await navCdp.send('Profiler.enable');await navCdp.send('Profiler.start');const targetAt=await page.evaluate(()=>performance.now());await page.locator('[data-ui-feedback-action="notification-target"]').last().click();await page.waitForSelector('#_blChecklistEvidence');const activateMs=await page.evaluate(at=>performance.now()-at,targetAt);assert.match(await page.locator('#_blChecklistEvidence').innerText(),/8123456/);fs.writeFileSync(path.join(root,'navigation.cpuprofile'),JSON.stringify((await navCdp.send('Profiler.stop')).profile));
  await page.locator('#_blChecklistEvidence [data-evidence-close]').first().click();await page.evaluate(()=>openNotificationHistory());await page.screenshot({path:path.join(root,'history-tr.png')});
  await page.locator('[data-notification-open]').first().click();await page.waitForSelector('#_blChecklistEvidence');await page.locator('#_blChecklistEvidence [data-evidence-close]').first().click();
  await page.evaluate(()=>applyLanguage('en'));await page.evaluate(()=>openNotificationHistory());assert.match(await page.locator('[data-notification-open]').first().innerText(),/Tests · B.*Open related record/);await page.screenshot({path:path.join(root,'history-en.png')});
  await page.locator('[data-notification-close]').first().click();
  await page.evaluate(()=>{BLCpAssistant._state.answers={};state.cp.rows[29999].Category='Set';});
  assert.equal(await page.evaluate(()=>openNotificationTarget({module:'cp',lineKey:'8123456|DEMO SET|002',itemId:'@set-components'})),true);
  await page.waitForSelector('#clPartsTitle');await page.locator('[data-parts-close]').first().click();
  const missing=await page.evaluate(async()=>{state.cp.rows=[];return openNotificationTarget({module:'cp',lineKey:'8123456|DEMO SET|002'});});assert.equal(missing,false);
  const activateTasks=await page.evaluate(({at,end})=>__longTasks.filter(t=>t.start>=at&&t.start<end),{at:targetAt,end:targetAt+activateMs});console.log('functional',JSON.stringify({activateMs,activateTasks,errors}));
 }
 console.log(JSON.stringify(samples.at(-1)));await context.close();
 }
 fs.writeFileSync(path.join(root,process.argv.includes('--functional-only')?'browser-functional.json':process.argv.includes('--control')?'browser-control.json':'browser-results.json'),JSON.stringify(samples,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill('SIGTERM');});
