'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const INDEX=fs.readFileSync(path.join(ROOT,'public','index.html'),'utf8');
const LFL=fs.readFileSync(path.join(ROOT,'public','lfl.js'),'utf8');
const PARSE=fs.readFileSync(path.join(ROOT,'server','lib','parse.js'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');

test('v6.23 Backlog rows carry a direct image identity into every drill-down',()=>{
  assert.match(PARSE,/_plmId: order\.plm/);
  assert.match(PARSE,/_imageRef: plmImageRef/);
  assert.match(SERVER,/\{includeInternalMeta:true\}/);
  assert.match(APP,/directRef\?`\$\{CP_IMAGE_API\}/);
});

test('v6.32 Backlog Excel files no longer embed image columns while LFL still can',()=>{
  const detailStart=APP.indexOf('async function exportCurrentBacklogDetail');
  const detailEnd=APP.indexOf('// Pivot büyüteci',detailStart);
  const detailBlock=APP.slice(detailStart,detailEnd);
  const exportStart=APP.indexOf('async function exportBacklogToExcel');
  const exportEnd=APP.indexOf('let backlogLoadedOnce',exportStart);
  const exportBlock=APP.slice(exportStart,exportEnd);
  assert.match(detailBlock,/const includeImages=false/);
  assert.doesNotMatch(detailBlock,/backlogWorkbookBufferWithImages/);
  assert.match(exportBlock,/const includeImages=false/);
  assert.doesNotMatch(exportBlock,/backlogWorkbookBufferWithImages/);
  assert.match(LFL,/imageColumnIndex=columns\.findIndex\(col=>col\.key==='__modelImage'\)/);
  assert.match(LFL,/window\.BLDetailImages\.addToExcel/);
});

test('v6.23 Backlog export options allow ASAS-IAS source columns and formulas',()=>{
  assert.doesNotMatch(INDEX,/id="backlogExportPreviewPanel"/);
  assert.match(INDEX,/id="backlogExcelOptionsBtn"/);
  assert.match(APP,/BACKLOG_EXCEL_COLUMNS_KEY/);
  assert.match(APP,/BACKLOG_EXCEL_FORMULAS_KEY/);
  assert.doesNotMatch(APP,/value="image:model"/);
  assert.match(APP,/function backlogExcelColumnCatalog\(\)/);
  assert.match(APP,/backlogExportSourceCatalog\(\)\.forEach\(item=>\{/);
  assert.match(APP,/data-col-add>/);
  assert.match(APP,/data-col-selected/);
  assert.match(SERVER,/req\.query\.sourceColumns/);
  assert.match(PARSE,/requestedColumns\.forEach/);
});
