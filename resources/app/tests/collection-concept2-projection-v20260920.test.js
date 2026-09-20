'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const Groups = require('../public/collection-model-groups.js');
const Export = require('../public/table-export.js');

function extractFunction(name) {
  let start = APP.indexOf(`function ${name}(`);
  if (start < 0) start = APP.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const brace = APP.indexOf('{', start);
  let depth = 0, quote = null, escaped = false;
  for (let i=brace; i<APP.length; i+=1) {
    const ch = APP[i];
    if (quote) {
      if (escaped) { escaped=false; continue; }
      if (ch === '\\') { escaped=true; continue; }
      if (ch === quote) quote=null;
      continue;
    }
    if (ch==='"' || ch==="'" || ch==='`') { quote=ch; continue; }
    if (ch==='{') depth+=1;
    else if (ch==='}' && --depth===0) return APP.slice(start, i+1);
  }
  throw new Error(`unterminated ${name}`);
}

function row(id, group, role, colour, buyer) { return { id, modelGroupId:group, modelGroupRole:role, colour, buyer }; }

test('Concept 2 collapse yalnız presentation projection; logical colour records değişmez ve filtered child kaybolmaz', () => {
  const ctx = {
    console, window:{}, kolRows:[], kolSort:{key:null,dir:1}, kolTransientTopRowId:null,
    kolColDefs:()=>[{k:'colour'},{k:'buyer'}], columnSchemaFor:()=>null,
    kolEffectiveValue:(r,k)=>r[k], compareSeasonValues:(a,b)=>String(a).localeCompare(String(b)),
    norm:v=>String(v ?? ''), kolIsColorSpecific:key=>['colour','colourCode','quantity','status','durum','img','imgRef'].includes(key),
    kolExToRetailDays:()=>'', kolParseQuantityNum:v=>Number(v), kolParseMoneyNum:v=>Number(v),
    kolLoadCollapsedGroups:()=>ctx.collapsed || new Set(), filteredKol:()=>ctx.logical || [],
  };
  vm.createContext(ctx);
  for (const name of ['kolGroupMembersIndex','kolCompareRowsForActiveSort','kolGroupAwareOrder','kolPresentationRows']) vm.runInContext(extractFunction(name), ctx);
  const rows = [row(1,'A','parent','BLACK','Z'),row(4,'B','parent','NAVY','A'),row(2,'A','variant','RED','Z'),row(5,'B','variant','WHITE','A'),row(3,'A','variant','ECRU','Z')];
  ctx.kolRows = rows;
  const logical = ctx.kolGroupAwareOrder(rows);
  assert.deepEqual(Array.from(logical, item=>item.id), [1,2,3,4,5]);
  ctx.collapsed = new Set(['A']);
  assert.deepEqual(Array.from(ctx.kolPresentationRows(logical), item=>item.id), [1,4,5]);
  assert.equal(logical.length, 5, 'collapse logical data sayısını azaltmamalı');
  ctx.logical = [rows.find(item=>item.id===2)];
  assert.deepEqual(Array.from(ctx.kolPresentationRows(ctx.logical), item=>item.id), [2], 'filter sonucu yalnız child ise collapse onu yok etmemeli');
});

test('Concept 2 model group override/relink semantiği parent editte korunur', () => {
  let rows = Groups.normalizeRows([
    { id:11, plmId:'100', modelKod:'M', inStoreMonth:'2026-10', colour:'BLACK', colourCode:'01', buyer:'Main', quantity:1 },
    { id:12, plmId:'100', modelKod:'M', inStoreMonth:'2026-10', colour:'RED', colourCode:'02', buyer:'', quantity:2 },
  ]).rows;
  const parent = rows.find(item=>item.modelGroupRole==='parent');
  const child = rows.find(item=>item.modelGroupRole==='variant');
  rows = Groups.setSharedValue(rows, parent.modelGroupId, 'buyer', 'Parent A');
  assert.equal(Groups.effectiveValue(rows.find(item=>item.id===child.id), 'buyer', rows), 'Parent A');
  rows = Groups.setVariantOverride(rows, child.id, 'buyer', 'Child Only');
  rows = Groups.setSharedValue(rows, parent.modelGroupId, 'buyer', 'Parent B');
  assert.equal(Groups.effectiveValue(rows.find(item=>item.id===child.id), 'buyer', rows), 'Child Only');
  rows = Groups.clearVariantOverride(rows, child.id, 'buyer');
  assert.equal(Groups.effectiveValue(rows.find(item=>item.id===child.id), 'buyer', rows), 'Parent B');
});

test('Concept 2 UI hierarchy record-based copy/export contractına sızmaz', () => {
  const records = [
    {id:1,buyer:'A',colour:'BLACK'}, {id:2,buyer:'A',colour:'RED'},
    {id:3,buyer:'A',colour:'ECRU'}, {id:4,buyer:'A',colour:'KHAKI'},
  ];
  const matrix = Export.buildMatrix({ records, columns:[{k:'buyer',label:'Buyer'},{k:'colour',label:'Colour'}], cellText:(column,record)=>record[column.k] });
  assert.equal(matrix.recordCount, 4);
  const html = Export.toHTML(matrix);
  assert.equal(Export.assertFlat(html, 4).ok, true);
  assert.doesNotMatch(html, /rowspan|kolModelGroup|kolLinkedCell|data-kol-inherited|data-kol-override/i);
});
