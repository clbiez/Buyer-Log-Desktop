'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-excel-split-'));
const port=Number(process.env.BUYER_LOG_EXCEL_SPLIT_PORT||6492),base=`http://127.0.0.1:${port}`;
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
  for(const tab of ['cp','koleksiyon','orders']){
    await page.evaluate(tab=>switchTab(tab),tab);
    await page.waitForTimeout(800);
    if(tab==='orders'){assert.ok(await page.locator('#ordersTableActions #navExcelBtn').isVisible());continue;}
    const p=tab==='cp'?'cp':'kol';
    for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl']){
      await page.evaluate(({theme,scale,lang})=>{applyLanguage(lang);document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiScale=scale;BLToolbarResponsive?.refresh?.(null,{remeasure:true});},{theme,scale,lang});
      await page.waitForTimeout(150);
      const boxes=await page.evaluate(p=>{
        const ids=[p+'ExcelExportBtn',p+'ExcelBtn'];return ids.map(id=>{const e=document.getElementById(id),r=e.getBoundingClientRect();return {id,x:r.x,y:r.y,width:r.width,height:r.height,svg:e.querySelectorAll('svg').length,text:e.textContent};});
      },p);
      assert.ok(boxes[0].width>=30&&boxes[1].width>=24,JSON.stringify(boxes));
      assert.ok(boxes[0].x+boxes[0].width<=boxes[1].x+1,JSON.stringify(boxes));
      assert.equal(boxes[1].svg,0,'arrow must have its own box');
    }
    await page.evaluate(()=>{applyLanguage('tr');document.documentElement.dataset.theme='light';document.documentElement.dataset.uiScale='standard';});
    // Direct export delegates once to the original action and never opens the drawer.
    const target=tab==='cp'?'navExcelBtn':'kolExportImgBtn';
    await page.evaluate(({p,target})=>{
      window.exportClicks=0;document.getElementById(target).addEventListener('click',e=>{e.stopImmediatePropagation();e.preventDefault();window.exportClicks++;},true);
    },{p,target});
    await page.locator('#'+p+'ExcelExportBtn').click();
    assert.equal(await page.evaluate(()=>window.exportClicks),1);
    assert.ok(await page.locator('#'+p+'ExcelMenu').isHidden());
    await page.locator('#'+p+'ExcelBtn').focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('#'+p+'ExcelMenu').isVisible());
    assert.equal(await page.locator('#'+p+'ExcelBtn').getAttribute('aria-expanded'),'true');
    if(tab==='cp')await page.screenshot({path:app+'/public/release-notes/next-assets/excel-split-buttons.png'});
    await page.locator('#'+p+'ExcelBtn').click();
    assert.ok(await page.locator('#'+p+'ExcelMenu').isHidden());
    await page.evaluate(target=>document.getElementById(target).disabled=true,target);
    assert.ok(await page.locator('#'+p+'ExcelExportBtn').isDisabled());
    await page.evaluate(target=>document.getElementById(target).disabled=false,target);
    assert.ok(await page.locator('#'+p+'ExcelExportBtn').isEnabled());
  }
  assert.deepEqual(errors,[],'browser errors');
  console.log('PASS split hitboxes in both drawers, TR/EN x light/dark x four sizes, direct export, disabled state, menu toggles and Orders export');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
