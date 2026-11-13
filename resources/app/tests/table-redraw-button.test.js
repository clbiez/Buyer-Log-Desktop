'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const APP=fs.readFileSync(path.join(__dirname,'../public/app-main.js'),'utf8');

function rangeControls(){
  const start=APP.indexOf('function renderTableRangeControls(');
  return APP.slice(start,APP.indexOf('// ---------- generic table renderer',start));
}

test('Range bar starts with a mini redraw button for CP, Orders and Collection',()=>{
  const src=rangeControls();
  assert.match(src,/<button type="button" class="tableRangeRedraw" data-range-redraw>/);
  assert.ok(src.indexOf('data-range-redraw')<src.indexOf('data-range-size'),'redraw button sits left of the size select');
  assert.match(src,/T\('Tabloyu yeniden çiz','Redraw table'\)/);
});

test('Redraw recomputes the whole module, not just the cached page rows',()=>{
  assert.match(APP,/function redrawTableModule\(tableKey\)/);
  assert.match(rangeControls(),/redrawTableModule\(tableKey\)/);
  const fn=APP.slice(APP.indexOf('function redrawTableModule('));
  const body=fn.slice(0,fn.indexOf('\n}\n'));
  assert.match(body,/tableKey==='cp'\)renderCPNow\(\)/);
  assert.match(body,/tableKey==='orders'\)renderOrdersNow\(\)/);
  assert.match(body,/tableKey==='koleksiyon'\)renderKol\(\)/);
  assert.match(body,/scrollTop/);
});
