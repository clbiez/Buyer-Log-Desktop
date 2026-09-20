'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Groups = require('../public/collection-model-groups.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.css'), 'utf8');

function sourceBetween(startText, endText) {
  const start = APP.indexOf(startText);
  const end = APP.indexOf(endText, start + startText.length);
  assert.ok(start >= 0 && end > start, `missing source block: ${startText}`);
  return APP.slice(start, end);
}

function loadOverrideSpec() {
  const block = sourceBetween('const KOL_COLOUR_OVERRIDE_PROJECTION_KEYS', '/* v7.81 — Bu hücre');
  const descriptors = new Map([
    ['targetPrice', {kind:'base', col:{k:'targetPrice',money:true}}],
    ['endeksmatik', {kind:'base', col:{k:'endeksmatik',endeksmatik:true}}],
    ['trLanded', {kind:'base', col:{k:'trLanded',trLanded:true}}],
    ['ydLanded', {kind:'base', col:{k:'ydLanded',ydLanded:true}}],
    ['fob', {kind:'base', col:{k:'fob',formulaReadonly:true,money:true}}],
    ['cx_test', {kind:'base', col:{k:'cx_test',custom:true}}],
    ['colour', {kind:'base', col:{k:'colour'}}],
  ]);
  const ctx = {
    KOL_LANDED_INPUT_COLS:{trPrice:{k:'trPrice'},trLandedMult:{k:'trLandedMult'},trFx:{k:'trFx'},ydLandedMult:{k:'ydLandedMult'}},
    kolIsColorSpecific:key=>['quantity','img','imgRef','colour','colourCode','durum','status'].includes(key),
    kolDescriptorByKey:key=>descriptors.get(key)||{kind:'synthetic',k:key,label:key},
  };
  vm.createContext(ctx);
  vm.runInContext(`${block}\nglobalThis.__spec=kolColourOverrideSpec;`, ctx);
  return ctx.__spec;
}

