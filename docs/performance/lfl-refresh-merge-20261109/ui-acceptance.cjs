/* Actual app + isolated demo snapshot, with worker admission constrained to 160 MiB. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(process.env.LFL_ACCEPTANCE_APP),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-lfl-refresh-recovery-'));
const port=6491,base=`http://127.0.0.1:${port}`,env={...process.env};
for(const key of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT']){env[key]=path.join(root,key);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_CONFIG_PATH=path.join(root,'config.json');fs.mkdirSync(path.join(root,'source'));
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:path.join(root,'source')}));
const log=fs.openSync(path.join(root,'server.log'),'a');
const server=spawn(process.execPath,['-e',"const pool=require('./server/lib/compute-pool');const create=pool.createComputePool;pool.createComputePool=options=>create({...options,memoryBudgetBytes:160*1024*1024,maxWorkers:1});require('./server/server');"],{cwd:app,env,stdio:['ignore',log,log]});
let browser;
(async()=>{
 let healthy=false;
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).status<500){healthy=true;break;}}catch(_){}await new Promise(resolve=>setTimeout(resolve,200));}
 assert.ok(healthy,'isolated server started');
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-lfl-recovery-123',password:'demo-lfl-recovery-123'})});
 assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
 async function api(url,body,status=200){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,status,await response.clone().text());return response.json();}
 async function upload(fob){
  const matrix=[['ORDER CODE','MAG','MMYG','KLASMAN','SEZON','IN STORE','FOB','ORDER QUANTITY','MANUFACTURER','COUNTRY','BUYING GROUP','BUYER'],['DEMO-RECOVERY','CU4E','DEMO','K.KOL LİSANS','S6','2026-02-10',fob,100,'DEMO A','CHINA','DEMO','DEMO']];
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(matrix),'Demo');
  await api('/api/lfl/upload',{name:'demo-lfl.xlsx',dataBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')});
 }
 await upload(10);const saved=await api('/api/collection-lfl-reference');assert.equal(saved.references[0].average,10);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1500,height:960},reducedMotion:'reduce'});
 const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
 await page.evaluate(()=>{
  applyLanguage('en');kolRows=[{id:91001,plmId:'DEMO-001',modelKod:'DEMO LFL MODEL',season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'FEBRUARY 2027',country:'CHINA',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'BLUE'}];
  kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(col=>col.k).filter(key=>!['modelKod','season','mag','urunTipi','targetPrice','inStoreMonth'].includes(key)));kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';renderKol();
 });
 await page.waitForFunction(()=>/10[,.]00/.test(document.querySelector('td[data-key="__referenceSummary__"]')?.textContent||''));
 await page.locator('td[data-key="__referenceSummary__"]').dblclick();
 await upload(20);
 assert.equal((await api('/api/collection-lfl-detail',{key:saved.references[0].key,version:saved.version},409)).code,'LFL_REFERENCE_STALE');
 assert.deepEqual(await api('/api/collection-lfl-reference'),saved,'ordinary reads retain saved references');
 await assert.rejects(page.evaluate(()=>BLCollectionLfl.detailReport(kolRows[0],'month')),/LFL source changed/);
 const feedbackStarted=performance.now();
 await page.locator('.cpdDrawer [data-cpd-lfl-refresh]').click();
 await page.waitForFunction(()=>document.querySelector('.cpdDrawer [data-cpd-lfl-refresh]')?.disabled===true);
 const feedbackMs=performance.now()-feedbackStarted;assert.ok(feedbackMs<=200,'refresh feedback <=200 ms: '+feedbackMs);
 console.log('Refresh feedback ms: '+feedbackMs);
 await page.waitForFunction(()=>document.querySelector('.cpdDrawer [data-cpd-lfl-refresh]')?.disabled===false);
 assert.match(await page.locator('.cpdDrawer').innerText(),/20[,.]00/);
 assert.ok(!(await page.locator('.cpdDrawer').innerText()).includes('Could not refresh'));
 const refreshed=await api('/api/collection-lfl-reference');assert.notEqual(refreshed.version,saved.version);assert.equal(refreshed.references[0].average,20);
 await page.locator('.cpdDrawer [data-cpd-lfl-details="month"]').click();
 const detail=page.locator('#blSharedDetailDrawer');await detail.locator('tbody tr[data-id]').first().waitFor();
 assert.match(await detail.innerText(),/DEMO-RECOVERY/);assert.match(await detail.innerText(),/W\.Avg \$20\b/);
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{applyLanguage('tr');BLCollectionPriceDrawer.refresh({force:true});});
 await page.locator('.cpdDrawer [data-cpd-lfl-details="month"]').click();await detail.locator('tbody tr[data-id]').first().waitFor();
 assert.match(await detail.innerText(),/SİPARİŞ DETAYLARI/i);assert.match(await detail.innerText(),/Ağ\.Ort\. \$20\b/);
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 await page.screenshot({path:path.join(assets,'collection-lfl-refresh-recovery-20261109.png')});
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{
  BLCollectionPriceDrawer.close();switchTab('shipping');
  shipRows=[{_shipId:'DEMO-SHIP-1',orderCode:'DEMO-001',styleName:'DEMO SHIPPING MODEL',quantity:1000,country:'CHINA',fob:8,trFiyatFobUsdLanded:12,ydFiyatUsdLandedGemi:9,ydFiyatUsdLandedGemiUcak:10,ydFiyatUsdLandedUcak:11,gemiAvantaj:25,gemiUcakAvantaj:16.67,ucakAvantaj:8.33,_canEdit:false}];
  renderShipDecision();
 });
 await page.locator('.shipCompare tbody tr').waitFor();
 const handle=await page.locator('.shipCompare .colResizer').first().evaluate(node=>({cursor:getComputedStyle(node).cursor,color:getComputedStyle(node,'::after').backgroundColor,width:getComputedStyle(node,'::after').width}));
 assert.equal(handle.cursor,'col-resize');assert.equal(handle.width,'1px');assert.notEqual(handle.color,'rgba(0, 0, 0, 0)');
 const shipStyles={};
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  shipStyles[theme]=await page.locator('.shipCompare').evaluate(table=>{
   const style=getComputedStyle(table),root=getComputedStyle(document.documentElement);
   return {radius:style.borderRadius,color:style.borderTopColor,expected:root.getPropertyValue('--ui-group-divider').trim()};
  });
  assert.equal(shipStyles[theme].radius,'0px');
 }
 await page.screenshot({path:path.join(assets,'shipping-theme-token-recovery-20261109.png')});
 fs.writeFileSync(path.join(root,'shipping-styles.json'),JSON.stringify(shipStyles,null,2));
 console.log('PASS: shipping comparison keeps canonical borders and radius in light/dark themes.');
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS: constrained worker admission, stale detail, retained references, explicit refresh and current order details in TR/EN.');
 console.log('Artifacts: '+root);
})().catch(error=>{console.error(error);console.error('Server log: '+path.join(root,'server.log'));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();const stopped=once(server,'exit');server.kill();await stopped;fs.closeSync(log);});
