'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../public/backlog-excel-columns');
const E=require('../public/formula-engine');
const columns=[{id:'field:0',header:'Quantity',display:'Quantity'},{id:'field:1',header:'Price',display:'Price'},{id:'calc:total',header:'calc:total',display:'Total'}];
test('stable references survive aliases, ordering and hidden dependencies',()=>{
 const settings={'field:0':{label:'Units'},'calc:total':{label:'Amount',formula:'[field:0]*[field:1]',format:'number'}};
 assert.deepEqual(C.dependencies(['calc:total'],columns,settings,E),['calc:total','field:0','field:1']);
 assert.equal(C.excelFormula(settings['calc:total'].formula,E,id=>({'field:0':'C2','field:1':'B2'}[id])),'IF(OR(C2="",B2=""),"",(C2*B2))');
 assert.equal(C.display(columns[0],settings),'Units');assert.equal(columns[0].header,'Quantity');
});
test('cycles and missing sources fail explicitly',()=>{
 assert.throws(()=>C.dependencies(['calc:total'],columns,{'calc:total':{formula:'[calc:total]+1'}},E),/cycle/i);
 assert.throws(()=>C.dependencies(['calc:total'],columns,{'calc:total':{formula:'[missing]+1'}},E),/missing/i);
});
test('date, conditions and strings compile to Excel with CP argument order',()=>{
 assert.equal(C.excelFormula('DAYS([field:0],[field:1])',E,id=>id==='field:0'?'A2':'B2'),'(B2-A2)');
 assert.equal(C.excelFormula('IF([field:0]>0,"ab","")',E,()=> 'A2'),'IF((A2>0),"ab","")');
 assert.equal(C.excelFormula('ADDDAYS([field:0],30)',E,()=> 'A2'),'(A2+30)');
});

test('native Excel formulas keep identity on reorder without touching quoted strings or settings references',()=>{
 const stored=C.nativeStore('IF(A{row}="A2",B{row}+Ayarlar!$G$14,0)',['field:0','field:1']);
 assert.equal(stored,'IF({col:field:0}{row}="A2",{col:field:1}{row}+Ayarlar!$G$14,0)');
 assert.equal(C.nativeExcel(stored,id=>id==='field:0'?'D':'C',7),'IF(D7="A2",C7+Ayarlar!$G$14,0)');
 assert.equal(C.nativeRowTemplate('IF(A2="A2",B2+Ayarlar!$G$2,0)'), 'IF(A{row}="A2",B{row}+Ayarlar!$G$2,0)');
 assert.ok(C.validateNative('IF(A{row}="",0,B{row}*2)',E));
 assert.ok(!C.validateNative('IF(A{row}',E));
 assert.ok(!C.validateNative("'[Other.xlsx]Data'!A2",E));
});
test('native dependencies participate in cycle and missing-source validation',()=>{
 assert.deepEqual(C.dependencies(['calc:total'],columns,{'calc:total':{excelFormula:'{col:field:0}{row}+{col:helper:_BL_TRANSIT_DAYS}{row}'}},E),['calc:total','field:0']);
 assert.throws(()=>C.dependencies(['calc:total'],columns,{'calc:total':{excelFormula:'{col:calc:total}{row}+1'}},E),/cycle/);
});
