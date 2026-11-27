'use strict';
// CP / Orders "Artwork Detail" sütunu Koleksiyon Artwork Detayı ile AYNI bölge
// kartı katmanını kullanır. Satırdaki PLM özet metni değişmez; filtre, sıralama,
// kopyala ve Excel aynı metni okur. Özet biçimine uymayan metin düz kalır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = read('public/collection-spreadsheet.css');
const COLUMN = read('public/collection-artwork-detail.js');

function loadArtwork(lang = 'tr') {
  const window = { appLang: lang, addEventListener() {}, BLCollectionSpreadsheetBridge: { rows: () => [] } };
  window.document = { readyState: 'complete', documentElement: { lang }, addEventListener() {}, getElementById() { return null; }, head: { appendChild() {} } };
  const context = vm.createContext({ window, document: window.document, setTimeout, clearTimeout, Date, Map, Set, WeakMap, Promise, Object, String, Number, Math, Array, JSON });
  vm.runInContext(COLUMN, context);
  return window;
}

function loadCell(window) {
  const start = APP.indexOf('const cpArtworkCellCache={tr:new Map(),en:new Map()};');
  assert.ok(start > 0, 'cpArtworkCellHtml must exist');
  const end = APP.indexOf('\n}\n', APP.indexOf('function cpArtworkCellHtml(row){', start)) + 2;
  const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const context = vm.createContext({ window, escapeHtml, String, Map, appLang: window.appLang || 'tr', CP_ARTWORK_PLM_KEY: 'Artwork Detail' });
  vm.runInContext(`${APP.slice(start, end)}\nthis.cell=cpArtworkCellHtml;`, context);
  return context.cell;
}

test('CP and Orders route Artwork Detail through the shared artwork card cell', () => {
  assert.match(APP, /const CP_ARTWORK_PLM_KEY='Artwork Detail';/);
  assert.match(APP, /if\(\(tableKey==='cp'\|\|tableKey==='orders'\)&&c\.k===CP_ARTWORK_PLM_KEY\) return cpArtworkCellHtml\(r\);/);
  // Orders kendi çiziciyle değil cellHtml üzerinden çizer; patch yolu da aynı çiziciyi kullanır.
  assert.match(APP, /if\(column\.type==='cpImage'\)return ordersImageCellHtml\(row\);\n\s*return cellHtml\(column,row,flags,tableKey\);/);
  assert.match(CSS, /:is\(#cpTable,#ordersTable\) tbody td\.cpArtworkTd \.kolArtworkCards\{display:flex;/);
});

test('PLM summary text renders as region cards; free text and empty stay plain', () => {
  const window = loadArtwork('en');
  const cell = loadCell(window);
  const single = cell({ 'Artwork Detail': 'Front: 1 | Pigment | Total: 1' });
  assert.match(single, /^<td class="cpArtworkTd kolArtworkTd" title="Front: 1 \| Pigment \| Total: 1">/);
  assert.match(single, /<span class="blCellChip"><b>Front<\/b><i>1<\/i><\/span><span class="blCellTag" data-tone="1">Pigment<\/span>/);
  assert.match(single, /<span class="blCellTotal">1<\/span>/);

  const set = cell({ 'Artwork Detail': 'A - Front: 1 | Pigment | Total: 1\nB - No print' });
  assert.match(set, /class="cpArtworkTd kolArtworkTd isMulti"/);
  assert.match(set, /<span class="blCellPart">A<\/span>/);
  assert.match(set, /<span class="blCellPart">B<\/span><span class="blCellNone">— No print<\/span>/);

  assert.equal(cell({ 'Artwork Detail': 'Legacy <b>set</b> text' }), '<td title="Legacy &lt;b&gt;set&lt;/b&gt; text">Legacy &lt;b&gt;set&lt;/b&gt; text</td>');
  assert.equal(cell({ 'Artwork Detail': '' }), '<td></td>');
  assert.equal(cell({}), '<td></td>');
});

test('without the artwork module the cell degrades to escaped text', () => {
  const cell = loadCell({});
  assert.equal(cell({ 'Artwork Detail': 'Front: 1 | Pigment | Total: 1' }), '<td title="Front: 1 | Pigment | Total: 1">Front: 1 | Pigment | Total: 1</td>');
});
