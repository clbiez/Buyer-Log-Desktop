'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright');
const [app,root,out,mode='green',lang='tr',theme='light']=process.argv.slice(2);
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'))),base='http://127.0.0.1:'+config.port;
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_SERVER_DATA_ROOT:root+'/data',BUYER_LOG_AUTH_DATA_ROOT:root+'/data',BUYER_LOG_DATA_ROOT:root+'/app',BUYER_LOG_LOCAL_DATA_ROOT:root+'/local',BUYER_LOG_LOCAL_DB:root+'/local/BuyerLogLocal.db',BUYER_LOG_CONFIG_PATH:root+'/config.json',BUYER_LOG_TEMP_ROOT:root+'/tmp'};
const log=fs.openSync(root+'/drill-server.log','a'),server=spawn(process.execPath,[app+'/server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
let browser;const report={mode,lang,theme,errors:[],checks:[]};const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 for(let i=0;i<120;i++){if(server.exitCode!==null)throw Error('server exited');try{if((await fetch(base+'/api/status')).ok)break;}catch{}await delay(250);}
 const password='synthetic-startup-only-123';const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password,newPassword:password})});assert.ok(login.ok);
 const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1600,height:1000}});await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));await page.route('https://**',r=>r.abort());
 await page.addInitScript(()=>{performance.setResourceTimingBufferSize(20000);window.__drillTabCalls=[];});
 await page.goto(base+'/?module=overview',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('blBootGuard')?.dataset.ready==='1',null,{timeout:180000});await page.evaluate(()=>BLBootGuard.continue());await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:180000});await page.waitForTimeout(1800);await page.evaluate(()=>document.querySelectorAll('dialog[open]').forEach(d=>d.close()));await page.waitForFunction(()=>BLPerf.timeline().some(x=>x.name==='BACKGROUND_WARMUP_DONE'),null,{timeout:180000});
 await page.evaluate(({lang,theme})=>{if(appLang!==lang)document.getElementById('railLangBtn').click();document.documentElement.dataset.theme=theme;const original=window.switchTab;window.switchTab=function(tab,...args){window.__drillTabCalls.push(tab);return original(tab,...args);};},{lang,theme});
 report.initial=await page.evaluate(()=>({backlogLoaded:BLPerf.isFeatureLoaded('backlogAnalysis'),sharedLinks:document.querySelectorAll('link[data-bl-lazy-style="backlog-plan-actual.css"]').length,active:document.querySelector('.view.active')?.id}));assert.equal(report.initial.backlogLoaded,false);assert.equal(report.initial.sharedLinks,0);
 let release,held;const hit=new Promise(r=>held=r);
 if(mode==='delayed')await page.route('**/backlog-plan-actual.css?*',async route=>{held();await new Promise(r=>release=r);await route.continue();});
 // Match the preceding Data Management activation in the original first-open probe.
 if(mode.startsWith('measure')){
  await page.evaluate(async()=>{switchTab('source');await BLPerf.ensureFeature('dataManagement');});await page.waitForSelector('#dataManagementRoot button');await page.locator('#dataManagementRoot button').first().click();
 }
 await page.evaluate(()=>{window.__drillStarted=performance.now();switchTab('manufacturers');window.__drillFeatureReady=BLPerf.ensureFeature('manufacturers').then(()=>performance.now()-window.__drillStarted);});
 if(mode==='delayed'){
  await Promise.race([hit,delay(10000).then(()=>{throw Error('shared stylesheet was not requested by Manufacturers');})]);await page.waitForTimeout(300);
  report.delayed=await page.evaluate(()=>({visibility:getComputedStyle(document.getElementById('view-manufacturers')).visibility,featureLoaded:BLPerf.isFeatureLoaded('manufacturers'),drawer:!!document.querySelector('#blvDrawer:not([hidden])')}));assert.equal(report.delayed.visibility,'hidden');assert.equal(report.delayed.featureLoaded,false);assert.equal(report.delayed.drawer,false);await page.screenshot({path:out.replace(/\.json$/,'-waiting.png')});release();report.checks.push('shared CSS gates the first Manufacturers paint');
 }
 await page.evaluate(()=>window.__drillFeatureReady);await page.waitForSelector('.mfpSearch',{timeout:120000});await page.waitForFunction(()=>!!window.BLManufacturersPage?.state?.result,null,{timeout:120000});
 report.manufacturersReadyMs=await page.evaluate(()=>performance.now()-window.__drillStarted);report.featureReadyMs=await page.evaluate(()=>window.__drillFeatureReady);
 await page.waitForSelector('[data-mfp-orders]',{timeout:120000});const clickStarted=await page.evaluate(()=>performance.now());await page.locator('[data-mfp-orders]').first().click();await page.waitForSelector('#blvDrawer:not([hidden]) .bpaTable tbody tr',{state:'attached',timeout:120000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 report.drillReadyMs=await page.evaluate(s=>performance.now()-s,clickStarted);
 report.drawer=await page.evaluate(()=>{const root=document.getElementById('blvDrawer'),drawer=root.querySelector('.bpaDrawer'),r=root.getBoundingClientRect(),d=drawer.getBoundingClientRect(),style=getComputedStyle(drawer);return {rootPosition:getComputedStyle(root).position,drawerPosition:style.position,display:style.display,rootRect:{x:r.x,y:r.y,width:r.width,height:r.height},drawerRect:{x:d.x,y:d.y,width:d.width,height:d.height},tableRows:drawer.querySelectorAll('tbody tr').length,title:drawer.querySelector('h3').textContent,subtitle:drawer.querySelector('.bpaDrawerKicker').textContent,closeTitle:drawer.querySelector('[data-blv-close]').title,tabCalls:window.__drillTabCalls,backlogLoaded:BLPerf.isFeatureLoaded('backlogAnalysis'),sharedLinks:document.querySelectorAll('link[data-bl-lazy-style="backlog-plan-actual.css"]').length,resources:performance.getEntriesByType('resource').filter(r=>/backlog-plan-actual\.css/.test(r.name)).map(r=>({url:r.name,decodedBytes:r.decodedBodySize,transferBytes:r.transferSize}))};});
 await page.waitForTimeout(350);await page.screenshot({path:out.replace(/\.json$/,'.png')});
 assert.equal(report.drawer.backlogLoaded,false);assert.ok(!report.drawer.tabCalls.includes('backlog'));assert.ok(report.drawer.tableRows>0);
 if(mode==='red'||mode==='measure-red'){assert.equal(report.drawer.rootPosition,'static');assert.equal(report.drawer.sharedLinks,0);report.status='red-confirmed';}
 else{
  assert.equal(report.drawer.rootPosition,'fixed');assert.equal(report.drawer.drawerPosition,'absolute');assert.equal(report.drawer.display,'flex');assert.equal(report.drawer.sharedLinks,1);assert.equal(report.drawer.resources.length,1);assert.equal(report.drawer.rootRect.height,1000);assert.ok(report.drawer.drawerRect.width>=1200);assert.equal(report.drawer.closeTitle,lang==='en'?'Close':'Kapat');assert.equal(report.drawer.subtitle,lang==='en'?'Manufacturers · Order drill-down':'Üreticiler · Sipariş alt detayı');report.checks.push('first order drill-down is styled without visiting Backlog');
  await page.locator('#blvDrawer .bpaDrawerHead [data-blv-close]').click();await page.waitForFunction(()=>document.getElementById('blvDrawer').hidden);report.checks.push('drawer close control works');
  // Loading Backlog after Manufacturers must reuse the same stylesheet and anchor.
  const cascade=await page.evaluate(async()=>{const old=document.querySelector('link[data-bl-lazy-style="backlog-plan-actual.css"]');await BLPerf.ensureFeature('backlogAnalysis');return {links:document.querySelectorAll('link[data-bl-lazy-style="backlog-plan-actual.css"]').length,same:old===document.querySelector('link[data-bl-lazy-style="backlog-plan-actual.css"]'),beforeAnchor:old.nextElementSibling?.matches('template[data-bl-style="backlog-plan-actual.css"]'),requests:performance.getEntriesByType('resource').filter(r=>/backlog-plan-actual\.css/.test(r.name)).length};});assert.deepEqual(cascade,{links:1,same:true,beforeAnchor:true,requests:1});report.cascade=cascade;report.checks.push('Backlog reuses the shared link, request and original anchor');report.status='passed';
 }
 assert.deepEqual(report.errors,[]);save();console.log(JSON.stringify({status:report.status,mode,lang,theme,readyMs:report.manufacturersReadyMs,drawer:report.drawer}));
 }catch(e){report.status='failed';report.failure=e.stack;save();console.error(e);process.exitCode=1;}finally{await browser?.close();server.kill('SIGTERM');await Promise.race([new Promise(r=>server.once('exit',r)),delay(10000)]);if(server.exitCode===null)server.kill('SIGKILL');}})();
