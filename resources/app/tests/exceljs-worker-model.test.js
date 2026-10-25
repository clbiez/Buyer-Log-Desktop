'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Policy=require('../public/file-parser-policy'),ExcelJS=require('../public/vendor/exceljs.min');
test('ExcelJS worker results are bounded again before the main thread receives a model',()=>{
 const model={worksheets:[{name:'Demo',rows:[{number:1,cells:[{address:'A1',value:'safe'}]}]}]};assert.equal(Policy.inspectExcelJsModel(model),model);model.worksheets[0].rows[0].number=Policy.LIMITS.rows+1;assert.throws(()=>Policy.inspectExcelJsModel(model),{code:'FILE_PARSE_LIMIT'});
 model.worksheets[0].rows[0].number=1;model.worksheets[0].rows[0].cells[0].address='XFD1';assert.throws(()=>Policy.inspectExcelJsModel(model),{code:'FILE_PARSE_LIMIT'});
});
test('merge ranges outside a small SheetJS data range are rejected before ExcelJS expands them',()=>{
 const book={SheetNames:['Demo'],Sheets:{Demo:{'!ref':'A1','!merges':[{s:{r:0,c:0},e:{r:99,c:25}}]}}};
 assert.throws(()=>Policy.inspectWorkbook(book,{...Policy.LIMITS,rows:50,cells:1000}),{code:'FILE_PARSE_LIMIT'});
 assert.equal(Policy.inspectWorkbook(book),book);
});
test('structured workbook models retain dates, styles, formulas, zero cache and PNG bytes on roundtrip',async()=>{
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Demo');sheet.getCell('A1').value='00123';sheet.getCell('B1').value={formula:'1-1',result:0};sheet.getCell('C1').value=new Date('2026-10-25T00:00:00Z');sheet.getCell('C1').numFmt='dd.mm.yyyy';sheet.getCell('A1').font={bold:true};const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=','base64');const imageId=book.addImage({buffer:image,extension:'png'});sheet.addImage(imageId,{tl:{col:0,row:2},ext:{width:10,height:10}});
 const original=await book.xlsx.writeBuffer(),read=new ExcelJS.Workbook();await read.xlsx.load(original);const clone=new ExcelJS.Workbook();clone.model=Policy.inspectExcelJsModel(structuredClone(read.model));const bytes=await clone.xlsx.writeBuffer(),again=new ExcelJS.Workbook();await again.xlsx.load(bytes);const out=again.getWorksheet('Demo');assert.equal(out.getCell('A1').value,'00123');assert.equal(out.getCell('A1').font.bold,true);assert.equal(out.getCell('B1').formula,'1-1');assert.equal(out.getCell('B1').result,0);assert.equal(out.getCell('C1').value.toISOString(),'2026-10-25T00:00:00.000Z');assert.equal(out.getCell('C1').numFmt,'dd.mm.yyyy');assert.equal(Buffer.compare(Buffer.from(again.model.media[0].buffer),image),0);
});
test('untrusted browser ExcelJS entry points use the bounded worker rather than main-thread ZIP parsing',()=>{
 for(const file of ['checklist-supplier-sync.js','pricing-desk.js','excel-templates.js']){const source=fs.readFileSync(path.join(__dirname,'../public',file),'utf8');assert.doesNotMatch(source,/\.xlsx\.load\(/,file);assert.match(source,/BLFileParser\.readExcelJsModel/,file);}
});
