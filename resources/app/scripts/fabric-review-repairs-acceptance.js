'use strict';
// Real Buyer Log UI + HTTP on isolated synthetic data. Requires Playwright/Chromium.
// No production accounts, shared folder, or corporate AI endpoint is contacted.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-fabric-repair-'));
const sourceFiles=['public/app-main.js','public/fabric-card-segment-ui.js','server/lib/fabric-cards.js','server/routes/fabric-card-routes.js'];
const fingerprints=()=>Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(app,file))).digest('hex')]));
const sourceFingerprints=fingerprints();
const port=6479,base=`http://127.0.0.1:${port}`,env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,name]of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_AUTH_DATA_ROOT:'auth',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,name);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:path.join(root,'source'),updates:{enabled:false}}));
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,page,cookie;
async function api(url,body){const r=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,await r.clone().text());return r.json();}
(async()=>{
 let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).status<500){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert(ready,'real server starts');
 const r=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'synthetic-fabric-only-123',newPassword:'synthetic-fabric-only-123'})});assert.equal(r.status,200,await r.clone().text());cookie=r.headers.get('set-cookie').split(';')[0];
 const profileFile=path.join(env.BUYER_LOG_AUTH_DATA_ROOT,'user-access.json');
 const profile=JSON.parse(fs.readFileSync(profileFile,'utf8'));profile.moderator.displayName='Demo Moderator';profile.moderator.username='demo.moderator';profile._revision++;fs.writeFileSync(profileFile,JSON.stringify(profile));
 const tr=['Üç İplik Şardonlu','30/70/14','260 gsm','65% Pamuk 35% Polyester'],en=['Brushed Three Thread','30/70/14','260 gsm','65% Cotton 35% Poliester'];
 await api('/api/fabric-cards',{items:[{code:'214233',summary:tr.join(' · '),summaryEn:en.join(' · '),summarySegments:{tr,en},details:{category:'Knit',type:'Three Thread',weight:'260 gsm'},summarySource:'manual',raw:'214233-Örme,Üç İplik Şardonlu,30/70/14,260 gsm,%65 Pamuk,%35 Poliester'}]});
 browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),at=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,at),value:cookie.slice(at+1),url:base}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',null,{timeout:60000});await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).first().click({timeout:5000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),null,{timeout:60000});
 await page.evaluate(async()=>{applyLanguage('en');await kolFabricCardsRequest('/api/fabric-cards',{cache:'no-store'});openFabricCardDialog('214233-Örme,Üç İplik Şardonlu,30/70/14,260 gsm,%65 Pamuk,%35 Poliester');});
 const modal=page.locator('#_kolFabricCardModal');await modal.waitFor({state:'visible'});
 assert.equal(await modal.locator('.fabricSegmentBar strong').innerText(),'Segmented summary');
 assert.deepEqual(await modal.locator('.fabricSegmentHeading span').allTextContents(),['Field','TR','EN','Translation']);
 await modal.locator('[data-source-language]').selectOption('tr');
 // Controlled LCW AI stand-in only in this synthetic browser session. Never contact an upstream.
 await page.evaluate(()=>{window.__fabricAiCalls=0;window.BuyerLogAI={ask:async()=>{window.__fabricAiCalls++;throw Error('synthetic unavailable');}};});
 await modal.locator('[data-part="tr:0"]').fill('Yeni Kumaş Türü');await modal.locator('[data-source-language]').selectOption('en');
 assert.equal(await page.evaluate(()=>document.getElementById('_kolFabricCardModal').__fabricEditor.result().ok),false);
 await modal.locator('[data-fabric="save"]').click();assert.equal(await modal.count(),1);
 await modal.locator('[data-source-language]').selectOption('tr');await modal.locator('[data-segment-action="edit:0"]').click();await modal.locator('[data-part="en:0"]').fill('New Fabric Type');
 assert.equal(await page.evaluate(()=>document.getElementById('_kolFabricCardModal').__fabricEditor.result().ok),true);
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});await page.screenshot({path:path.join(assets,'fabric-segments-review-repairs.png')});
 await modal.locator('[data-fabric="save"]').click();await modal.waitFor({state:'detached'});
 const card=(await api('/api/fabric-cards')).cards.find(c=>c.code==='214233');assert.equal(card.summarySegments.tr[0],'Yeni Kumaş Türü');assert.equal(card.summarySegments.en[0],'New Fabric Type');assert.equal(card.translationOverrides.en[0],true);
 assert.equal(await page.evaluate(()=>window.__fabricAiCalls),0,'cancelled debounce sends no request');
 let libraryRequests=0;page.on('request',request=>{if(request.url().includes('/api/fabric-cards'))libraryRequests++;});
 const openToVisibleMs=[];
 for(let i=0;i<5;i++){
   openToVisibleMs.push(await page.evaluate(async()=>{
     const start=performance.now();openFabricCardDialog('214233-Örme,Üç İplik Şardonlu,30/70/14,260 gsm,%65 Pamuk,%35 Poliester');
     await new Promise(requestAnimationFrame);return performance.now()-start;
   }));
   await page.locator('#_kolFabricCardModal [data-fabric="cancel"]').click();
   assert.equal(await page.locator('#_kolFabricCardModal').count(),0,'closing disposes the editor');
 }
 assert.equal(libraryRequests,0,'reopening a loaded card does not add library fetches');
 assert.equal(await page.evaluate(()=>window.__fabricAiCalls),0,'reopening translated cards does not start AI work');
 assert.ok(openToVisibleMs.every(ms=>ms<=200),'visible editor feedback stays within the declared 200 ms budget');
 assert.deepEqual(fingerprints(),sourceFingerprints,'the accepted runtime source must not change during the run');
 const result={result:'PASS',root,runtime:{node:process.version,platform:process.platform,chromium:browser.version()},sourceFingerprints,errors,englishLabels:true,cancelledTranslationBlocksSave:true,manualCorrectionPersisted:true,aiCalls:0,openToVisibleMs,libraryRequestsDuringFiveReopens:libraryRequests,viewport:[1440,1000],note:'Actual Buyer Log server + app modal; synthetic data and browser-only failing AI stand-in. Candidate feedback/cleanup evidence only: physical devices, Main comparison, Electron and external LCW AI are not exercised.'};
 fs.writeFileSync(path.join(root,'acceptance.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(async e=>{console.error(e);console.error('Evidence root: '+root);if(page)await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{await browser?.close();if(server.exitCode==null&&server.signalCode==null){const exited=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');const timer=setTimeout(()=>server.kill('SIGKILL'),5000);await exited;clearTimeout(timer);}fs.closeSync(log);});
