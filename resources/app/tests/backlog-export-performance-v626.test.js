'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');
const SERVER=fs.readFileSync(path.join(ROOT,'server','server.js'),'utf8');
const PARSE=fs.readFileSync(path.join(ROOT,'server','lib','parse.js'),'utf8');

test('v6.26 Backlog export no longer renders a preview panel',()=>{
  assert.doesNotMatch(APP,/previewLimit:'100'/);
  assert.match(SERVER,/const previewLimit=Math\.min\(500/);
  assert.match(SERVER,/totalRows:detailRows\.totalRows\|\|detailRows\.length/);
  const route=SERVER.slice(SERVER.indexOf("app.get('/api/backlog-export'"),SERVER.indexOf("app.post('/api/backlog-detail'"));
  assert.doesNotMatch(route,/buildBacklogGrouped\(/);
});

test('v6.26 Backlog row preparation only builds CP rows for filtered segments',()=>{
  const start=PARSE.indexOf('function buildBacklogTemplateRows');
  const end=PARSE.indexOf('/* Segment -> BACKLOG_TEMPLATE_HEADERS',start);
  const block=PARSE.slice(start,end);
  assert.match(block,/selectedSegments =/);
  assert.match(block,/buildCPRowsFromASAS\(cpOrders,/);
  assert.doesNotMatch(block,/buildCPRowsFromASAS\(asasOrders,/);
  assert.match(block,/Object\.defineProperty\(rows, 'totalRows'/);
});

test('v6.32 Backlog Excel export skips image embedding for speed and integrity',()=>{
  const start=APP.indexOf('async function exportBacklogToExcel');
  const end=APP.indexOf('let backlogLoadedOnce',start);
  const block=APP.slice(start,end);
  assert.match(block,/const includeImages=false/);
  assert.doesNotMatch(block,/backlogWorkbookBufferWithImages/);
  assert.match(block,/saveWorkbookWithValidations/);
});

test('v6.26 Backlog Excel column dialog always has a visible fixed catalog',()=>{
  assert.match(APP,/BACKLOG_EXCEL_COLUMNS_KEY='bl\.backlog\.excelColumns\.v4'/);
  assert.match(APP,/BACKLOG_EXCEL_COLUMNS_LEGACY_KEY='bl\.backlog\.excelColumns\.v3'/);
  assert.match(APP,/function backlogExportSourceCatalog\(\)/);
  assert.match(APP,/BACKLOG_DEFAULT_EXPORT_HEADERS\.map/);
  assert.match(APP,/role="dialog" aria-modal="true"/);
  assert.match(CSS,/\.backlogExportColumnsBody\{[^}]*flex:1 1 auto;[^}]*min-height:260px/);
});
