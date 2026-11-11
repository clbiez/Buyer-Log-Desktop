/* Actual app + isolated demo snapshot: an explicit refresh adopts an LFL source that lost a reference group. */
'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{once}=require('node:events');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),root=fs.mkdtempSync(path.join(os.tmpdir(),'buyerlog-lfl-removed-groups-'));
const port=6493,base=`http://127.0.0.1:${port}`,env={...process.env};
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
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-lfl-removed-123',password:'demo-lfl-removed-123'})});
 assert.equal(login.status,200,await login.clone().text());const cookie=login.headers.get('set-cookie').split(';')[0];
 async function api(url,body,status=200){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(response.status,status,await response.clone().text());return response.json();}
 const header=['ORDER CODE','MAG','MMYG','KLASMAN','SEZON','IN STORE','FOB','ORDER QUANTITY','MANUFACTURER','COUNTRY','BUYING GROUP','BUYER'];
 const line=(code,inStore,fob)=>[code,'CU4E','DEMO','K.KOL LİSANS','S6',inStore,fob,100,'DEMO A','CHINA','DEMO','DEMO'];
 async function upload(rows){
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,...rows]),'Demo');
  await api('/api/lfl/upload',{name:'demo-lfl.xlsx',dataBase64:XLSX.write(book,{type:'buffer',bookType:'xlsx'}).toString('base64')});
 }
 // Saved references contain February and March; the later source no longer has the March order (cancelled).
 await upload([line('DEMO-FEB','2026-02-10',10),line('DEMO-MAR','2026-03-10',12)]);
 const saved=await api('/api/collection-lfl-reference');assert.ok(saved.references.some(item=>item.key.includes('2026-03')));
 browser=await chromium.launch();
 const context=await browser.newContext({viewport:{width:1500,height:960},reducedMotion:'reduce'});
 const [name,...rest]=cookie.split('=');await context.addCookies([{name,value:rest.join('='),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
 await page.evaluate(()=>{
  applyLanguage('tr');kolRows=[{id:91002,plmId:'DEMO-002',modelKod:'DEMO LFL MODEL',season:'S7',mag:'CU4E',urunTipi:'K.KOL LİSANS',inStoreMonth:'FEBRUARY 2027',country:'CHINA',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'BLUE'}];
  kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(col=>col.k).filter(key=>!['modelKod','season','mag','urunTipi','targetPrice','inStoreMonth'].includes(key)));kolPictureHidden=true;kolColFilters={};kolHealthState.filter='';renderKol();
 });
 await page.waitForFunction(()=>/10[,.]00/.test(document.querySelector('td[data-key="__referenceSummary__"]')?.textContent||''));
 await page.locator('td[data-key="__referenceSummary__"]').dblclick();
 await upload([line('DEMO-FEB','2026-02-10',20)]);
 assert.equal((await api('/api/collection-lfl-detail',{key:saved.references.find(item=>item.key.endsWith('"2026-02"]')).key,version:saved.version},409)).code,'LFL_REFERENCE_STALE');
 await page.locator('.cpdDrawer [data-cpd-lfl-refresh]').click();
 await page.waitForFunction(()=>document.querySelector('.cpdDrawer [data-cpd-lfl-refresh]')?.disabled===false);
 const drawerText=await page.locator('.cpdDrawer').innerText();
 assert.match(drawerText,/referans grubu kaldırıldı/,'refresh succeeded and reported removed groups');
 assert.ok(!drawerText.includes('yenilenemedi'),'refresh is not blocked');assert.match(drawerText,/20[,.]00/);
 const refreshed=await api('/api/collection-lfl-reference');assert.notEqual(refreshed.version,saved.version);
 assert.ok(!refreshed.references.some(item=>item.key.includes('2026-03')),'the removed group is gone');
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 // Release-note visual uses an anonymous buyer label instead of the default Moderator account name.
 await page.evaluate(()=>{const read=window.kolLflCountryRuleFor;window.kolLflCountryRuleFor=row=>{const rule=read?.(row);return rule?{...rule,ownerName:'Demo Buyer'}:rule;};BLCollectionPriceDrawer.refresh({force:true});});
 assert.ok(!(await page.locator('.cpdDrawer').innerText()).includes('Gökberk'));
 await page.waitForTimeout(300);
 await page.screenshot({path:path.join(assets,'collection-lfl-refresh-removed-groups.png')});
 await page.locator('.cpdDrawer [data-cpd-lfl-details="month"]').click();
 const detail=page.locator('#blSharedDetailDrawer');await detail.locator('tbody tr[data-id]').first().waitFor();
 assert.match(await detail.innerText(),/DEMO-FEB/);assert.ok(!(await detail.innerText()).includes('DEMO-MAR'));
 await page.keyboard.press('Escape');
 await page.evaluate(()=>{applyLanguage('en');BLCollectionPriceDrawer.refresh({force:true});});
 assert.match(await page.locator('.cpdDrawer').innerText(),/reference groups no longer in the current LFL source were removed/);
 assert.deepEqual(errors,[],'browser errors');
 console.log('PASS: stale saved references with a removed group refresh explicitly, report the removal and open current order details in TR/EN.');
 console.log('Artifacts: '+root);
})().catch(error=>{console.error(error);console.error('Server log: '+path.join(root,'server.log'));process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();const stopped=once(server,'exit');server.kill();await stopped;fs.closeSync(log);});
