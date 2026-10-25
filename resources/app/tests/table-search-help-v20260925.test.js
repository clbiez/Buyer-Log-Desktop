'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const JS = fs.readFileSync(path.join(ROOT, 'public', 'table-search-help.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'table-search-help.css'), 'utf8');

test('table search help assets are loaded by the main page', () => {
  assert.match(INDEX, /table-search-help\.css\?v=__BL_ASSET_VERSION__/);
  assert.match(INDEX, /table-search-help\.js\?v=__BL_ASSET_VERSION__/);
});

test('CP, Orders and Collection main searches receive exactly one pinned adjacent information button', () => {
  assert.match(JS, /TARGET_IDS=\['cpSearch','ordersSearch','kolSearch'\]/);
  assert.match(JS, /document\.querySelectorAll\(selector\)/);
  assert.match(JS, /extra\.remove\(\)/);
  assert.match(JS, /button\.dataset\.tbPriority='pinned'/);
  assert.match(JS, /button\.dataset\.tbOverflow='never'/);
  assert.match(JS, /input\.insertAdjacentElement\('afterend',button\)/);
  assert.match(JS, /button\.textContent='i'/);
  assert.match(JS, /aria-expanded/);
  assert.match(JS, /aria-controls/);
});

test('help copy documents OR, AND, exclusion and Excel paste behavior without breaking decimal commas', () => {
  assert.match(JS, /Virgül \+ boşluk = VEYA/);
  assert.match(JS, /Noktalı virgül \+ boşluk = VE\./);
  assert.match(JS, /! = bu değeri içermesin/);
  assert.match(JS, /Excel’den yapıştırma/);
  assert.match(JS, /13,50 gibi ondalık değerler tek arama değeri olarak kalır/);
  assert.match(JS, /Comma \+ space = OR/);
  assert.match(JS, /Semicolon \+ space = AND/);
});

test('search help uses a compact themed fixed popover', () => {
  assert.match(CSS, /\.tableSearchHelpButton\{/);
  assert.match(CSS, /width:24px/);
  const shared=fs.readFileSync(path.join(__dirname,'..','public','ui-components.css'),'utf8');
  assert.match(shared,/\.tableSearchHelpButton[^}]*border-radius:var\(--ui-radius\)/);
  assert.match(CSS, /\.tableSearchHelpPopover\{/);
  assert.match(CSS, /position:fixed/);
  assert.match(shared,/\.tableSearchHelpPopover[^}]*background:var\(--ui-surface\)/);
  assert.match(shared,/\.tableSearchHelpPopover[^}]*border:0/);
});

test('overflowing table search stays editable and expands on hover or focus', () => {
  assert.match(JS, /function inputContentWidth\(input\)/);
  assert.match(JS, /measureContext\.measureText\(value\)\.width/);
  assert.match(JS, /input\.addEventListener\('pointerenter',\(\)=>setInputExpanded\(input,true\)\)/);
  assert.match(JS, /input\.addEventListener\('pointerleave'/);
  assert.match(JS, /input\.addEventListener\('focus',\(\)=>setInputExpanded\(input,true\)\)/);
  assert.match(JS, /--table-search-hover-width/);
  assert.match(CSS, /\.tableActionToolbar>input\[type=search\]\.tableSearchInputExpanded\{/);
  assert.match(CSS, /flex:0 0 var\(--table-search-hover-width/);
  assert.match(CSS, /max-width:var\(--table-search-hover-width/);
});
