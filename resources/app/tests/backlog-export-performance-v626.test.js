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

test('v6.26 Backlog export no longer renders a preview panel',async()=>{
  assert.doesNotMatch(APP,/previewLimit:'100'/);
  const capture=require('./helpers/computed-backlog-request'),tasks=require('../server/lib/compute-tasks'),parse=require('../server/lib/parse');
  const capped=await capture({format:'json',previewLimit:'20000'});assert.equal(capped.parts.previewLimit,500);
  const full=await capture({format:'json'});assert.equal(full.parts.previewLimit,0);
  const orders=Array.from({length:600},(_,i)=>({ocode:4100000+i,model:'Demo',ccode:'01',colour:'Blue',season:'W6',countryRaw:'MISIR',manufacturer:'DEMO',buyerGrup:'DEMO',qty:1,kalan:1,fob:5,ex:new Date(2026,9,1),retail:new Date(2027,0,1),mb:new Date(2026,11,1)})),source={asasOrders:orders,antrepoMap:{}},grouped=parse.buildBacklogGrouped;
  parse.buildBacklogGrouped=()=>{throw Error('Export must not build a grouped report');};
  try{
    const preview=tasks.buildBacklog('export',source,{...capped.parts,headers:['Sipariş Kod'],overrides:{}});assert.equal(preview.rows.length,500);assert.equal(preview.totalRows,600);
    const complete=tasks.buildBacklog('export',source,{...full.parts,headers:['Sipariş Kod'],overrides:{}});assert.equal(complete.rows.length,600);assert.equal(complete.totalRows,600);
  }finally{parse.buildBacklogGrouped=grouped;}
  const route=SERVER.slice(SERVER.indexOf("app.get('/api/backlog-export'"),SERVER.indexOf("app.post('/api/backlog-detail'"));
  assert.doesNotMatch(route,/buildBacklogGrouped\(/);
});

test('Backlog row preparation skips CP projection and builds source details only on request',()=>{
  const start=PARSE.indexOf('function buildBacklogTemplateRows');
  const end=PARSE.indexOf('/* Segment -> BACKLOG_TEMPLATE_HEADERS',start);
  const block=PARSE.slice(start,end);
  assert.match(block,/selectedSegments =/);
  assert.doesNotMatch(block,/buildCPRowsFromASAS\(/);
  assert.match(block,/options.includeSourceDetails===true\s*\? buildOrdersRowsFromASAS\(cpOrders,/);
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
