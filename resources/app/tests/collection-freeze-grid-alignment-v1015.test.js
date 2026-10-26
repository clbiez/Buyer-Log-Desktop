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
  const css = read('public/collection-spreadsheet.css');
  const html = read('public/index.html');
  assert.match(css,
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody td\.frzL\{position:sticky\}/,
    'the spreadsheet interaction layer must preserve sticky positioning on every frozen body cell');
  assert.match(html, /collection-spreadsheet\.css\?v=__BL_ASSET_VERSION__&rev=[A-Za-z0-9._-]+/,
    'the browser must receive the corrected freeze rule instead of a cached stylesheet');
});
