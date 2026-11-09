'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const aa=process.env.MOTION_AA==='1',resultFile=aa?'aa-results.json':'results.json';
const repo=path.resolve(__dirname,'../../..'),evidence=path.join(repo,'work/full-viewport-motion'),app=path.join(repo,'resources/app'),root=path.join(evidence,'demo');fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(path.join(evidence,'main-motion-plus.js'),execFileSync('git',['show','4a0cc7b4:resources/app/public/motion-plus.js'],{cwd:repo}));
const port=6498,base=`http://127.0.0.1:${port}`,env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json'),BUYER_LOG_CENTRAL_IAM_ENABLED:'0'};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;env.BUYER_LOG_LOCAL_DB=path.join(root,'local/BuyerLogLocal.db');
const source=path.join(root,'source');fs.mkdirSync(source,{recursive:true});fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const fixture=require(app+'/scripts/generate-demo-data').build({rows:180,seed:7,today:new Date('2026-11-09T00:00:00Z')});
const XLSX=require(app+'/node_modules/xlsx');const hashes={};
for(const [name,rows] of [['ASAS',fixture.asas],['Antrepo',fixture.antrepo]]){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});fs.writeFileSync(path.join(source,`${name} - Demo.xlsx`),bytes);hashes[name]=crypto.createHash('sha256').update(bytes).digest('hex');}
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;const report={baseMain:'4a0cc7b4',aa,fixture:{rows:180,seed:7,hashes},samples:[],matrix:[],errors:[]};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function api(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r;}
async function boot(kind){
 const context=await browser.newContext({viewport:{width:1920,height:1150},reducedMotion:'reduce'});
 const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
 await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');localStorage.setItem('bl.user.moderator.bl.releaseNotes.lastSeenStable.v1','99.0.0');
   window.longTasks=[];new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:false});
   window.motionCalls=[];const animate=Element.prototype.animate;Element.prototype.animate=function(frames,options){const a=animate.call(this,frames,options);motionCalls.push({target:this,frames,options,animation:a});return a;};
 });
 await context.route('**/motion-plus.js?*',r=>r.fulfill({path:(aa||kind==='main')?path.join(evidence,'main-motion-plus.js'):path.join(app,'public/motion-plus.js'),contentType:'application/javascript'}));
 const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));page.on('dialog',d=>d.dismiss());
 const started=Date.now();await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
 const startupMs=Date.now()-started;await page.emulateMedia({reducedMotion:'no-preference'});
 await page.evaluate(()=>{document.documentElement.dataset.blRender='gpu';document.documentElement.dataset.blMotion='on';});
 return {context,page,startupMs};
}
async function navigate(page,tab){
 const timing=await page.evaluate(async tab=>{
  longTasks.length=0;const start=performance.now();switchTab(tab);const switchMs=performance.now()-start;
  while(!document.querySelector(`#${tab}Table tbody tr td`)){if(performance.now()-start>60000)throw Error('Table timeout');await new Promise(r=>setTimeout(r,10));}
  const domReadyMs=performance.now()-start;
  await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  return {switchMs,domReadyMs,nextFrameMs:performance.now()-start};
 },tab);
 await delay(1000);
 return {...timing,longTasks:await page.evaluate(()=>longTasks.slice())};
}
async function measure(page){return page.evaluate(()=>{
 const view=document.querySelector('main > section.active'),table=view.querySelector('table'),host=table.closest('.tablewrap').getBoundingClientRect();
 const eligible=[...table.tBodies[0].rows].slice(0,128).filter(row=>{const b=row.getBoundingClientRect();return b.width>0&&b.height>0&&b.bottom>Math.max(0,host.top)&&b.top<Math.min(innerHeight,host.bottom)&&b.right>Math.max(0,host.left)&&b.left<Math.min(innerWidth,host.right)&&!row.querySelector('.blGridActiveCell,.blGridSelectedCell,.kolSpreadsheetActiveCell,.kolActiveGridCell,[aria-selected="true"],[contenteditable="true"],input:focus,textarea:focus,select:focus');});
 const snapshot=table.textContent,rows=[...table.tBodies[0].rows];motionCalls.length=0;
 const t=performance.now();BLMotionPlus.activate(true);const setupMs=performance.now()-t;
 const calls=motionCalls.filter(x=>x.target.tagName==='TR');
 return {setupMs,eligible:eligible.length,animated:calls.length,coverage:eligible.every(row=>calls.some(c=>c.target===row)),endMs:Math.max(0,...calls.map(c=>c.options.delay+c.options.duration)),dataParity:snapshot===table.textContent&&rows.every((r,i)=>r===table.tBodies[0].rows[i]),activeRowEffects:document.getAnimations().filter(a=>a.id==='bl-motion-table-row').length};
});}
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}if(server.exitCode!==null)throw Error('Server exited; see server.log');await delay(250);}
 const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-animation-123',password:'demo-animation-123'});cookie=login.headers.get('set-cookie').split(';')[0];
 await api('/api/refresh',{});for(let i=0;i<240;i++){if(!(await(await api('/api/refresh-status')).json()).running)break;await delay(250);}
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});report.chromium=browser.version();
 for(let pair=0;pair<3;pair++)for(const kind of ['main','candidate']){
  const {context,page,startupMs}=await boot(kind);const sample={pair,kind,startupMs,visits:[]};
  for(const tab of ['cp','orders','cp','orders']){
   const timing=await navigate(page,tab),m=await measure(page);sample.visits.push({tab,...timing,...m});
   assert.ok(m.dataParity);assert.ok(m.endMs<=391);if(kind==='candidate'&&!aa){assert.ok(m.coverage,JSON.stringify(m));assert.ok(m.animated>6);assert.ok(m.setupMs<50);}
   await delay(500);
  }
  sample.cleanup=[];
  for(let i=0;i<5;i++){await measure(page);sample.cleanup.push(await page.evaluate(()=>{document.querySelector('main > section.active').dispatchEvent(new WheelEvent('wheel',{bubbles:true}));return document.getAnimations().filter(a=>a.id==='bl-motion-table-row').length;}));}
  assert.ok(sample.cleanup.every(n=>n===0));report.samples.push(sample);fs.writeFileSync(path.join(evidence,resultFile),JSON.stringify(report,null,2));console.log(JSON.stringify(sample));
  if(pair===2&&kind==='candidate'&&!aa){
   for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl'])for(const lang of ['tr','en']){
    await page.evaluate(({theme,scale,lang})=>{applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:scale});},{theme,scale,lang});await delay(200);const m=await measure(page);assert.ok(m.coverage);report.matrix.push({theme,scale,lang,...m});await delay(450);
   }
   await page.evaluate(()=>{applyLanguage('en');Object.assign(document.documentElement.dataset,{theme:'light',uiScale:'standard'});});await delay(300);
   await page.evaluate(()=>{BLMotionPlus.activate(true);for(const a of document.getAnimations().filter(a=>a.id==='bl-motion-table-row')){a.pause();a.currentTime=200;}});
   await page.screenshot({path:path.join(app,'public/release-notes/next-assets/full-viewport-table-motion-20261109.png'),animations:'allow'});
   await page.evaluate(()=>BLMotionPlus.setEnabled(false));assert.equal((await measure(page)).animated,0);await page.evaluate(()=>BLMotionPlus.setEnabled(true));
   await page.emulateMedia({reducedMotion:'reduce'});assert.equal((await measure(page)).animated,0);
  }
  await context.close();
 }
 assert.deepEqual(report.errors,[]);report.status='passed';fs.writeFileSync(path.join(evidence,resultFile),JSON.stringify(report,null,2));console.log(aa?'PASS Main/Main control series':'PASS real UI coverage, data parity, bounded timing, cancellation and appearance matrix');
})().catch(e=>{console.error(e);report.status='failed';report.failure=e.stack;fs.writeFileSync(path.join(evidence,resultFile),JSON.stringify(report,null,2));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await done;clearTimeout(timer);}fs.closeSync(log);});