function loadSummaryEngine(rowsRef) {
  const block = sourceBetween("const KOL_GROUP_SUMMARY_SEPARATOR=' · ';", '// Ex-Factory/Retail arası gün sayısı');
  const number = value => {
    if (value == null || value === '') return NaN;
    const n = Number(String(value).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  };
  const ctx = {
    Map, Set, Number, String, Math, console,
    appLang:'en',
    kolRows: rowsRef,
    kolEffectiveValue:(row,key)=>Groups.effectiveValue(row,key,ctx.kolRows),
    kolParseQuantityNum:number,
    kolParseMoneyNum:number,
    kolFormatQuantityDisplay:value=>Number(value).toLocaleString('en-US',{maximumFractionDigits:2}),
    kolFormatMoneyDisplay:value=>Number(String(value).replace(',','.')).toFixed(2),
    kolFormatPercentDisplay:value=>`${Number(String(value).replace(',','.')).toFixed(2)}%`,
    kolFormatHologramDisplay:value=>String(value),
    columnSchemaFor:column=>column.custom&&column.dataType==='currency'?{dataType:'currency',format:value=>`$${Number(value).toFixed(2)}`}:(column.custom?{dataType:column.dataType||'text',format:value=>String(value??'')}:null),
    fmtDate:value=>String(value||''),
    kolWeekDisplay:value=>String(value||''),
    kolMonthDisplay:value=>String(value||''),
    transitDelTypeDisplay:value=>String(value||''),
    L:value=>String(value||''),
    kolBestPricing:()=>null,
    kolConfirmedDisplay:()=>null,
    kolLandedCalc:row=>({trLanded:Number(row.trLandedCalc),ydLanded:Number(row.ydLandedCalc)}),
    kolExToRetailDays:row=>row.exToRetailCalc||'',
    endeksmatikMoney:(value,currency)=>`${currency==='TRY'?'₺':'$'}${Number(value).toFixed(2)}`,
    endeksmatikPct:value=>`${Number(value).toFixed(2)}%`,
  };
  ctx.kolEffectiveEndeksmatikRow = row => {
    const data=Groups.effectiveValue(row,'endeksmatikData',ctx.kolRows);
    return data&&typeof data==='object'?{...row,endeksmatikData:data}:row;
  };
  vm.createContext(ctx);
  vm.runInContext(`${block}\nglobalThis.__summary=kolCollapsedGroupSummary;`, ctx);
  return {ctx, summary:ctx.__summary};
}

function normalizedThree() {
  return Groups.normalizeRows([
    {id:1,plmId:'100',modelKod:'MODEL-X',inStoreMonth:'2026-10',colour:'BLACK',colourCode:'BLK',quantity:'5000',targetPrice:'10',supplier:'A',shipDate:'2026-10-01'},
    {id:2,plmId:'100',modelKod:'MODEL-X',inStoreMonth:'2026-10',colour:'NAVY',colourCode:'NVY',quantity:'10000',targetPrice:'',supplier:'',shipDate:''},
    {id:3,plmId:'100',modelKod:'MODEL-X',inStoreMonth:'2026-10',colour:'ECRU',colourCode:'ECR',quantity:'',targetPrice:'',supplier:'',shipDate:''},
  ]).rows;
}

const baseDescriptors = [
  {kind:'base',k:'colour',col:{k:'colour'}},
  {kind:'base',k:'colourCode',col:{k:'colourCode'}},
  {kind:'base',k:'quantity',col:{k:'quantity',qty:true}},
  {kind:'base',k:'targetPrice',col:{k:'targetPrice',money:true}},
  {kind:'base',k:'supplier',col:{k:'supplier'}},
  {kind:'base',k:'shipDate',col:{k:'shipDate',date:true}},
  {kind:'base',k:'cx_test',col:{k:'cx_test',custom:true,dataType:'text'}},
];

test('override eligibility is metadata-driven and maps projected cells to persisted storage keys', () => {
  const spec = loadOverrideSpec();
  assert.deepEqual(Array.from(spec('targetPrice').storageKeys), ['targetPrice']);
  assert.deepEqual(Array.from(spec('endeksmatik').storageKeys), ['endeksmatikData']);
  assert.deepEqual(Array.from(spec('trLanded').storageKeys), ['trPrice','trLandedMult','trFx']);
  assert.deepEqual(Array.from(spec('ydLanded').storageKeys), ['ydLandedMult']);
  assert.deepEqual(Array.from(spec('cx_test').storageKeys), ['cx_test']);
  assert.equal(spec('fob'), null, 'formula-only output must not get shadow override storage');
  assert.equal(spec('colour').alreadyColorSpecific, true);
  assert.equal(spec('__bestPrice__'), null, 'synthetic Best Price remains display-only');
});

test('one colour × one field override survives later parent edits without detaching sibling fields', () => {
  let rows = normalizedThree();
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  const navy = rows.find(r=>r.colour==='NAVY');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','100');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'supplier','A');
  rows = Groups.setVariantOverride(rows,navy.id,'targetPrice','110');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','120');
  const nextNavy = rows.find(r=>r.id===navy.id);
  const ecru = rows.find(r=>r.colour==='ECRU');
  assert.equal(Groups.effectiveValue(nextNavy,'targetPrice',rows),'110');
  assert.equal(Groups.effectiveValue(ecru,'targetPrice',rows),'120');
  assert.equal(Groups.effectiveValue(nextNavy,'supplier',rows),'A');
  assert.deepEqual(Object.keys(nextNavy.variantOverrides), ['targetPrice']);
});

test('Endeksmatik and custom fields use the same persisted variantOverrides architecture and survive reload', () => {
  let rows = normalizedThree();
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  const navy = rows.find(r=>r.colour==='NAVY');
  const sharedEndeks = {result:{prices:{usd:10},indexes:{targetUsd:2}}};
  const navyEndeks = {result:{prices:{usd:14},indexes:{targetUsd:3}}};
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'endeksmatikData',sharedEndeks);
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'cx_test','Model Value');
  rows = Groups.setVariantOverride(rows,navy.id,'endeksmatikData',navyEndeks);
  rows = Groups.setVariantOverride(rows,navy.id,'cx_test','Navy Value');
  const reloaded = Groups.normalizeRows(JSON.parse(JSON.stringify(rows))).rows;
  const reloadedNavy = reloaded.find(r=>r.id===navy.id);
  assert.equal(Groups.effectiveValue(reloadedNavy,'endeksmatikData',reloaded).result.prices.usd,14);
  assert.equal(Groups.effectiveValue(reloadedNavy,'cx_test',reloaded),'Navy Value');
  assert.equal(Object.prototype.hasOwnProperty.call(reloadedNavy.variantOverrides,'supplier'),false);
});

test('collapsed summary joins colours/codes/text, sums quantity, and preserves group order', () => {
  let rows = normalizedThree();
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  const navy = rows.find(r=>r.colour==='NAVY');
  const ecru = rows.find(r=>r.colour==='ECRU');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'supplier','A');
  rows = Groups.setVariantOverride(rows,navy.id,'supplier','B');
  rows = Groups.setVariantOverride(rows,ecru.id,'supplier','C');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'shipDate','2026-10-01');
  rows = Groups.setVariantOverride(rows,navy.id,'shipDate','2026-10-02');
  rows = Groups.setVariantOverride(rows,navy.id,'cx_test','Navy Custom');
  rows = Groups.setVariantOverride(rows,ecru.id,'cx_test','Ecru Custom');
  const engine = loadSummaryEngine(rows); engine.ctx.kolRows=rows;
  const summary = engine.summary(rows,baseDescriptors);
  assert.equal(summary.get('colour').display,'BLACK · NAVY · ECRU');
  assert.equal(summary.get('colourCode').display,'BLK · NVY · ECR');
  assert.equal(summary.get('quantity').display,'15,000 / 3 Colours');
  assert.equal(summary.get('supplier').display,'A · B · C');
  assert.equal(summary.get('shipDate').display,'2026-10-01 · 2026-10-02');
  assert.equal(summary.get('cx_test').display,'Navy Custom · Ecru Custom');
});

