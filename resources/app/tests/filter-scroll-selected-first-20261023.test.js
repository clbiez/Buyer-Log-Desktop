'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('Price & Supplier multi-filters pin selected values without resetting the list viewport', () => {
  const src = read('price-supplier-analysis.js');
  const code = src.slice(src.indexOf('  function filterSelect(dim){'), src.indexOf('  function filterConfigurator(){'));
  const E = { dimensionValues: () => ['Kaşe-Örme','Kaşkorse','Keten','Krep','Kırınkıl','Mikro','Müslin'], keyOf: value => String(value).toLocaleUpperCase('tr-TR') };
  const select = new Function('E','dataset','ui','esc','t','dimLabel','filterValues', code + '\nreturn filterSelect;')(
    E, {}, {filterSearch:{},openFilter:'kumaşTipi'}, String, key => key, key => key, () => ['Mikro','Kaşkorse']
  );
  const html = select('kumaşTipi');
  const options = [...html.matchAll(/data-ps-filter-value="kumaşTipi" value="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(options.slice(0,2), ['Kaşkorse','Mikro']);
  assert.match(src, /scrollByDim\.set\(menu\.dataset\.psFilterMenu,list\.scrollTop\)/);
  assert.match(src, /list\.scrollTop=oldTop/);
  assert.match(src, /\.focus\(\{preventScroll:true\}\)/);
});

test('shared CP/Orders/Backlog filter helper moves checked rows first and retains scroll and focus', () => {
  const src = read('app-main.js');
  const from = src.indexOf('function pinCheckedFilterChoices(bodyEl){');
  const to = src.indexOf('function openValueFilterPanel(opts){', from);
  assert.ok(from >= 0 && to > from);
  const labels = [0,1,2,3,4].map(i => ({
    dataset:{filterOrder:String(i)},
    input:{checked:i===2||i===4,focus(options){this.focused=options.preventScroll}},
    querySelector(){return this.input}
  }));
  const focused = labels[2].input;
  const list = {
    scrollTop:117,
    querySelectorAll(){return labels.slice()},
    appendChild(item){labels.splice(labels.indexOf(item),1);labels.push(item)},
    contains(item){return labels.some(label=>label.input===item)}
  };
  const pin = new Function('document', src.slice(from,to) + '\nreturn pinCheckedFilterChoices;')({activeElement:focused});
  pin({querySelector:()=>list});
  assert.deepEqual(labels.map(row=>row.dataset.filterOrder),['2','4','0','1','3']);
  assert.equal(list.scrollTop,117);
  assert.equal(focused.focused,true);
  focused.checked=false;
  pin({querySelector:()=>list});
  assert.deepEqual(labels.map(row=>row.dataset.filterOrder),['4','0','1','2','3']);
  assert.equal(list.scrollTop,117);
  assert.match(src, /bodyEl\.querySelector\('\.cfpList'\)\?\.addEventListener\('change'/);
});

test('LFL facets and scenario editor retain search, scroll and selected-first order', () => {
  const src = read('lfl.js');
  assert.match(src, /const ordered=values\.slice\(\)\.sort\(\(a,b\)=>Number\(selected\.has\(b\)\)-Number\(selected\.has\(a\)\)\)/);
  assert.match(src, /if\(list\)list\.scrollTop=scroll/);
  assert.match(src, /if\(restoreFocus\)searchInput\?\.focus\(\{preventScroll:true\}\)/);
  assert.match(src, /if\(list\)list\.scrollTop=optionTop/);
  assert.match(src, /state\.customCompare\.editorSearch=event\.target\.value/);
});

test('Backlog Overview keeps the filter viewport and pins active values and columns', () => {
  const src = read('backlog-overview.js');
  assert.match(src, /sort\(\(a,b\)=>Number\(selected\.has\(b\.value\)\)-Number\(selected\.has\(a\.value\)\)\)/);
  assert.match(src, /sort\(\(a,b\)=>Number\(activeIds\.has\(b\.id\)\)-Number\(activeIds\.has\(a\.id\)\)\)/);
  assert.match(src, /if\(values\)values\.scrollTop=previous\.values/);
  assert.match(src, /focus\(\{preventScroll:true\}\)/);
});

test('Overview and numeric filters pin choices in-place without resetting scroll', () => {
  const flow = read('overview-global-flow.js'), html=read('index.html');
  assert.match(flow, /list\.scrollTop=position/);
  assert.match(flow, /data-gf-order=/);
  assert.match(flow, /labels\.sort\(\(a,b\)=>Number\(b\.querySelector\('input'\)\?\.checked\)/);
  assert.match(html, /boxes\.forEach\(x=>x\.onchange=\(\)=>\{pinCheckedFilterChoices\(list\);applyVals\(\);\}\)/);
  assert.match(html, /data-filter-order="\$\{index\}"/);
});

test('INTAKE and Quotation selectors keep selected items first in a stable viewport', () => {
  const intake=read('intake.js'),quotes=read('quotations.js');
  assert.match(intake, /\.sort\(\(a,b\)=>Number\(selected\.has\(b\)\)-Number\(selected\.has\(a\)\)\)/);
  assert.match(intake, /list\.scrollTop = top/);
  assert.match(intake, /let availableValues = localValues/);
  assert.match(quotes, /orderedValues=values\.slice\(\)\.sort/);
  assert.match(quotes, /data-filter-order=/);
  assert.match(quotes, /pinCheckedFilterChoices\(panel\)/);
});

test('OAB drill and Backlog chart filters preserve selection order and scroll', () => {
  const oab=read('oab.js'),charts=read('backlog-chart.js');
  assert.match(oab, /orderedValues=values\.slice\(\)\.sort/);
  assert.match(oab, /pinCheckedFilterChoices\(panel\)/);
  assert.match(charts, /chartFilterOrder=available\.map/);
  assert.match(charts, /seriesList\.scrollTop=scroll/);
  assert.match(charts, /event\.target\.focus\?\.\(\{preventScroll:true\}\)/);
});
