'use strict';
// Real Buyer Log, isolated synthetic account and data; no production data is read.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx'),{execFileSync}=require('node:child_process');
const app=path.resolve(__dirname,'..'),root=path.resolve(app,'../../work/report-layout-acceptance');fs.mkdirSync(root,{recursive:true});
const port=6497,base=`http://127.0.0.1:${port}`,env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
env.BUYER_LOG_AUTH_DATA_ROOT=env.BUYER_LOG_SERVER_DATA_ROOT;env.BL_DATA_DIR=env.BUYER_LOG_SERVER_DATA_ROOT;
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',updates:{enabled:false}}));
const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser;
(async()=>{
 let ready=false;for(let i=0;i<120;i++){try{ready=(await fetch(base+'/api/health')).status<500;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready,'isolated server ready');
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',password:'demo-report-123',newPassword:'demo-report-123'})});assert.ok(login.ok,await login.clone().text());
 const cookie=login.headers.get('set-cookie').split(';')[0],split=cookie.indexOf('=');
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1600,height:960},reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
 await context.addCookies([{name:cookie.slice(0,split),value:cookie.slice(split+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const page=await context.newPage(),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.BLPerf&&typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(()=>{applyLanguage('en');switchTab('cp');});
 await page.waitForTimeout(800);
 const seedCp=()=>{
   const rows=Array.from({length:4},(_,i)=>({_id:i+1,'PLM ID':990001+i,'Model Name':'DEMO MODEL '+(i+1),'Product Main Description':i%2?'T-Shirt':'Sweat','C.Code':'DEMO-C'+i,Colour:'NAVY','Order Code':880001+i,Season:'S7',Country:'DEMO','Order Quantity':100+i,Manufacturer:'DEMO FACTORY','Ex-factory':'2027-03-10','Retail Date':'2027-04-10','Del. Type':'Regular',STATUS:'Order Placed'}));
   state.cp={...(state.cp||{}),rows};state.orders={...(state.orders||{}),rows:rows.map(r=>({...r}))};state.cpSelected.clear();state.ordersSelected.clear();
   state.cpSort={key:null,dir:1};state.ordersSort={key:null,dir:1};
   colmgr.cp.order=CP_COLS.map(c=>c.k);colmgr.cp.hidden=new Set(CP_COLS.filter(c=>!['PLM ID','Model Name','Product Main Description','C.Code','Colour','Season','Country','Order Code','Order Quantity','Manufacturer','Ex-factory','Retail Date'].includes(c.k)).map(c=>c.k));
   applyPlmStyleLinksPayload({links:rows.map(row=>({plmId:row['PLM ID'],styleId:row['PLM ID']+100,styleName:row['Model Name']}))});
   for(const key of ['custom','focus','extended','all'])BLStorage.removeItem('buyerlog.tableReportMode.v1.layout.cp.'+key);
   renderCP();BLFlushTableRenders();ensureTableReportAdapters();BLTableReportInline.setMode('cp',true);
 };
 await page.evaluate(seedCp);await page.evaluate(()=>BLTableReportInline.refreshShared());
 if(process.env.REPORT_PERF_ONLY==='1'){
   const baseline='e6794e78fc4ec8c841f664dde7b65ba60c3cf454';
   const original=name=>execFileSync('git',['show',baseline+':resources/app/public/'+name],{cwd:app,encoding:'utf8',maxBuffer:8*1024*1024});
   const sources={main:original('table-report-inline.js'),candidate:fs.readFileSync(path.join(app,'public/table-report-inline.js'),'utf8')};
   const styles={main:original('ui-tokens.css')+'\n'+original('ui-components.css'),candidate:fs.readFileSync(path.join(app,'public/ui-tokens.css'),'utf8')+'\n'+fs.readFileSync(path.join(app,'public/ui-components.css'),'utf8')};
   const samples=[];
   for(let pair=0;pair<3;pair++)for(const variant of ['main','candidate']){
     await page.evaluate(({source,css})=>{
       for(const sheet of document.querySelectorAll('link[href^="ui-tokens.css"],link[href^="ui-components.css"]'))sheet.disabled=true;
       let style=document.getElementById('reportPerfStyles');if(!style){style=document.createElement('style');style.id='reportPerfStyles';document.head.append(style);}style.textContent=css;
       BLTableReportInline.setMode('cp',false);document.querySelector('[data-table-report-inline="cp"]')?.remove();
       (0,eval)(source);
       const seed=state.cp.rows[0],rows=Array.from({length:300},(_,i)=>({...seed,_id:i+1,'PLM ID':990001+i,'Model Name':'DEMO MODEL '+i}));
       BLTableReportInline.register('cp',{tab:'cp',table:()=>document.getElementById('cpTable'),rows:()=>rows,columns:()=>tableReportCoreColumns('cp'),images:()=>false,...tableReportInteraction('cp')});
       BLTableReportInline.setMode('cp',true);
     },{source:sources[variant],css:styles[variant]});
     await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
     const measurement=await page.evaluate(()=>{
       const raw=[];
       for(let i=0;i<10;i++){const start=performance.now();BLTableReportInline.setMode('cp',true);document.querySelector('#blTableReport-cp').getBoundingClientRect();raw.push(performance.now()-start);}
       return {raw,mean:raw.reduce((a,b)=>a+b,0)/raw.length,rows:document.querySelectorAll('#blTableReport-cp tbody tr[data-id]').length||300};
     });samples.push({pair,variant,...measurement});
   }
   const evidence={base:'e6794e78fc4ec8c841f664dde7b65ba60c3cf454',scenario:'Actual Buyer Log unchanged report refresh and layout; baseline/candidate report JS and canonical CSS, same final app shell; 300 synthetic rows, 12 fields; 3 alternating pairs, 10 renders per sample',budget:'Existing report rendering: no reproducible regression; new edit and selection interactions <=200ms',samples};
   fs.writeFileSync(path.join(root,'performance.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));return;
 }
 console.log('Report rows',await page.locator('#blTableReport-cp tbody tr[data-id]').count());
 await page.screenshot({path:path.join(root,'initial.png')});
 assert.equal(await page.locator('#blTableReport-cp tbody tr[data-id]').count(),4);
 // Every preset has a pencil and it opens the existing Fields drawer.
 await page.locator('#cpTableViewActions [data-bl-view-trigger]').click();await page.screenshot({path:path.join(assets,'view-fields-pencils.png')});await page.locator('#cpTableViewActions [data-fields-view="extended"]').click();
 assert.ok(await page.locator('#_tableFieldsMenu').isVisible());await page.locator('[data-table-fields-close]').click();await page.keyboard.press('Escape');
 // Drag a field from the supporting line into the primary line.
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 const field=page.locator('[data-table-report-inline="cp"] [data-tr-field="Model Name"]'),group=await field.locator('xpath=ancestor::*[@data-tr-group]').getAttribute('data-tr-group');
 const primary=page.locator('[data-table-report-inline="cp"] [data-tr-group="'+group+'"] [data-tr-line="0"]');
 await field.dragTo(primary);
 await page.screenshot({path:path.join(assets,'report-cell-layout.png')});
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="save"]').click();
 const savedLayout=await page.evaluate(()=>BLStorage.getItem('buyerlog.tableReportMode.v1.layout.cp.custom'));
 assert.ok(savedLayout.includes('Model Name'));
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="reset"]').click();
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="cancel"]').click();
 assert.equal(await page.evaluate(()=>BLStorage.getItem('buyerlog.tableReportMode.v1.layout.cp.custom')),savedLayout);
 console.log('PASS saved drag, reset preview and cancel');
 // Select a report group and copy; output must be the underlying table columns.
 const cell=page.locator('#blTableReport-cp tbody tr[data-id]').first().locator('td[data-key]').nth(Number(group));await cell.click();await page.keyboard.press('Control+c');
 console.log('Selection',await page.evaluate(()=>({grid:BLGridClipboard.state('blTableReport-cp'),overlay:blOverlayOpen(),active:document.body.dataset.activeTab})),errors);
 await page.waitForFunction(async()=>Boolean(await navigator.clipboard.readText()),{timeout:5000});
 const copied=await page.evaluate(()=>navigator.clipboard.readText());console.log('Copied:',JSON.stringify(copied));assert.ok(copied.includes('990001'));assert.ok(copied.includes('\t'));
 const expected=await page.evaluate(()=>BLTableExport.toTSV(BLTableExport.buildMatrix({records:[state.cp.rows[0]],columns:visibleCols('cp').filter(c=>['PLM ID','Model Name','C.Code','Colour'].includes(c.k)),columnLabel:c=>tableColumnLabel('cp',c),cellText:(c,r)=>cellPlainText(c,r,computeFlags(r))}),{includeHeaders:false}));
 assert.equal(copied,expected,'report group is the original table cells in original order');
 await cell.click({modifiers:['Shift']});
 await page.screenshot({path:path.join(assets,'report-table-selection.png')});
 // Same shared row menu, exact canonical links, and the real BOM dialog.
 await cell.click({button:'right'});
 await page.locator('.rowCtxMenu').waitFor();
 for(const label of ['Open in PLM','Open TROY Order','Open TROY Shipment Request','PLM BOM / Print Details'])assert.ok(await page.locator('.rowCtxMenu').getByText(label,{exact:true}).isVisible(),label);
 await page.screenshot({path:path.join(assets,'report-row-actions.png')});await page.keyboard.press('Escape');
 const urls=[];await page.exposeFunction('captureReportLink',url=>urls.push(url));await page.evaluate(()=>{window.open=(url)=>{window.captureReportLink(url);return null;};});
 for(const label of ['Open in PLM','Open TROY Order','Open TROY Shipment Request']){await cell.click({button:'right'});await page.locator('.rowCtxMenu').getByText(label,{exact:true}).click();}
 assert.deepEqual(urls,['https://corenectum.lcwaikiki.com/models-options/style-overview?styleId=990101&m=2','https://troy.lcwaikiki.com/order-management/orders/880001','https://troy.lcwaikiki.com/cps-management/shipment-request/880001']);
 await cell.click({button:'right'});await page.locator('.rowCtxMenu').getByText('PLM BOM / Print Details',{exact:true}).click();
 await page.locator('[data-bom-close]').first().waitFor();await page.locator('[data-bom-close]').first().click();
 assert.deepEqual(await page.evaluate(()=>[...state.cpSelected]),[],'opening row actions does not replace cell or row selection');
 console.log('PASS canonical PLM / TROY links and real BOM dialog');
 // Shared CSS covers row selectors and excludes boolean data/permission fields.
 const railMatrix=await page.evaluate(()=>{
   const attrs=['class="rowChk"','class="shipCompareChk"','class="shipRowChk"','data-tr-check="0"','data-ship-chk-all','data-fabric-pick="0"','data-bin-id="demo"','data-cpa-queue-check="demo"','data-dc-item="demo"','data-dc-toggle-all','data-ta-pick="demo"','data-ta-all','data-act="selectRow"','data-act="selectAll"','id="shipChkAll"'];
   const table=document.createElement('table');table.style.cssText='position:absolute;left:-3000px;top:0;width:300px;table-layout:fixed';
   table.innerHTML='<tbody>'+attrs.map(attr=>'<tr style="height:48px"><td><input type="checkbox" '+attr+' checked></td><td>Demo</td></tr>').join('')+'<tr><td><input type="checkbox" data-um-rolecell="read"></td><td><input type="checkbox" data-ed-xbar="0"></td></tr></tbody>';document.body.append(table);
   const result=[...table.querySelectorAll('input')].map(input=>({appearance:getComputedStyle(input).appearance,width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height}));table.remove();return result;
 });
 for(const item of railMatrix.slice(0,-2)){assert.equal(item.appearance,'none');assert.equal(item.width,8);assert.ok(item.height>=44);}
 for(const item of railMatrix.slice(-2))assert.notEqual(item.appearance,'none','boolean property inputs retain their own control');
 // Native checkbox semantics, full-height rail and mixed header state.
 await page.locator('#blTableReport-cp [data-tr-check="1"]').check();
 const rail=await page.locator('#blTableReport-cp [data-tr-check="1"]').evaluate(input=>({appearance:getComputedStyle(input).appearance,width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height,cellHeight:input.closest('td').getBoundingClientRect().height,color:getComputedStyle(input).backgroundColor,cellWidth:input.closest('td').getBoundingClientRect().width}));
 assert.equal(rail.appearance,'none');assert.equal(rail.width,8);assert.equal(rail.cellWidth,8);assert.ok(Math.abs(rail.height-rail.cellHeight)<2);assert.notEqual(rail.color,'rgba(0, 0, 0, 0)');
 assert.ok(await page.locator('#blTableReport-cp [data-tr-check="all"]').evaluate(input=>input.indeterminate));
 await page.evaluate(()=>applyTheme('dark'));await page.screenshot({path:path.join(assets,'row-selection-rails.png')});await page.evaluate(()=>applyTheme('light'));
 await page.locator('#blTableReport-cp [data-tr-check="1"]').uncheck();
 // Real Moderator publish + buyer read/deny, including an older personal layout.
 const profilesResponse=await fetch(base+'/api/users/admin',{headers:{cookie}}),profiles=await profilesResponse.json();
 let buyer=profiles.profiles.find(profile=>profile.username==='report-buyer');
 if(!buyer){const response=await fetch(base+'/api/users',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:profiles.revision,username:'report-buyer',displayName:'Demo Buyer',title:'Buyer',managerId:'moderator',password:'Demo-buyer-123'})});const created=await response.json();assert.equal(response.status,201,JSON.stringify(created));buyer=created.user;}
 const buyerLogin=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:buyer.id,password:'Demo-buyer-123'})});assert.equal(buyerLogin.status,200);const buyerCookie=buyerLogin.headers.get('set-cookie').split(';')[0];
 const forbidden=await fetch(base+'/api/table-report-layouts',{method:'PUT',headers:{cookie:buyerCookie,'Content-Type':'application/json'},body:JSON.stringify({table:'cp',view:'custom',layout:{},expectedId:''})});assert.equal(forbidden.status,403,'server denies non-Moderator even with a forged request');
 const buyerContext=await browser.newContext({viewport:{width:1600,height:960},reducedMotion:'reduce'}),eq=buyerCookie.indexOf('=');await buyerContext.addCookies([{name:buyerCookie.slice(0,eq),value:buyerCookie.slice(eq+1),domain:'127.0.0.1',path:'/'}]);
 await buyerContext.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const buyerPage=await buyerContext.newPage();buyerPage.setDefaultTimeout(10000);await buyerPage.goto(base);await buyerPage.waitForFunction(()=>typeof switchTab==='function',{timeout:60000});await buyerPage.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:4000}).catch(()=>{});await buyerPage.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await buyerPage.evaluate(()=>{applyLanguage('en');switchTab('cp');});await buyerPage.evaluate(seedCp);await buyerPage.evaluate(()=>BLTableReportInline.refreshShared());
 await buyerPage.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();assert.equal(await buyerPage.locator('[data-tr-action="save-all"]').count(),0,'shared save is hidden for buyer');
 await buyerPage.locator('[data-tr-action="reset"]').click();await buyerPage.locator('[data-tr-action="save"]').click();
 await page.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();await page.screenshot({path:path.join(assets,'report-save-everyone.png')});
 const publication=page.waitForResponse(response=>response.url().endsWith('/api/table-report-layouts')&&response.request().method()==='PUT');await page.locator('[data-tr-action="save-all"]').click();const published=await (await publication).json();assert.ok(published.slots['cp.custom'].id);await page.waitForFunction(()=>!document.querySelector('[data-tr-action="save-all"]'));
 await buyerPage.evaluate(()=>BLTableReportInline.refreshShared());
 await buyerPage.locator('[data-table-report-inline="cp"] [data-tr-action="edit"]').click();
 assert.equal(await buyerPage.locator('[data-tr-field="Model Name"]').evaluate(button=>button.closest('[data-tr-line]').dataset.trLine),'0','the new publication replaces the older personal layout');
 await buyerPage.locator('[data-tr-action="cancel"]').click();
 // A stale moderator cannot overwrite a newer publication.
 const stale=await fetch(base+'/api/table-report-layouts',{method:'PUT',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({table:'cp',view:'custom',layout:{},expectedId:''})});assert.equal(stale.status,409);
 await buyerPage.close();await buyerContext.close();console.log('PASS 8px rails, Moderator publication, buyer inheritance and server authority/conflict guards');
 // Row checkbox shares the ordinary table's selection.
 await page.locator('#blTableReport-cp [data-tr-check="1"]').check();assert.deepEqual(await page.evaluate(()=>[...state.cpSelected]),[2]);
 assert.equal(await page.evaluate(()=>BLGridClipboard.state('blTableReport-cp')?.selectionRange),null,'checking a row supersedes the old cell selection, as in the normal table');
 await page.evaluate(()=>BLTableReportInline.setMode('cp',false));assert.equal(await page.locator('#cpTable tbody tr[data-id="2"] .rowChk').isChecked(),true);
 // Selected-row rich clipboard is byte-identical in both presentations.
 await page.evaluate(()=>copyManagedTableLikeExcel('cp',filteredCP(),state.cpSelected,'navCopy'));
 const plainTable=await page.evaluate(()=>navigator.clipboard.readText());
 await page.evaluate(()=>BLTableReportInline.setMode('cp',true));
 await page.evaluate(()=>copyGridSelection(true));
 await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),plainTable);
 // Real XLSX exports retain the table schema and rows while report is visible.
 async function workbook(report){await page.evaluate(on=>BLTableReportInline.setMode('cp',on),report);const download=page.waitForEvent('download');await page.evaluate(()=>exportActiveTableStyled());const file=await download;const saved=path.join(root,report?'report.xlsx':'table.xlsx');await file.saveAs(saved);const book=XLSX.readFile(saved);return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,defval:''});}
 assert.deepEqual(await workbook(true),await workbook(false));
 console.log('PASS identical selected-row clipboard and real XLSX export');
 // Orders and Collection share the same report interaction without changing their source.
 await page.evaluate(()=>{switchTab('orders');colmgr.orders.hidden=new Set(colmgr.cp.hidden);renderOrders();BLFlushTableRenders();BLTableReportInline.setMode('orders',true);});
 assert.equal(await page.locator('#blTableReport-orders tbody tr[data-id]').count(),4);
 await page.locator('#blTableReport-orders tbody td[data-key]').first().click();await page.keyboard.press('Control+c');
 await page.waitForFunction(async()=>(await navigator.clipboard.readText()).includes('990001'));
 await page.evaluate(async()=>{switchTab('koleksiyon');await BLPerf.ensureFeature('collectionTools');});
 await page.evaluate(()=>{kolRows=[{id:91001,plmId:'990001',modelKod:'DEMO COLLECTION',season:'S7',mag:'DEMO',urunTipi:'DEMO',country:'DEMO',quantity:'200',targetPrice:'14',pricing:{},durum:'',colour:'NAVY'}];kolColOrder=kolDefaultDisplayOrder();kolHiddenCols=new Set(kolColDefs().map(c=>c.k).filter(k=>!['modelKod','season','quantity','targetPrice'].includes(k)));kolPictureHidden=true;kolColFilters={};kolSelected.clear();renderKol();BLTableReportInline.setMode('koleksiyon',true);});
 assert.equal(await page.locator('#blTableReport-koleksiyon tbody tr[data-id]').count(),1);
 const collectionCell=page.locator('#blTableReport-koleksiyon tbody td[data-key]').filter({hasText:'DEMO COLLECTION'}).first();await collectionCell.click();await page.keyboard.press('Control+c');
 await page.waitForFunction(async()=>(await navigator.clipboard.readText()).includes('DEMO COLLECTION'));
 await page.locator('#blTableReport-koleksiyon [data-tr-check="0"]').check();assert.deepEqual(await page.evaluate(()=>[...kolSelected]),[91001]);
 await page.evaluate(()=>applyLanguage('tr'));
 await page.waitForFunction(()=>document.querySelector('[data-table-report-inline="koleksiyon"] [data-tr-action="edit"]')?.textContent==='Düzeni özelleştir').catch(async error=>{console.log('LANG',await page.evaluate(()=>({lang:document.documentElement.lang,text:document.querySelector('[data-table-report-inline="koleksiyon"]')?.textContent})));throw error;});
 await page.locator('[data-table-report-inline="koleksiyon"] [data-tr-action="edit"]').click();assert.ok(await page.getByRole('button',{name:'Kaydet',exact:true}).isVisible());
 console.log('PASS CP, Orders, Collection and live TR/EN');
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(root,'results.json'),JSON.stringify({ok:true,errors},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill();fs.closeSync(log);});
