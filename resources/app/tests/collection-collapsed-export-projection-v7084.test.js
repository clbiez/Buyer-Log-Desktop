'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Groups = require('../public/collection-model-groups.js');
const FabricCards = require('../public/fabric-cards-engine.js');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const SHEET = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.js'), 'utf8');

function between(startText,endText){
  const start=APP.indexOf(startText),end=APP.indexOf(endText,start+startText.length);
  assert.ok(start>=0&&end>start,`missing block ${startText}`);
  return APP.slice(start,end);
}

function makeRows(){
  let rows=Groups.normalizeRows([
    {id:1,plmId:'100',modelKod:'DRYTOUCH-1',inStoreMonth:'2026-10',colour:'NEW BLACK',colourCode:'BLK',quantity:'5000',fabric:'Cotton',not:'Parent note'},
    {id:2,plmId:'100',modelKod:'DRYTOUCH-1',inStoreMonth:'2026-10',colour:'GREY',colourCode:'GRY',quantity:'10000',fabric:'Cotton',not:'Parent note'},
    {id:3,plmId:'100',modelKod:'DRYTOUCH-1',inStoreMonth:'2026-10',colour:'NAVY',colourCode:'NVY',quantity:'2000',fabric:'Cotton',not:'Parent note'},
  ]).rows;
  const grey=rows.find(row=>row.colour==='GREY');
  const navy=rows.find(row=>row.colour==='NAVY');
  rows=Groups.setVariantOverride(rows,grey.id,'fabric','Viscose');
  rows=Groups.setVariantOverride(rows,navy.id,'not','Navy note');
  return rows;
}

const descriptors=[
  {kind:'base',k:'modelKod',col:{k:'modelKod'}},
  {kind:'base',k:'colour',col:{k:'colour'}},
  {kind:'base',k:'colourCode',col:{k:'colourCode'}},
  {kind:'base',k:'quantity',col:{k:'quantity',qty:true}},
  {kind:'base',k:'fabric',col:{k:'fabric'}},
  {kind:'base',k:'not',col:{k:'not'}},
];

function loadEngine(rows,collapsed){
  const block=between("const KOL_GROUP_SUMMARY_SEPARATOR=' · ';",'// Ex-Factory/Retail arası gün sayısı');
  const number=value=>{
    if(value==null||String(value).trim()==='')return NaN;
    const s=String(value).trim().replace(/\./g,'').replace(',','.');
    const n=Number(s);return Number.isFinite(n)?n:NaN;
  };
  const groupIndex=list=>{
    const map=new Map();
    (list||[]).forEach(row=>{const id=String(row.modelGroupId||'');if(!id)return;const arr=map.get(id)||[];arr.push(row);map.set(id,arr);});
    return map;
  };
  const ctx={
    Map,Set,Number,String,Math,console,
    appLang:'en',kolRows:rows,
    kolFabricApi:()=>FabricCards,kolFabricCards:new Map(),
    kolEffectiveValue:(row,key)=>Groups.effectiveValue(row,key,ctx.kolRows),
    kolParseQuantityNum:number,kolParseMoneyNum:number,
    kolFormatQuantityDisplay:value=>Math.trunc(Number(value)).toLocaleString('tr-TR'),
    kolFormatMoneyDisplay:value=>Number(String(value).replace(',','.')).toFixed(2).replace('.',','),
    kolFormatPercentDisplay:value=>`${Number(String(value).replace(',','.')).toFixed(2).replace('.',',')}%`,
    kolFormatHologramDisplay:value=>String(value??''),
    columnSchemaFor:()=>null,fmtDate:value=>String(value||''),kolWeekDisplay:value=>String(value||''),kolMonthDisplay:value=>String(value||''),transitDelTypeDisplay:value=>String(value||''),L:value=>String(value||''),norm:value=>String(value??''),
    kolBestPricing:()=>null,kolConfirmedDisplay:()=>null,kolLandedCalc:()=>({trLanded:null,ydLanded:null}),kolExToRetailDays:()=>'',
    endeksmatikMoney:value=>String(value),endeksmatikPct:value=>String(value),kolEffectiveEndeksmatikRow:row=>row,
    filteredKol:()=>ctx.kolRows,kolDisplayDescriptors:()=>descriptors,kolLoadCollapsedGroups:()=>collapsed,kolGroupMembersIndex:groupIndex,
  };
  ctx.kolPresentationRows=logical=>{
    const list=Array.isArray(logical)?logical:ctx.kolRows;
    if(!collapsed.size)return list.slice();
    const all=groupIndex(ctx.kolRows),logicalIds=new Set(list.map(row=>String(row.id)));
    return list.filter(row=>{
      const gid=String(row.modelGroupId||'');if(!gid||!collapsed.has(gid))return true;
      const members=all.get(gid)||[];if(members.length<2)return true;
      const parent=members.find(item=>item.modelGroupRole==='parent')||members[0];
      if(!logicalIds.has(String(parent.id)))return true;
      return String(row.id)===String(parent.id);
    });
  };
  vm.createContext(ctx);
  const fabricDisplay=between('const kolFabricDisplayCache=new Map();','/* Kumaş hücresinin içi:');
  vm.runInContext(`${fabricDisplay}\n${block}\nglobalThis.__projection=kolCollectionExportProjection;globalThis.__text=kolCollectionExportCellText;globalThis.__selected=kolCollectionProjectionSelected;`,ctx);
  return ctx;
}

