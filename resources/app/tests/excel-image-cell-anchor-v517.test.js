'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const ExcelJS=require(path.join(ROOT,'public','vendor','exceljs.min.js'));
const JSZip=require(path.join(ROOT,'public','vendor','jszip.min.js'));

function helperFactory(){
  const a=APP.indexOf('function kolExcelImageAnchorBox(');
  const b=APP.indexOf('async function kolPrepareExcelImage',a);
  assert.ok(a>=0&&b>a,'Excel image anchor helper must exist');
  const source=APP.slice(a,b);
  return new Function(`const KOL_IMAGE_EXCEL_PADDING_PX=2;\n${source}\nreturn {kolExcelImageAnchorBox,kolExcelImageTwoCellPlacement};`)();
}

test('v5.18 image anchor fits proportionally, centers in the cell and locks aspect ratio',()=>{
  const {kolExcelImageAnchorBox,kolExcelImageTwoCellPlacement}=helperFactory();
  const box=kolExcelImageAnchorBox(1200,800,100,50,2);
  assert.ok(Math.abs(box.width/box.height-1.5)<1e-9,'aspect ratio must be preserved');
  assert.ok(Math.abs(box.left-(100-box.width)/2)<1e-9,'image must be horizontally centered');
  assert.ok(Math.abs(box.top-(50-box.height)/2)<1e-9,'image must be vertically centered');
  const placement=kolExcelImageTwoCellPlacement({width:1200,height:800},4,100,50,3,2);
  // placement artık açık bir editAs alanı taşımıyor (yalnız {tl,ext}) — ExcelJS br
  // verilmediğinde zaten oneCellAnchor+editAs="oneCell" üretiyor; bu gerçek OOXML
  // çıktısı üzerinden aşağıdaki testte (satır ~46) doğrulanıyor.
  assert.equal(placement.tl.nativeCol,2);
  assert.equal(placement.tl.nativeRow,3);
  assert.ok(placement.tl.nativeColOff>=0&&placement.tl.nativeRowOff>=0);
  assert.ok(Math.abs(placement.ext.width/placement.ext.height-1.5)<1e-9);
});

test('v5.18 ExcelJS serializes Buyer Log image anchors as one-cell OOXML with aspect lock',async()=>{
  const {kolExcelImageTwoCellPlacement}=helperFactory();
  const wb=new ExcelJS.Workbook(),ws=wb.addWorksheet('Images');
  ws.getColumn(1).width=14;ws.getRow(1).height=48;
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7mQAAAAASUVORK5CYII=';
  const imageId=wb.addImage({base64:png,extension:'png'});
  ws.addImage(imageId,kolExcelImageTwoCellPlacement({width:1200,height:800},1,103,64,1,2));
  const buffer=await wb.xlsx.writeBuffer();
  const zip=await JSZip.loadAsync(Buffer.from(buffer));
  const xml=await zip.file('xl/drawings/drawing1.xml').async('string');
  assert.match(xml,/<xdr:oneCellAnchor editAs="oneCell">/);
  assert.match(xml,/<a:picLocks noChangeAspect="1"\/>/);
  assert.match(xml,/<xdr:ext cx="\d+" cy="\d+"\/>/);
  assert.doesNotMatch(xml,/<xdr:twoCellAnchor/);
});
