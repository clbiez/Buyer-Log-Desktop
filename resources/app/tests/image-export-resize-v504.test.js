'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
function between(start,end){const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);assert.ok(a>=0,`${start} missing`);assert.ok(b>a,`${end} missing`);return APP.slice(a,b);}

test('v5.04 clipboard keeps original bitmap data and only controls presentation size',()=>{
  const loader=between('async function _copyImageDataUrl','// Panoya kopyalama sırasında');
  assert.match(loader,/reader\.readAsDataURL\(blob\)/);
  assert.doesNotMatch(loader,/canvas|drawImage|toDataURL/);
  const cell=between('async function _copyCellFromTd','function _copyEnsureRequiredRowsRendered');
  assert.match(cell,/width:auto;height:auto;max-width:100%;max-height:100%/);
  assert.doesNotMatch(cell,/<img[^>]*style="[^"]*width:100%;height:100%/);
  assert.match(cell,/width:\$\{cellWidth\}px;height:\$\{cellHeight\}px/);
});

test('dışarıya yapıştırılan görsel daralırken yüksekliğini otomatik oranlar, Excel ölçü özniteliklerini korur',()=>{
  const cell=between('async function _copyCellFromTd','function _copyEnsureRequiredRowsRendered');
  assert.match(cell,/width="\$\{width\}" height="\$\{height\}"/);
  assert.match(cell,/width:auto;height:auto;max-width:100%;max-height:100%/);
  assert.match(cell,/mso-data-placement:same-cell/);
});

test('clipboard görseli thumbnail kutusundan bağımsız olarak kaynak oranıyla hücreye sığdırılır',()=>{
  const helper=between('function _copyImageFitBox','async function _copyCellFromTd');
  assert.match(helper,/kolFitImageDimensions/);
  const natural=between('function _copyImageNaturalSize','async function _copyCellFromTd');
  assert.match(natural,/naturalWidth/);
  const cell=between('async function _copyCellFromTd','function _copyEnsureRequiredRowsRendered');
  assert.match(cell,/_copyImageFitBox\(/);
  assert.match(cell,/overflow:hidden/);
  assert.match(cell,/mso-data-placement:same-cell/);

  const fit=new Function(`function kolFitImageDimensions(naturalWidth,naturalHeight,maxWidth,maxHeight){
    const nw=Math.max(1,Number(naturalWidth)||1),nh=Math.max(1,Number(naturalHeight)||1);
    const mw=Math.max(1,Number(maxWidth)||1),mh=Math.max(1,Number(maxHeight)||1);
    const scale=Math.min(1,mw/nw,mh/nh); return {width:nw*scale,height:nh*scale};
  }\n${helper}\nreturn _copyImageFitBox;`)();
  const box=fit(1200,800,68,44,4);
  assert.ok(Math.abs(box.width/box.height-1.5)<1e-9);
  assert.ok(box.width<=64&&box.height<=40,'image must stay inside the cell content box');
});

test('v5.18 Excel images use native EMU one-cell anchors so aspect ratio cannot stretch',()=>{
  const placement=between('function kolExcelImageAspectLockedPlacement','function kolExcelImageTwoCellPlacement');
  assert.match(placement,/KOL_EXCEL_EMU_PER_PX/);
  assert.match(placement,/nativeColOff:emu\(box\.left\)/);
  assert.match(placement,/nativeRowOff:emu\(box\.top\)/);
  assert.match(placement,/ext:\{width:box\.width,height:box\.height\}/);
  assert.doesNotMatch(placement,/editAs:'oneCell'/);
  assert.doesNotMatch(placement,/nativeColOff:-emu\(right\)/);
  const cp=between('async function exportStyledDomTable','async function exportCpTableWithLightTheme');
  assert.match(cp,/kolExcelImageTwoCellPlacement\(image,entry\.row,cellWidth,cellHeight,entry\.col\+1,2\)/);
  assert.match(cp,/if\(Number\(entry\.cellWidth\)>0\)column\.width/);
  assert.match(cp,/if\(Number\(entry\.cellHeight\)>0\)row\.height/);
});

test('v5.04 unsupported image conversion preserves source pixel dimensions',()=>{
  const prep=between('async function kolPrepareExcelImage','function kolExcelImagePlacement');
  assert.match(prep,/outWidth=Math\.max\(1,Math\.round\(width\)\)/);
  assert.match(prep,/outHeight=Math\.max\(1,Math\.round\(height\)\)/);
  assert.doesNotMatch(prep,/maxDim=2400/);
});

test('v5.04 email CID payload keeps original resolution instead of thumbnail re-encoding',()=>{
  const asset=between('async function prepareEmailInlineAsset','async function prepareEmailTopicTableContent');
  assert.match(asset,/const dataUrl=prepared\.dataUrl/);
  assert.doesNotMatch(asset,/canvas|drawImage|toDataURL/);
});
