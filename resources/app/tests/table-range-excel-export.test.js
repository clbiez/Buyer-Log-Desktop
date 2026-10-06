'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');
const ExcelJS=require('../public/vendor/exceljs.min.js'),JSZip=require('../public/vendor/jszip.min.js');
test('managed Excel rows are lazy and contain the full source even when only 50 rows are visible',()=>{
 const a=APP.indexOf('function* managedExcelExportRows('),b=APP.indexOf('async function exportStyledDomTable',a);
 let allocated=0,computed=0;
 const document={createElement(){allocated++;return{dataset:{},children:[{dataset:{}}]};}};
 const rows=Array.from({length:33000},(_,i)=>({_id:i,value:`order-${i}`}));
 const generator=new Function('document','cellHtml','ordersCellHtml',`${APP.slice(a,b)};return managedExcelExportRows;`)(document,(col,row)=>row.value,(col,row)=>row.value);
 const exportRows=generator(rows,'orders',[{k:'Order Code'}],row=>{computed++;return{value:row.value};});
 assert.equal(allocated,0);const first=exportRows.next().value;assert.equal(allocated,1);assert.equal(first.dataset.id,'0');assert.equal(first.innerHTML,'order-0');
 let last=first,count=1;for(const row of exportRows){count++;last=row;}
 assert.equal(count,33000);assert.equal(computed,33000);assert.equal(last.dataset.id,'32999');assert.equal(last.children[0].dataset.key,'Order Code');
 const selected=[...generator(rows,'orders',[{k:'Order Code'}],null,new Set([32999]))];
 assert.equal(selected.length,1);assert.equal(selected[0].dataset.id,'32999');
 const block=APP.slice(b,APP.indexOf('async function exportCpTableWithLightTheme',b));
 assert.match(block,/managedRecords\s*\?managedExcelExportRows/);
 assert.match(block,/managedRecords\|\|candidateRows\.some/,'off-page checkbox selection must not fall back to exporting everything');
 assert.match(block,/exported%100===0/,'large exports yield so the UI can repaint');
});
test('move and size anchors retain fitted image ratio, stay within their cell and serialize an aspect lock',async()=>{
 const a=APP.indexOf('function kolExcelImageAnchorBox('),b=APP.indexOf('async function kolPrepareExcelImage',a);
 const placement=new Function(`const KOL_IMAGE_EXCEL_PADDING_PX=2;${APP.slice(a,b)};return kolExcelImageMoveAndSizePlacement;`)();
 const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Images');
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7mQAAAAASUVORK5CYII=';
 const media=wb.addImage({base64:png,extension:'png'});
 for(const [i,size] of [{width:1200,height:800},{width:400,height:900}].entries()){
  const anchor=placement(size,i+2,100,60,3,2),{tl,br}=anchor;
  assert.equal(tl.nativeCol,2);assert.equal(br.nativeCol,2);assert.equal(br.nativeRow,tl.nativeRow);
  assert.ok(Math.abs((br.nativeColOff-tl.nativeColOff)/(br.nativeRowOff-tl.nativeRowOff)-size.width/size.height)<0.00001);
  assert.ok(tl.nativeColOff>=0&&br.nativeColOff<=100*9525);assert.ok(br.nativeRowOff<=60*9525);
  ws.addImage(media,anchor);
 }
 const zip=await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
 const xml=await zip.file('xl/drawings/drawing1.xml').async('string');
 assert.equal((xml.match(/<xdr:twoCellAnchor editAs="twoCell">/g)||[]).length,2);
 assert.equal((xml.match(/noChangeAspect="1"/g)||[]).length,2);
 assert.doesNotMatch(xml,/<xdr:oneCellAnchor/);assert.equal(Object.keys(zip.files).filter(name=>/^xl\/media\/image\d+\.png$/.test(name)).length,1);
});
