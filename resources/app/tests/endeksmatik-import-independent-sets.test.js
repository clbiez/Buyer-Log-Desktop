'use strict';
// Uploading a structurally valid TL workbook must never mutate the original
// legacy snapshot, while preserving USD signature/reconciliation protections.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const XLSX=require('xlsx');

const root=fs.mkdtempSync(path.join(os.tmpdir(),'bl-em-independent-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT=root;
const engine=require('../server/lib/endeksmatik');
const model=require('../server/lib/endeksmatik-model');
const fixture=require('./helpers/endeksmatik-fixture');

function workbook(season='S1'){
  const wb=XLSX.utils.book_new();
  const dims=['CUW4','CU4E','KNIT','LICENSE','TOP'];
  const header=[];
  ['Merch Marka Yaş Grup','Merch Alt Grup','Tedarik Grup','Buyer Grup','Klasman'].forEach((h,i)=>{header[i+1]=h;});
  const screen=XLSX.utils.aoa_to_sheet([]);
  screen['!ref']='B1:C22';
  screen.C1={t:'s',v:season};
  screen.C2={t:'n',v:46000};
  screen.B22={t:'n',v:0.03};
  XLSX.utils.book_append_sheet(wb,screen,'ENDEKSMATİK');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([header,[null,...dims,.4,.3,.2,.1]]),'KLASMAN LİSTESİ ÖZET');
  const pivotHeader=[...header];pivotHeader[6]='Toplam 202501';pivotHeader[7]='Toplam 202502';
  for(const name of ['KLASMAN KUMAŞ PİVOT','KLASMAN CMT PİVOT','KLASMAN AKSESUAR PİVOT','KLASMAN EK İŞLEM PİVOT']){
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([pivotHeader,[null,...dims,100,110]]),name);
  }
  const rate1=[],rate2=[];
  rate1[21]='202501';rate1[22]=30;
  rate2[21]='202502';rate2[22]=31;
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([rate1,rate2]),'Değişimler');
  return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
const input={
  mmyg:'CUW4',mag:'CU4E',supplyGroup:'KNIT',buyingGroup:'LICENSE',category:'TOP',
  previousOrderMonth:'202501',previousInStoreMonth:'202501',
  newOrderMonth:'202502',newInStoreMonth:'202502',previousUsdPrice:2.75,
};

test('new TL uploads create distinct selectable sets and preserve original legacy',async()=>{
  const before=engine.listSets().find(s=>s.id==='legacy');
  const first=await engine.importWorkbookBuffer(workbook('S1'),'legacy-a.xlsx',{actor:'qa'});
  assert.equal(first.uploaded.model,'legacy-tl');
  assert.match(first.uploaded.id,/^em-[0-9a-f]{16}$/);
  assert.equal(first.uploaded.recordCount,1);
  assert.equal(first.activeSetId,first.uploaded.id);
  assert.equal(first.uploaded.uploadedBy,'qa');
  const out=engine.calculate({...input,setId:first.uploaded.id});
  assert.equal(out.source.setId,first.uploaded.id);
  assert.equal(out.source.setVersion,first.uploaded.version);
  assert.equal(out.source.model,'legacy-tl');
  assert.ok(Number.isFinite(out.prices.usd));
  assert.deepEqual(engine.lookup({...input,setId:first.uploaded.id}).levels,[]);

  const second=await engine.importWorkbookBuffer(workbook('S2'),'legacy-b.xlsx');
  assert.notEqual(second.uploaded.id,first.uploaded.id);
  assert.equal(engine.listSets().filter(s=>s.model==='legacy-tl').length,3);
  assert.equal(engine.listSets().find(s=>s.id==='legacy').version,before.version);
  assert.equal(engine.listSets().find(s=>s.id==='legacy').sourceFile,before.sourceFile);

  const renamed=await engine.renameSet(first.uploaded.id,'First TL workbook');
  assert.equal(renamed.label,'First TL workbook');
  const again=await engine.importWorkbookBuffer(workbook('S1'),'same.xlsx');
  assert.equal(again.alreadyPresent,true);
  assert.equal(again.uploaded.id,first.uploaded.id);
  assert.equal(again.uploaded.label,'First TL workbook');
  assert.equal(engine.listSets().length,3);
  await engine.deleteSet(first.uploaded.id);
  assert.equal(engine.listSets().length,2);
  assert.ok(engine.listSets().some(s=>s.id==='legacy'));
});

test('rejected upload leaves every existing set untouched',async()=>{
  const before=engine.listSets().map(s=>[s.id,s.version]);
  await assert.rejects(()=>engine.importWorkbookBuffer(Buffer.from('not an excel'),'broken.xlsx'));
  assert.deepEqual(engine.listSets().map(s=>[s.id,s.version]),before);
  await assert.rejects(
    ()=>engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook({breakFormula:'depot'}),'modified-usd.xlsx'),
    err=>err.code==='MODEL_SIGNATURE_MISMATCH');
  assert.deepEqual(engine.listSets().map(s=>[s.id,s.version]),before);
});

test('USD files still receive strict signature and Excel reconciliation checks',async()=>{
  const result=await engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook(),'bd.xlsx');
  assert.equal(result.uploaded.model,model.MODEL_ID);
  assert.ok(result.uploaded.validation.signatureOk);
  assert.ok(result.uploaded.validation.reconciliationOk);
  const again=await engine.importWorkbookBuffer(fixture.buildEndeksmatikWorkbook(),'bd.xlsx');
  assert.equal(again.alreadyPresent,true);
  assert.equal(again.uploaded.id,result.uploaded.id);
});
test('UI uses readable, bilingual import stages and removes busy state after failure',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../public/design.css'),'utf8');
  assert.match(app,/function createEndeksmatikUploadProgress\\(file\\)/);
  assert.match(app,/reader\\.onprogress=/);
  assert.match(app,/progress\\.setStage\\('verify'\\)/);
  assert.match(app,/progress\\.remove\\(\\)/);
  assert.match(app,/endeksmatikImportBusy=false/);
  assert.match(app,/data-em-phase="read"/);
  assert.match(app,/data-em-phase="verify"/);
  assert.match(app,/data-em-phase="finish"/);
  assert.match(app,/Bağımsız TL seti oluşturuldu/);
  assert.match(css,/\\.endeksmatikImportOverlay/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
