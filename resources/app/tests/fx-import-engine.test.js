'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const engine=require('../public/fx-import-engine');
const grid={sheetName:'Demo',rows:[['Demo forecast'],[],['Country','Code','2026-10-31','2026-11-30'],[null,null,'o'],['Demo','TRY',40,41],[],['Demo','EUR',.9,.91],['Demo','GBP',.8,.81]]};
test('deterministic detection preserves merged-header, marker and separator behavior',()=>{
 const parsed=engine.extractWithLayout(grid,engine.detectLayout(grid));assert.deepEqual(parsed.months,{'2026-10':{TRY:40,EUR:.9,GBP:.8},'2026-11':{TRY:41,EUR:.91,GBP:.81}});assert.equal(parsed.reportMonth,'2026-10');assert.equal(engine.detectLayout({sheetName:'Empty',rows:[['no table']]}),null);
});
const layout={sheetName:'Shifted',headerRow:1,monthColumns:[{col:'F',month:'2026-10'}],codeColumn:'D',firstDataRow:2,lastDataRow:4,direction:'usd_per_unit',scale:1,confidence:.92,warnings:[]};
const shifted={sheetName:'Shifted',rows:[[null,null,null,'Code',null,'Oct 2026'],[null,null,null,'TRY',null,.025],[null,null,null,'EUR',null,1.1],[null,null,null,'GBP',null,1.25]]};
test('explicit shifted layout reads only cells and converts direction and scale',()=>{
 const parsed=engine.extractWithLayout(shifted,{...layout,rates:{TRY:999}});assert.equal(parsed.months['2026-10'].TRY,40);assert.equal(parsed.months['2026-10'].GBP,.8);
 const scaled=engine.extractWithLayout({...shifted,rows:[shifted.rows[0],[null,null,null,'JPY',null,.65],shifted.rows[2],shifted.rows[3]]},{...layout,scale:100});assert.equal(scaled.months['2026-10'].JPY,100/.65);
 const direct=engine.extractWithLayout({...shifted,rows:[shifted.rows[0],[null,null,null,'JPY',null,15000],shifted.rows[2],shifted.rows[3]]},{...layout,direction:'per_usd',scale:100});assert.equal(direct.months['2026-10'].JPY,150);
 assert.throws(()=>engine.extractWithLayout(shifted,{...layout,lastDataRow:5000000}),/layout/i);
});
test('validation blocks invalid codes, values, months, collisions, small scope and reversed TRY',()=>{
 const good={months:{'2026-10':{TRY:40,EUR:.9,GBP:.8}}};assert.equal(engine.validateFxImport(good,{}).errors.length,0);
 for(const parsed of [{months:{'2026-10':{TRY:.025,EUR:.9,GBP:.8}}},{months:{'2026-13':{TRY:40,EUR:.9,GBP:.8}}},{months:{'2026-10':{TRY:40,EURO:1,GBP:.8}}},{months:{'2026-10':{TRY:NaN,EUR:.9,GBP:.8}}},{months:{'2026-10':{TRY:40}}},{...good,conflicts:[{month:'2026-10',code:'TRY'}]}])assert.ok(engine.validateFxImport(parsed,{}).errors.length);
});
test('named threshold rules warn about jumps, changed cells, gaps and missing favorites',()=>{
 const checked=engine.validateFxImport({months:{'2026-10':{TRY:40,EUR:.9,GBP:.8},'2026-12':{TRY:60,EUR:.91,GBP:.81}}},{months:{'2026-10':{TRY:30}}});
 for(const code of ['month-jump','current-difference','month-gap','missing-currency'])assert.ok(checked.warnings.some(w=>w.code===code),code);
});
test('LCW AI contract checks layout shape and discards extra rate fields',()=>{
 const prompt=require('../server/lib/lcwai/lcwai-prompt');assert.ok(prompt.CONTRACTS['fx-kur-layout']);
 const result=prompt.parseStructured(JSON.stringify({...layout,rates:{TRY:999}}),'fx-kur-layout');assert.equal(result.ok,true);assert.equal(result.data.rates,undefined);assert.equal(result.data.codeColumn,'D');
 assert.equal(prompt.parseStructured(JSON.stringify({...layout,direction:'guess'}),'fx-kur-layout').ok,false);
 assert.equal(prompt.parseStructured(JSON.stringify({...layout,monthColumns:[{col:'F',month:'2026-99'}]}),'fx-kur-layout').ok,false);
});
test('grid preview is cropped and addresses cells without exposing paths',()=>{
 const preview=engine.previewGrids([{sheetName:'Demo',rows:Array.from({length:50},()=>Array(60).fill('x'.repeat(80)))}]);assert.equal(preview[0].totalRows,50);assert.equal(preview[0].totalColumns,60);assert.equal(preview[0].cells.length,30);assert.equal(preview[0].cells[0].length,40);assert.equal(preview[0].cells[0][0].address,'A1');assert.equal(preview[0].cells[0][0].value.length,40);
});
test('both adapters delegate and recovery is user initiated with validation before save',()=>{
 const fx=fs.readFileSync(path.join(__dirname,'../public/fx.js'),'utf8'),server=fs.readFileSync(path.join(__dirname,'../server/lib/fxWorkbook.js'),'utf8');
 assert.match(fx,/BLFxImportEngine/);assert.match(server,/fx-import-engine/);assert.doesNotMatch(fx,/function cellNum\(|function cellDate\(/);assert.doesNotMatch(server,/function numberValue\(|function parseTextDate\(/);
 assert.match(fx,/async function readWithAiLayout/);assert.match(fx,/validateFxImport/);assert.match(fx,/previewGrids/);assert.match(fx,/openConnectionDialog/);assert.match(fx,/errors\.length/);assert.match(fx,/confirm/);
 const oc=fs.readFileSync(path.join(__dirname,'../public/open-costing.js'),'utf8');assert.match(oc,/showImportRecovery/);
});

test('report month includes the earliest header even when all its rate cells are blank',()=>{
 const blankFirst={sheetName:'Demo',rows:[[null,null,'2026-10','2026-11'],[null,'TRY',null,50],[null,'EUR',null,.9],[null,'GBP',null,.8]]};
 const parsed=engine.extractWithLayout(blankFirst,engine.detectLayout(blankFirst));assert.equal(parsed.reportMonth,'2026-10');assert.equal(parsed.stats.firstMonth,'2026-11');
 const combined=engine.combineParsed([parsed]);assert.equal(combined.reportMonth,'2026-10');
 const {decideFolderKurApply}=require('../server/lib/fxWorkbook');assert.equal(decideFolderKurApply({reportMonth:'2026-11'},{data:combined,reportMonth:combined.reportMonth,fingerprint:'demo'}).reason,'older-report');
});
