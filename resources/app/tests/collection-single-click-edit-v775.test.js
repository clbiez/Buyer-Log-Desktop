'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const sheet=read('public/collection-spreadsheet.js');
const app=read('public/app-main.js');
const css=read('public/collection-spreadsheet.css');
function between(src,a,b){const i=src.indexOf(a);assert.ok(i>=0,`missing ${a}`);const j=src.indexOf(b,i+a.length);assert.ok(j>i,`missing ${b}`);return src.slice(i,j);}

test('plain left click uses the single-click pointer edit controller',()=>{
  const bind=between(sheet,'function bind(){','function init()');
  assert.match(bind,/kolSpreadsheetHandlePointerEdit\(e,td\)/);
  assert.doesNotMatch(bind,/addEventListener\('dblclick'[\s\S]*beginEdit/);
});

test('single-click edit keeps native editors pointer-addressable for first-click caret/select behavior',()=>{
  assert.match(css,/Single-click editing/);
  assert.match(css,/#kolTable td \.editCell\{pointer-events:auto\}/);
  assert.doesNotMatch(css,/td:not\(\.kolSpreadsheetEditing\)[^\n]*\.editCell\{pointer-events:none\}/);
});

test('Shift click remains range selection and cannot enter edit mode',()=>{
  const fn=between(sheet,'function kolSpreadsheetHandlePointerEdit','function kolSpreadsheetResumePendingPointerEdit');
  const shift=fn.slice(fn.indexOf('if(event.shiftKey)'),fn.indexOf('if(!editable)'));
  assert.match(shift,/setActive\(td,\{extend:true\}\)/);
  assert.doesNotMatch(shift,/beginEdit/);
});

test('read-only/calculated cells select only and do not call beginEdit',()=>{
  const fn=between(sheet,'function kolSpreadsheetHandlePointerEdit','function kolSpreadsheetResumePendingPointerEdit');
  const ro=fn.slice(fn.indexOf('if(!editable)'),fn.indexOf('const identity='));
  assert.match(ro,/setActive\(td\)/);
  assert.doesNotMatch(ro,/beginEdit/);
  assert.match(fn,/meta\?\.editable&&bridge\(\)\?\.canEdit/);
});

test('buttons links pictures and row numbers retain special non-edit behavior',()=>{
  const bind=between(sheet,"table.addEventListener('pointerdown'","table.addEventListener('contextmenu'");
  assert.match(bind,/kolSpreadsheetRowNumber/);
  assert.match(bind,/img\.kolThumb/);
  assert.match(bind,/button:not\(\.kolSpreadsheetRowNumber\),a/);
});

test('pointer edit does not select-all while keyboard F2 keeps existing select behavior',()=>{
  const begin=between(sheet,'function beginEdit','function pointerEditIdentity');
  assert.match(begin,/source='keyboard'/);
  assert.match(begin,/selectAll=source!==\'pointer\'/);
  const pointer=between(sheet,'function kolSpreadsheetHandlePointerEdit','function kolSpreadsheetResumePendingPointerEdit');
  assert.match(pointer,/source:'pointer',selectAll:false/);
});

test('pointer target is stored by rowId/key and resumed after a rerender',()=>{
  assert.match(sheet,/pendingPointerEdit:null/);
  assert.match(sheet,/function pointerEditIdentity/);
  assert.match(sheet,/function findCellByIdentity/);
  assert.match(sheet,/function kolSpreadsheetResumePendingPointerEdit/);
  const render=between(sheet,'function afterRender','function selectWholeSpreadsheetRow');
  assert.match(render,/pendingPointerEdit&&kolSpreadsheetResumePendingPointerEdit\(\)/);
});

test('focus transitions clear editing state but preserve the stable spreadsheet selection',()=>{
  const focus=between(sheet,"document.addEventListener('focusin'","document.addEventListener('focusout'");
  assert.match(focus,/sameCellIdentity\(state\.pendingPointerEdit,coord\)/);
  const out=between(sheet,"document.addEventListener('focusout'",'function init()');
  assert.match(out,/state\.editingCell=null/);
  assert.doesNotMatch(out,/clearActiveIfMatches\(/);
});

test('Ctrl+C from a focused Collection editor copies spreadsheet cell/range unless text is explicitly selected',()=>{
  assert.match(sheet,/function editorNativeSelection/);
  const copy=between(sheet,'function handleCopyShortcut','function targetPlan');
  assert.match(copy,/gridEditor&&editorNativeSelection\(gridEditor\)/);
  assert.match(copy,/selectedClipboard\(\)/);
  assert.match(copy,/writeClipboard\(payload\.html,payload\.plain\)/);
  const globalCopy=between(app,'function blActiveCopyButton',"document.getElementById('navCopy')");
  assert.ok(globalCopy.indexOf('handleCopyShortcut')<globalCopy.indexOf("target.closest('input,textarea,select"));
});

test('matrix paste is intercepted from a focused editor while a single scalar paste stays native',()=>{
  const bind=between(sheet,'function bind(){',"q('kolSpreadsheetPasteBtn')");
  assert.match(bind,/matrixLike=\/\\t\/\.test\(text\)/);
  assert.match(bind,/if\(gridEditor&&!matrixLike\)return/);
  assert.match(bind,/void pasteText\(text\)/);
});

test('legacy Collection matrix paste is bypassed whenever Spreadsheet V3 is active',()=>{
  const legacy=between(app,"document.addEventListener('paste',e=>{","document.addEventListener('keydown',e=>{");
  assert.match(legacy,/Spreadsheet V3\+ owns matrix paste/);
  assert.match(legacy,/if\(window\.BLCollectionSpreadsheet\?\.enabled\?\.\(\)\)return/);
});


test('compound label clicks preserve the native target editor instead of forcing the first cell editor',()=>{
  const fn=between(sheet,'function kolSpreadsheetHandlePointerEdit','function kolSpreadsheetResumePendingPointerEdit');
  assert.match(fn,/closest\?\.\('label'\)\?\.querySelector\?\.\('\.editCell:not\(:disabled\)'\)/);
});

test('multiline Collection notes keep native newline paste unless the clipboard is tabular',()=>{
  const bind=between(sheet,'function bind(){',"q('kolSpreadsheetPasteBtn')");
  assert.match(bind,/gridEditor\?\.dataset\?\.k==='not'/);
  assert.match(bind,/gridEditor\.tagName==='TEXTAREA'/);
  assert.match(bind,/!\/\\t\/\.test\(text\)/);
});

test('single click itself has no persistence/calculation calls',()=>{
  const fn=between(sheet,'function kolSpreadsheetHandlePointerEdit','function kolSpreadsheetResumePendingPointerEdit');
  for(const forbidden of ['renderKol','saveKolRows','syncModelFields','kolApplyRulePricing','kolLandedCalc','batchEdit'])assert.doesNotMatch(fn,new RegExp(forbidden));
});
