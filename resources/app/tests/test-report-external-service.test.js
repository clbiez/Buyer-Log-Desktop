'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-external-lab-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const X=require('../server/lib/test-reports/extract'),E=require('../public/test-report-engine'),store=require('../server/lib/test-reports/store');
const {createService}=require('../server/lib/test-reports/service');
const {fixture,pdfFromItems}=require('./helpers/external-lab-fixture.cjs');
const profile={id:'demo',displayName:'Demo Buyer'},service=createService({authorizedOrders:async()=>new Map([['po1',{orderCode:'4100001'}]])});
function mail(pdf){return Buffer.from(['From: supplier@example.test','To: buyer@example.test','Subject: Demo GS TEST REPORT','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="demo"','','--demo','Content-Type: text/plain; charset=utf-8','','Herewith enclosed DEMO,KNIT-8YD (4100001) GS TEST report for your approval.','--demo','Content-Type: application/pdf; name="Demo-lab.pdf"','Content-Disposition: attachment; filename="Demo-lab.pdf"','Content-Transfer-Encoding: base64','',pdf.toString('base64'),'--demo--',''].join('\r\n'));}
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
test('real PDF extraction and MIME intake read external IDs, preserve parent evidence and deduplicate separate drops',async()=>{
  const pdf=pdfFromItems(fixture()),buffer=mail(pdf);
  const out=await X.processFiles([{name:'Demo.eml',buffer},{name:'Demo-lab.pdf',buffer:pdf}]);
  assert.equal(out.reports.length,1);assert.equal(out.reports[0].talepNo,'DEMSL260000124-A');
  assert.equal(out.reports[0].siparisKodu,'4100001');assert.equal(out.reports[0].modelAdi,'DEMO,KNIT-8YD');
  assert.equal(out.reports[0].talepTipi,'Gold Seal');assert.equal(out.reports[0].raporTarihiIso,'2026-10-17');
  assert.equal(out.reports[0].testler.length,2);assert.equal(E.reportOutcome(out.reports[0]).code,'pass');
  assert.deepEqual(out.reports[0].dosyalar.map(f=>f.tur).sort(),['eml','pdf']);
  assert.equal(out.files[0].reading.reports,1);assert.equal(out.files[0].reading.pdfPages,3);assert.equal(out.files[0].reading.attachments,1);
  assert.equal(out.files[0].reading.status,'text');assert.equal(out.files[0].sources[1].parentId,out.files[0].sources[0].id);
  assert.equal(out.files[0].sources[1].hash,out.files[0].sources[0].attachments[0].hash);
});
test('external reference survives preview and commit without AI; business records change only on confirmation',async()=>{
  const parsed=await service.parse(profile,[{name:'Demo.eml',base64:mail(pdfFromItems(fixture())).toString('base64')}]);
  assert.equal(parsed.files[0].reading.tests,2);assert.equal(store.read().revision,0);
  await assert.rejects(service.commit(profile,{sessionId:parsed.sessionId,items:[{talepNo:'DEMSL260000124-A',orderKey:'forbidden',itemId:'tests'}]}),{code:'TEST_REPORT_ORDER_FORBIDDEN'});
  const result=await service.commit(profile,{sessionId:parsed.sessionId,items:[{talepNo:'DEMSL260000124-A',orderKey:'po1',itemId:'tests'}]});
  assert.equal(result.results.length,1);assert.equal(result.results[0].attachments.length,2);
  assert.ok(store.read().reports['DEMSL260000124-A']);assert.equal(store.read().links['DEMSL260000124-A'].orderKey,'po1');
});
test('partially scanned PDF keeps a parsed summary but cannot imply approval',async()=>{
  const items=fixture().filter(item=>item.p!==3);items.push({p:3,x:25,y:770,w:0,s:''});
  const result=await X.processFile({name:'Partly-scanned.pdf',buffer:pdfFromItems(items)});
  assert.equal(result.reports[0].talepNo,'DEMSL260000124-A');assert.equal(result.sources[0].complete,false);
  assert.ok(result.reports[0].uyarilar.some(w=>w.code==='incompleteDocument'));
  assert.equal(E.reportOutcome(result.reports[0]).code,'pending');
});
