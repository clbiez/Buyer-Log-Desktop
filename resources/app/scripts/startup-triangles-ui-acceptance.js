'use strict';
// Real isolated Buyer Log UI. Playwright emulates only the desktop bitmap bridge;
// the host's one-shot capture store has separate Node tests.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-fx-'));
const port=Number(process.env.BUYER_LOG_STARTUP_FX_PORT||6495),base=`http://127.0.0.1:${port}`,env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp',BUYER_LOG_AUTH_DATA_ROOT:'server/auth'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_KEEP_ALIVE='1';
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',centralIamEnabled:false,refreshWithExcel:false,updates:{enabled:false}}));
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let browser,page,loginFrame=null,preparedPng=null,prepared=0,taken=0;
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;
  for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/user-profiles')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}
  assert.ok(ready,'server readiness; see server.log');
  for(const file of ['motion-plus.js','motion-plus-theme.js']){
    const asset=await fetch(base+'/'+file);assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);assert.match(await asset.text(),/BLMotionPlus/);
  }
  assert.equal((await fetch(base+'/api/data/cp')).status,401,'UI assets do not expose authenticated business data');
  const setup=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-startup-123',password:'demo-startup-123'})});
  assert.equal(setup.status,200,await setup.clone().text());
  const account=await setup.json();
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1200,height:800},reducedMotion:'no-preference'}),errors=[];
  await context.exposeBinding('startupBitmap',async({page},action)=>{
    if(action==='late')return preparedPng;
    if(action==='take'){taken++;const png=loginFrame;loginFrame=null;await new Promise(resolve=>setTimeout(resolve,180));return png;}
    if(action==='prepare'){
      assert.equal(await page.locator('#password').inputValue(),'','revealed password was cleared before capture');
      prepared++;loginFrame=(await page.screenshot()).toString('base64');preparedPng=loginFrame;return true;
    }
    return (await page.screenshot()).toString('base64');
  });
  await context.addInitScript(()=>{
    localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0');
    localStorage.setItem('lcw.themeTransition.v1',JSON.stringify({effect:'circle',speed:1,size:100}));
    async function decode(png){
      if(!png)return null;
      const img=new Image();img.src='data:image/png;base64,'+png;await img.decode();
      const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,img.width,img.height).data;
      for(let i=0;i<d.length;i+=4){const r=d[i];d[i]=d[i+2];d[i+2]=r;}
      return {width:img.width,height:img.height,bgra:d};
    }
    // Observe every rendered frame from body creation, including before DCL.
    // A destination frame before the login canvas is the original regression.
    window.startupPaints=[];
    function sample(){
      const body=document.body,guard=document.getElementById('blBootGuard');
      if(body&&guard){
        const phase=Number(getComputedStyle(body).opacity)===0?'held':document.querySelector('.blThemeFxLayer')?'login':'trivia';
        if(window.startupPaints.at(-1)!==phase)window.startupPaints.push(phase);
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
    window.buyerLogDesktop={
      renderProfile:async()=>({softwareCompositing:false}),
      captureView:async()=>decode(await window.startupBitmap('capture')),
      prepareStartupTransition:()=>window.startupBitmap('prepare'),
      takeStartupTransition:async()=>{
        const scenario=new URLSearchParams(location.search).get('arrivalCase');
        if(scenario==='rejected')throw Error('demo IPC rejection');
        if(scenario==='late')await new Promise(resolve=>setTimeout(resolve,1100));
        return decode(await window.startupBitmap(scenario==='late'?'late':'take'));
      }
    };
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base+'/select-user.html');
  await page.locator('#username').fill(account.user.username);
  // Select the asynchronous suggestion before moving to the password so a late
  // suggestion response cannot cover the password toggle during this test.
  await page.locator('#suggestions [role="option"]').first().click();
  await page.locator('#suggestions').waitFor({state:'hidden'});
  await page.locator('#password').fill('demo-startup-123');
  await page.locator('#togglePassword').click();
  // Keep parsing in progress long enough to expose a DOMContentLoaded arrival.
  await page.route('**/selection-action-bar.js*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,1000));await route.continue();
  });
  await page.locator('#loginBtn').click();
  await page.waitForURL(base+'/',{waitUntil:'domcontentloaded'});
  console.log('Handoff:',{prepared,taken,frame:!!loginFrame});
  await page.waitForSelector('.blThemeFxLayer',{timeout:15000});
  await page.waitForTimeout(650);
  const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
  await page.screenshot({path:path.join(assets,'startup-login-no-flash.png')});
  await page.waitForSelector('.blThemeFxLayer',{state:'detached',timeout:20000});
  const paints=await page.evaluate(()=>window.startupPaints);
  console.log('First-paint sequence:',paints);
  assert.deepEqual(paints.filter(p=>p!=='held'),['login','trivia'],'trivia must first appear through the login transition, without a flash or replay');
  assert.equal(prepared,1);assert.equal(taken,1);assert.equal(loginFrame,null);
  await page.waitForSelector('[data-boot-continue]',{timeout:60000});
  assert.ok(await page.locator('#blBootGuard').isVisible(),'trivia waits for explicit Continue');
  await page.evaluate(()=>BLMotionPlusTheme.save({effect:'circle',speed:1,size:100}));
  await page.locator('[data-boot-continue]').focus();await page.keyboard.press('Enter');
  await page.waitForSelector('.blThemeFxLayer');
  await page.waitForTimeout(1000);
  await page.screenshot({path:path.join(root,'startup-trivia-folding.png')});
  await page.waitForSelector('.blThemeFxLayer',{state:'detached',timeout:20000});
  assert.equal(await page.locator('#blBootGuard').count(),0);
  assert.equal(await page.evaluate(()=>BLMotionPlusTheme.settings().effect),'circle','startup does not overwrite theme preference');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'corporateConnectionsBtn','keyboard focus returns to shell');
  for(const lang of ['tr','en'])for(const theme of ['light','dark'])for(const size of ['compact','standard','large','xl']){
    await page.evaluate(({lang,theme,size})=>{applyLanguage(lang);Object.assign(document.documentElement.dataset,{theme,uiScale:size});},{lang,theme,size});
    const result=await page.evaluate(()=>new Promise(resolve=>{
      let updates=0;const handled=BLMotionPlus.startup(()=>updates++);
      setTimeout(()=>{const layers=document.querySelectorAll('.blThemeFxLayer').length;BLMotionPlusTheme.finish();resolve({handled,updates,layers});},800);
    }));
    assert.deepEqual(result,{handled:true,updates:1,layers:1},`${lang}/${theme}/${size}`);
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>BLMotionPlus.startup(()=>{})),false);
  await page.emulateMedia({reducedMotion:'no-preference'});
  for(const state of [{blMotion:'off',blRender:'gpu'},{blMotion:'on',blRender:'software'}]){
    assert.equal(await page.evaluate(state=>{Object.assign(document.documentElement.dataset,state);return BLMotionPlus.startup(()=>{});},state),false);
  }
  await page.evaluate(()=>{Object.assign(document.documentElement.dataset,{blMotion:'on',blRender:'gpu'});delete window.buyerLogDesktop;});
  assert.equal(await page.evaluate(()=>BLMotionPlus.startup(()=>{})),false,'browser fallback is immediate');
  // Real document fallbacks: no frame, rejected IPC, and a valid bitmap arriving
  // after the hold deadline. None may cover trivia after it has become visible.
  for(const scenario of ['missing','rejected','late']){
    const fallback=await context.newPage();fallback.on('pageerror',e=>errors.push(e.message));
    await fallback.goto(base+'/?arrivalCase='+scenario,{waitUntil:'domcontentloaded'});
    await fallback.waitForSelector('#blBootGuard');
    await fallback.waitForFunction(()=>!document.documentElement.dataset.blStartupArrival);
    await fallback.waitForTimeout(1500);
    const result=await fallback.evaluate(()=>({paints:startupPaints.filter(p=>p!=='held'),layers:document.querySelectorAll('.blThemeFxLayer').length,opacity:getComputedStyle(document.body).opacity}));
    assert.deepEqual(result,{paints:['trivia'],layers:0,opacity:'1'},scenario+': fallback never replays sign-in');
    await fallback.close();
  }
  assert.deepEqual(errors,[],'browser errors');
  console.log('PASS login → trivia → shell: real bitmap folding, empty password, one-shot handoff, explicit Continue, keyboard focus, preference preserved; TR/EN × 2 themes × 4 sizes; reduced/off/software/browser guards');
})().catch(async e=>{console.error(e);if(page){console.error('UI:',await page.evaluate(()=>({url:location.href,error:document.getElementById('error')?.textContent,boot:document.getElementById('blBootGuard')?.textContent.slice(-400),js:document.getElementById('blErrBox')?.textContent})));await page.screenshot({path:path.join(root,'failure.png')});}process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server.exitCode===null){const stopped=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await stopped;clearTimeout(timer);}
  fs.closeSync(log);
});
