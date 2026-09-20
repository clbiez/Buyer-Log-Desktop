'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const ExcelJS=require(path.join(ROOT,'public','vendor','exceljs.min.js'));
const JSZip=require(path.join(ROOT,'public','vendor','jszip.min.js'));
function helperFactory(){
  const a=APP.indexOf('function kolExcelImageAnchorBox('),b=APP.indexOf('async function kolPrepareExcelImage',a);
  assert.ok(a>=0&&b>a);
  const src=APP.slice(a,b);
  return new Function(`const KOL_IMAGE_EXCEL_PADDING_PX=2;\n${src}\nreturn {kolExcelImageAnchorBox,kolExcelImageAspectLockedPlacement};`)();
}
test('v5.18 all primary UI image surfaces use contain instead of cover/stretch',()=>{
  assert.match(CSS,/#cpTable img\.cpThumb[\s\S]*object-fit:contain!important/);
  assert.match(CSS,/#ordersTable img\.cpThumb[\s\S]*object-fit:contain!important/);
  assert.match(CSS,/#kolTable img\.kolThumb[\s\S]*object-fit:contain!important/);
  assert.match(CSS,/\.qhPictureCell img[\s\S]*object-fit:contain!important/);
  assert.doesNotMatch(CSS,/\.qhPictureCell img\{[^}]*object-fit:cover/);
});
test('v5.18 clipboard and email HTML never stretch image width and height to 100 percent simultaneously',()=>{
  const copy=APP.slice(APP.indexOf('async function _copyCellFromTd'),APP.indexOf('function _copyEnsureRequiredRowsRendered'));
  assert.match(copy,/width:auto;height:auto/);
  assert.doesNotMatch(copy,/<img[^>]*style="[^"]*width:100%;height:100%/);
  const mail=APP.slice(APP.indexOf('async function prepareEmailTopicTableContent'),APP.indexOf('function prepareEmailTopicCell'));
  assert.match(mail,/width:\$\{a\.width\}px;height:\$\{a\.height\}px/);
  assert.doesNotMatch(mail,/width:100%;height:100%/);
});
test('v5.18 ExcelJS drawing is one-cell anchored and serializes noChangeAspect lock',async()=>{
  const {kolExcelImageAspectLockedPlacement}=helperFactory();
  const placement=kolExcelImageAspectLockedPlacement({width:1200,height:800},1,103,64,1,2);
  // placement artık açık bir editAs alanı taşımıyor (yalnız {tl,ext}) — ExcelJS br
  // verilmediğinde zaten oneCellAnchor+editAs="oneCell" üretiyor; bu aşağıdaki gerçek
  // OOXML çıktısı testinde doğrulanıyor.
  assert.ok(Math.abs(placement.ext.width/placement.ext.height-1.5)<1e-9);
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Images');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7mQAAAAASUVORK5CYII=';
  const id=wb.addImage({base64:png,extension:'png'});
  ws.addImage(id,placement);
  const buf=await wb.xlsx.writeBuffer(),zip=await JSZip.loadAsync(Buffer.from(buf));
  const xml=await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.match(xml,/<xdr:oneCellAnchor editAs="oneCell">/);
  assert.match(xml,/<a:picLocks noChangeAspect="1"\/>/);
  assert.match(xml,/<xdr:ext cx="\d+" cy="\d+"\/>/);
  assert.doesNotMatch(xml,/<xdr:twoCellAnchor/);
});
