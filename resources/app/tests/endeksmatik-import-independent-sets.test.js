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
  return require('./helpers/endeksmatik-tl-fixture').buildLegacyTlWorkbook({season});
}
const input={
  mmyg:'CUW4',mag:'CU4E',supplyGroup:'KNIT',buyingGroup:'LICENSE',category:'TOP',
  previousOrderMonth:'202501',previousInStoreMonth:'202501',
  newOrderMonth:'202502',newInStoreMonth:'202502',previousUsdPrice:2.75,
};

test('legacy TL fixed columns do not shift when the workbook used range starts after A',async()=>{
  // SheetJS 0.20.x writes dimensions starting at A1. Set the actual OOXML
  // dimension so this remains a real offset-input regression, independent of
  // the fixture writer's normalization policy.
  async function declaredRanges(bytes,ranges){
    const zip=await require('../public/vendor/jszip.min.js').loadAsync(bytes),names=XLSX.read(bytes,{type:'buffer',bookSheets:true}).SheetNames;
    for(const [name,range] of Object.entries(ranges)){const file='xl/worksheets/sheet'+(names.indexOf(name)+1)+'.xml';zip.file(file,(await zip.file(file).async('string')).replace(/<dimension ref="[^"]*"\/>/,'<dimension ref="'+range+'"/>'));}
    return zip.generateAsync({type:'nodebuffer'});
  }
  const decoded=XLSX.read(await declaredRanges(workbook('OFFSET'),{'Değişimler':'V3:W4'}),{type:'buffer'});
  assert.match(decoded.Sheets['Değişimler']['!ref'],/^V/);
  // The existing fixture already reproduces the V:W currency table offset.
  // Also exercise legitimate sheets whose unused column A is excluded from
  // the declared range instead of relying on the writer's A1 default.
  for(const name of ['KLASMAN LİSTESİ ÖZET','KLASMAN KUMAŞ PİVOT','KLASMAN CMT PİVOT','KLASMAN AKSESUAR PİVOT','KLASMAN EK İŞLEM PİVOT']){
    const sheet=decoded.Sheets[name],range=XLSX.utils.decode_range(sheet['!ref']);range.s.c=1;sheet['!ref']=XLSX.utils.encode_range(range);
  }
  const ranges=Object.fromEntries(Object.entries(decoded.Sheets).map(([name,sheet])=>[name,sheet['!ref']]));
  const bytes=await declaredRanges(XLSX.write(decoded,{type:'buffer',bookType:'xlsx'}),ranges);
  assert.match(XLSX.read(bytes,{type:'buffer'}).Sheets['KLASMAN LİSTESİ ÖZET']['!ref'],/^B/);
  const snapshot=engine.parseWorkbookBuffer(bytes,'offset.xlsx');
  assert.deepEqual(snapshot.months,['202501','202502']);
  assert.deepEqual(snapshot.fx,{'202501':30,'202502':31});
  assert.deepEqual(snapshot.records[0].slice(0,9),['CUW4','CU4E','KNIT','LICENSE','TOP',.4,.3,.2,.1]);
  assert.deepEqual(snapshot.records[0].slice(9),[[100,110],[100,110],[100,110],[100,110]]);
  // A previously populated identifier column must produce exactly the same
  // domain values; no financial formula is changed by origin normalization.
  for(const sheet of Object.values(decoded.Sheets)){
    sheet.A1={t:'s',v:'Synthetic reference'};
    const range=XLSX.utils.decode_range(sheet['!ref']);range.s.c=0;sheet['!ref']=XLSX.utils.encode_range(range);
  }
  const withA=engine.parseWorkbookBuffer(XLSX.write(decoded,{type:'buffer',bookType:'xlsx'}),'with-a.xlsx');
  assert.deepEqual(withA.records,snapshot.records);assert.deepEqual(withA.fx,snapshot.fx);
});

test('new TL uploads create distinct selectable sets and preserve original legacy',async()=>{
  const before=engine.listSets().find(s=>s.id==='legacy');
  const firstBytes=workbook('S1');
  const first=await engine.importWorkbookBuffer(firstBytes,'legacy-a.xlsx',{actor:'qa'});
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
  const again=await engine.importWorkbookBuffer(firstBytes,'same.xlsx');
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

test('a broken USD signature cannot downgrade through a second legacy FX table or forged legacy metadata',()=>{
  for(const forgedLegacyHeader of [false,true]){
    const wb=XLSX.read(fixture.buildEndeksmatikWorkbook({breakFormula:'depot',repeatLabels:true}),{type:'buffer'});
    fixture.MONTHS.forEach((month,i)=>{
      wb.Sheets['Değişimler'][`V${i+2}`]={t:'n',v:Number(month)};
      wb.Sheets['Değişimler'][`W${i+2}`]={t:'n',v:30+i*2};
    });
    if(forgedLegacyHeader){wb.Sheets['ENDEKSMATİK'].C1={t:'s',v:'Synthetic TL header'};wb.Sheets['ENDEKSMATİK'].C2={t:'n',v:46000};}
    assert.throws(()=>engine.parseImportWorkbook(XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),'ambiguous.xlsx'),error=>error.code==='MODEL_SIGNATURE_MISMATCH');
  }
});

test('a positively identified legacy TL layout still imports through the shared-sheet fallback',()=>{
  const result=engine.parseImportWorkbook(workbook('VALID LEGACY'),'valid-legacy.xlsx');
  assert.equal(result.model,'legacy-tl');assert.equal(result.snapshot.records.length,1);
  assert.deepEqual(result.snapshot.fx,{'202501':30,'202502':31});
});

test('USD files still receive strict signature and Excel reconciliation checks',async()=>{
  const usdBytes=fixture.buildEndeksmatikWorkbook();
  const result=await engine.importWorkbookBuffer(usdBytes,'bd.xlsx');
  assert.equal(result.uploaded.model,model.MODEL_ID);
  assert.ok(result.uploaded.validation.signatureOk);
  assert.ok(result.uploaded.validation.reconciliationOk);
  const again=await engine.importWorkbookBuffer(usdBytes,'bd.xlsx');
  assert.equal(again.alreadyPresent,true);
  assert.equal(again.uploaded.id,result.uploaded.id);
});
test('UI uses readable, bilingual import stages and removes busy state after failure',()=>{
  const app=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../public/design.css'),'utf8');
  assert.match(app,/function createEndeksmatikUploadProgress\(file\)/);
  assert.match(app,/reader\.onprogress=/);
  assert.match(app,/progress\.setStage\('verify'\)/);
  assert.match(app,/progress\.remove\(\)/);
  assert.match(app,/endeksmatikImportBusy=false/);
  assert.match(app,/data-em-phase="read"/);
  assert.match(app,/data-em-phase="verify"/);
  assert.match(app,/data-em-phase="finish"/);
  assert.match(app,/Bağımsız TL seti oluşturuldu/);
  assert.match(css,/\.endeksmatikImportOverlay/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
test.after(()=>{fs.rmSync(root,{recursive:true,force:true});});