test('expanded group projects every real colour row',()=>{
  const rows=makeRows(),ctx=loadEngine(rows,new Set());
  const projected=ctx.__projection(rows,descriptors);
  assert.equal(projected.length,3);
  assert.deepEqual(Array.from(projected,row=>row.row.colour),['NEW BLACK','GREY','NAVY']);
  assert.ok(projected.every(record=>record.collapsed===false));
});

test('collapsed group projects one row whose exported cells are the canonical Group Summary',()=>{
  const rows=makeRows(),groupId=String(rows[0].modelGroupId),ctx=loadEngine(rows,new Set([groupId]));
  const projected=ctx.__projection(rows,descriptors);
  assert.equal(projected.length,1);
  const record=projected[0];
  assert.equal(record.collapsed,true);
  const byKey=Object.fromEntries(descriptors.map(col=>[col.k,ctx.__text(col,record)]));
  assert.equal(byKey.colour,'NEW BLACK · GREY · NAVY');
  assert.equal(byKey.colourCode,'BLK · GRY · NVY');
  assert.equal(byKey.quantity,'17.000 / 3 Colours');
  assert.equal(byKey.fabric,'Cotton · Viscose','colour override must participate in summary/export');
  assert.equal(byKey.not,'Parent note · Navy note');
});

test('hidden selected child maps to its single visible collapsed summary row',()=>{
  const rows=makeRows(),groupId=String(rows[0].modelGroupId),ctx=loadEngine(rows,new Set([groupId]));
  const record=ctx.__projection(rows,descriptors)[0];
  const hiddenChild=rows.find(row=>row.modelGroupRole==='variant');
  assert.equal(ctx.__selected(record,new Set([hiddenChild.id])),true);
});

test('Collection copy/export call sites share the projection rather than raw parent rows',()=>{
  assert.match(APP,/kolTable:\s*\{[\s\S]*?rowsFn:\(\)=>kolCollectionExportProjection\(filteredKol\(\)\)/);
  assert.match(APP,/cellText:\s*\(col,record\)=>kolCollectionExportCellText\(col,record\)/);
  assert.match(APP,/function buildCollectionStyledCopy[\s\S]*?const all=meta\.rowsFn\(\)/);
  assert.match(APP,/function kolExportSelection\(\)[\s\S]*?kolCollectionExportProjection\(logical\)/);
  assert.match(APP,/async function kolExportWithImages[\s\S]*?const summaryEntry=summary\?\.get\?\.\(d\.k\)[\s\S]*?cell\.value=kolExportSingleLineText\(summaryEntry\.display\)/);
  assert.match(APP,/kolStyleMgmtExportBtn[\s\S]*?kolRawExportSelection\(\)/,'editable/import-compatible Style Management export must stay raw');
});

test('spreadsheet Ctrl+C takes the rendered canonical summary display for collapsed cells only',()=>{
  assert.match(SHEET,/function valueForCoord\(coord,liveRows=null\)\{[^}]*dataset\?\.kolGroupSummary==='1'[^}]*kolSummaryDisplay/);
  assert.match(SHEET,/bridge\(\)\?\.rawValue\?\.\(row,coord\.key\)/,'expanded/non-summary cells preserve existing raw clipboard behavior');
});

