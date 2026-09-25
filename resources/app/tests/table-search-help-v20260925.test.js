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

test('CP, Orders and Collection main searches receive an adjacent information button', () => {
  assert.match(JS, /TARGET_IDS=\['cpSearch','ordersSearch','kolSearch'\]/);
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
  assert.match(CSS, /\.tableSearchHelpPopover\{/);
  assert.match(CSS, /position:fixed/);
  assert.match(CSS, /background:var\(--card\)/);
  assert.match(CSS, /border:1px solid var\(--line2\)/);
});
