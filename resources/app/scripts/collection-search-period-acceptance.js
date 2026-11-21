/* Real-app acceptance for Collection search: language-independent MB month and
 * MB / EXF / RT period shortcuts. All data is synthetic. Optional argv[2]: PNG path. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-kol-search-'));
const port=6493,base=`http://127.0.0.1:${port}`,shot=process.argv[2]||'';
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser,cookie;
async function start(){
  server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
  let healthy=false;
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500){healthy=true;break;}}catch(_){}await new Promise(r=>setTimeout(r,200));}
  assert.ok(healthy,'isolated server started');
  const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-search-123',password:'demo-search-123'})});
  assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
}
const row=(id,season,month,exFactory,extra={})=>({id,plmId:'DEMO-'+id,modelKod:'DEMO MODEL '+id,productMainDefinition:'Demo T-Shirt',buyer:'DEMO BUYER',season,urunTipi:'DEMO',inStoreMonth:month,exFactory,retail:'',pricing:{},durum:'',colour:'BLUE',...extra});
const ROWS=[
  row(1,'S7','MART 2027','2026-12-14'),
  row(2,'S7','APRIL 2027','2027-01-11'),
  row(3,'S7','MAYIS 2027','2027-02-08'),
  row(4,'S7','HAZİRAN 2027','2027-03-08'),
  row(5,'W7','TEMMUZ 2027','2027-04-12'),
  row(6,'W7','JULY 2027','2027-04-19'),
  row(7,'W7','EKİM 2027','2027-06-14'),
];
(async()=>{
  await start();
  const launch={headless:true,args:['--no-sandbox']};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  browser=await chromium.launch(launch);
  const context=await browser.newContext({viewport:{width:1400,height:800},deviceScaleFactor:shot?2:1,reducedMotion:'reduce'});
  const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
  await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
  await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
  await page.evaluate(async rows=>{
    switchTab('koleksiyon');await window.BLPerf.ensureFeature('collectionTools');
    applyLanguage('en');kolRows=rows;
    kolWorkspaceList=kolWorkspaceList.map(item=>item.ownerId==='moderator'?{...item,ownerName:'DEMO BUYER A'}:item);
    kolColOrder=kolDefaultDisplayOrder();
    kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['plmId','modelKod','season','inStoreWeek','inStoreMonth','exFactory','buyer'].includes(k)));
    kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';renderKol();
  },ROWS);
  const search=async query=>page.evaluate(q=>{
    const input=document.getElementById('kolSearch');input.value=q;input.dispatchEvent(new Event('input',{bubbles:true}));
    return new Promise(resolve=>setTimeout(()=>resolve(filteredKol().map(r=>r.id)),400));
  },query);
  // 1) MB ayı kayıt dilinden bağımsız.
  assert.deepEqual((await search('July')).sort(),[5,6],'July finds TR and EN stored months');
  assert.deepEqual((await search('Temmuz')).sort(),[5,6],'Temmuz finds TR and EN stored months');
  console.log('PASS MB month search is language independent');
  // 2) Dönem kısayolları (yıl yok, sezonla kapsam).
  assert.deepEqual((await search('S7; MB=M3-M5')).sort(),[1,2,3]);
  assert.deepEqual((await search('MB=M7')).sort(),[5,6]);
  assert.deepEqual((await search('MB=M11-M3')).sort(),[1],'range wraps the year end');
  assert.deepEqual((await search('W7; MB=M7!')).sort(),[7],'exclusion removes the whole period');
  const exf=await search('EXF=M4');
  assert.deepEqual(exf.sort(),[5,6],'Ex-Factory month uses the date');
  console.log('PASS MB / EXF period shortcuts filter Collection rows');
  // 3) Yardım penceresi dönem bölümünü iki dilde gösterir.
  await page.locator('.tableSearchHelpButton[data-search-help-for="kolSearch"]').click();
  assert.match(await page.locator('#tableSearchHelpPopover').innerText(),/Date shortcuts \(Collection\)[^]*MB=W1-W24/);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>applyLanguage('tr'));
  await page.locator('.tableSearchHelpButton[data-search-help-for="kolSearch"]').click();
  assert.match(await page.locator('#tableSearchHelpPopover').innerText(),/Tarih kısayolları \(Koleksiyon\)/);
  console.log('PASS search help explains period shortcuts in TR and EN');
  if(shot){
    await page.keyboard.press('Escape');
    await search('S7; MB=M3-M5');
    await page.waitForTimeout(500);
    const box=await page.locator('#kolSearch').boundingBox();
    const y=Math.max(0,box.y-150);
    await page.screenshot({path:shot,clip:{x:0,y,width:1400,height:540}});
    console.log('SCREENSHOT',shot);
  }
  assert.deepEqual(errors,[],'no page errors');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await browser?.close().catch(()=>{});
  if(server){const stopped=once(server,'exit');server.kill();await stopped;}
  fs.rmSync(root,{recursive:true,force:true});
});
