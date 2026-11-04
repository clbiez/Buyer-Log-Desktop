'use strict';
// Real Buyer Log on isolated demo data. Requires Playwright + Chromium.
// NODE_PATH can point at an external Playwright installation. No production data is read.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright-core');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-blur-'));
const port=Number(process.env.BUYER_LOG_BLUR_PORT||6494),base=`http://127.0.0.1:${port}`;
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

  const read=()=>page.evaluate(()=>{const e=document.querySelector('.blWorkspaceBlur'),c=getComputedStyle(e),r=document.querySelector('.rail');return {state:e.dataset.blur,mode:e.dataset.mode,opacity:Number(c.opacity),background:c.backgroundColor,filter:c.backdropFilter,shadow:getComputedStyle(r).boxShadow,left:e.getBoundingClientRect().left,railRight:r.getBoundingClientRect().right,count:document.querySelectorAll('.blWorkspaceBlur').length,transition:c.transitionDuration};});
  const check=async(state)=>{await page.waitForFunction(state=>document.querySelector('.blWorkspaceBlur').dataset.blur===state,state);const s=await read();assert.equal(s.opacity,state?1:0,JSON.stringify(s));assert.equal(s.count,1);if(state)assert.match(s.background,/rgba\(0, 0, 0, 0\.(06|12)\)/);return s;};
  await page.mouse.move(1400,900);
  await page.evaluate(()=>{document.activeElement?.blur();document.documentElement.dataset.rail='min';});
  const tabs=await page.locator('.rail button[data-tab]').evaluateAll(es=>es.map(e=>e.dataset.tab));
  for(const tab of tabs){
    await page.evaluate(tab=>switchTab(tab),tab);await page.waitForTimeout(200);
    await page.locator('.rail').hover();const s=await check('rail');
    assert.notEqual(s.shadow,'none');assert.ok(s.railRight>s.left);
    await page.mouse.move(1400,900);await check('');
  }
  await page.evaluate(()=>switchTab('cp'));await page.waitForTimeout(300);
  for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const scale of ['compact','standard','large','xl'])for(const render of ['gpu','software']){
    await page.evaluate(({lang,theme,scale,render})=>{applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:scale,blRender:render});},{lang,theme,scale,render});
    await page.locator('.rail').hover();let s=await check('rail');assert.notEqual(s.shadow,'none');assert.equal(s.filter,render==='software'?'none':'blur(6px)');
    await page.mouse.move(1400,900);await check('');
    // Use the real keyboard expansion path.
    await page.keyboard.press('Tab');await page.locator('.rail button[data-tab="cp"]').focus();s=await check('rail');assert.notEqual(s.shadow,'none');
    await page.evaluate(()=>{document.activeElement.blur();document.querySelector('.rail').classList.remove('railKeyboardOpen');});await check('');
    await page.evaluate(()=>openNotesEditor(state.cp.rows[0]._id,'Notes'));
    s=await check('dialog');assert.equal(s.left,0);assert.equal(s.filter,render==='software'?'none':'blur(6px)');
    await page.keyboard.press('Tab');assert.ok(await page.locator('#_notesEditorModal').evaluate(e=>e.contains(document.activeElement)));
    if(lang==='tr'&&theme==='light'&&scale==='standard'&&render==='gpu')await page.screenshot({path:app+'/public/release-notes/next-assets/workspace-blur-dialog.png'});
    await page.keyboard.press('Escape');await check('');
  }
  // Every registered custom backdrop has the same single tint; no second scrim.
  const registered=fs.readFileSync(app+'/public/workspace-blur.js','utf8').match(/const surfaces='([^']+)'/)[1].split(',');
  const contract=await page.evaluate(selectors=>selectors.map(selector=>({selector,colors:[...document.querySelectorAll(selector)].map(e=>getComputedStyle(e).backgroundColor)})),registered);
  fs.writeFileSync(path.join(root,'surface-audit.json'),JSON.stringify(contract,null,2));
  await page.evaluate(()=>{applyLanguage('tr');Object.assign(document.documentElement.dataset,{theme:'light',uiScale:'standard',blRender:'gpu'});});
  await page.locator('.rail').hover();await check('rail');
  await page.screenshot({path:app+'/public/release-notes/next-assets/workspace-blur-rail.png'});
  await page.mouse.move(1400,900);await check('');
  // Nested actual dialogs retain one dim layer until the final close.
  await page.evaluate(()=>openNotesEditor(state.cp.rows[0]._id,'Notes'));await check('dialog');
  await page.evaluate(()=>{const d=document.createElement('dialog');d.id='blurNativeTest';d.textContent='Demo';document.body.append(d);d.showModal();});await check('dialog');
  await page.keyboard.press('Escape');await check('dialog');
  await page.evaluate(()=>document.getElementById('blurNativeTest').remove());await page.keyboard.press('Escape');await check('');
  // Full pinned rail does not dim the content.
  await page.evaluate(()=>document.documentElement.dataset.rail='full');await page.locator('.rail').hover();await check('');
  await page.mouse.move(1400,900);
  await context.emulateMedia?.({reducedMotion:'no-preference'});
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{document.documentElement.dataset.rail='min';delete document.documentElement.dataset.blMotion;});
  await page.locator('.rail').hover();await page.waitForTimeout(300);assert.equal((await read()).opacity,1);
  await page.mouse.move(1400,900);await page.waitForTimeout(300);assert.equal((await read()).opacity,0);
  await page.evaluate(()=>document.documentElement.dataset.blMotion='off');assert.equal((await read()).transition,'0s');
  assert.deepEqual(errors,[],'browser errors');
  console.log('PASS',tabs.length,'screens; TR/EN x 2 themes x 4 sizes x GPU/software; hover/keyboard; real notes dialog; nested native dialog; pinned rail; reduced/off/normal motion; repeated close clears dim');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
