'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
// Run from any directory; all accounts, configuration and data stay in work/.
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..');
fs.mkdirSync(path.join(repo,'work'),{recursive:true});
const root=fs.mkdtempSync(path.join(repo,'work/search-feedback-runtime-')),port=6493,base='http://127.0.0.1:'+port;
fs.mkdirSync(root,{recursive:true});fs.mkdirSync(path.join(root,'source'),{recursive:true});
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BL_KEEP_ALIVE:'1'};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_AUTH_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key.toLowerCase());fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(root,'source'),refreshWithExcel:false,updates:{enabled:false}}));
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser;
(async()=>{
 server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/user-profiles')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'server ready');
 const password=crypto.randomBytes(20).toString('hex'),login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:password,password})});assert.equal(login.status,200,await login.clone().text());
 const cookie=login.headers.get('set-cookie').split(';')[0], [name,...rest]=cookie.split('=');
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const main=execFileSync('git',['show','dacd2ddb:resources/app/public/app-main.js'],{cwd:repo,maxBuffer:12e6}).toString();
 async function open(baseline=false){
  const context=await browser.newContext({viewport:{width:1500,height:900},reducedMotion:'reduce'});await context.addCookies([{name,value:rest.join('='),url:base}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  if(baseline)await context.route('**/app-main.js?*',r=>r.fulfill({body:main,contentType:'application/javascript'}));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
  await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});return {context,page,errors};
 }
 const ui=await open();const page=ui.page;
 await page.evaluate(()=>{
  applyLanguage('tr');kolRows=[1,3,4,6,8].map(i=>({id:i,plmId:'DEMO-'+i,modelKod:'DEMO MODEL '+i,season:'S7',colour:'BLUE',quantity:100,urunTipi:'KNIT',durum:''}));
  kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['plmId','modelKod','season','colour','quantity'].includes(k)));kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';
  document.getElementById('kolSearch').value=Array.from({length:8},(_,i)=>'DEMO-'+(i+1)).join(', ');renderKol();
 });
 assert.deepEqual(await page.locator('#kolSearchFeedback .tableSearchMissingTerm').allTextContents(),['DEMO-2','DEMO-5','DEMO-7']);
 assert.match(await page.locator('#kolSearchFeedback').innerText(),/bulunamayan \(3\)/);
 await page.screenshot({path:path.join(app,'public/release-notes/next-assets/search-missing-values.png')});
 for(const lang of ['en','tr'])for(const theme of ['dark','light']){
  await page.evaluate(({lang,theme})=>{applyLanguage(lang);document.documentElement.dataset.theme=theme;renderKol();},{lang,theme});
  assert.match(await page.locator('#kolSearchFeedback').innerText(),lang==='en'?/Not found in filtered results/:/Filtrelenmiş sonuçlarda bulunamayan/);
  const colors=await page.locator('.tableSearchMissingTerm').first().evaluate(el=>({color:getComputedStyle(el).color,token:getComputedStyle(document.documentElement).getPropertyValue('--ui-danger')}));assert.ok(colors.color&&colors.token);
 }
 await page.locator('#kolSearch').fill('');await page.waitForFunction(()=>document.getElementById('kolSearchFeedback').hidden);
 await page.evaluate(()=>{document.getElementById('kolSearch').value='(DEMO-1; BLUE), (DEMO-2; RED)';renderKol();});
 assert.deepEqual(await page.locator('#kolSearchFeedback .tableSearchMissingTerm').allTextContents(),['(DEMO-2; RED)']);
 // CP/Orders integration uses the actual table render and shared haystack.
 for(const tab of ['cp','orders']){
  await page.evaluate(tab=>{
   const rows=[1,3,4,6,8].map(i=>({_id:'demo-'+i,'PLM ID':'DEMO-'+i,'Model Name':'DEMO MODEL '+i,Season:'S7','Order Quantity':100,'Active/Inactive':'Active'}));
   state[tab]={...(state[tab]||{}),rows};switchTab(tab);document.getElementById(tab+'Search').value=Array.from({length:8},(_,i)=>'DEMO-'+(i+1)).join(', ');
   if(tab==='cp')renderCPNow();else renderOrdersNow();
  },tab);
  assert.deepEqual(await page.locator('#'+tab+'SearchFeedback .tableSearchMissingTerm').allTextContents(),['DEMO-2','DEMO-5','DEMO-7']);
 }
 assert.deepEqual(ui.errors,[]);console.log('PASS real Buyer Log: CP/Orders/Collection, eight values/three missing, clear, row groups, TR/EN, light/dark, no page errors');await ui.context.close();
 const result={base:'dacd2ddb',rows:30000,dataHash:crypto.createHash('sha256').update('DEMO-00001..DEMO-30000;S7;BLUE;KNIT;quantity100').digest('hex'),runtime:process.version,browser:browser.version(),pairs:[]};
 for(let pair=0;pair<3;pair++){
  const samples={};
  for(const baseline of [true,false]){
   const run=await open(baseline);
   await run.page.evaluate(()=>{
    kolRows=Array.from({length:30000},(_,i)=>({id:i+1,plmId:'DEMO-'+String(i+1).padStart(5,'0'),modelKod:'DEMO MODEL '+i,season:'S7',colour:'BLUE',quantity:100,urunTipi:'KNIT',durum:''}));
    kolWorkspaceCanEdit=false;kolColFilters={};kolHealthState.filter='';kolPictureHidden=true;document.getElementById('kolSearch').value='DEMO-00001, DEMO-00003, DEMO-00004, DEMO-00006, DEMO-00008, MISSING-A, MISSING-B, MISSING-C';renderKol();
   });
   const metrics=await run.page.evaluate(async()=>{
    let feedbackMs=0;const original=window.BLTableSearchFeedback?.render;
    if(original)window.BLTableSearchFeedback.render=function(...args){const start=performance.now();const value=original(...args);feedbackMs+=performance.now()-start;return value;};
    const start=performance.now();renderKol();const renderMs=performance.now()-start;
    await new Promise(requestAnimationFrame);const frameMs=performance.now()-start;
    if(original)window.BLTableSearchFeedback.render=original;
    return {renderMs,frameMs,feedbackMs,results:filteredKol().length,heap:performance.memory?.usedJSHeapSize};
   });
   assert.equal(metrics.results,5);assert.ok(metrics.feedbackMs<50);samples[baseline?'main':'candidate']=metrics;await run.context.close();
  }
  result.pairs.push(samples);console.log('PAIR',pair+1,JSON.stringify(samples));
 }
 fs.writeFileSync(path.join(repo,'work/search-feedback-performance.json'),JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}fs.closeSync(log);});
