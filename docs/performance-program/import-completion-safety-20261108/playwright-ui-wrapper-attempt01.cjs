'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const actual=require('/opt/codex/cua_node/lib/node_modules/playwright');
const OUT='/tmp/buyerlog-import-completion-safety/ui';fs.mkdirSync(OUT,{recursive:true});
async function diagnose(page){
 const data={status:'running',classification:'actual demo app/engines/HTTP, programmatic workbook setup through existing _state API; fault-injected post-ACK GET only; no timing acceptance'};
 const save=()=>fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(data,null,2)+'\n');save();
 let rowAck=false,noteWrites=0,rowWrites=0,blockedRefresh=0;
 page.on('response',response=>{const request=response.request(),url=new URL(response.url());if(url.pathname==='/api/overrides/batch'&&request.method()==='POST'&&response.ok())rowAck=true;});
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/note-columns'&&request.method()==='PUT')noteWrites++;
  if(url.pathname==='/api/overrides/batch'&&request.method()==='POST')rowWrites++;
  if(rowAck&&url.pathname==='/api/data'&&request.method()==='GET'){blockedRefresh++;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic post-ACK refresh failure'})});}
  return route.continue();
 });
 try{
  await page.evaluate(async()=>{await window.BLPerf.ensureFeature('excelImport');await window.BLPerf.ensureLibrary('xlsx');window.BLExcelImportWizard.open('cp');});
  await page.waitForSelector('#excelImportWizard');
  data.setup=await page.evaluate(()=>{
   const s=window.BLExcelImportWizard._state(),row=s.adapter.rows()[0],values=[['Order Code','Model Name','C.Code','Import Safety Synthetic'],[String(row['Order Code']),row['Model Name'],row['C.Code'],'synthetic-ACK-value-20261108']];
   const sheet=XLSX.utils.aoa_to_sheet(values),Workbook=window.BLExcelImportWorkbook;
   s.fileName='synthetic-import-safety.xlsx';s.sheetName='Synthetic';s.grid=Workbook.gridFromWorksheet(XLSX,sheet,s.sheetName);s.analysis=Workbook.analyzeSheet(s.grid,{headerRow:0});
   s.table=Workbook.extractTable(s.grid,s.analysis,{});s.assignments={};
   const targets=['Order Code','Model Name','C.Code','__new__'];s.table.columns.forEach((column,i)=>{s.assignments[column.id]={targetId:targets[i],newColumnLabel:'Import Safety Synthetic',newColumnType:'text'};});
   s.newColumns=[{columnId:s.table.columns[3].id,label:'Import Safety Synthetic',dataType:'text'}];s.matchFieldIds=['Order Code','Model Name','C.Code'];s.step='match';window.BLExcelImportWizard.refreshLanguage();
   return {rows:s.table.rows.length,headers:s.table.columns.map(c=>c.header),cpRows:s.adapter.rows().length,revision:s.adapter.revision()};
  });save();assert.equal(data.setup.rows,1);
  await page.locator('#excelImportWizard [data-xim="next"]').click();
  data.plan=await page.evaluate(()=>{const p=window.BLExcelImportWizard._state().plan;return {executable:p?.executable,summary:p?.summary,blocking:p?.blocking,newColumns:p?.newColumns};});save();assert.equal(data.plan.executable,true,JSON.stringify(data.plan));
  await page.locator('#excelImportWizard [data-xim="next"]').click();
  await page.waitForFunction(()=>Boolean(window.BLExcelImportWizard._state()?.result),null,{timeout:60000});
  data.result=await page.evaluate(()=>window.BLExcelImportWizard._state().result);data.network={rowAck,noteWrites,rowWrites,blockedRefresh};save();
  assert.equal(data.result.serverWrite,'acknowledged');assert.equal(data.result.updated,1);assert.equal(data.result.customFieldsCreated,1);assert.equal(data.result.status,'failed');
  assert.equal(noteWrites,1,'no rollback PUT');assert.equal(rowWrites,1,'one row POST');assert.ok(blockedRefresh>0);
  const response=await page.context().request.get(new URL('/api/data?mode=initial',page.url()).href);assert.equal(response.status(),200);
  const server=await response.json(),serialized=JSON.stringify(server);data.retainedServerNoteId=await page.evaluate(()=>CP_NOTE_COLUMN_DEFS.find(d=>d.label==='Import Safety Synthetic')?.id);
  assert.ok(data.retainedServerNoteId);assert.ok(serialized.includes(data.retainedServerNoteId));assert.ok(serialized.includes('synthetic-ACK-value-20261108'),'real server retains written note value');data.serverValueRetained=true;
  await page.screenshot({path:path.join(OUT,'import-ack-retained.tr.png')});
  await page.evaluate(()=>{appLang='en';window.appLang='en';document.documentElement.lang='en';window.BLI18n.setLanguage('en');window.BLExcelImportWizard.refreshLanguage();});
  await page.waitForTimeout(150);
  data.englishText=await page.locator('#excelImportWizard .ximNotice').last().innerText();assert.match(data.englishText,/server acknowledged/i);
  await page.screenshot({path:path.join(OUT,'import-ack-retained.en.png')});
  data.status='passed';save();
 }catch(error){data.status='failed';data.error={message:error.message,stack:error.stack};save();await page.screenshot({path:path.join(OUT,'failure.png')}).catch(()=>{});throw error;}
}
module.exports={chromium:{launch:async options=>{
 const browser=await actual.chromium.launch(options),newContext=browser.newContext.bind(browser);
 browser.newContext=async options=>{const context=await newContext(options),newPage=context.newPage.bind(context);
  context.newPage=async()=>{const page=await newPage(),close=page.close.bind(page);let done=false;
   page.close=async options=>{if(!done){done=true;if(await page.evaluate(()=>document.body.dataset.activeTab==='cp'&&Boolean(window.__startupProbe?.startupCompleteMs)).catch(()=>false))await diagnose(page);}return close(options);};return page;};return context;};return browser;
}}};
