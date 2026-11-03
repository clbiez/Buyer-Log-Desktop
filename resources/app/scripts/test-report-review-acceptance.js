'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{fork}=require('node:child_process');
// Isolated production UI/server acceptance. Only the LCW AI HTTP boundary is stubbed.
// Requires Playwright (or playwright-core), Chromium and local loopback access.
let chromium;try { ({chromium}=require('playwright')); } catch (_) { ({chromium}=require('playwright-core')); }
const app=path.resolve(__dirname,'..'),repo=path.resolve(app,'../..'),work=path.join(repo,'work');
fs.mkdirSync(work,{recursive:true});
const root=fs.mkdtempSync(path.join(work,'report-runtime-'));
const child=fork(path.join(app,'tests/helpers/legacy-authority-server.cjs'),[root],{cwd:app,stdio:['ignore','pipe','pipe','ipc']});
const log=fs.createWriteStream(path.join(root,'server.log'));child.stdout.pipe(log);child.stderr.pipe(log);
let browser;
(async()=>{
 const ready=await new Promise((resolve,reject)=>{child.on('message',m=>m.ready&&resolve(m));child.on('exit',code=>reject(Error('Server exited '+code)));setTimeout(()=>reject(Error('Server timeout')),50000).unref();});
 const base='http://127.0.0.1:'+ready.port;
 browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1600,height:1000},timezoneId:'Europe/Istanbul'});
 await context.route('**/*',r=>['127.0.0.1','localhost'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
 assert.ok((await context.request.post(base+'/api/user-login',{data:{username:'fixture-admin',password:'Fixture-only-123'}})).ok());
 let packet,aiCalls=0,mode='finding';const uploads=[];
 await context.route('**/api/lcwai/status*',r=>r.fulfill({json:{status:{connected:true}}}));
 await context.route('**/api/lcwai/files',async r=>{
  const request=r.request(),name=decodeURIComponent(request.headers()['x-lcwai-file-name']||'file.json'),bytes=request.postDataBuffer();
  if(name==='BuyerLog-Test-Review.json')packet=JSON.parse(bytes.toString());
  uploads.push({name,size:bytes.length});
  await r.fulfill({json:{attachment:{blobName:'demo/'+uploads.length,fileName:name,contentType:request.headers()['content-type'],size:bytes.length,url:'demo/'+uploads.length}}});
 });
 await context.route('**/api/lcwai/ask',async r=>{
  const request=r.request().postDataJSON();assert.equal(request.source,'test-report-assess');aiCalls++;
  assert.ok(packet.cp.rows[0].fields['Ex-factory'],'calendar dates reach the shared AI client');
  if(mode==='unresolved') {
    const data={protocol:packet.protocol,caseId:packet.caseId,snapshotId:packet.snapshotId,coveredSourceIds:packet.focusSourceIds,unresolvedSourceIds:packet.focusSourceIds,assessments:[],explanation:'Kaynaklar elle incelenmeli.'};
    return r.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:{structured:{ok:true},data,model:{label:'Demo response (stub)'}}})+'\n'});
  }
  const source=packet.sources.find(s=>s.name==='Demo.eml'),row=packet.cp.rows.find(row=>row.orderCode==='4100001');
  const data={protocol:packet.protocol,caseId:packet.caseId,snapshotId:packet.snapshotId,coveredSourceIds:packet.focusSourceIds,unresolvedSourceIds:[],explanation:'Demo review completed',assessments:[{reportId:'DEMO-2026-01',orderKey:row.key,orderCode:row.orderCode,step:'tests',status:'rejected',scope:'verified',component:'FABRIC',labResult:'Fail',commercialDecision:'',summary:'Kumaş testi başarısız. Tekrar test isteyin.',actions:['Tekrar test isteyin.'],risks:[],evidence:[{sourceId:source.id,page:0,quote:'Report DEMO-2026-01 Order 4100001 FABRIC Fail'}],extraction:{genelSonuc:'Fail'}}]};
  await r.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'result',result:{structured:{ok:true},data,model:{label:'Demo response (stub)'}}})+'\n'});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',async r=>{if(/test-reports|lcwai/.test(r.url()))console.log('REVIEW',r.status(),new URL(r.url()).pathname,(await r.text()).slice(0,300));});
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await page.waitForTimeout(1500);
 console.log('BUTTONS',(await page.locator('button:visible').allTextContents()).slice(0,15));
 const splash=page.getByRole('button',{name:/Buyer Log.a devam et|Continue to Buyer Log/i});if(await splash.count())await splash.click({timeout:30000});
 await page.locator('button[data-tab="cp"]').click();
 await page.waitForFunction(()=>typeof state!=='undefined'&&state.cp?.rows.length>0,null,{timeout:30000});
 await page.addLocatorHandler(page.locator('body'),()=>page.evaluate(()=>document.querySelectorAll('[data-rn-close]').forEach(button=>button.click())),{noWaitAfter:true});
 await page.evaluate(async()=>{await BLPerf.ensureFeature('testReportImport');await BLTestReportImport.open();});
 const result=await page.evaluate(async()=>{
  const Review=BLTestReportAssessment,cpRows=BLFormulaRows.cp(),decisions=BLCpAssistant.computeDecisionsForRows(cpRows);
  const cp=Review.cpSnapshot(cpRows,{keyOf:r=>decisions.byRow.get(r)?.orderKey,orderCodeOf:r=>BLCanonicalFields.value(r,'cp','orderCode'),checklistOf:r=>{const prefix=decisions.byRow.get(r)?.orderKey+'::';return Object.entries(BLCpAssistant._state.answers).filter(([key])=>key.startsWith(prefix)).map(([key,answer])=>({itemId:key.slice(prefix.length),answer}));}});
  cp.rows[0].fields.Priority='CRITICAL';
  const parsed=await(await fetch('/api/test-reports/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[{name:'Demo.eml',base64:btoa('From: lab@example.test\r\nSubject: Test\r\n\r\nReport DEMO-2026-01 Order 4100001 FABRIC Fail')} ]})})).json();
  const r=await fetch('/api/test-reports/prepare-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:parsed.sessionId,cp})});
  return {status:r.status,body:await r.json(),cp};
 });
 fs.writeFileSync(path.join(root,'baseline.json'),JSON.stringify(result,null,2));
 assert.equal(result.status,200,JSON.stringify(result.body));
 const mail=Buffer.from('From: lab@example.test\r\nTo: buyer@example.test\r\nSubject: Demo test result\r\nDate: Tue, 3 Nov 2026 10:00:00 +0300\r\n\r\nReport DEMO-2026-01 Order 4100001 FABRIC Fail');
 await page.locator('[data-tr-close]').first().click();
 await page.evaluate(base64=>{
  const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],'Demo.eml',{type:'message/rfc822'}));
  document.querySelector('#cpTable').dispatchEvent(new DragEvent('dragenter',{dataTransfer:dt,bubbles:true,cancelable:true}));
  const overlay=document.querySelector('.trDropOverlay');if(!overlay)throw Error('External CP drop overlay not bound');
  overlay.dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));
 },mail.toString('base64'));
 await page.waitForFunction(()=>BLTestReportImport._ui.session&&!BLTestReportImport._ui.busy&&['done','error'].includes(BLTestReportImport._ui.ai.state),null,{timeout:30000}).catch(async error=>{console.log('FAILED UI',await page.evaluate(()=>({busy:BLTestReportImport._ui.busy,session:BLTestReportImport._ui.session,ai:BLTestReportImport._ui.ai,toast:document.body.innerText.slice(-4000)})));await page.screenshot({path:path.join(root,'report-e2e-failed.png')});throw error;});
 const preview=await page.evaluate(()=>({state:BLTestReportImport._ui.ai.state,message:BLTestReportImport._ui.ai.message,entries:BLTestReportImport._ui.entries.map(entry=>({id:entry.id,included:entry.include,plan:BLTestReportImport._plan(entry)}))}));
 console.log('PREVIEW',JSON.stringify(preview));assert.equal(preview.state,'done');assert.equal(aiCalls,1);assert.ok(preview.entries.every(entry=>!entry.included));
 const before=await(await context.request.get(base+'/api/test-reports')).json();assert.equal(before.reports['DEMO-2026-01'],undefined);
 const assets=path.join(app,'public/release-notes/next-assets');fs.mkdirSync(assets,{recursive:true});
 await page.locator('[data-tr-include]').first().check();
 await page.screenshot({path:path.join(assets,'test-report-ai-review.png')});
 await page.locator('[data-tr-commit]').click();
 await page.waitForFunction(()=>BLTestReportImport._ui.done!==null,null,{timeout:20000});
 const saved=await(await context.request.get(base+'/api/test-reports')).json();assert.ok(saved.reports['DEMO-2026-01']);
 const shared=await(await context.request.get(base+'/api/checklist-supplier')).json(),key=packet.cp.rows.find(row=>row.orderCode==='4100001').key;
 assert.equal(shared.answers[key+'::tests'].state,'rejected');assert.ok(shared.answers[key+'::tests'].attachments.length);
 const attachment=shared.answers[key+'::tests'].attachments[0];assert.equal((await context.request.get(base+'/api/checklist-supplier/attachments/'+attachment.id)).status(),200);
 assert.deepEqual(errors,[]);
 await page.locator('[data-tr-close]').first().click();mode='unresolved';
 await page.evaluate(()=>BLTestReportImport.open());
 const {fixture,pdfFromItems}=require(path.join(app,'tests/helpers/external-lab-fixture.cjs')),pdf=pdfFromItems(fixture());
 await page.locator('[data-tr-input]').setInputFiles([1,2].map(()=>({name:'Demo-lab.pdf',mimeType:'application/pdf',buffer:pdf})));
 await page.waitForFunction(()=>BLTestReportImport._ui.session&&!BLTestReportImport._ui.busy&&['done','error'].includes(BLTestReportImport._ui.ai.state),null,{timeout:30000});
 const retained=await page.evaluate(()=>({state:BLTestReportImport._ui.ai.state,reports:BLTestReportImport._ui.entries.map(entry=>entry.report.talepNo),sources:BLTestReportImport._ui.ai.packet?.sources.length,unresolved:BLTestReportImport._ui.ai.unresolved?.length}));
 assert.equal(retained.state,'done');assert.equal(retained.sources,1);assert.equal(retained.unresolved,1);assert.ok(retained.reports.includes('DEMSL260000124-A'));
 await page.screenshot({path:path.join(assets,'test-report-preserved-sources.png')});
 assert.equal((await(await context.request.get(base+'/api/test-reports')).json()).reports['DEMSL260000124-A'],undefined);
 fs.writeFileSync(path.join(work,'report-e2e-results.json'),JSON.stringify({cpOverlayAccepted:result.status===200,externalDrop:true,aiBoundary:'stubbed HTTP status/upload/ask; production UI, parser, server review validator, store and checklist routes',aiCalls,uploads,unselectedBeforeApproval:true,reportSaved:true,checklistState:shared.answers[key+'::tests'].state,attachmentAccessible:true,duplicatePdfSources:retained.sources,parserReportPreservedWhenUnresolved:true,pageErrors:errors},null,2));
 console.log('SUCCESS: intake → shared AI HTTP client → source validation → explicit approval → report + checklist + attachment');
 console.log('RUNTIME',root);
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();child.kill();log.end();});
