'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
const html=read('public/index.html'),app=read('public/app-main.js'),sheet=read('public/collection-spreadsheet.js'),css=read('public/collection-spreadsheet.css'),q=read('public/quotations.js');

test('Collection has no pricing KPI/selection-summary DOM and remains full-width',()=>{
  assert.doesNotMatch(html,/id="kolPricingActionBar"|id="kolPricingSelectionSummary"|id="kolPricingLayout"/);
  assert.doesNotMatch(css,/kolPricingActionBar|kolPricingSelectionSummary|kolPricingLayout/);
  assert.match(q,/spreadsheet-first/);assert.match(q,/kolPricingActionBar'\)\?\.remove/);
});

test('Send to Pricing is the first Tools action and Quotations/Pricing History stay out of Tools',()=>{
  const menu=html.match(/<div class="toolbarMoreMenu" id="kolToolsMenu" hidden>([\s\S]*?)<\/div>\s*<\/div>/)?.[1]||'';
  assert.ok(menu.indexOf('id="kolSendPricingBtn"')>=0);
  assert.ok(menu.indexOf('id="kolSendPricingBtn"')<menu.indexOf('id="kolLicenseRoyaltyBtn"'));
  assert.match(menu,/kolSendPricingBtn[\s\S]*toolbarMoreDivider[\s\S]*kolLicenseRoyaltyBtn/);
  assert.doesNotMatch(menu,/kolQuotationsBtn|kolPriceHistoryBtn/);
  assert.match(html,/data-tab="quotations"/);assert.match(html,/data-tab="pricinghistory"/);
  assert.match(app,/kolSendPricingBtn'\)\?\.addEventListener\('click'/);
  assert.match(app,/openSendToPricing/);
});

test('Collection keeps the compact selection helper but removes Formula/fx and View UI completely',()=>{
  for(const id of ['kolSpreadsheetPasteBtn','kolSelectedCount','kolSpreadsheetStatusBar'])assert.match(html,new RegExp(`id=\"${id}\"`));
  for(const id of ['kolSpreadsheetViewWrap','kolSpreadsheetViewBtn','kolSpreadsheetViewMenu','kolFormulaBar','kolFormulaName','kolFormulaValue','kolFormulaHint'])assert.doesNotMatch(html,new RegExp(`id=\"${id}\"`));
  assert.doesNotMatch(html,/>fx</);
  assert.doesNotMatch(sheet,/PREF_KEY|showFormula|showLetters|data-kol-density|data-kol-view-toggle|kolSpreadsheetViewBtn|kolFormulaValue/);
  assert.match(html,/collection-spreadsheet\.css/);assert.match(html,/collection-spreadsheet-engine\.js/);assert.match(html,/collection-spreadsheet\.js/);
});

test('active-cell navigation is independent from business checkbox selection and does not render on Arrow keys',()=>{
  assert.match(sheet,/function setActive\(/);assert.match(sheet,/function move\(/);assert.match(sheet,/const extend=e\.shiftKey/);
  const keyboard=sheet.slice(sheet.indexOf("table.addEventListener('keydown'"),sheet.indexOf("document.addEventListener('paste'"));
  assert.match(keyboard,/ArrowDown/);assert.match(keyboard,/F2/);assert.doesNotMatch(keyboard,/renderKol|bridge\(\)\?\.render/);
  assert.doesNotMatch(sheet,/rowChk.*checked\s*=/s);
});

test('single click enters editable Collection cells while F2 remains a keyboard edit entry',()=>{
  assert.match(sheet,/pointerdown[\s\S]*kolSpreadsheetHandlePointerEdit\(e,td\)/);
  assert.match(sheet,/function kolSpreadsheetHandlePointerEdit\(/);assert.match(sheet,/beginEdit\(td,\{source:'pointer'/);assert.match(sheet,/e\.key==='F2'/);
  assert.doesNotMatch(sheet,/addEventListener\('dblclick'[\s\S]*beginEdit\(td\)/);
  assert.match(app,/if\(window\.BLCollectionSpreadsheet\?\.enabled\?\.\(\)\)return;/);
});

test('column metadata protects calculated/derived fields and keeps calculation explanations for read-only tooltips',()=>{
  assert.match(app,/function kolSpreadsheetColumnMeta\(/);assert.match(app,/ruleReadonly\|\|c\.formulaReadonly\|\|c\.exToRetail\|\|c\.endeksmatik\|\|c\.ydLanded\|\|c\.trLanded/);
  assert.match(app,/Calculated from current valid quotations/);assert.match(app,/Approved quotation price/);assert.match(app,/Endeksmatik benchmark engine/);assert.match(app,/landed-cost engine/);
  assert.match(app,/if\(!meta\.editable\)return \{ok:false,reason:'calculated'\}/);
});

test('multi-cell paste validates first and uses one undo + one save + one render transaction',()=>{
  assert.match(sheet,/function targetPlan\(/);assert.match(sheet,/Paste Preview|Yapıştırma Önizlemesi/);assert.match(sheet,/calculated\/read-only skipped/);
  const batch=app.slice(app.indexOf('function kolSpreadsheetBatchEdit('),app.indexOf('function kolSpreadsheetSetColumnWidth',app.indexOf('function kolSpreadsheetBatchEdit(')));
  assert.equal((batch.match(/kolPushUndo\(\)/g)||[]).length,1);
  assert.equal((batch.match(/saveKolRows\(\)/g)||[]).length,1);
  assert.equal((batch.match(/renderKol\(\)/g)||[]).length,2); // success + rollback only, never per cell
  assert.match(batch,/pushUndo:false,save:false,syncQuotations:false/);
  assert.match(batch,/kolRows=before/);
});

test('single-cell paste with no TAB is treated as scalar text and never expands into extra rows',()=>{
  assert.match(sheet,/function isSingleCellPasteTarget\(\)/);
  const pasteFn=sheet.slice(sheet.indexOf('async function pasteText('),sheet.indexOf('function restoreActiveAfterRender('));
  assert.match(pasteFn,/const scalarPaste=!\/\\t\/\.test\(text\)&&isSingleCellPasteTarget\(\)/);
  assert.match(pasteFn,/scalarPaste\?\[\[Engine\.normalizeSingleCellPasteText\(text\)\]\]/);
  assert.match(sheet,/function isSingleCellPasteTarget\(\)\{if\(selectedCoordinates\(\)\.length\|\|state\.wholeRowSelection\)return false;/);
});

test('document-level paste handler only treats grid-editor input as matrix-like when TAB is present, so plain multiline text reaches native editors untouched',()=>{
  const pasteListenerStart=sheet.indexOf("document.addEventListener('paste',e=>");
  const pasteListener=sheet.slice(pasteListenerStart,sheet.indexOf("q('kolSpreadsheetPasteBtn')",pasteListenerStart));
  assert.match(pasteListener,/matrixLike=\/\\t\/\.test\(text\)/);
  assert.doesNotMatch(pasteListener,/matrixLike=\/\[\\t\\r\\n\]\//);
});

test('Ctrl+C gives spreadsheet range priority before business-row Copy button',()=>{
  const copyStart=app.indexOf('function blActiveCopyButton');const copy=app.slice(copyStart,app.indexOf("document.getElementById('navCopy')",copyStart));
  assert.match(copy,/BLCollectionSpreadsheet\?\.handleCopyShortcut/);
  assert.ok(copy.indexOf('handleCopyShortcut')<copy.indexOf('blActiveCopyButton();'));
  assert.match(sheet,/function selectedClipboard\(/);
  assert.match(sheet,/exporter\.toTSV\(safe\)/);
  assert.match(sheet,/exporter\.toSafeHTML\(safe\)/);
});

test('row numbers and column letters are transient UI, not persisted schema fields',()=>{
  assert.match(app,/kolSpreadsheetRowNumber/);assert.match(sheet,/Engine\.columnLetter/);
  assert.doesNotMatch(app,/kolColOrder[^\n]*columnLetter/);assert.doesNotMatch(app,/KOL_COL_STATE_KEY[^\n]*activeCell/);
});

test('resize double click AutoFits and freeze reuses existing sticky freeze implementation',()=>{
  const resize=app.slice(app.indexOf('function attachKolColResize'),app.indexOf('function openKolCheckFilter'));
  assert.match(resize,/dblclick/);assert.match(resize,/autoFitColumn/);assert.doesNotMatch(resize,/attachCollapseOnDoubleClick/);
  assert.match(app,/function kolSpreadsheetFreezeToKey/);assert.match(app,/setFreeze\('koleksiyon',left\)/);assert.match(app,/applyFreeze\('kolTable','koleksiyon',true\)/);
});



test('Tab skips calculated cells while read-only workspaces keep visible-cell navigation',()=>{
  const moveTab=sheet.slice(sheet.indexOf('function moveTab('),sheet.indexOf('function beginEdit',sheet.indexOf('function moveTab(')));
  assert.match(moveTab,/editableOnly=Boolean\(bridge\(\)\?\.canEdit/);
  assert.match(moveTab,/columnMeta\?\.\(td\.dataset\.key\)\?\.editable/);
  assert.match(moveTab,/if\(!editableOnly\|\|/);
});

test('validated dropdown paste uses the existing input commit path without detached-select value loss',()=>{
  const makeEditor=app.slice(app.indexOf('function kolSpreadsheetMakeEditor('),app.indexOf('function kolSpreadsheetBatchEdit',app.indexOf('function kolSpreadsheetMakeEditor(')));
  assert.match(makeEditor,/document\.createElement\('input'\)/);
  assert.doesNotMatch(makeEditor,/createElement\(c\?\.select\?'select'/);
  const validate=app.slice(app.indexOf('function kolSpreadsheetValidateValue('),app.indexOf('function kolSpreadsheetMakeEditor',app.indexOf('function kolSpreadsheetValidateValue(')));
  assert.match(validate,/c\?\.select&&raw/);assert.match(validate,/invalid-option/);
});


test('Collection filter dropdown adds Excel-like sort/search/select-all controls without replacing filter semantics',()=>{
  const filter=app.slice(app.indexOf('function openKolHeaderFilter('),app.indexOf("document.getElementById('kolClearColFiltersBtn')",app.indexOf('function openKolHeaderFilter(')));
  assert.match(filter,/data-kol-filter-sort/);assert.match(filter,/Smallest → Largest/);assert.match(filter,/Oldest → Newest/);assert.match(filter,/Search values…/);assert.match(filter,/Select All/);
  assert.match(filter,/parseTableSearchTerms\(query\)/);assert.match(filter,/tableSearchMatches\(v,terms,\{plainMode:'contains'\}\)/);assert.match(filter,/kolColFilters\[key\]/);assert.match(filter,/kolSort=\{key,dir/);
});


test('completed cell edits clear edit styling without losing clipboard selection identity',()=>{
  assert.match(app,/Spreadsheet V3 owns Collection cell focus\/selection/);
  const legacy=app.slice(app.indexOf('function kolMarkActiveGridCell'),app.indexOf('function kolEditorIdentity',app.indexOf('function kolMarkActiveGridCell')));
  assert.match(legacy,/BLCollectionSpreadsheet\?\.enabled/);
  assert.match(legacy,/kolClearActiveGridCell\(\);return/);
  assert.match(sheet,/function clearActiveIfMatches\(/);
  const focusout=sheet.slice(sheet.indexOf("document.addEventListener('focusout'"),sheet.indexOf('function init()',sheet.indexOf("document.addEventListener('focusout'")));
  assert.match(focusout,/state\.editingCell=null/);
  assert.doesNotMatch(focusout,/clearActiveIfMatches\(/);
  assert.match(focusout,/document\.activeElement\?\.closest\?\.\('#kolTable \.editCell'\)/);
});

test('new Collection CSS is namespaced and uses Buyer Log accent rather than Excel green branding',()=>{
  assert.match(css,/#view-koleksiyon\.kolSpreadsheetWorkspace/);assert.match(css,/var\(--acc\)/);assert.doesNotMatch(css,/#217346/i);
  assert.doesNotMatch(css,/(^|\n)\s*(table|td|th|input|button)\s*\{/);
});
