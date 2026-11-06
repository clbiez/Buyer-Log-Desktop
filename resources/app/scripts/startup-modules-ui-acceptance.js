'use strict';
// Real Buyer Log on isolated demo data: the startup curtain ("Did you know?")
// stays closed until the background-prepared modules are ready, names the stage it
// is waiting for, and the EXE launch notice lists the post-update launcher steps.
// Requires Playwright + Chromium (NODE_PATH may point at an external install).
// No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{EventEmitter}=require('node:events');
let playwright;try{playwright=require('playwright-core');}catch(_){playwright=require('playwright');}
const {chromium}=playwright;
const app=path.resolve(__dirname,'..'),assets=path.join(app,'public','release-notes','next-assets');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-modules-'));
const port=Number(process.env.BUYER_LOG_STARTUP_PORT||6496),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require(app+'/scripts/generate-demo-data').build({rows:20,seed:7,today:new Date('2026-11-03T00:00:00Z')});
const XLSX=require(app+'/node_modules/xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`));
}
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,cookie;
async function api(url,body){
  const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie:cookie||'','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.ok(res.ok,await res.clone().text());return res;
}
// The real launcher-core notice HTML, produced by launcher-core.js itself.
function launcherNoticeUrl(language){
  let url='';
  const eapp=Object.assign(new EventEmitter(),{isPackaged:true,setPath(){},requestSingleInstanceLock:()=>true,whenReady:()=>Promise.resolve(),exit(){},quit(){},relaunch(){},getPreferredSystemLanguages:()=>[language]});
  class Notice extends EventEmitter{constructor(){super();this.webContents=new EventEmitter();}loadURL(value){url=value;return Promise.resolve();}show(){}isDestroyed(){return false;}destroy(){}}
  const lifecycle={readState:()=>({pending:{ready:true,appCoreRoot:'/pending',version:'7.0.335'}}),rollbackExistingTrial:()=>null,activatePending:()=>null,currentPointer:()=>({appCoreRoot:'/current',version:'7.0.334'})};
  const context={__dirname:path.join(app,'electron'),module:{exports:{}},global:{},setTimeout,clearTimeout,setImmediate,process:{env:{},execPath:'/portable/BuyerLog.exe',pid:1,uptime:()=>4.2},require:name=>{
    if(name==='fs')return {readFileSync:file=>String(file).endsWith('desktop-ui-language.json')?'{}':'{"launcherVersion":"1.2.0"}',mkdirSync(){},appendFileSync(){}};
    if(name==='path')return path;if(name==='electron')return {app:eapp,BrowserWindow:Notice,dialog:{showErrorBox(){}}};
    if(name==='./portable-paths')return {resolvePortableRoot:()=>'/portable',desktopPaths:()=>({electronProfileRoot:'/profile',localDataRoot:'/portable/data/local'})};
    if(name==='./update/launcher-state')return {createLauncherState:()=>lifecycle};if(name==='./update/semver')return {compareSemver:()=>0};
    if(name==='./manual-patch/manager')return {createInstalledManager:()=>({})};if(name==='./manual-patch/core-verification')return {verifyPackagedCore(){}};
    return undefined;
  }};
  vm.runInNewContext(fs.readFileSync(path.join(app,'electron','launcher-core.js'),'utf8'),context);context.module.exports.start();
  return new Promise(resolve=>setImmediate(()=>setImmediate(()=>resolve(url))));
}
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'demo server did not start; see server.log');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-startup-123',password:'demo-startup-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>{localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');localStorage.setItem('bl.trivia.seen.v1','[]');});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  // Hold the Orders module preparation so the curtain is observed while it waits.
  let releaseOrders;const ordersHeld=new Promise(resolve=>{releaseOrders=resolve;});let ordersSeen=false;
  await page.route(/\/api\/(page-projection|data)\/orders/,async route=>{ordersSeen=true;await ordersHeld;await route.continue();});
  await page.goto(base+'/?module=overview',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#blBootGuard [data-boot-stage="ui"][data-done="true"]'),null,{timeout:90000});
  const until=async(check,ms=60000)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return true;await page.waitForTimeout(100);}return false;};
  assert.ok(await until(()=>ordersSeen),'Orders preparation started behind the curtain');
  await page.waitForFunction(()=>/Siparişler|Orders/.test(document.querySelector('#blBootGuard [data-boot-detail]')?.textContent||''),null,{timeout:30000});
  await page.waitForTimeout(2500);
  const waiting=await page.evaluate(()=>({continue:Boolean(document.querySelector('[data-boot-continue]')),ready:document.getElementById('blBootGuard')?.dataset.ready||'',detail:document.querySelector('[data-boot-detail]')?.textContent||'',active:document.querySelector('[data-boot-stage][data-active="true"]')?.dataset.bootStage||'',done:[...document.querySelectorAll('[data-boot-stage][data-done="true"]')].map(e=>e.dataset.bootStage)}));
  console.log('waiting',JSON.stringify(waiting));
  assert.equal(waiting.continue,false,'Continue is not offered while a module prepares');
  assert.equal(waiting.ready,'');assert.equal(waiting.active,'modules');assert.match(waiting.detail,/Modüller hazırlanıyor: Siparişler \(\d\/\d\)…/);
  assert.deepEqual(waiting.done.sort(),['data','profile','ui']);
  fs.mkdirSync(assets,{recursive:true});
  await page.screenshot({path:path.join(assets,'startup-curtain-modules-wait.png')});
  releaseOrders();
  await page.waitForSelector('[data-boot-continue]',{timeout:90000});
  const after=await page.evaluate(()=>({detail:document.querySelector('[data-boot-detail]')?.textContent||'',done:[...document.querySelectorAll('[data-boot-stage][data-done="true"]')].map(e=>e.dataset.bootStage),warm:(window.BLPerf?.timeline?.()||[]).filter(m=>/BACKGROUND_WARMUP_(READY|DONE)/.test(m.name||m.mark||'')).length}));
  console.log('ready',JSON.stringify(after));
  assert.equal(after.detail,'Tüm modüller hazır.');assert.ok(after.done.includes('modules'));
  await page.click('[data-boot-continue]');
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:10000});
  // English stage text on the same real page path.
  const en=await context.newPage();
  await en.goto(base+'/?module=overview',{waitUntil:'domcontentloaded'});
  await en.waitForSelector('[data-boot-lang="en"]',{timeout:90000});
  await en.click('[data-boot-lang="en"]');
  await en.waitForSelector('[data-boot-continue]',{timeout:90000});
  const enText=await en.evaluate(()=>({detail:document.querySelector('[data-boot-detail]')?.textContent||'',chip:document.querySelector('[data-boot-stage="modules"]')?.textContent||''}));
  console.log('english',JSON.stringify(enText));
  assert.equal(enText.detail,'All modules are ready.');assert.equal(enText.chip,'Modules');
  await en.click('[data-boot-lang="tr"]');
  // Launcher notice: real HTML at its real 440×320 size, mid-update.
  const notice=await browser.newContext({viewport:{width:440,height:320},deviceScaleFactor:2.5,reducedMotion:'reduce'});
  const np=await notice.newPage();await np.goto(await launcherNoticeUrl('tr-TR'));
  await np.evaluate(()=>{window.BLNotice.step('verify-new');window.BLNotice.step('backup');});
  const steps=await np.evaluate(()=>[...document.querySelectorAll('li')].map(li=>li.dataset.step+':'+li.dataset.state));
  console.log('notice',JSON.stringify(steps));
  assert.deepEqual(steps,['verify-current:done','verify-new:done','backup:active','activate:pending','start:pending']);
  await np.screenshot({path:path.join(assets,'launcher-update-steps.png')});
  assert.deepEqual(errors.filter(e=>!/ResizeObserver/.test(e)),[],'no page errors');
  console.log('OK');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{try{await browser?.close();}catch(_){}server.kill();});
