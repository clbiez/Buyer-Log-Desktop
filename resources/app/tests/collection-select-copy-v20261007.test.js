'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const SHEET=fs.readFileSync(path.join(__dirname,'..','public','collection-spreadsheet.js'),'utf8');
function between(source,startText,endText){
  const start=source.indexOf(startText),end=source.indexOf(endText,start+startText.length);
  assert.ok(start>=0&&end>start,`missing block ${startText}`);
  return source.slice(start,end);
}

test('Collection clipboard reads current bridge rows instead of stale render cache',()=>{
  assert.match(SHEET,/function liveRowSnapshot\(\)/);
  const matrix=between(SHEET,'function selectedMatrix','function headerLabelFor');
  assert.match(matrix,/function selectedMatrix\(liveRows=null\)/);
  assert.match(matrix,/valueForCoord\(coord,liveRows\)/);
  const clipboard=between(SHEET,'function selectedClipboard','function updateStatus');
  assert.match(clipboard,/selectedMatrix\(liveRowSnapshot\(\)\)/);
  const value=between(SHEET,'function valueForCoord','function metadata');
  assert.match(value,/liveRows\?\.get\(String\(coord\.rowId\)\)\|\|state\.rowById\.get/);
});

test('native select cells copy their current selected value before any delayed rerender',()=>{
  const value=between(SHEET,'function valueForCoord','function metadata');
  assert.match(value,/querySelector\?\.\('select\.editCell:not\(:disabled\)'\)/);
  assert.match(value,/return liveSelect\.value\?\?''/);
});

test('explicit right-click Copy stays cell-scoped even when business rows are checked',()=>{
  const copy=between(SHEET,'function handleCopyShortcut','function selectedCoordinates');
  // Klavye Ctrl+C işaretli modellere ancak hücre seçimi daha eski ise devreder
  // ("en son seçim kazanır", v7.0.290); sağ tık Copy her zaman hücreye bağlıdır.
  assert.match(copy,/const checkedModels=bridge\(\)\?\.selectedCount\?\.\(\)\|\|0;/);
  assert.match(copy,/!options\.forceCellCopy&&checkedModels>0&&!cellSelectionWins\(\)/);
  const ctx=between(SHEET,'function cellContext','function bind()');
  assert.equal((ctx.match(/forceCellCopy:true/g)||[]).length,2);
});
