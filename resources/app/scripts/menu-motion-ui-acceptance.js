'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-menu-motion-'));
const port=Number(process.env.BUYER_LOG_MENU_MOTION_PORT||6496),base=`http://127.0.0.1:${port}`;
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
  await context.addInitScript(()=>{
    window.menuMotionCalls=[];
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      const result=animate.call(this,frames,options);
      menuMotionCalls.push({target:this,frames,options,animation:result});return result;
    };
  });
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  async function toggle(trigger,menu,expected){
    const result=await page.evaluate(async({trigger,menu})=>{
      const target=document.getElementById(menu),start=menuMotionCalls.length;
      document.getElementById(trigger).click();
      await new Promise(resolve=>requestAnimationFrame(resolve));
      return {hidden:target.hidden,calls:menuMotionCalls.slice(start).filter(x=>x.target===target).length,
        active:target.getAnimations().filter(a=>a.id==='bl-motion-entrance').length,
        expanded:document.getElementById(trigger).getAttribute('aria-expanded')};
    },{trigger,menu});
    assert.equal(result.hidden,!expected.open,JSON.stringify({trigger,result}));
    assert.equal(result.calls,expected.calls,JSON.stringify({trigger,result}));
    assert.equal(result.active,expected.open?expected.calls:0,JSON.stringify({trigger,result}));
    if(result.expanded!==null)assert.equal(result.expanded,String(expected.open));
    return result;
  }
  for(const tab of ['cp','orders','koleksiyon']){
    await page.evaluate(tab=>switchTab(tab),tab);await page.waitForTimeout(1100);
    const prefix=tab==='koleksiyon'?'kol':tab;
    const names=tab==='orders'?['Tools','PlmSync','More']:['Tools','Excel','PlmSync','More'];
    for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl']){
      await page.evaluate(({lang,theme,scale})=>{
        applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:scale});
        BLToolbarResponsive?.refresh?.(null,{remeasure:true});
      },{lang,theme,scale});
      await page.waitForTimeout(80);
      for(const name of names){
        const trigger=prefix+name+'Btn',menu=prefix+name+'Menu';
        await toggle(trigger,menu,{open:true,calls:1});
        // Close before 240ms, then reopen immediately. No 700ms throttle or stale effect.
        await toggle(trigger,menu,{open:false,calls:0});
        await toggle(trigger,menu,{open:true,calls:1});
        await toggle(trigger,menu,{open:false,calls:0});
      }
      results.push({tab,lang,theme,scale});
    }
    // A harmless demo control keeps the actual Tools menu open, like a submenu trigger.
    const trigger=prefix+'ToolsBtn',menu=prefix+'ToolsMenu';
    await toggle(trigger,menu,{open:true,calls:1});await page.waitForTimeout(800);
    const repeated=await page.evaluate(async menu=>{
      const target=document.getElementById(menu),button=document.createElement('button');
      button.textContent='Demo';target.appendChild(button);const start=menuMotionCalls.length;
      button.click();await new Promise(resolve=>setTimeout(resolve,100));button.remove();
      return menuMotionCalls.slice(start).filter(x=>x.target===target).length;
    },menu);
    assert.equal(repeated,0,'interacting inside an open menu must keep its surface still');
    await toggle(trigger,menu,{open:false,calls:0});
    // Native keyboard activation follows the same single entrance path.
    await page.locator('#'+trigger).focus();
    const countBefore=await page.evaluate(menu=>menuMotionCalls.filter(x=>x.target.id===menu).length,menu);
    await page.keyboard.press('Enter');await page.waitForTimeout(300);
    assert.equal(await page.evaluate(menu=>menuMotionCalls.filter(x=>x.target.id===menu).length,menu),countBefore+1);
    await page.keyboard.press('Enter');assert.ok(await page.locator('#'+menu).isHidden());
    for(const mode of ['reduced','off']){
      await page.emulateMedia({reducedMotion:mode==='reduced'?'reduce':'no-preference'});
      await page.evaluate(mode=>BLMotionPlus.setEnabled(mode!=='off'),mode);
      await toggle(trigger,menu,{open:true,calls:0});await toggle(trigger,menu,{open:false,calls:0});
    }
    await page.emulateMedia({reducedMotion:'no-preference'});await page.evaluate(()=>BLMotionPlus.setEnabled(true));
  }
  await page.evaluate(()=>switchTab('cp'));await page.waitForTimeout(1100);
  await page.evaluate(()=>{applyLanguage('en');Object.assign(document.documentElement.dataset,{theme:'dark',uiScale:'standard'});});
  await toggle('cpToolsBtn','cpToolsMenu',{open:true,calls:1});await page.waitForTimeout(300);
  await page.screenshot({path:app+'/public/release-notes/next-assets/menu-opening-motion.png'});
  await toggle('cpToolsBtn','cpToolsMenu',{open:false,calls:0});
  // Explicit Motion+ drawer has no generic overlay added by the fallback.
  await toggle('railAppearanceBtn','railAppearanceMenu',{open:true,calls:1});
  await page.waitForTimeout(350);await toggle('railAppearanceBtn','railAppearanceMenu',{open:false,calls:0});
  // The real notes dialog has a CSS card entrance: the scrim must stay still.
  await page.evaluate(()=>{
    window.menuMotionCalls.length=0;
    const button=document.createElement('button');document.body.appendChild(button);
    button.onclick=()=>openNotesEditor(state.cp.rows[0]._id,'Notes');button.click();button.remove();
  });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#_notesEditorModal').evaluate(e=>menuMotionCalls.filter(x=>x.target===e).length),0);
  await page.keyboard.press('Tab');assert.ok(await page.locator('#_notesEditorModal').evaluate(e=>e.contains(document.activeElement)));
  await page.keyboard.press('Escape');assert.ok(await page.locator('#_notesEditorModal').isHidden());
  assert.deepEqual(errors,[],'browser errors');
  fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify({results,errors},null,2));
  console.log('PASS',results.length,'page/language/theme/size combinations; first-frame single entrances, fast reopen, inside clicks, keyboard, reduced/off motion, drawer and notes focus/Escape');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
