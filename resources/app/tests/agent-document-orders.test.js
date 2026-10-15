'use strict';
/* Paydaş belgeleri (karışık Excel, e-posta, PDF, ekran görüntüsü) siparişlerle
   eşlenir ve riskleri kanonik CP tarihleriyle hesaplanır. LCW AI yalnız satır
   çıkarır; eşleme ve risk Buyer Log'dadır. LCW AI burada sahte bir motordur. */
const test=require('node:test'),assert=require('node:assert/strict');
const Docs=require('../server/lib/agent-document-orders');
const ExcelJS=require('../public/vendor/exceljs.min.js');
const d=iso=>Docs.ordinalOf(iso);
const orders=[
  {orderCode:'7300001',plmId:'100001',modelName:'DEMO KAZAK',colourCode:'C1',colour:'NAVY',quantity:1200,plannedLoadDate:d('2026-11-20'),latestSafeLoadDate:d('2026-11-28'),targetType:'retail',targetDate:d('2026-12-20')},
  {orderCode:'7300002',plmId:'100002',modelName:'DEMO HIRKA',colourCode:'C2',colour:'RED',quantity:800,plannedLoadDate:d('2026-11-10'),latestSafeLoadDate:d('2026-12-15'),targetType:'retail',targetDate:d('2027-01-10')},
  {orderCode:'7300003',plmId:'100003',modelName:'DEMO TSHIRT',colourCode:'C3',colour:'WHITE',quantity:500,plannedLoadDate:d('2026-12-01'),latestSafeLoadDate:d('2026-12-08')},
  {orderCode:'7300004',plmId:'100004',modelName:'DEMO PIJAMA',colourCode:'C4',colour:'BLUE',quantity:300,plannedLoadDate:d('2026-11-15'),latestSafeLoadDate:d('2026-11-30')},
  {orderCode:'7300005',plmId:'100004',modelName:'DEMO PIJAMA',colourCode:'C4',colour:'BLUE',quantity:300,plannedLoadDate:d('2026-11-15'),latestSafeLoadDate:d('2026-11-30')}];

test('rows match by order code, then PLM + colour, then model + colour; ambiguous and unknown rows stay unmatched',()=>{
  const rows=Docs.parseRows({rowsJson:JSON.stringify([
    {orderCode:'PO 7300001',requestedExFactory:'2026-12-05',currentExFactory:'2026-11-20'},
    {plmId:'100002',colourCode:'c2',requestedExFactory:'2026-11-17'},
    {model:'Demo Tshirt',colour:'white',requestedExFactory:'2026-12-05'},
    {plmId:'100004',colourCode:'C4',requestedExFactory:'2026-11-20'},
    {orderCode:'9999999',requestedExFactory:'2026-12-01'}])});
  const result=Docs.evaluate(rows,orders);
  assert.deepEqual(result.rows.map(r=>[r.match,r.orderCode,r.risk]),[['order-code','7300001','high'],['plm-colour','7300002','low'],['model-colour','7300003','medium'],['ambiguous','',"unmatched"],['none','9999999','unmatched']]);
  assert.deepEqual([result.rows[0].shiftDays,result.rows[0].slackDays,result.rows[0].latestSafeLoad],[15,-7,'2026-11-28'],'requested date after the latest safe load is high risk');
  assert.deepEqual(result.rows[3].candidates,['7300004','7300005'],'two candidates are never guessed');
  assert.deepEqual(result.totals,{rows:5,matched:3,ambiguous:1,unmatched:1,high:1,medium:1,low:1,unknown:0});
  assert.match(Docs.compactSummary(result),/1\|7300001\|DEMO KAZAK\|C1\|2026-11-20→2026-12-05\|\+15d\|safe 2026-11-28\|high\|order-code\|safe-load/);
  assert.deepEqual(Docs.evaluate(Docs.parseRows({rowsJson:JSON.stringify([{orderCode:'7300001',requestedExFactory:'2026-12-10'}])}),[{...orders[0],latestSafeLoadDate:null}]).rows.map(r=>[r.risk,r.basis]),[['high','shift']],'without a safe load date the shift decides and says so');
});

test('a messy workbook is turned into a local table; only text reaches LCW AI, images go as files',async()=>{
  const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Revize');
  sheet.getCell('A1').value='DEMO TEKSTIL - EX FACTORY REVIZE TALEBI';sheet.getRow(3).values=['PO NO','MODEL','RENK','QTY','ESKI EXF','YENI EXF'];
  sheet.getRow(4).values=[7300001,'DEMO KAZAK','C1',1200,new Date(Date.UTC(2026,10,20)),'05.12.2026'];
  wb.addWorksheet('Gizli').state='hidden';
  const files=[{name:'DEMO-revize.xlsx',base64:Buffer.from(await wb.xlsx.writeBuffer()).toString('base64')},{name:'DEMO-ekran.png',base64:Buffer.from('PNGDATA').toString('base64')}];
  const calls=[];
  const engine={ask:async()=>{throw new Error('should upload');},askWithFiles:async(_o,input)=>{calls.push(input);return {structured:{ok:true},data:{kind:'ex-factory-revision',request:'Ex-factory 2 hafta ertelensin',sender:'DEMO TEKSTIL',summary:'DEMO',rowsJson:JSON.stringify([{orderCode:'7300001',requestedExFactory:'2026-12-05',currentExFactory:'2026-11-20'}])}};}};
  const result=await Docs.analyzeDocuments({id:'owner'},files,{engine,orders:async()=>orders});
  const table=calls[0].context.documents[0];
  assert.equal(table.kind,'table');assert.deepEqual(table.sheets.map(s=>s.sheet),['Revize'],'hidden sheets are skipped');
  assert.match(table.sheets[0].rows.join('\n'),/7300001 \| DEMO KAZAK \| C1 \| 1200 \| 2026-11-20 \| 05\.12\.2026/);
  assert.deepEqual(calls[0].files.map(f=>f.fileName),['DEMO-ekran.png']);
  assert.equal(result.totals.high,1);assert.equal(result.docKind,'ex-factory-revision');
  assert.equal(Docs.ordinalOf('05.12.2026'),Docs.ordinalOf('2026-12-05'),'day-first dates are read');
});

test('an e-mail body is read locally; invented or broken rows never become matches',async()=>{
  const eml=['From: DEMO Tedarikci <demo@example.com>','Subject: EXF revize','Content-Type: text/plain; charset=utf-8','','Merhaba, 7300002 siparisinin ex-factory tarihini 2026-11-17 olarak revize edebilir miyiz?'].join('\r\n');
  let seen;const engine={ask:async(_o,input)=>{seen=input.context.documents[0];return {structured:{ok:true},data:{kind:'ex-factory-revision',rowsJson:'not json'}};}};
  await assert.rejects(Docs.analyzeDocuments({id:'o'},[{name:'DEMO.eml',base64:Buffer.from(eml).toString('base64')}],{engine,orders:async()=>orders}),{code:'OFFICE_AI_CONTRACT_INVALID'});
  assert.equal(seen.kind,'mail');assert.match(seen.subject,/EXF revize/);assert.match(seen.text.join(''),/7300002/);
  await assert.rejects(Docs.analyzeDocuments({id:'o'},[{name:'DEMO.exe',base64:'AA=='}],{engine,orders:async()=>orders}),{code:'OFFICE_ATTACHMENT_TYPE'});
});
