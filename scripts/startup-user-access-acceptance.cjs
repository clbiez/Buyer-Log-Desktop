/* Actual Buyer Log with isolated synthetic data and controlled startup failures. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'../resources/app'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-startup-access-'));
const port=6492,base=`http://127.0.0.1:${port}`,env={...process.env};
for(const [key,folder] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,folder);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');
fs.mkdirSync(path.join(root,'source'));
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');
let server,browser;
const baselineFile=relative=>execFileSync('git',['show','origin/main:resources/app/public/'+relative],{cwd:app,maxBuffer:16*1024*1024,encoding:'utf8'});
const baseline={index:baselineFile('index.html'),app:baselineFile('app-main.js'),perf:baselineFile('perf-runtime.js')};
const samples=[];


async function scenario(cookie,mode,language='tr',variant='candidate'){
  const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  try{
    const [name,...rest]=cookie.split('=');
    await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/'}]);
    await context.addInitScript(lang=>localStorage.setItem('bl.user.moderator.lcw.lang.v1',lang),language);
    const page=await context.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    let requests=0,projectionRequested=false;
    const pendingProjections=[];
    if(variant==='main'){
      await page.route('**/app-main.js?*',route=>route.fulfill({contentType:'application/javascript',body:baseline.app}));
      await page.route('**/perf-runtime.js?*',route=>route.fulfill({contentType:'application/javascript',body:baseline.perf}));
      await page.route(base+'/',async route=>{
        const response=await route.fetch();let html=await response.text();
        const marker='<script>\n(function(){',start=html.indexOf(marker),end=html.indexOf('</script>',start);
        const bs=baseline.index.indexOf(marker),be=baseline.index.indexOf('</script>',bs);
        html=html.slice(0,start)+baseline.index.slice(bs,be)+html.slice(end);
        await route.fulfill({response,body:html});
      });
    }

    if(mode!=='healthy'){
      await page.route('**/user-access-ui.js?*',async route=>{
        requests++;
        if(mode==='always'||requests===1)await route.fulfill({status:503,body:'Temporary failure'});
        else await route.continue();
      });
      // Model a cache miss whose heavy Overview projection remains pending.
      // Initial authenticated data still comes from the actual isolated server.
      await page.route('**/api/data?*',async route=>{
        const response=await route.fetch(),data=await response.json();
        Object.assign(data,{hasCachedData:true,overviewDeferred:true,sourceFilterRequired:false});
        await route.fulfill({response,json:data});
      });
      await page.route('**/api/data/overview*',route=>{projectionRequested=true;pendingProjections.push(route);});
      await page.route('**/api/page-projection/overview*',route=>{projectionRequested=true;pendingProjections.push(route);});
    }
    await page.goto(base,{waitUntil:'domcontentloaded'});
    if(mode==='always'){
      await page.waitForSelector('#blBootGuard[data-failed="1"] [data-boot-retry]',{timeout:10000});
      assert.equal(requests,2,'one retry after a transient script error');
      assert.equal(await page.locator('[data-boot-continue]').count(),0,'failed profile stays gated');
      assert.match(await page.locator('[data-boot-message]').innerText(),language==='en'?/User information could not be prepared/:/Kullanıcı bilgileri hazırlanamadı/);
      if(language==='tr'){
        await page.screenshot({path:path.join(app,'public/release-notes/next-assets/startup-user-access-retry.png')});
        await page.evaluate(()=>applyLanguage('en'));
        assert.match(await page.locator('[data-boot-message]').innerText(),/User information could not be prepared/);
        assert.equal(await page.locator('[data-boot-retry]').innerText(),'Retry');
      }
    }else{
      if(mode==='once'){
        await page.waitForSelector('[data-boot-stage="profile"][data-done="true"]',{timeout:10000});
        assert.equal(await page.locator('[data-boot-continue]').count(),0,'the actual opening screen remains a hard gate');
        assert.equal(projectionRequested,true);
        for(const route of pendingProjections)await route.fulfill({json:{rows:[]}});
      }
      await page.waitForSelector('#blBootGuard[data-ready="1"] [data-boot-continue]',{timeout:10000});
      assert.equal(await page.locator('#blBootGuard[data-failed="1"]').count(),0);
      if(mode==='once'){
        assert.equal(requests,2,'the failed access script is retried before the projection finishes');
        assert.equal(projectionRequested,true);
        await page.screenshot({path:path.join(app,'public/release-notes/next-assets/startup-user-access-recovered.png')});
      }
      await page.locator('[data-boot-continue]').click();
      await page.waitForFunction(()=>!document.getElementById('blBootGuard'));
      if(mode==='healthy')samples.push({variant,...await page.evaluate(()=>({gateMs:BLPerf.snapshot().startupGateReadyMs?.lastMs,usableMs:performance.now(),scripts:[...document.scripts].filter(s=>s.src.includes('user-access-ui.js')).length}))});
      assert.notEqual(await page.locator('#currentUserInitials').innerText(),'?');
    }
    assert.deepEqual(errors,[],'no uncaught browser errors');
    console.log(`PASS ${mode} (${language}, ${variant})`);
  }finally{await context.close();}
}

(async()=>{
  server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
  let healthy=false;
  for(let i=0;i<100;i++){
    try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500){healthy=true;break;}}catch(_){}
    if(server.exitCode!==null)break;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.ok(healthy,'isolated server started');
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-startup-123',password:'demo-startup-123'})});
  assert.equal(login.status,200,await login.clone().text());
  const cookie=login.headers.get('set-cookie').split(';')[0];
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  if(process.env.BUYER_LOG_STARTUP_RED==='1'){await scenario(cookie,'once','tr','main');return;}
  for(let i=0;i<3;i++){await scenario(cookie,'healthy','tr','main');await scenario(cookie,'healthy','tr','candidate');}
  for(const [mode,language] of [['once','tr'],['always','tr'],['always','en']])await scenario(cookie,mode,language);
  console.log('L2 raw samples: '+JSON.stringify(samples));
  fs.writeFileSync(path.join(root,'samples.json'),JSON.stringify(samples,null,2));
  console.log('Performance samples: '+root+'/samples.json');
})().catch(error=>{console.error(error);console.error('Server log: '+path.join(root,'server.log'));process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();
  if(server&&server.exitCode===null){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.closeSync(log);
});
