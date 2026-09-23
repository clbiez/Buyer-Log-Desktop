'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'..','public','app-main.js'),'utf8');
function between(source,start,end){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0,`${start} missing`);assert.ok(b>a,`${end} missing`);return source.slice(a,b);
}

test('v5.52 Collection Excel writes Endeksmatik summary instead of the empty synthetic row field',()=>{
  const exportBlock=between(APP,'async function kolExportWithImages','function kolStyleExportValue');
  assert.match(exportBlock,/if\(c\.endeksmatik\)/);
  assert.match(exportBlock,/endeksmatikExcelText\(r\)/);
  assert.match(exportBlock,/kolExportSingleLineText/);
  assert.match(APP,/function endeksmatikExcelText\(row\)/);
  assert.match(APP,/endeksmatikCompactText\(row\)/);
});

test('v5.52 Collection Excel recalculates and exports Overseas/TR Landed as numeric dollar cells',()=>{
  const exportBlock=between(APP,'async function kolExportWithImages','function kolStyleExportValue');
  assert.match(exportBlock,/landed=kolLandedCalc\(r\)/);
  assert.match(exportBlock,/else if\(c\.ydLanded\)[\s\S]*?cell\.value=landed\.ydLanded[\s\S]*?cell\.numFmt='"\$"#,##0\.00'/);
  assert.match(exportBlock,/else if\(c\.trLanded\)[\s\S]*?cell\.value=landed\.trLanded[\s\S]*?cell\.numFmt='"\$"#,##0\.00'/);
});

test('v5.52 exported calculated cells keep audit-friendly calculation context in Excel notes',()=>{
  const exportBlock=between(APP,'async function kolExportWithImages','function kolStyleExportValue');
  assert.match(exportBlock,/Previous order|Eski sipariş/);
  assert.match(exportBlock,/landed\.supp/);
  assert.match(exportBlock,/landed\.ydMult/);
  assert.match(exportBlock,/landed\.trPrice/);
  assert.match(exportBlock,/landed\.fx/);
  assert.match(exportBlock,/landed\.trMult/);
});
