'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const QUOT = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');
const QUOT_STORE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'quotations-store.js'), 'utf8');
const PARSE = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'parse.js'), 'utf8');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const quotationStore = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));

test('v4.76 Backlog pivot includes vehicle type from operational delivery type', () => {
  assert.match(PARSE, /vehicle:\s*o\s*=>\s*o\._delType\s*\|\|\s*'\(boş\)'/);
  assert.match(PARSE, /vehicle:\s*'Vasıta Tipi'/);
  assert.match(INDEX, /vehicle:'Del\. Type'/);
  assert.match(INDEX, /BACKLOG_DIM_ORDER\s*=\s*\[[^\]]*'vehicle'/);
  assert.match(INDEX, /vehicle:'Vasıta Tipi'/);
  const order={
    ocode:1001,model:'MODEL',ccode:'C1',colour:'BLACK',season:'W6',countryRaw:'MISIR',
    manufacturer:'MFR',license:'LICENSE',category:'KNIT',merch:'12',ageGroup:'A1',
    buyer:'BUYER',buyerGrup:'GROUP',line:'LINE 1',qty:100,kalan:100,fob:5,
    opd:new Date(2026,0,1),ex:new Date(2026,7,1),retail:new Date(2026,9,7),
    mb:new Date(2026,8,23),merkezSevkeHazirKalan:0,
  };
  const ov={notesmap:{},submap:{},suppfobmap:{},suppfobmetamap:{},delmap:{},licensormap:{},datemap:{},pricingRules:[],transitRules:[]};
  const report=parse.buildBacklogGrouped([order],{},ov,{groupBy:['vehicle']});
  assert.deepEqual(report.dimValues.vehicle,['Gemi']);
  assert.equal(report.tree[0].label,'Gemi');
});

test('v4.76 Collection has Special Code and Line as persistent editable columns', () => {
  const cols = INDEX.slice(INDEX.indexOf('const KOL_COLS = ['), INDEX.indexOf('let kolCustomCols'));
  assert.match(cols, /\{k:'specialCode', label:'Special Code'/);
  assert.match(cols, /\{k:'line', label:'Line'/);
  assert.ok(cols.indexOf("k:'specialCode'") < cols.indexOf("k:'line'"));
  assert.match(INDEX, /\['plmId','productMainDefinition','specialCode','line'[\s\S]*?'fabric'/);
  assert.match(INDEX, /specialCode:\s*norm\(r\['Special Code'\]\)/);
  assert.match(INDEX, /line:\s*norm\(r\['Line'\]\)/);
  assert.match(INDEX, /add\('specialCode','SPECIAL CODE'/);
  assert.match(INDEX, /add\('line','LINE','HAT'\)/);
});

test('v4.76 quotation records are detached from Notebook storage', () => {
  assert.doesNotMatch(QUOT, /function qSyncNotebook|function qNotebookText|notebookPageId|qRemoveNotebookPage/);
  assert.doesNotMatch(QUOT_STORE, /notebookPageId/);
  assert.match(QUOT, /NOTEBOOK_DETACH_KEY\s*=\s*'lcw\.quotations\.notebookDetached\.v4\.76'/);
  assert.match(QUOT, /filter\(page=>page\?\.type!=='quotation'&&!qNorm\(page\?\.quotationId\)\)/);
  assert.match(QUOT, /qReady=qHydrateShared\(\)\.then\(result=>\{qDetachLegacyNotebookPages\(\);return result;\}\)/);
  const normalized=quotationStore.normalizeRequest({
    id:'quotation-v476',ownerId:'buyer',notebookPageId:'legacy-page',
    manufacturers:[{name:'MFR'}],items:[{id:'line',modelKey:'kol:1',manufacturer:'MFR'}],
  });
  assert.equal(Object.hasOwn(normalized,'notebookPageId'),false);
});

test('v4.78 freeze picker uses a single laser boundary and freezes its left side', () => {
  assert.match(INDEX, /_freezePick=\{tableId,tableKey,trigger:actualTrigger,hoverIndex:null,laser:null\}/);
  assert.match(INDEX, /function freezeMoveLaser\(event\)/);
  assert.match(INDEX, /line\.className='freezeLaser'/);
  assert.match(INDEX, /const count=pick\.hoverIndex\+1;\s*setFreeze\(pick\.tableKey,count\)/);
  assert.doesNotMatch(INDEX, /freezeRenderBar|_freezePick\.second|freezeClosed|freezeOpen/);
  assert.match(CSS, /\.freezeLaser\{[^}]*background:linear-gradient/s);
  assert.match(CSS, /\.navActionBtn\.freezeOn,\.lflCpTableTool\.freezeOn/);
});

test('v4.76 freeze offsets are recalculated after resizing and grouped headers freeze too', () => {
  assert.match(INDEX, /applyColgroupWidths\(table,tableKey,withChk\);\s*applyFreeze\(table\.id,tableKey,withChk\)/);
  assert.match(INDEX, /applyFreeze\('kolTable','koleksiyon',true\)/);
  assert.match(INDEX, /groupRow\.querySelectorAll\('th\[data-start\]\[data-end\]'\)/);
  assert.match(INDEX, /data-start="\$\{r\.start\}" data-end="\$\{r\.end\}"/);
  assert.match(INDEX, /freezeRefreshTable\(tableId,tableKey\)/);
});

test('v4.76 CP and Orders group headers move all columns in the group together', () => {
  assert.match(INDEX, /function moveColumnGroup\(tableKey,sourceGroup,targetGroup,before\)/);
  assert.match(INDEX, /const sourceKeys=cs\.order\.filter\(key=>byKey\[key\]\?\.group===sourceGroup\)/);
  assert.match(INDEX, /remaining\.splice\(insertAt,0,\.\.\.sourceKeys\)/);
  assert.match(INDEX, /if\(opts\.withGroups&&\['cp','orders'\]\.includes\(tableKey\)\)/);
  assert.match(INDEX, /attachGroupDrag\(th,th\.dataset\.grp,tableKey,rerenderGroups\)/);
  assert.match(CSS, /th\.draggableGroup\{cursor:grab;\}/);
});
