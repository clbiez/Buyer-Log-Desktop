'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const parse=require('../server/lib/parse');
const backlogExcel=require('../public/backlog-excel-formulas.js');

const ROOT=path.join(__dirname,'..');
const APP=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const OV={notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[]};
let seq=0;
function row(extra={}){seq+=1;return Object.assign({ocode:8800000+seq,model:'MODEL '+seq,ccode:'C'+seq,colour:'BLACK',season:'S7',countryRaw:'INDIA',manufacturer:'MFR',license:'',category:'TEE',merch:'12',ageGroup:'A1',buyer:'BUYER',buyerGrup:'GROUP',line:'LINE',qty:100,kalan:100,fob:5,opd:'2026-01-01T00:00:00.000Z',ex:'2026-06-01T00:00:00.000Z',retail:'2026-08-10T00:00:00.000Z',mb:'2026-07-10T00:00:00.000Z'},extra);}
function report(rows,opts={}){return parse.buildBacklogGrouped(rows,{},OV,{groupBy:['buyerGrup'],...opts});}

test('v6.30 JSON-restored retail and in-store dates are actually filtered',()=>{
  const rows=JSON.parse(JSON.stringify([row(),row({retail:'2026-09-10T00:00:00.000Z',mb:'2026-09-01T00:00:00.000Z'})]));
  assert.equal(report(rows,{retailFrom:'2026-08-01',retailTo:'2026-08-31'}).totalOrders,1);
  assert.equal(report(rows,{inStoreFrom:'2026-09-01',inStoreTo:'2026-09-30'}).totalOrders,1);
});

test('Pivot Ayarları kaydı tarihleri commit eder ve Excel kanonik filtre sorgusunu kullanır',()=>{
  assert.match(APP,/function commitBacklogDateInputs\(\)/);
  assert.match(APP,/backlogPivotSettingsBtn'\)\?\.addEventListener\('click', openBacklogPivotSettings\)/);
  assert.match(APP,/data-backlog-settings-save/);
  assert.match(APP,/if\(!commitBacklogDateInputs\(\)\)return;/);
  const start=APP.indexOf('async function exportBacklogToExcel'),end=APP.indexOf("document.getElementById('backlogExportBtn')",start),block=APP.slice(start,end);
  assert.match(block,/const params=backlogExportQueryParams\(\)/);
  assert.doesNotMatch(block,/dimFiltersObj/);
  assert.match(APP,/dimFiltersObj\.antrepoDate = \{granularity:backlogDateFilter\.granularity, values:backlogDateFilter\.values\}/);
});

test('v6.30 Excel image placement omits invalid editAs on oneCellAnchor',()=>{
  const start=APP.indexOf('function kolExcelImageAspectLockedPlacement'),end=APP.indexOf('function kolExcelImageTwoCellPlacement',start),block=APP.slice(start,end);
  assert.match(block,/ext:\{width:box\.width,height:box\.height\}/);
  assert.doesNotMatch(block,/editAs/);
});



test('Backlog Excel Ay/Hafta hücreleri orijinal tarih hücresine formülle bağlıdır',()=>{
  const month=backlogExcel.dateDimensionFormula('Q2','month','tr');
  const week=backlogExcel.dateDimensionFormula('Q2','week','tr');
  assert.match(month,/Q2/);
  assert.match(month,/WEEKDAY\(Q2,2\)/);
  assert.match(month,/CHOOSE\(MONTH/);
  assert.match(week,/WEEKNUM\(Q2,21\)/);
  assert.match(week,/\. Hafta/);
  assert.match(APP,/derivedHeaderSources/);
  assert.match(APP,/dateDimensionSources:expanded\.derivedHeaderSources/);
  assert.match(APP,/BLBacklogExcel\.dateDimensionFormula/);
  assert.match(APP,/function backlogChartBucketFormula/);
  assert.match(APP,/_BL_CHART_TIME1/);
  assert.match(APP,/_BL_CHART_BUCKET1/);
  assert.match(APP,/__backlogChartLiveSource/);
});
