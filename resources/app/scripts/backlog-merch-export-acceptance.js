'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
// Real HTTP + browser downloads on isolated synthetic data. Requires Playwright and Chromium.
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..');
fs.mkdirSync(path.join(repo,'work'),{recursive:true});
const root=fs.mkdtempSync(path.join(repo,'work/backlog-merch-'));
const XLSX=require(path.join(app,'node_modules/xlsx')),ExcelJS=require(path.join(app,'public/vendor/exceljs.min.js')),{chromium}=require('playwright');
const port=Number(process.env.BUYER_LOG_BACKLOG_ACCEPTANCE_PORT||6487),base=`http://127.0.0.1:${port}`;
fs.mkdirSync(root,{recursive:true});
const env={...process.env,BUYER_LOG_DATA_ROOT:path.join(root,'app'),BUYER_LOG_SERVER_DATA_ROOT:path.join(root,'server'),BUYER_LOG_LOCAL_DATA_ROOT:path.join(root,'local'),BUYER_LOG_TEMP_ROOT:path.join(root,'temp'),BUYER_LOG_CONFIG_PATH:path.join(root,'config.json')};
for(const k of ['BUYER_LOG_DATA_ROOT','BUYER_LOG_SERVER_DATA_ROOT','BUYER_LOG_LOCAL_DATA_ROOT','BUYER_LOG_TEMP_ROOT'])fs.mkdirSync(env[k],{recursive:true});
const source=path.join(root,'source');fs.mkdirSync(source,{recursive:true});fs.writeFileSync(env.BUYER_LOG_CONFIG_PATH,JSON.stringify({port,sourceFolder:source}));
const demo=require(path.join(app,'scripts/generate-demo-data')).build({rows:8,seed:7,today:new Date('2026-11-03T00:00:00Z')});
const heads=demo.asas[2],retail='Retail Depo Tarih Yıl Ay Gün',budget='Model Bütçe Tarih Yıl Ay Gün';
for(let i=3;i<demo.asas.length;i++){
 demo.asas[i][heads.indexOf(retail)]=['2026-12-28','2027-01-04','2026-04-27','2026-05-03'][i%4];
 demo.asas[i][heads.indexOf(budget)]=['2026-04-27','2026-05-03','2027-01-04','2026-12-28'][i%4];
}
for(const [name,sheet,aoa]of [['ASAS - Demo.xlsx','ASAS',demo.asas],['Antrepo - Demo.xlsx','Antrepo',demo.antrepo]]){
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(aoa),sheet);XLSX.writeFile(wb,path.join(source,name));
}
function calendarHtml(variant=0){let html='<html>';for(const year of [2026,2027]){
 html+=`<app-lcw-calendar id="app-lcw-calendar-${year}"><table>`;
 const jan=new Date(Date.UTC(year,0,1)),monday=new Date(jan);monday.setUTCDate(jan.getUTCDate()-(jan.getUTCDay()+6)%7);
 const lengths=[5,4,4,5,4,4,5,4,4,5,4,4];let month=1,end=lengths[0];
 for(let w=1;w<=52;w++){
  if(w>end){month++;end+=lengths[month-1];}
  const names=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const label=variant&&year===2026&&w===18?'May':names[month-1];
  html+='<tr class="nopadding noselect"><th id="'+label+'">'+label+'</th><td class="week-cell">'+w+'</td>';
  for(let d=0;d<7;d++){const day=new Date(monday);day.setUTCDate(monday.getUTCDate()+(w-1)*7+d);html+='<td><span class="noselect">'+day.getUTCDate()+'</span></td>';}
  html+='</tr>';
 }
 html+='</table></app-lcw-calendar>';
}return html+'</html>';}
const log=fs.openSync(path.join(root,'server.log'),'a');const server=spawn(process.execPath,['server/server.js'],{cwd:app,env,stdio:['ignore',log,log]});let browser,cookie;
async function api(url,body){const res=await fetch(base+url,{method:body?'POST':'GET',headers:{cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.ok(res.ok,await res.clone().text());return res;}
(async()=>{
 for(let i=0;i<160;i++){try{if((await fetch(base+'/api/health')).status<500)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 const login=await fetch(base+'/api/user-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:'moderator',newPassword:'demo-merch-123',password:'demo-merch-123'})});assert.equal(login.status,200,await login.clone().text());cookie=login.headers.get('set-cookie').split(';')[0];
 const upload=variant=>api('/api/merch-calendar',{name:'DEMO-MerchCalendar.xls',contentBase64:Buffer.from(calendarHtml(variant)).toString('base64')});
 await upload(0);await api('/api/refresh',{});
 for(let i=0;i<120;i++){if(!(await (await api('/api/refresh-status')).json()).running)break;await new Promise(r=>setTimeout(r,250));}
 let data=await (await api('/api/backlog-export?format=json')).json();assert.ok(data.rows.length);assert.equal(data.merchCalendar.configured,true);
 const initialRevision=data.rowsRevision;
 await upload(1);const changed=await (await api('/api/backlog-export?format=json')).json();assert.notEqual(changed.rowsRevision,initialRevision);
 const boundary=changed.rows.find(r=>String(r[retail]).startsWith('2026-04-27'));assert.ok(boundary);assert.equal(boundary['Retail Depo Merch Yil Ay'],'2026-05');
 await upload(0);data=await (await api('/api/backlog-export?format=json')).json();
 const direct=await api('/api/backlog-export');fs.writeFileSync(path.join(root,'server.xlsx'),Buffer.from(await direct.arrayBuffer()));
 const directWb=XLSX.readFile(path.join(root,'server.xlsx'));
 const directRows=XLSX.utils.sheet_to_json(directWb.Sheets.BACKLOG);assert.equal(directRows.length,data.rows.length);
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce',acceptDownloads:true});
 const sep=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,sep),value:cookie.slice(sep+1),domain:'127.0.0.1',path:'/',httpOnly:true}]);
 await context.addInitScript(()=>localStorage.setItem('bl.releaseNotes.lastSeenStable.v1','99.0.0'));
 const errors=[],page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.dismiss());
 await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof switchTab==='function',{timeout:60000});
 await page.getByText(/Buyer Log'a devam et|Continue to Buyer Log/).click({timeout:3000}).catch(()=>{});
 await page.waitForFunction(()=>!document.getElementById('blBootGuard'),{timeout:60000});
 await page.evaluate(async()=>{switchTab('backlog');await BLPerf.ensureFeature('backlogAnalysis');});
 await page.waitForTimeout(600);
 const results=[];
 for(const lang of ['tr','en']){
  await page.evaluate(lang=>{appLang=lang;},lang);
  const promise=page.waitForEvent('download');await page.evaluate(()=>exportBacklogToExcel());
  const download=await promise,file=path.join(root,`legacy-${lang}.xlsx`);await download.saveAs(file);
  const wb=XLSX.readFile(file,{cellNF:true});const ws=wb.Sheets.BACKLOG,rows=XLSX.utils.sheet_to_json(ws,{defval:''});assert.equal(rows.length,data.rows.length);assert.equal(rows.reduce((sum,r)=>sum+Number(r.Adet||0),0),data.rows.reduce((sum,r)=>sum+Number(r.Adet||0),0));
  for(const row of rows){
   const expected=data.rows.find(r=>String(r['Sipariş Kod'])===String(row['Sipariş Kod'])&&String(r['Renk Kod'])===String(row['Renk Kod']));assert.ok(expected);
   for(const field of [retail,budget]){
    const period=await page.evaluate(d=>BLDateDimension.describe(d),expected[field]);
    assert.equal(row[field] instanceof Date?row[field].toISOString().slice(0,10):row[field],String(expected[field]).slice(0,10));
    assert.equal(row[field+' (Ay)'],lang==='tr'?period.monthLabelTr:period.monthLabelEn);
    assert.equal(row[field+' (Hafta)'],lang==='tr'?period.weekLabelTr:period.weekLabelEn);
   }
  }
  results.push({export:'legacy',lang,rows:rows.length,pass:true});
 }
 await page.evaluate(()=>{BLBacklogOverview.setExportOption('includePlanActual',true);});
 const v3promise=page.waitForEvent('download');await page.evaluate(()=>exportBacklogV3());const v3=await v3promise;await v3.saveAs(path.join(root,'v3.xlsx'));
 const v3wb=new ExcelJS.Workbook();await v3wb.xlsx.load(fs.readFileSync(path.join(root,'v3.xlsx')));assert.ok(v3wb.worksheets.some(w=>w.name==='BACKLOG'));assert.equal(v3wb.getWorksheet('BACKLOG').rowCount,data.rows.length+1);assert.equal(v3wb.getWorksheet('Backlog V3').rowCount,data.rows.length+1);results.push({export:'v3',sheets:v3wb.worksheets.map(w=>w.name),pass:true});
 await page.evaluate(({rows,retail,budget})=>{appLang='tr';openBacklogDetailShell('Backlog · Merch LCW takvimi — DEMO','');BLStorage.setItem(BACKLOG_DETAIL_COMPACT_KEY,'0');renderBacklogDetailTable(rows,['Sipariş Kod',retail,budget,'Adet']);}, {rows:data.rows,retail,budget});
 await page.locator('#backlogDetailTableWrap').waitFor({state:'visible'});
 await page.waitForTimeout(1800);await page.screenshot({path:path.join(root,'backlog-merch-calendar.png')});
 const detailPromise=page.waitForEvent('download');await page.evaluate(()=>exportCurrentBacklogDetail());const detail=await detailPromise;await detail.saveAs(path.join(root,'detail.xlsx'));const detailRows=XLSX.utils.sheet_to_json(XLSX.readFile(path.join(root,'detail.xlsx')).Sheets.BACKLOG);assert.equal(detailRows.length,data.rows.length);assert.equal(detailRows[0][retail+' (Ay)'],'Nisan 2026');results.push({export:'detail',pass:true});
 assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(root,'results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify({root,results}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();server.kill('SIGTERM');});
