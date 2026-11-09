'use strict';
// Actual Buyer Log, isolated synthetic workbooks and cards; no production data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-order-atlas-'));
const port=Number(process.env.BUYER_LOG_ORDER_ATLAS_PORT||6483),base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CENTRAL_IAM_ENABLED:'0',BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){
  env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});
}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
require('./lib/startup-benchmark').initializeBenchmarkState(root);
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:20,seed:7,today:new Date('2026-11-09T00:00:00Z')});
const licenseColumn=demo.asas[2].indexOf('Lisans');
demo.asas.slice(3).forEach((row,i)=>{row[licenseColumn]=['NORTH STAR','NORTH STAR','ORBIT CLUB','CLOSED','UNSELECTED'][i%5];});
const XLSX=require('xlsx');
for(const [name,rows] of [['ASAS',demo.asas],['Antrepo',demo.antrepo]]){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);XLSX.writeFile(wb,path.join(source,`${name} - Demo.xlsx`));
}
const cardEngine=require('../server/lib/license-cards');
const seeded=cardEngine.appendDiscovered({_revision:0,_revisions:{},pricingRules:[]},['NORTH STAR','ORBIT CLUB','CLOSED','UNSELECTED'].map(license=>({license,licensor:'DTR'}))).overrides;
const assetStore=require('../server/lib/license-card-assets');assetStore.configure({dir:path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'license-card-assets')});
const cover=assetStore.externalizeImage('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC');
for(const card of seeded.licenseCards.items.filter(c=>['NORTH STAR','CLOSED'].includes(c.license)))card.processAtlas={version:1,license:{id:card.id,name:card.license,agency:'Demo Licensing',manufacturerVisible:card.license!=='CLOSED',internalNotes:'PRIVATE-CARD-CONTENT',stages:[{id:'concept',title:'Konsept onayı',i18n:{en:{title:'Concept approval'}},enabled:true,approver:'licensor',note:'PRIVATE-SOURCE-NOTE',supplierShowSourceNote:false,supplierInstructions:'Demo portalından gönderin.',i18nSupplier:'',submissions:[{id:'route',method:'email',recipient:'demo@example.com',timing:'approval',note:'PRIVATE-ROUTE-NOTE',supplierShowNotes:false}]}],addresses:[],portal:{url:'https://example.com/private',notes:'PRIVATE-PORTAL',manufacturerVisible:false}},sharedAddresses:[],visualLibrary:[]};
seeded.licenseCards.items.find(card=>card.license==='NORTH STAR').processAtlas.license.cover=cover;
fs.writeFileSync(path.join(env.BUYER_LOG_SERVER_DATA_ROOT,'overrides.json'),JSON.stringify(seeded));
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});fs.closeSync(log);
let browser,page,cookie='';
async function api(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(r.ok,await r.clone().text());return r;}
(async()=>{
  console.log('Artifacts:',root);
  let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'server ready');
  const login=await api('/api/user-login',{userId:'moderator',newPassword:'synthetic-atlas-test-123',password:'synthetic-atlas-test-123'});cookie=login.headers.get('set-cookie').split(';')[0];
  await api('/api/refresh',{});for(let i=0;i<160;i++){const s=await(await api('/api/refresh-status')).json();if(!s.running){assert.equal(s.error,null);break;}await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
  const split=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),url:base,httpOnly:true}]);
  await context.addInitScript(()=>{try{for(const key of ['bl.releaseNotes.lastSeenStable.v1','bl.user.moderator.bl.releaseNotes.lastSeenStable.v1'])localStorage.setItem(key,'99.0.0');}catch{}});
  page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});
  await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:30000});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
  for(const moduleId of ['cp','orders']){
    console.log('Testing',moduleId);
    await page.evaluate(mode=>switchTab(mode),moduleId);
    await page.waitForFunction(mode=>state[mode]?.rows?.length>0,moduleId,{timeout:30000});
    await page.evaluate(mode=>{state[mode+'Selected'].clear();updateShippingBtnVisibility();},moduleId);
    assert.ok(await page.locator(`[data-order-license-atlas="${moduleId}"]`).isDisabled());
    const chosen=await page.evaluate(mode=>{
      const rows=mode==='cp'?filteredCP():filteredOrders(),selected=state[mode+'Selected'];
      const get=r=>BLCanonicalFields.canonicalValue(r,mode,'license');
      const take=[...rows.filter(r=>get(r)==='NORTH STAR').slice(0,2),rows.find(r=>get(r)==='ORBIT CLUB'),rows.find(r=>get(r)==='CLOSED')].filter(Boolean);
      take.forEach(r=>selected.add(r._id));updateShippingBtnVisibility();return take.length;
    },moduleId);assert.equal(chosen,4,'two repeated licenses plus plain and closed');
    await page.locator('#'+moduleId+'ToolsBtn').click();await page.locator(`[data-order-license-atlas="${moduleId}"]`).click();
    const dialog=page.locator('.orderLicenseAtlas');await dialog.waitFor();await dialog.locator('[data-oa-action="download"]:enabled').waitFor();
    assert.equal(await dialog.locator('.orderAtlasList .lcNotice').count(),3);assert.match(await dialog.innerText(),/4 seçili sipariş · 2 lisans/);
    assert.ok(!await page.evaluate(()=>BLPerf.isFeatureLoaded('licensecards')),'card page is not initialized by the atlas');
    await dialog.locator('[data-oa-action="preview"]').click();await dialog.locator('iframe').waitFor();
    assert.equal(await dialog.locator('iframe').getAttribute('sandbox'),'');
    await page.frameLocator('.orderAtlasPreview').locator('.lic').first().waitFor();
    assert.equal(await page.frameLocator('.orderAtlasPreview').locator('.lic').count(),2);
    await page.frameLocator('.orderAtlasPreview').locator('.lic>summary').first().click();
    assert.ok(await page.frameLocator('.orderAtlasPreview').locator('.lic[open]').count());
    const image=path.join(app,'public/release-notes/next-assets',`order-license-atlas-${moduleId}-20261109.png`);fs.mkdirSync(path.dirname(image),{recursive:true});await page.screenshot({path:image});
    await dialog.locator('[data-oa-language]').selectOption('en');
    const downloadPromise=page.waitForEvent('download');await dialog.locator('[data-oa-action="download"]').click();const download=await downloadPromise;
    const file=await download.path(),html=fs.readFileSync(file,'utf8');assert.ok(fs.statSync(file).size<9000000);assert.match(html,/<html lang="en"/);assert.match(html,/NORTH STAR/);assert.match(html,/ORBIT CLUB/);assert.match(html,/Concept approval/);assert.match(html,/data:image\/png;base64,/);assert.ok(!html.includes('/api/license-cards/assets/'),'saved images are embedded for offline use');
    for(const forbidden of ['UNSELECTED','CLOSED','PRIVATE-CARD-CONTENT','PRIVATE-SOURCE-NOTE','PRIVATE-ROUTE-NOTE','PRIVATE-PORTAL'])assert.ok(!html.includes(forbidden),forbidden+' excluded');
    await page.evaluate(()=>applyLanguage('en'));assert.match(await dialog.locator('h2').innerText(),/Create License Atlas/);
    await page.setViewportSize({width:390,height:844});assert.ok(await dialog.evaluate(d=>d.getBoundingClientRect().right<=innerWidth));await page.setViewportSize({width:1440,height:1000});
    await dialog.locator('[data-oa-close]').click();await page.evaluate(()=>applyLanguage('tr'));
    await page.evaluate(mode=>{document.getElementById(mode+'Search').value='NORTH STAR';if(mode==='cp')renderCPNow();else renderOrdersNow();},moduleId);
    await page.waitForFunction(mode=>selectedEndeksmatikRows(mode).length===2,moduleId);await page.evaluate(()=>updateShippingBtnVisibility());
    if(!await page.locator('#'+moduleId+'ToolsMenu').isVisible())await page.locator('#'+moduleId+'ToolsBtn').click();
    await page.locator(`[data-order-license-atlas="${moduleId}"]`).click();
    await dialog.locator('[data-oa-action="download"]:enabled').waitFor();assert.match(await dialog.innerText(),/2 seçili sipariş · 1 lisans/);
    assert.equal(await dialog.locator('.orderAtlasList .lcNotice').count(),1);await dialog.locator('[data-oa-close]').click();
    await page.evaluate(mode=>{document.getElementById(mode+'Search').value='';if(mode==='cp')renderCPNow();else renderOrdersNow();},moduleId);
    console.log('PASS',moduleId,'selection, deduplication, sharing, plain map, preview, private fields, offline download, TR/EN and mobile');
  }
  await page.route('**/api/license-cards',route=>route.fulfill({status:500,contentType:'application/json',body:'{}'}));
  await page.locator('#ordersToolsBtn').click();await page.locator('[data-order-license-atlas="orders"]').click();
  await page.locator('.orderLicenseAtlas [role="alert"]').waitFor();assert.ok(await page.locator('.orderLicenseAtlas [data-oa-action="download"]').isDisabled());
  await page.locator('.orderLicenseAtlas [data-oa-close]').click();await page.unroute('**/api/license-cards');
  console.log('PASS hidden selected rows excluded and failed card loading prevents download');
  assert.deepEqual(errors,[]);console.log('PASS no page errors');
})().catch(async error=>{console.error(error);if(page){await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText().catch(()=>'' )).slice(-4000));}process.exitCode=1;}).finally(async()=>{await browser?.close();server.kill('SIGTERM');});