for(const lang of ['tr','en'])test(`collapsed fabric uses the same ${lang} card summary as expanded rows and keeps raw data`,()=>{
  let rows=makeRows();
  const raw='3859-Suprem,30/1 Ne Compact Penye Pamuk,150 gsm,%100 Pamuk';
  rows=Groups.clearVariantOverride(rows,rows.find(row=>row.colour==='GREY').id,'fabric');
  rows=Groups.setSharedValue(rows,rows[0].modelGroupId,'fabric',raw);
  const ctx=loadEngine(rows,new Set([String(rows[0].modelGroupId)]));
  ctx.appLang=lang;
  ctx.kolFabricCards.set('3859',{code:'3859',summary:'Süprem · 30/1 Ne · 150 gsm · %100 Pamuk',summaryEn:'Single Jersey · 30/1 Ne · 150 gsm · 100% Cotton'});
  const before=JSON.stringify(rows),record=ctx.__projection(rows,descriptors)[0];
  const text=ctx.__text(descriptors.find(d=>d.k==='fabric'),record);
  assert.equal(text,FabricCards.displayText(raw,ctx.kolFabricCards,lang));
  assert.doesNotMatch(text,/Compact Penye/);
  assert.equal(JSON.stringify(rows),before,'view projection must preserve canonical PLM fabric');
});

test('collapsed fabric includes distinct effective colour overrides and falls back for a missing card',()=>{
  let rows=makeRows();
  const raw='3859-Suprem,30/1 Ne Compact Penye Pamuk,150 gsm,%100 Pamuk';
  rows=Groups.clearVariantOverride(rows,rows.find(row=>row.colour==='GREY').id,'fabric');
  rows=Groups.setSharedValue(rows,rows[0].modelGroupId,'fabric',raw);
  const grey=rows.find(row=>row.colour==='GREY');
  const missing='9999-Uncatalogued fabric';
  rows=Groups.setVariantOverride(rows,grey.id,'fabric',missing);
  const ctx=loadEngine(rows,new Set([String(rows[0].modelGroupId)]));
  ctx.kolFabricCards.set('3859',{summary:'Süprem',summaryEn:'Single Jersey'});
  const text=ctx.__text(descriptors.find(d=>d.k==='fabric'),ctx.__projection(rows,descriptors)[0]);
  assert.equal(text,'Single Jersey · '+missing);
});

test('collapsed multipart fabric preserves part labels and card summaries',()=>{
  let rows=makeRows();
  const raw='A - 3859-Long jersey information / B - 2832-Long rib information';
  rows=Groups.clearVariantOverride(rows,rows.find(row=>row.colour==='GREY').id,'fabric');
  rows=Groups.setSharedValue(rows,rows[0].modelGroupId,'fabric',raw);
  const ctx=loadEngine(rows,new Set([String(rows[0].modelGroupId)]));
  ctx.kolFabricCards.set('3859',{summary:'Süprem',summaryEn:'Single Jersey'});
  ctx.kolFabricCards.set('2832',{summary:'Ribana',summaryEn:'Rib'});
  const text=ctx.__text(descriptors.find(d=>d.k==='fabric'),ctx.__projection(rows,descriptors)[0]);
  assert.equal(text,'A · 3859 · Single Jersey / B · 2832 · Rib');
});