test('collapsed monetary summary is quantity-weighted, not arithmetic average', () => {
  let rows = normalizedThree().slice(0,2);
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  const navy = rows.find(r=>r.modelGroupRole==='variant');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','10');
  rows = Groups.setVariantOverride(rows,navy.id,'targetPrice','20');
  const engine = loadSummaryEngine(rows); engine.ctx.kolRows=rows;
  const summary = engine.summary(rows,baseDescriptors);
  assert.equal(summary.get('targetPrice').display,'$16.67');
  assert.notEqual(summary.get('targetPrice').display,'$15.00');
});

test('missing price quantity is excluded from the weighted denominator', () => {
  let rows = normalizedThree();
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  const navy = rows.find(r=>r.colour==='NAVY');
  const ecru = rows.find(r=>r.colour==='ECRU');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','10');
  rows = Groups.setVariantOverride(rows,navy.id,'targetPrice','');
  rows = Groups.setVariantOverride(rows,ecru.id,'targetPrice','20');
  // Give ECRU a usable quantity; NAVY's 10k must not enter the denominator.
  rows.find(r=>r.id===ecru.id).quantity='5000';
  const engine = loadSummaryEngine(rows); engine.ctx.kolRows=rows;
  const summary = engine.summary(rows,baseDescriptors);
  assert.equal(summary.get('targetPrice').display,'$15.00');
});

test('identical prices keep the normal common display instead of inventing a different aggregate', () => {
  let rows = normalizedThree();
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'targetPrice','10');
  const engine = loadSummaryEngine(rows); engine.ctx.kolRows=rows;
  const summary = engine.summary(rows,baseDescriptors);
  assert.equal(summary.get('targetPrice').display,'$10.00');
});

test('Endeksmatik summary weights colour-level benchmark price/rate by quantity and uses explicit child override', () => {
  let rows = normalizedThree().slice(0,2);
  const parent = rows.find(r=>r.modelGroupRole==='parent');
  const navy = rows.find(r=>r.modelGroupRole==='variant');
  rows = Groups.setSharedValue(rows,parent.modelGroupId,'endeksmatikData',{result:{prices:{usd:10,try:100},indexes:{targetUsd:2,targetTl:4}}});
  rows = Groups.setVariantOverride(rows,navy.id,'endeksmatikData',{result:{prices:{usd:20,try:200},indexes:{targetUsd:5,targetTl:7}}});
  const engine = loadSummaryEngine(rows); engine.ctx.kolRows=rows;
  const descriptors=[{kind:'base',k:'endeksmatik',col:{k:'endeksmatik',endeksmatik:true}}];
  const summary=engine.summary(rows,descriptors).get('endeksmatik');
  assert.equal(summary.display,'YD $16.67 · TR ₺166.67');
  assert.match(summary.title,/YD 4\.00% · TR 6\.00%/);
});

test('collapsed projection stays display-only while UI and visual export share the canonical summary resolver', () => {
  assert.match(APP,/const collapsedSummaryCache=new Map\(\)/);
  assert.match(APP,/groupSummary=kolCollapsedGroupSummary\(groupMembers,descriptors\)/);
  assert.match(APP,/data-kol-group-summary="1" data-kol-summary-display=/);
  assert.doesNotMatch(sourceBetween('function kolCollapsedGroupSummary(', '// Ex-Factory/Retail arası gün sayısı'),/saveKolRows|setSharedValue|setVariantOverride|row\[[^\]]+\]\s*=/);
  assert.match(CSS,/td\[data-kol-group-summary="1"\].*:not\(\.kolSpreadsheetEditing\):not\(:focus-within\)::after/);
  assert.match(CSS,/content:attr\(data-kol-summary-display\)/);
  assert.match(CSS,/text-overflow:ellipsis/);
  assert.match(APP,/function kolCollectionExportProjection\(/);
  assert.match(APP,/function kolCollectionExportCellText\(col,record\)/);
  assert.match(APP,/const entry=kolCollectionProjectionSummaryEntry\(record,col\?\.k\)/);
  assert.match(APP,/function kolSpreadsheetRawValue\(row,key\)/,'editor/raw lifecycle remains separate from display summary');
});

test('explicit Notes override is protected from legacy same-PLM propagation', () => {
  const commit = sourceBetween('function commitKolEditor(', 'function commitKolPriceEditor(');
  assert.match(commit,/peer\.modelGroupRole==='variant'&&kolHasVariantOverride\(peer,'not'\)\)return/);
  assert.match(commit,/if\(k==='not'&&!variantOverrideEdit\)/,'explicit colour note must not propagate back to parent/siblings');
});
