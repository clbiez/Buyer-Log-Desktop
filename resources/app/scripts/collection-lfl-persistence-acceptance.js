/* Real-app persistence acceptance; all source and account data is synthetic. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-lfl-persistence-'));
const port=6487,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[key],{recursive:true});
fs.mkdirSync(path.join(root,'source'));fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');let server,browser,cookie;
async function start(){
 server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
 let healthy=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500){healthy=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,200));}
 assert.ok(healthy,'isolated server started');
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-persist-123',password:'demo-persist-123'})});
 assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
}
async function stop(){const stopped=once(server,'exit');server.kill();await stopped;server=null;}
async function api(url,body,status=200){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,status,await response.clone().text());return response.json();}
const header=['ORDER CODE','MAG','MMYG','KLASMAN','SEZON','IN STORE','FOB','ORDER QUANTITY','MANUFACTURER','COUNTRY','BUYING GROUP','BUYER'];
const rows=[['DEMO-1','CU4E','DEMO','K.KOL LİSANS','S6','2026-02-10',10,100,'DEMO A','CHINA','DEMO','DEMO'],['DEMO-2','CU4E','DEMO','K.KOL LİSANS','S6','2026-03-10',20,300,'DEMO B','CHINA','DEMO','DEMO']];
async function upload(data){const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([header,...data]),'Demo');return api('/api/lfl/upload',{name:'demo-lfl.xlsx',dataBase64:XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}).toString('base64')});}
(async()=>{
 await start();await upload(rows);const saved=await api('/api/collection-lfl-reference');assert.equal(saved.references[0].average,17.5);
 await stop();await start();assert.equal((await api('/api/lfl')).rows.length,2);assert.deepEqual(await api('/api/collection-lfl-reference'),saved);
 console.log('PASS source rows and references survive process restart');
 await stop();fs.renameSync(path.join(root,'local/model-snapshots'),path.join(root,'local/model-snapshots-unavailable'));await start();
 assert.deepEqual(await api('/api/collection-lfl-reference'),saved);
 assert.equal((await api('/api/collection-lfl-reference?rebuild=1',null,409)).code,'LFL_SOURCE_UNAVAILABLE');
 assert.deepEqual(await api('/api/collection-lfl-reference'),saved);
 console.log('PASS saved references survive an unavailable source and failed refresh');
 await upload([rows[1]]);
 assert.equal((await api('/api/collection-lfl-reference?rebuild=1',null,409)).code,'LFL_REFERENCE_INCOMPLETE');
 assert.deepEqual(await api('/api/collection-lfl-reference'),saved);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1500,height:960},reducedMotion:'reduce'});
 const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(async()=>{switchTab('koleksiyon');await window.BLPerf.ensureFeature('collectionTools');});
 await page.evaluate(()=>{
  applyLanguage('tr');kolRows=[{id:91001,plmId:'DEMO-001',modelKod:'DEMO LFL MODEL',season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'FEBRUARY 2027',country:'CHINA',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'BLUE'}];
  kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(col=>col.k).filter(key=>!['modelKod','season','mag','urunTipi','targetPrice','inStoreMonth'].includes(key)));kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';renderKol();
 });
 await page.waitForFunction(()=>document.querySelector('td[data-key="__referenceSummary__"]')?.textContent.includes('17,50'));
 await page.locator('td[data-key="__referenceSummary__"]').dblclick();
 await page.locator('.cpdDrawer [data-cpd-lfl-refresh]').click();
 await page.waitForFunction(()=>document.querySelector('.cpdDrawer')?.textContent.includes('Kayıtlı referanslar korundu'));
 assert.match(await page.locator('.cpdDrawer').innerText(),/17,50/);assert.match(await page.locator('.cpdDrawer').innerText(),/10,00/);
 await page.evaluate(()=>{
  const body=document.querySelector('.cpdBody'),section=document.querySelector('[data-cpd-lfl-details="season"]').closest('.cpdSection');
  body.scrollTop+=section.getBoundingClientRect().top-body.getBoundingClientRect().top-8;
 });
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 await page.screenshot({path:path.join(assets,'collection-lfl-persistence.png')});
 await page.evaluate(()=>{applyLanguage('en');BLCollectionPriceDrawer.refresh({force:true});});
 assert.match(await page.locator('.cpdDrawer').innerText(),/Saved references were preserved/);
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS incomplete refresh preserves displayed references and gives TR/EN feedback');
 const updated=rows.map(row=>row.map((value,index)=>index===6?Number(value)+5:value));
 await upload(updated);const refreshed=await api('/api/collection-lfl-reference?rebuild=1');assert.equal(refreshed.references[0].average,22.5);
 await stop();await start();assert.deepEqual(await api('/api/collection-lfl-reference'),refreshed);
 console.log('PASS explicit successful refresh replaces and persists references');console.log('Artifacts: '+root);
})().catch(error=>{console.error(error);console.error('Server log: '+path.join(root,'server.log'));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)await stop();fs.closeSync(log);});
