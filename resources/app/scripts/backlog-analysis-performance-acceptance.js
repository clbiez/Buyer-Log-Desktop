'use strict';
// Real server/browser on synthetic workbooks; never opens the user's data root.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright'),XLSX=require('xlsx');
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..');
fs.mkdirSync(path.join(repo,'work'),{recursive:true});
const root=fs.mkdtempSync(path.join(repo,'work/backlog-analysis-')),port=6491,base=`http://127.0.0.1:${port}`;
const env={...process.env,BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const [key,dir] of Object.entries({BUYER_LOG_DATA_ROOT:'app',BUYER_LOG_SERVER_DATA_ROOT:'server',BUYER_LOG_LOCAL_DATA_ROOT:'local',BUYER_LOG_TEMP_ROOT:'temp'})){env[key]=path.join(root,dir);fs.mkdirSync(env[key],{recursive:true});}
const source=path.join(root,'source');fs.mkdirSync(source);
fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,host:'127.0.0.1',sourceFolder:source,refreshWithExcel:false,centralIamEnabled:false,updates:{enabled:false}}));
const demo=require('./generate-demo-data').build({rows:150,seed:7,today:new Date('2026-11-05T00:00:00Z')});
const headers=demo.asas[2];
for(let i=3;i<demo.asas.length;i++)demo.asas[i][headers.indexOf('Sezon')]=['W6','S7','W7'][i%3];
for(const [file,sheet,rows] of [['ASAS - Demo.xlsx','ASAS',demo.asas],['Antrepo - Demo.xlsx','Antrepo',demo.antrepo]]){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),sheet);XLSX.writeFile(wb,path.join(source,file));
}
const log=fs.openSync(path.join(root,'server.log'),'a'),server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});
let cookie,browser,page;
const filter={id:'cp:Sezon',source:'cp',header:'Sezon',rowKey:'Sezon',label:'Sezon',values:['S7']};
async function api(url,body){const response=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,await response.clone().text());return response;}
(async()=>{
 console.log('Artifacts:',root);
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,250));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-backlog-123',password:'demo-backlog-123'})});assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
 await api('/api/refresh',{});
 for(let i=0;i<160;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(resolve=>setTimeout(resolve,250));}
 const params=new URLSearchParams({lazyDimensions:'1',groupBy:'season,status',analysisFilters:JSON.stringify([filter])});
 const full=await (await api('/api/backlog?lazyDimensions=1')).json();
 const pivot=await (await api('/api/backlog?'+params)).json();assert.ok(pivot.totalRows>0&&pivot.totalRows<full.totalRows);assert.deepEqual(pivot.dimValues,{});
 const details=await (await api('/api/backlog-export?format=json&'+params)).json();assert.equal(details.rows.length,pivot.totalRows);assert.equal(details.rows.reduce((sum,row)=>sum+row.Adet,0),pivot.totalQty);
 const facet=await (await api('/api/backlog-filter-values?field=cp%3ASezon&'+params)).json();assert.equal(facet.values.length,3);assert.ok(!facet.rows);
 const dimension=await (await api('/api/backlog?valueDimensions=season&'+params)).json();assert.equal(dimension.dimValues.season.length,3);assert.deepEqual(dimension.dimValuesActive.season,['S7']);
 const workbook=await api('/api/backlog-export?'+params),wb=XLSX.read(Buffer.from(await workbook.arrayBuffer()));
 const excelRows=XLSX.utils.sheet_to_json(wb.Sheets.BACKLOG);assert.equal(excelRows.length,details.rows.length);assert.equal(excelRows.reduce((sum,row)=>sum+row.Adet,0),pivot.totalQty);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:950},reducedMotion:'reduce'}),sep=cookie.indexOf('=');
 await context.addCookies([{name:cookie.slice(0,sep),value:cookie.slice(sep+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(filter=>{
  localStorage.setItem('bl.user.moderator.lcw.backlog.overview.v1',JSON.stringify({open:true,filters:[filter]}));
  localStorage.setItem('bl.user.moderator.bl.releaseNotes.lastSeenStable.v1','99.0.0');
 },filter);
 page=await context.newPage();const errors=[],requests=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function');
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:60000});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(async()=>{await BLPerf.ensureFeature('backlogAnalysis');});
 assert.equal(await page.evaluate(()=>BLBacklogOverview.queryFilters()[0]?.values[0]),'S7');
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/backlog-export')requests.push(request.url());});
 await page.evaluate(()=>switchTab('backlog'));
 await page.locator('#backlogOverviewBody .bpaHero').waitFor({timeout:60000});
 await page.waitForFunction(()=>BLBacklogAnalysis._state.rows?.length>0&&!BLBacklogAnalysis._state.loading);
 assert.equal(await page.evaluate(()=>lastBacklogData.totalQty),pivot.totalQty);
 assert.ok(requests.length>0);assert.ok(requests.every(url=>new URL(url).searchParams.has('analysisFilters')),'all dashboard requests retain analysis filters');
 assert.equal(requests.length,1,'Overview and Delivery share one filtered HTTP request');
 const initialRequests=requests.length;
 await page.evaluate(()=>{backlogGroupBy=['buyer'];fetchCurrentBacklog();});
 await page.waitForFunction(()=>lastBacklogData.groupBy.join(',')==='buyer');await page.waitForTimeout(300);
 assert.equal(requests.length,initialRequests,'grouping does not invalidate detail rows');
 await page.locator('#backlogOverviewFilter').click();
 await page.locator('[data-blvf-edit="cp%3ASezon"]').click();
 await page.locator('[data-blvf-value="W6"]').waitFor({timeout:15000});
 assert.equal(await page.locator('[data-blvf-value]').count(),3);
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 await page.screenshot({path:path.join(assets,'backlog-analysis-scope.png')});
 await page.locator('[data-blvf-value="W6"]').check();
 await page.waitForFunction(()=>BLBacklogAnalysis._state.rows?.some(row=>row.Sezon==='W6')&&!BLBacklogAnalysis._state.loading);
 assert.equal(await page.locator('[data-blvf-value]').count(),3,'filtering preserves available alternatives');
 assert.equal(await page.evaluate(()=>BLBacklogAnalysis._state.parity.match),true);
 await page.locator('[data-blvf-close]').last().click();
 const previousRevision=await page.evaluate(()=>lastBacklogData.rowsInputRevision);
 const buyerIndex=headers.indexOf('Buyer');assert.ok(buyerIndex>=0);
 for(let i=3;i<demo.asas.length;i++)demo.asas[i][buyerIndex]='DEMO UPDATED';
 const changed=XLSX.utils.book_new();XLSX.utils.book_append_sheet(changed,XLSX.utils.aoa_to_sheet(demo.asas),'ASAS');XLSX.writeFile(changed,path.join(source,'ASAS - Demo.xlsx'));
 await api('/api/refresh',{});
 for(let i=0;i<160;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(resolve=>setTimeout(resolve,250));}
 await page.evaluate(()=>fetchCurrentBacklog());
 await page.waitForFunction(previous=>lastBacklogData.rowsInputRevision!==previous&&BLBacklogAnalysis._state.rows?.every(row=>row.Buyer==='DEMO UPDATED')&&!BLBacklogAnalysis._state.loading,previousRevision,{timeout:60000});
 assert.equal(await page.evaluate(()=>BLBacklogAnalysis._state.parity.match),true,'source refresh updates all panel totals');
 await page.evaluate(()=>openBacklogPivotSettings());
 await page.locator('#backlogSettingsAddFilter').click();
 await page.locator('[data-backlog-filter-values]').first().click();
 await page.locator('.headerFilterPanel,.valueFilterPanel,[role="dialog"]').last().waitFor();
 assert.deepEqual(errors,[]);
 const results={fullRows:full.totalRows,filteredRows:pivot.totalRows,filteredQty:pivot.totalQty,facetValues:facet.values.map(value=>value.value),dashboardRequests:initialRequests,excelParity:true,sourceRefresh:true,browserErrors:errors};
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
})().catch(async error=>{console.error(error);if(page){await page.screenshot({path:path.join(root,'failure.png')}).catch(()=>{});console.error(await page.evaluate(()=>({url:location.href,boot:document.getElementById('blBootGuard')?.textContent.slice(-200),js:document.getElementById('blErrBox')?.textContent})).catch(()=>({})));}process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');});
