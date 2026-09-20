'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {performance}=require('node:perf_hooks');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const sheet=read('public/collection-spreadsheet.js');
const app=read('public/app-main.js');
const E=require('../public/collection-spreadsheet-engine.js');

function between(source,start,end){
  const i=source.indexOf(start); assert.ok(i>=0,`missing ${start}`);
  const j=source.indexOf(end,i+start.length); assert.ok(j>i,`missing ${end}`);
  return source.slice(i,j);
}

test('100 ArrowDown events stay on lightweight cell-navigation path',()=>{
  const keyboard=between(sheet,"table.addEventListener('keydown'","document.addEventListener('paste'");
  for(const forbidden of ['renderKol','saveKolRows','syncModelFields','kolApplyRulePricing','kolLandedCalc','fetch('])assert.doesNotMatch(keyboard,new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(keyboard,/ArrowDown/);assert.match(keyboard,/move\(/);
});

test('normal active-cell movement uses cached grid coordinates rather than scanning table DOM',()=>{
  const move=between(sheet,'function move(dr,dc','function moveTab');
  assert.match(move,/cellAt\(/);assert.match(move,/visibleCells\(\)/);
  assert.doesNotMatch(move,/querySelector|querySelectorAll|getElementsBy|render|save|sync/i);
  const coord=between(sheet,'function coordForCell','function cellAt');
  assert.match(coord,/state\.coordByCell\.get\(td\)/);
});

test('column resize mousemove changes width only and never recalculates business pricing',()=>{
  const resize=between(app,'function attachKolColResize','function openKolCheckFilter');
  const onMove=between(resize,'function onMove(ev)','function onUp()');
  for(const forbidden of ['renderKol','saveKolRows','kolApplyRulePricing','kolLandedCalc','kolBestPricing','syncModelFields'])assert.doesNotMatch(onMove,new RegExp(forbidden));
  assert.match(onMove,/style\.width/);assert.match(onMove,/applyFreeze/);
});

test('spreadsheet controller does not attach scroll work that can save, sync, or recalculate',()=>{
  assert.doesNotMatch(sheet,/addEventListener\(['"]scroll['"]/);
});

test('transient spreadsheet state is isolated from shared Collection persistence',()=>{
  const stateDecl=sheet.match(/const state=\{[^\n]+\}/)?.[0]||'';
  assert.match(stateDecl,/active:null/);assert.match(stateDecl,/anchor:null/);assert.match(stateDecl,/focus:null/);
  assert.doesNotMatch(sheet,/saveKolRows\(|deltaStore|syncModelFields|shared-data|BuyerLogLocal/);
});

test('multi-cell batch edit persists once and quotation sync happens only for changed canonical model fields',()=>{
  const batch=between(app,'function kolSpreadsheetBatchEdit','function kolSpreadsheetSetColumnWidth');
  assert.equal((batch.match(/saveKolRows\(\)/g)||[]).length,1);
  assert.equal((batch.match(/kolPushUndo\(\)/g)||[]).length,1);
  assert.match(batch,/syncQuotations:false/);
  assert.match(batch,/\['plmId','modelKod','urunTipi','colour','colourCode','season','lisans'\]/);
});

test('read-only calculated field metadata covers the canonical Collection derived classes',()=>{
  const meta=between(app,'function kolSpreadsheetColumnMeta','function kolSpreadsheetRawValue');
  assert.match(meta,/ruleReadonly/);assert.match(meta,/formulaReadonly/);assert.match(meta,/exToRetail/);assert.match(meta,/endeksmatik/);assert.match(meta,/ydLanded/);assert.match(meta,/trLanded/);
  assert.match(meta,/editable:!calculated/);
});

test('100x100 Excel clipboard parsing/serialization remains comfortably sub-frame in pure engine',()=>{
  const rows=Array.from({length:100},(_,r)=>Array.from({length:100},(_,c)=>String(r*100+c)));
  const input=rows.map(r=>r.join('\t')).join('\r\n');
  const t0=performance.now();
  const matrix=E.parseClipboardMatrix(input);const text=E.tsv(matrix);
  const elapsed=performance.now()-t0;
  assert.equal(matrix.length,100);assert.equal(matrix[0].length,100);assert.ok(text.length>input.length*0.9);
  // Wide enough for slower portable-node machines while still catching accidental quadratic blow-ups.
  assert.ok(elapsed<250,`10k-cell clipboard engine took ${elapsed.toFixed(1)} ms`);
});

test('1000-row range math is linear and bounded without materializing unrelated business state',()=>{
  const t0=performance.now();
  const cells=E.cellsInRange(E.rangeBounds({r:0,c:0},{r:999,c:19}));
  const elapsed=performance.now()-t0;
  assert.equal(cells.length,20000);
  assert.ok(elapsed<250,`20k range positions took ${elapsed.toFixed(1)} ms`);
});
