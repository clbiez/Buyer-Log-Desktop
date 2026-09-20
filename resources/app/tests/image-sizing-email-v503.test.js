'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const DESIGN=fs.readFileSync(path.join(ROOT,'public','design.css'),'utf8');

function between(start,end){const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);assert.ok(a>=0,`${start} missing`);assert.ok(b>a,`${end} missing`);return APP.slice(a,b);}

test('v5.03 CP/Orders image modes use compact uniform row heights',()=>{
  assert.match(APP,/cp:\{preferenceKey:'lcw\.cp\.imageSize\.v2',[\s\S]*min:\{col:52,w:42,h:28,row:34\},max:\{col:74,w:66,h:40,row:46\}/);
  // Mekanizma değişti, özellik değil: satır yüksekliği artık her görsel yüklendiğinde
  // tr'ye tek tek yazılmıyor; bir kez --cp-row-h değişkenine yazılıp CSS'ten uygulanıyor.
  // tr'ye yazmak sanallaştırılmış listede her görsel yüklenişinde yeniden yerleşim
  // tetikleyip kaydırma titremesine yol açıyordu (bkz. app-main.js:1882 yorumu).
  const vars=between('function cpApplyImageSizeVars','function cpNormalizePlmImageId');
  assert.match(vars,/root\.style\.setProperty\('--cp-row-h',`\$\{dims\.row\}px`\)/);
  assert.match(CSS,/#cpTable tbody tr\{height:var\(--cp-row-h-cp/);
  assert.match(CSS,/#ordersTable tbody tr\{height:var\(--cp-row-h-orders/);
  const block=between('function cpApplyImageRowHeight','function bindCpImageNode');
  // Nöbetçi: satır yüksekliğinin tr'ye geri yazılması titremeyi geri getirir.
  assert.doesNotMatch(block,/tr\.style\.height/);
  assert.doesNotMatch(block,/renderedHeight\)\+6/);
});

// v5.85: en küçük kademe (small) kaldırıldı — 22×18 px'de model görseli ayırt
// edilemiyordu. Kalan iki kademenin ölçüleri ve "oran satır yüksekliğini
// değiştiremez" kuralı aynen korunuyor.
test('v5.03 Collection Medium/Large modes are compact and ratio cannot change row height',()=>{
  assert.match(APP,/koleksiyon:\{preferenceKey:'lcw\.koleksiyon\.imageSize\.v2',[\s\S]*min:\{col:48,w:38,h:28,row:34\},max:\{col:68,w:60,h:38,row:44\}/);
  assert.match(APP,/function kolImgDims\(\)\{ return tableImageSizeDimensions\('koleksiyon',kolImgSize\); \}/);
  const block=between('function kolCompactRowHeightForDimensions','let kolColFilters');
  assert.match(block,/return kolImgDims\(\)\.row/);
  assert.doesNotMatch(block,/rendered\+6/);
});

test('v5.04 clipboard keeps original image resolution while initial display follows the current cell',()=>{
  const block=between('async function _copyCellFromTd','function _copyEnsureRequiredRowsRendered');
  assert.match(block,/thumb\.getBoundingClientRect\(\)/);
  assert.match(block,/cellRect=td\.getBoundingClientRect\(\)/);
  assert.match(block,/_copyImageDataUrl\(thumb\)/);
  assert.match(block,/width:auto;height:auto;max-width:100%;max-height:100%/);
  assert.doesNotMatch(block,/<img[^>]*style="[^"]*width:100%;height:100%/);
  assert.match(block,/width:\$\{cellWidth\}px;height:\$\{cellHeight\}px/);
  const loader=between('async function _copyImageDataUrl','// Panoya kopyalama sırasında');
  assert.doesNotMatch(loader,/canvas|toDataURL/);
  assert.match(loader,/reader\.readAsDataURL\(blob\)/);
});

test('v5.18 CP/Orders Excel starts at current cell size and locks image proportions',()=>{
  const block=between('async function exportStyledDomTable','async function exportCpTableWithLightTheme');
  assert.match(block,/entry\.cellWidth/);
  assert.match(block,/entry\.cellHeight/);
  assert.match(block,/kolExcelImageTwoCellPlacement\(image,entry\.row,cellWidth,cellHeight,entry\.col\+1,2\)/);
  assert.doesNotMatch(APP,/editAs:'oneCell'/);
  assert.match(APP,/nativeColOff/);
  assert.match(APP,/nativeRowOff/);
  assert.doesNotMatch(block,/tl:\{col:entry\.col/);
  // v10.90 — görsel kaynağı kanonik model kimliğidir; hücre ölçüleri DOM'dan gelmeye devam eder.
  assert.match(APP,/imageEntries\.push\(\{row:excelRow,col:col-1,identity,src:domImage,cellWidth:tdRect\.width\|\|0,cellHeight:trRect\.height\|\|0\}\)/);
  assert.match(APP,/orders:\s*\{sel:'#ordersTable'/);
});

test('v5.18 Collection Excel follows selected image mode and uses aspect-locked anchors',()=>{
  assert.match(APP,/function kolExcelImageMetrics\(\)/);
  assert.match(APP,/rowPx:dims\.row,rowPt:dims\.row\*72\/96,colPx:dims\.col/);
  assert.match(APP,/function kolExcelImagePlacement\(preparedImage,rowNum,cellWidth,cellHeight,columnIndex=1\)/);
  assert.match(APP,/function kolExcelImageTwoCellPlacement\(/);
  const placement=between('function kolExcelImageAspectLockedPlacement','function kolExcelImageTwoCellPlacement');
  assert.match(placement,/nativeCol:baseCol/);
  assert.match(placement,/ext:\{width:box\.width,height:box\.height\}/);
  assert.doesNotMatch(placement,/editAs:'oneCell'/);
  assert.match(APP,/const KOL_EXCEL_EMU_PER_PX=9525/);
  assert.match(APP,/width:i===0\?kolExcelImageMetrics\(\)\.colChars/);
});

test('v5.18 email Picture cells keep original CID resolution without stretching',()=>{
  assert.match(APP,/function prepareEmailTopicTableContent\(rows,columns\)/);
  assert.match(APP,/src="cid:\$\{a\.cid\}"/);
  const asset=between('async function prepareEmailInlineAsset','async function prepareEmailTopicTableContent');
  assert.doesNotMatch(asset,/canvas|drawImage|toDataURL/);
  assert.match(asset,/const dataUrl=prepared\.dataUrl/);
  assert.match(APP,/inlineImages:\(inlineImages\|\|\[\]\)\.map/);
  assert.match(APP,/imageJobs\.push\(\{src,rowNum,columnIndex:ci\+1,column\}\)/);
  const workbook=between('async function prepareEmailBuildTopicTableWorkbook','function prepareEmailWorkbookFileEntry');
  assert.match(workbook,/kolExcelImageTwoCellPlacement\(image,job\.rowNum,cellWidth,cellHeight,job\.columnIndex,2\)/);
  assert.doesNotMatch(APP,/editAs:'oneCell'/);
  assert.match(APP,/width:\$\{a\.width\}px;height:\$\{a\.height\}px/);
  assert.doesNotMatch(APP,/src="cid:\$\{a\.cid\}"[^`]*width:100%;height:100%/);
  assert.doesNotMatch(SERVER,/inlineImages\.slice\(0,\s*20\)/);
});

test('v5.03 startup and requested v5.01 UI revisions remain in the package',()=>{
  assert.match(SERVER,/if\(snapshot\)return snapshot;/);
  assert.match(APP,/data-note-group-count/);
  assert.match(APP,/addEventListener\('dblclick'/);
  assert.match(APP,/appendSharedTableActions\('ordersTableActions',\['undoBtn','redoBtn'/);
  assert.match(DESIGN,/#cpPriceHistoryBtn/);
});
