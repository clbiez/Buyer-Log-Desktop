'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-refresh-branches-'));
const port=Number(process.env.BUYER_LOG_REFRESH_BRANCHES_PORT||6492),base=`http://127.0.0.1:${port}`;
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
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'demo server did not start; see server.log');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'demo-borders-123',password:'demo-borders-123'});
  cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});
  for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[],results=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});

  await page.evaluate(()=>switchTab('cp'));
  const trigger=page.locator('#topRefreshBtn');
  for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl']){
    await page.evaluate(({theme,scale,lang})=>{closeTopRefreshMenu();applyLanguage(lang);document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=scale;},{theme,scale,lang});
    await trigger.click();await page.waitForSelector('#_topRefreshMenu');
    assert.ok((await page.locator('#_topRefreshMenu [role="menuitem"]').allTextContents()).includes('CP'));
    assert.ok(await page.locator('#_topRefreshMenu').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}));
    assert.ok(await page.locator('.topRefreshBranches').evaluate(e=>e.viewBox.baseVal.height>0&&getComputedStyle(e).stroke!=='none'));
    await page.keyboard.press('End');await page.keyboard.press('Home');assert.equal(await page.evaluate(()=>document.activeElement.dataset.refreshScope),'cp');
    await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.dataset.refreshScope),'cp');
    assert.ok((await page.locator('#topRefreshDetail').innerText()).includes('CP'));
    await page.keyboard.press('Escape');assert.equal(await trigger.getAttribute('aria-expanded'),'false');assert.equal(await trigger.evaluate(e=>e===document.activeElement),true);
    await trigger.click();await page.waitForSelector('#_topRefreshMenu');await trigger.click();assert.equal(await page.locator('#_topRefreshMenu').count(),0);
  }
  await page.evaluate(()=>switchTab('orders'));await trigger.click();await page.waitForSelector('#_topRefreshMenu');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.refreshScope),'linked');
  await page.evaluate(()=>{closeTopRefreshMenu();switchTab('lfl');});await trigger.click();await page.waitForSelector('#_topRefreshMenu');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.refreshScope),'lfl');
  await page.evaluate(()=>{closeTopRefreshMenu();switchTab('cp');});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await trigger.click();await page.waitForSelector('#_topRefreshMenu');
  assert.ok(await page.locator('#_topRefreshMenu').evaluate(e=>e.getAnimations({subtree:true}).length>0));
  await page.evaluate(()=>{BLMotionPlus.setEnabled(false);closeTopRefreshMenu();});
  await trigger.click();await page.waitForSelector('#_topRefreshMenu');
  assert.equal(await page.locator('#_topRefreshMenu').evaluate(e=>e.getAnimations({subtree:true}).length),0);
  await page.evaluate(()=>{closeTopRefreshMenu();BLMotionPlus.setEnabled(true);});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{applyLanguage('tr');document.documentElement.dataset.theme='light';document.documentElement.dataset.uiScale='standard';});
  await trigger.click();await page.waitForSelector('#_topRefreshMenu');
  await page.screenshot({path:app+'/public/release-notes/next-assets/refresh-fine-branches.png'});
  await page.evaluate(()=>{window.refreshCalls=[];loadFromServer=async(force,targets)=>window.refreshCalls.push({force,targets});});
  await page.locator('[data-refresh-scope="cp"]').click();assert.deepEqual(await page.evaluate(()=>window.refreshCalls),[{force:true,targets:['cp']}]);
  await trigger.click();await page.waitForSelector('#_topRefreshMenu');
  if(await page.locator('[data-refresh-scope="linked"]').count()){
    const expected=await page.evaluate(()=>withLinkedRefreshTargets(linkedRefreshMembers()));
    await page.locator('[data-refresh-scope="linked"]').click();assert.deepEqual((await page.evaluate(()=>window.refreshCalls)).at(-1).targets,expected);
  }else await page.evaluate(()=>closeTopRefreshMenu());
  await page.evaluate(()=>{window.BL_REFRESH_BUSY=true;window.stagesOpened=0;openRefreshStagesModal=()=>window.stagesOpened++;});await trigger.click();assert.equal(await page.evaluate(()=>window.stagesOpened),1);await page.evaluate(()=>window.BL_REFRESH_BUSY=false);
  for(const width of [390,800]){await page.setViewportSize({width,height:900});await page.evaluate(()=>openTopRefreshMenu(document.getElementById('topRefreshBtn')));await page.waitForSelector('#_topRefreshMenu');assert.ok(await page.locator('#_topRefreshMenu').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth}));await page.evaluate(()=>closeTopRefreshMenu());}
  assert.deepEqual(errors,[],'browser errors');
  console.log('PASS refresh branches: TR/EN x light/dark x four sizes, keyboard, scopes, busy state and responsive bounds');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
