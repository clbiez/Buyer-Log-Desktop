'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../public/collection-spreadsheet-engine.js');

test('column letters follow visible order and cross Z safely',()=>{
  assert.equal(E.columnLetter(0),'A');assert.equal(E.columnLetter(25),'Z');assert.equal(E.columnLetter(26),'AA');assert.equal(E.columnLetter(51),'AZ');
});
test('clipboard matrix parses Excel TSV and trailing CRLF without phantom row',()=>{
  assert.deepEqual(E.parseClipboardMatrix('1\t2\r\n3\t4\r\n'),[['1','2'],['3','4']]);
});
test('single-cell paste text collapses CR/LF/CRLF line breaks into single spaces without extra whitespace',()=>{
  assert.equal(E.normalizeSingleCellPasteText('ABCD\r\nASDTY'),'ABCD ASDTY');
  assert.equal(E.normalizeSingleCellPasteText('ABCD\nASDTY'),'ABCD ASDTY');
  assert.equal(E.normalizeSingleCellPasteText('ABCD\rASDTY'),'ABCD ASDTY');
  assert.equal(E.normalizeSingleCellPasteText('ABCD\n\nASDTY'),'ABCD ASDTY');
  assert.equal(E.normalizeSingleCellPasteText('plain text'),'plain text');
});
test('rectangular ranges normalize anchor/focus in every direction',()=>{
  assert.deepEqual(E.rangeBounds({r:4,c:5},{r:2,c:1}),{r1:2,r2:4,c1:1,c2:5});
  assert.equal(E.cellsInRange({r1:0,r2:1,c1:0,c2:2}).length,6);
});
test('TSV serialization keeps one selected grid row per line and removes embedded tabs/newlines',()=>{
  assert.equal(E.tsv([['A','B\nC'],['D\tE',2]]),'A\tB C\nD E\t2');
});
test('multi-cell paste repeats a copied row across every selected row',()=>{
  assert.deepEqual(
    E.expandPasteMatrix([['A','B']],{r1:2,r2:4,c1:1,c2:2}),
    [['A','B'],['A','B'],['A','B']],
  );
});
test('multi-cell paste repeats a copied matrix across the selected rectangle',()=>{
  assert.deepEqual(
    E.expandPasteMatrix([['A','B'],['C','D']],{r1:0,r2:3,c1:0,c2:3}),
    [['A','B','A','B'],['C','D','C','D'],['A','B','A','B'],['C','D','C','D']],
  );
});
test('paste geometry rejects incompatible clipboard and selection rectangles',()=>{
  const result=E.planPasteGeometry([['1','2','3'],['4','5','6']],{r1:0,r2:2,c1:0,c2:3});
  assert.equal(result.ok,false);
  assert.deepEqual(result.clipboard,{rows:2,columns:3});
  assert.deepEqual(result.selection,{rows:3,columns:4});
});
test('status statistics calculate Count/Sum/Average only from numeric values',()=>{
  const parse=v=>{const n=Number(String(v).replace(',','.'));return Number.isFinite(n)?n:NaN;};
  const s=E.selectionStats([['1,5','x'],['2.5','']],parse);
  assert.deepEqual(s,{count:3,numericCount:2,sum:4,average:2});
});
test('paste preview summary and undo metadata contain geometry but no clipboard values',()=>{
  const summary=E.pasteSummary({geometry:{mode:'fill',clipboard:{rows:1,columns:1},selection:{rows:3,columns:2}},ops:[1,2,3,4],readonly:1,invalid:1,skipped:0});
  assert.deepEqual(summary,{kind:'paste',mode:'fill',changed:4,readonly:1,invalid:1,skipped:0,source:{rows:1,columns:1},target:{rows:3,columns:2}});
  assert.doesNotMatch(JSON.stringify(summary),/value|clipboardText/);
});
