'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),XLSX=require('xlsx');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-em-tl-contract-'));process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const engine=require('../server/lib/endeksmatik'),fixture=require('./helpers/endeksmatik-tl-fixture'),usd=require('./helpers/endeksmatik-fixture');
const input={mmyg:'CUW4',mag:'CU4E',supplyGroup:'KNIT',buyingGroup:'LICENSE',category:'TOP',previousOrderMonth:'202501',previousInStoreMonth:'202501',newOrderMonth:'202502',newInStoreMonth:'202502',previousTryPrice:100,previousUsdPrice:10};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
for(const layout of ['s7','w6']){
 test(`${layout} TL formulas identify the model and reproduce all-component adjustment, FX and provenance`,async()=>{
  const bytes=fixture.buildLegacyTlWorkbook({layout,date:layout==='w6'?'15.10.2026':46000}),parsed=engine.parseImportWorkbook(bytes,layout+'.xlsx');
  assert.equal(parsed.model,'legacy-tl');assert.equal(parsed.snapshot.calculationContract,'endeksmatik-tl-workbook/v1');assert.equal(parsed.snapshot.validation.signature.ok,true);assert.equal(parsed.snapshot.validation.reconciliation.ok,true);
  if(layout==='w6')assert.equal(parsed.snapshot.sourceUpdatedAt,'2026-10-15');
  const result=await engine.importWorkbookBuffer(bytes,layout+'.xlsx');
  const out=engine.calculate({...input,setId:result.uploaded.id});
  close(out.indexes.targetTl,.067);close(out.indexes.targetUsd,1.1/(31/30)*.97-1);close(out.prices.try,106.7);close(out.prices.usd,10*1.1/(31/30)*.97);
  assert.equal(out.source.calculationContract,'endeksmatik-tl-workbook/v1');assert.equal(out.source.layout,layout);assert.equal(out.source.fxPolicy,'exact-depot-month');
 });
 test(`${layout} altered TL calculation or cached numeric result cannot be accepted as a different model`,()=>{
  for(const change of ['formula','cache','missing-month']){
   const wb=XLSX.read(fixture.buildLegacyTlWorkbook({layout}),{type:'buffer'}),cell=wb.Sheets['ENDEKSMATİK']['C'+(layout==='w6'?17:16)];
   if(change==='formula')cell.f+='*1.5';else if(change==='cache')cell.v+=.1;else wb.Sheets['ENDEKSMATİK']['C'+(layout==='w6'?9:8)]={t:'n',v:199901};
   assert.throws(()=>engine.parseImportWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'changed.xlsx'),e=>['MODEL_SIGNATURE_MISMATCH','MODEL_RECONCILIATION_FAILED'].includes(e.code));
  }
 });
}
test('erasing USD output formulas does not authorize a legacy fallback while the remaining USD controls survive',()=>{
 const wb=XLSX.read(usd.buildEndeksmatikWorkbook({breakFormula:'depot',repeatLabels:true}),{type:'buffer'}),screen=wb.Sheets['ENDEKSMATİK'];
 screen.C1={t:'s',v:'Forged legacy season'};screen.C2={t:'n',v:46000};
 for(const address of ['C15','C16','C17','C18','C19'])delete screen[address].f;
 usd.MONTHS.forEach((month,i)=>{wb.Sheets['Değişimler']['V'+(i+2)]={t:'n',v:Number(month)};wb.Sheets['Değişimler']['W'+(i+2)]={t:'n',v:30+i*2};});
 assert.throws(()=>engine.parseImportWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'erased-usd.xlsx'),e=>e.code==='MODEL_SIGNATURE_MISMATCH');
});
test('a malformed source metadata date remains unknown while a complete TL formula contract can still be verified',()=>{
 const parsed=engine.parseImportWorkbook(fixture.buildLegacyTlWorkbook({layout:'w6',date:'15.10..2026'}),'unknown-date.xlsx');
 assert.equal(parsed.snapshot.sourceUpdatedAt,'');assert.equal(parsed.snapshot.validation.signature.ok,true);assert.ok(parsed.snapshot.validation.warnings.some(value=>value.includes('freshness was not verified')));
});
test('historical legacy snapshots retain their calculation behavior rather than being silently migrated',()=>{
 const parsed=engine.parseImportWorkbook(fixture.buildLegacyTlWorkbook(),'new.xlsx'),snapshot=JSON.parse(JSON.stringify(parsed.snapshot));
 delete snapshot.calculationContract;
 const record=snapshot.records[0],runtime={snapshot,byKey:new Map([[engine.keyOf(record.slice(0,5)),record]]),byNoSupply:new Map(),monthIndex:new Map(snapshot.months.map((m,i)=>[m,i]))};
 const old=engine.calculateLegacy(input,runtime);
 close(old.indexes.targetTl,.0769);
 assert.equal(old.source.calculationContract,'legacy-v602');
});
test('source metadata uses strict date-only parsing, including leap days and the Excel 1904 date system',()=>{
 const leap=engine.parseImportWorkbook(fixture.buildLegacyTlWorkbook({date:'29.02.2024'}),'leap.xlsx');assert.equal(leap.snapshot.sourceUpdatedAt,'2024-02-29');
 const invalid=engine.parseImportWorkbook(fixture.buildLegacyTlWorkbook({date:'29.02.2025'}),'invalid-date.xlsx');assert.equal(invalid.snapshot.sourceUpdatedAt,'');
 const wb=XLSX.read(fixture.buildLegacyTlWorkbook(),{type:'buffer'});wb.Workbook=wb.Workbook||{};wb.Workbook.WBProps={...(wb.Workbook.WBProps||{}),date1904:true};
 const out=engine.parseImportWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'1904.xlsx');
 assert.equal(out.snapshot.sourceUpdatedAt,new Date(Date.UTC(1904,0,1)+46000*86400000).toISOString().slice(0,10));
});
test('formula string literals retain significant spaces and cannot be normalized into a different lookup',()=>{
 const wb=XLSX.read(fixture.buildLegacyTlWorkbook(),{type:'buffer'});wb.Sheets['ENDEKSMATİK'].C16.f=wb.Sheets['ENDEKSMATİK'].C16.f.replace('"Toplam "','"Toplam"');
 assert.throws(()=>engine.parseImportWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'changed-lookup.xlsx'),e=>e.code==='MODEL_SIGNATURE_MISMATCH');
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
