/* Real-app acceptance for the buyer country filter; all source and account data is synthetic. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-lfl-country-'));
const port=6491,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser,cookie;
async function start(){
 server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
 let healthy=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500){healthy=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,200));}
 assert.ok(healthy,'isolated server started');
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-country-123',password:'demo-country-123'})});
 assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
}
async function stop(){const stopped=once(server,'exit');server.kill();await stopped;server=null;}
async function api(url,body,status=200){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,status,await response.clone().text());return response.json();}
const header=['ORDER CODE','MAG','MMYG','KLASMAN','SEZON','IN STORE','FOB','ORDER QUANTITY','MANUFACTURER','COUNTRY','BUYING GROUP','BUYER'];
const rows=[
 ['DEMO-1','CU4E','DEMO','K.KOL LİSANS','S6','2026-02-10',10,100,'DEMO A','CHINA','DEMO','DEMO'],
 ['DEMO-2','CU4E','DEMO','K.KOL LİSANS','S6','2026-02-12',20,100,'DEMO B','MOROCCO','DEMO','DEMO'],
 ['DEMO-3','CU4E','DEMO','K.KOL LİSANS','S6','2026-03-10',30,200,'DEMO C','EGYPT','DEMO','DEMO'],
 ['DEMO-4','CU4E','DEMO','K.KOL LİSANS','S6','2026-02-10',500,100,'DEMO D','TURKIYE','DEMO','DEMO'],
];
async function upload(data){const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header,...data]),'Demo');return api('/api/lfl/upload',{name:'demo-lfl.xlsx',dataBase64:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}).toString('base64')});}
(async()=>{
 await start();await upload(rows);
 const snapshot=await api('/api/collection-lfl-reference');
 const season=snapshot.references.find(item=>item.season==='S6'&&item.currency==='USD'&&!item.month&&!item.throughMonth);
 assert.equal(season.average,22.5);assert.deepEqual(season.byCountry.map(item=>item.country),['CN','EG','MA']);
 const detail=await api('/api/collection-lfl-detail',{key:season.key,version:snapshot.version,excludedCountries:['MA','EG']});
 assert.equal(detail.reference.average,10);assert.deepEqual(detail.rows.map(row=>row.orderCode),['DEMO-1']);
 assert.equal((await api('/api/collection-lfl-detail',{key:season.key,version:snapshot.version,excludedCountries:'MA'},400)).code,'VALIDATION_ERROR');
 console.log('PASS server references carry country sums and details honour excluded countries');
 const launch={headless:true,args:['--no-sandbox']};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)launch.executablePath=process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
 browser=await chromium.launch(launch);
 const context=await browser.newContext({viewport:{width:1500,height:960},reducedMotion:'reduce'});
 const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(async()=>{switchTab('koleksiyon');await window.BLPerf.ensureFeature('collectionTools');});
 await page.evaluate(()=>{
  applyLanguage('tr');kolRows=[{id:91001,plmId:'DEMO-001',modelKod:'DEMO LFL MODEL',buyer:'DEMO BUYER',season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'FEBRUARY 2027',country:'CHINA',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'BLUE'}];
  kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(col=>col.k).filter(key=>!['modelKod','buyer','season','mag','urunTipi','targetPrice','inStoreMonth'].includes(key)));kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';renderKol();
 });
 const summary='td[data-key="__referenceSummary__"]';
 await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('22,50'),summary);
 await page.locator(summary).dblclick();
 await page.locator('.cpdDrawer [data-cpd-lfl-country="MA"]').check();
 await page.locator('.cpdDrawer [data-cpd-lfl-country="EG"]').check();
 await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('10,00'),summary);
 const text=await page.locator('.cpdDrawer').innerText();
 assert.match(text,/Hariç ülkeler: .*Mısır.*Fas|Hariç ülkeler: .*Fas.*Mısır/);assert.match(text,/\$10,00/);
 const saved=await page.evaluate(()=>JSON.parse(BLStorage.getItem('lcw.koleksiyon.analytics.lflCountryRules.v1')));
 assert.deepEqual(saved,{rules:[{buyer:'DEMO BUYER',countries:['EG','MA']}]});
 console.log('PASS buyer rule recalculates Collection references and is stored per user');
 await page.evaluate(()=>{
  const body=document.querySelector('.cpdBody'),section=document.querySelector('[data-cpd-lfl-details="season"]').closest('.cpdSection');
  body.scrollTop+=section.getBoundingClientRect().top-body.getBoundingClientRect().top-8;
 });
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 await page.screenshot({path:path.join(assets,'collection-lfl-country-filter.png')});
 await page.evaluate(()=>{applyLanguage('en');BLCollectionPriceDrawer.refresh({force:true});});
 const english=await page.locator('.cpdDrawer').innerText();
 assert.match(english,/Country filter/);assert.match(english,/Excluded countries/);
 await page.locator('.cpdDrawer [data-cpd-lfl-country="MA"]').uncheck();
 await page.locator('.cpdDrawer [data-cpd-lfl-country="EG"]').uncheck();
 await page.waitForFunction(selector=>document.querySelector(selector)?.textContent.includes('22.50')||document.querySelector(selector)?.textContent.includes('22,50'),summary);
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS TR/EN drawer and clearing the rule restores all countries');console.log('Artifacts: '+root);
})().catch(error=>{console.error(error);console.error('Server log: '+path.join(root,'server.log'));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await stop();fs.closeSync(log);});
