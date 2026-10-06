'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');

function between(start,end){
  const a=APP.indexOf(start),b=APP.indexOf(end,a+start.length);
  assert.ok(a>=0,`${start} missing`);assert.ok(b>a,`${end} missing`);
  return APP.slice(a,b);
}

test('v5.13 CP/Orders styled Excel export is native ExcelJS, not a SheetJS-to-ExcelJS round trip',()=>{
  const block=between('async function exportStyledDomTable','async function exportCpTableWithLightTheme');
  assert.match(block,/const wb=new ExcelJS\.Workbook\(\)/);
  assert.match(block,/await wb\.xlsx\.writeBuffer\(\)/);
  assert.match(block,/wb\.addImage\(\{base64:image\.dataUrl/);
  assert.doesNotMatch(block,/XLSX\.write\(/);
  assert.doesNotMatch(APP,/imageWorkbook\.xlsx\.load\(raw\)/);
});

test('CP/Orders Excel images preserve fitted aspect ratio and move and size with their cells',()=>{
  const block=between('async function exportStyledDomTable','async function exportCpTableWithLightTheme');
  assert.match(block,/cellWidth:tdRect\.width\|\|0,cellHeight:trRect\.height\|\|\(managedRecords/);
  // v10.90 — görsel kaynağı artık ekrandaki <img>'in currentSrc'si değil kanonik
  // model kimliğidir (bkz. tests/cp-orders-external-output-v1090.test.js);
  // hazırlama yine kolPrepareExcelImage üzerinden geçer.
  assert.match(APP,/async function _prepareExcelJsImages[\s\S]*kolPrepareExcelImage\(source\)/);
  assert.match(block,/kolExcelImageMoveAndSizePlacement\(image,entry\.row,cellWidth,cellHeight,entry\.col\+1,2\)/);
  assert.match(APP,/nativeColOff/);
  assert.doesNotMatch(APP,/editAs:'oneCell'/);
  assert.match(APP,/ext:\{width:box\.width,height:box\.height\}/);
});

test('v5.13 Backlog magnifier detail API returns the canonical report header order',()=>{
  assert.match(SERVER,/headers: BACKLOG_TEMPLATE_HEADERS/);
  assert.match(APP,/currentBacklogDetailHeaders=Array\.isArray\(headers\)/);
});

test('v5.13 Backlog magnifier Excel uses the same detail sheet/formula and validation engine as full export',()=>{
  const detail=between('async function exportCurrentBacklogDetail','// Pivot büyüteci:');
  // v5.86: dördüncü argüman artık boş dizi değil; Backlog sarı koşullu
  // biçimlendirmesi bu yoldan geçtiği için buraya bağlandı.
  assert.match(detail,/backlogExpandDateDimensions\(headers,currentBacklogDetailRows\)/);
  assert.match(detail,/buildBacklogDetailSheet\(expanded\.headers,expanded\.rows,null,\{includeImages,dateDimensionSources:expanded\.derivedHeaderSources\}\)/);
  assert.match(detail,/backlogWorkbookGuardConfig\(workbookHeaders,expanded\.rows\)/);
  assert.match(detail,/saveWorkbookWithValidations\(wb,filename,rules\.validations,rules\.conditionalFormats,rules\.protections/);
  const full=between('async function exportBacklogToExcel','async function fetchBacklog');
  // v5.87: yol süresi tablosu BACKLOG formüllerine bağlandığı için üçüncü
  // argüman olarak geçiliyor.
  // v7.0.81: sayfa kullanıcının kaydettiği sütun seçimi/sırasıyla kurulur
  // (exportHeaders); motor ve üçüncü argüman aynı kalır.
  assert.match(full,/backlogExpandDateDimensions\(exportHeaders,data\.rows\|\|\[\]\)/);
  assert.match(full,/const chartState=window\.BLBacklogChart\?\.getState\?\.\(\)\|\|null/);
  assert.match(full,/buildBacklogDetailSheet\(expanded\.headers,expanded\.rows,transitPlan,\{includeImages,dateDimensionSources:expanded\.derivedHeaderSources,chartState\}\)/);
  assert.match(full,/backlogWorkbookGuardConfig\(backlogHeaders,backlogRows\)/);
});
