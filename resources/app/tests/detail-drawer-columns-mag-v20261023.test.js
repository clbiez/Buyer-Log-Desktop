'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const drawer=require('../public/detail-drawer.js');
const layout=require('../public/detail-report-layout.js');
const canonical=require('../public/canonical-fields.js');
const CSS=fs.readFileSync(path.join(__dirname,'..','public','detail-drawer.css'),'utf8');
// Manifest appearance lives in the shared contract; module CSS retains layout.
const VISUAL=fs.readFileSync(path.join(__dirname,'..','public','ui-components.css'),'utf8').replace(/html\[data-ui-system="manifest"\] /g,'').replace(/\s*\{\s*/g,'{');
const JS=fs.readFileSync(path.join(__dirname,'..','public','detail-drawer.js'),'utf8');
const labels={buyer:'Buyer / Group',identity:'Order / Model',supplier:'Manufacturer / Season',status:'Status / Portfolio',context:'Shipment / Route'};
const base=[{key:'Buyer',label:'Buyer'},{key:'Buying Group',label:'Buying Group'}];

test('nested ASAS MAG appears in the Buyer / Group report without changing source rows',()=>{
  const rows=[{Buyer:'MEHMET',raw:{'Merch Alt Grup Kod':'MAG-42'}}];
  const before=JSON.stringify(rows);
  const columns=drawer.includeMagColumn(rows,base,'cp',canonical);
  assert.deepEqual(columns.map(c=>c.key),['Buyer','Buying Group','MAG']);
  const buyer=layout.project(columns,'cp',canonical,labels).find(col=>col.reportRole==='buyer');
  assert.deepEqual(buyer.fields.map(col=>col.key),['Buyer','Buying Group','MAG']);
  assert.equal(JSON.stringify(rows),before);
  assert.equal(base.length,2);
  assert.ok(JS.includes("'MAG: ':'')+part.html"));
});

test('MAG aliases never create duplicate columns',()=>{
  const rows=[{mag:'M-2'}];
  const original=[...base,{key:'Merch Alt Grup Kod',label:'MAG'}];
  assert.strictEqual(drawer.includeMagColumn(rows,original,'cp',canonical),original);
});

test('rows without MAG data are not assigned invented values or fields',()=>{
  const rows=[{Buyer:'MEHMET',raw:{'Merch Alt Grup Kod':''}}];
  assert.strictEqual(drawer.includeMagColumn(rows,base,'cp',canonical),base);
});

test('MAG insertion is not imposed on flat pivot reports',()=>{
  assert.match(JS,/input\.flatColumns===true\?suppliedColumns:includeMagColumn\(/);
});

test('header and Columns popovers outrank sticky table headers across all shared detail reports',()=>{
  const TOKENS=fs.readFileSync(path.join(__dirname,'..','public','ui-tokens.css'),'utf8');
  const z=selector=>{
    const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const values=[...VISUAL.matchAll(new RegExp(escaped+'\\{[^}]*?z-index:var\\((--ui-z-[\\w-]+)\\)','g'))];
    const token=values.at(-1)?.[1];
    return Number(TOKENS.match(new RegExp(token+':(-?\\d+)'))?.[1]);
  };
  assert.ok(z('.blDetailDrawerHead')>z('.blDetailDrawerSubbar'));
  assert.ok(z('.blDetailDrawerSubbar')>z('.blDetailTable thead th'));
  assert.equal(z('.blDetailTableWrap'),0);
  assert.match(CSS,/\.blDetailColumnPanel\{[^}]*overflow:auto/);
});
