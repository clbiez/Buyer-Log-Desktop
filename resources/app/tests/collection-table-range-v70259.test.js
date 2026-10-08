'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');

test('Collection uses the same persisted visible-row range controls as CP and Orders',()=>{
  const start=APP.indexOf('function renderKol()');
  const end=APP.indexOf('function kolSpreadsheetFormulaInfo',start);
  const render=APP.slice(start,end);
  assert.match(render,/renderTableRangeControls\(table,'koleksiyon',rows,renderKol\)/);
  assert.match(render,/visibleRows\.forEach\(\(r,ri\)=>/);
  assert.match(render,/afterRender\?\.\(\{rows:visibleRows,descriptors,pictureVisible\}\)/);
  assert.match(render,/logicalRows\.forEach\(r=>selectionSetId\(kolSelected,r\.id,selAll\.checked\)\)/);
});
