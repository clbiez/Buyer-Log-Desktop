'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Engine=require('../public/open-costing-engine'),Fx=require('../public/fx-calculation-engine'),Business=require('../public/business-rules');
const root=path.resolve(__dirname,'..');
test('shared native costing matches the pre-change installed UI calculation including exact rounding',()=>{
 const saved=require('./fixtures/open-costing-native-v20261011.json');assert.deepEqual(Engine.calculateRecord(saved.record,saved.record.snap),saved.result);
});
test('installed UI delegates line totals and all cost steps to the same native engine',()=>{
 const src=fs.readFileSync(path.join(root,'public/open-costing.js'),'utf8'),extract=name=>{const match=src.match(new RegExp('function '+name+'\\([^\\n]+\\}'));assert.ok(match);return match[0];},context={window:{BLOpenCostingEngine:Engine},fxSnapFor:record=>record.snap,current:null};vm.createContext(context);vm.runInContext(extract('lineTotal')+'\n'+extract('calculateRecord')+'\n'+extract('parseLocalizedNumber'),context);const saved=require('./fixtures/open-costing-native-v20261011.json');assert.deepEqual(context.calculateRecord(saved.record),saved.result);assert.equal(context.lineTotal(saved.record.sections.fabric[0],saved.record),1.76);assert.equal(context.parseLocalizedNumber('1.234,56'),1234.56);
 const perf=fs.readFileSync(path.join(root,'public/perf-runtime.js'),'utf8');assert.match(perf,/openCosting:\['fx-calculation-engine\.js','fx-import-engine\.js','fx\.js','open-costing-engine\.js','open-costing\.js'\]/);
});
test('native FX and legacy localized amounts retain missing-currency evidence and compound rate order',()=>{
 const raw={meta:{currency:'USD',quantity:100},sections:{fabric:[{qty:'0,5',unitPrice:'1.234,56',currency:'EUR',wastePct:'10,5'}]},rates:{productionWastePct:10,overheadPct:20,financePct:30,profitPct:40}},missing=Engine.calculateRecord(raw,{base:'USD',dir:'per_base',rates:{}});assert.deepEqual(missing.missingCurrencies,['EUR']);assert.equal(missing.sectionTotals.fabric,682.0944);const actual=Engine.calculateRecord(raw,{base:'USD',dir:'per_base',rates:{EUR:.8}});assert.deepEqual(actual.missingCurrencies,[]);assert.ok(Math.abs(actual.direct-852.618)<1e-10);assert.equal(actual.finalFob,Business.roundHalfUp(actual.direct*1.1*1.2*1.3*1.4,2));assert.equal(Fx.resolveMonth('2026-10',{months:{'2026-09':{TRY:40}}}).month,'2026-09');
});
test('the shared FX default preserves the installed UI current local month contract',()=>{
 const now=new Date(2026,9,11);for(const value of [undefined,null,'','invalid'])assert.equal(Engine.normalizeFxMonth(value,now),'2026-10');assert.equal(Engine.normalizeFxMonth('2026-09',now),'2026-09');
 const ui=fs.readFileSync(path.join(root,'public/open-costing.js'),'utf8');assert.match(ui,/r\.meta\.fxMonth=window\.BLOpenCostingEngine\.normalizeFxMonth\(r\.meta\.fxMonth\)/);assert.match(ui,/const requested=window\.BLOpenCostingEngine\.normalizeFxMonth\(record\?\.meta\?\.fxMonth\)/);
});
