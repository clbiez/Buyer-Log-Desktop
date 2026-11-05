'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Collection header drops legacy letter references without altering the selection engine', () => {
  const source = read('public/collection-spreadsheet.js');
  const start = source.indexOf('function removeLetterHeaders()');
  assert.ok(start >= 0, 'header cleanup should exist');
  const body = source.slice(start, source.indexOf('\n  function decorateCells()', start));
  assert.ok(body.includes("thead.querySelector('.kolSpreadsheetLettersRow')?.remove();"));
  assert.ok(body.includes("thead.classList.add('isLettersHidden');"));
  assert.doesNotMatch(body, /createElement|insertBefore|innerHTML/,
    'the column letters should never be reconstructed');
  assert.match(source, /function selectColumn\(/,
    'the spreadsheet selection engine must remain available');
});

test('Collection reapplies sticky freeze after removing letter headers', () => {
  const source = read('public/collection-spreadsheet.js');
  const afterRender = source.slice(source.indexOf('function afterRender('), source.indexOf('\n  function selectWholeSpreadsheetRow', source.indexOf('function afterRender(')));
  assert.ok(afterRender.includes('removeLetterHeaders();bridge()?.reapplyFreeze?.();'),
    'freeze offsets must be recalculated after the letter row is removed');
});

test('Data Health chips no longer occupy space in the Collection workspace', () => {
  const css = read('public/collection-spreadsheet.css');
  assert.ok(css.includes('#view-koleksiyon #kolHealthBar{display:none!important}'),
    'legacy Data Health rendering must not reintroduce the summary row');
});

test('Collection spreadsheet positioning does not override frozen body cells', () => {
  // Spreadsheet hücreleri `position:relative` alır; donmuş hücrelerde sticky'yi
  // dondurma motorunun ürettiği `!important` kural kazanır, ayrı CSS yaması gerekmez.
  const css = read('public/collection-spreadsheet.css');
  const engine = read('public/table-freeze.js');
  assert.match(css, /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody td\{position:relative\}/);
  assert.doesNotMatch(css, /frzL/, 'freeze positioning has a single owner: table-freeze.js');
  assert.match(engine, /'>tbody>' \+ plain \+ '>' \+ n \+ '\{position:sticky!important;left:'/);
  const html = read('public/index.html');
  assert.match(html, /table-freeze\.js\?v=__BL_ASSET_VERSION__&rev=\d+/);
});

test('Collection summary hides only the duplicate count text, preserving the footer cell paint', () => {
  const css = read('public/ui-components.css');
  const source = read('public/app-main.js');
  assert.match(source, /<td class="collectionModelCount"><span>\$\{escapeHtml\(modelText\)\}<\/span><\/td>/);
  assert.match(css, /#kolTable tfoot \.collectionModelCount>span\{visibility:hidden;\}/);
  assert.doesNotMatch(css, /#kolTable tfoot \.collectionModelCount\{visibility:hidden;\}/,
    'hiding the entire cell exposes scrolling model names underneath the sticky footer');
});
