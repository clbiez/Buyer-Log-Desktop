'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('Collection spreadsheet letter row derives its width from the current header DOM', () => {
  const source = read('public/collection-spreadsheet.js');
  const start = source.indexOf('function injectLetters()');
  assert.ok(start >= 0, 'injectLetters must exist');
  const body = source.slice(start, source.indexOf('\n  function decorateCells()', start));

  assert.match(body, /querySelector\(['"]tr\.colRow['"]\)/,
    'letter count must come from the freshly rendered Collection header');
  assert.match(body, /filter\(th=>!th\.classList\.contains\(['"]chkTh['"]\)\)/,
    'the row-number/checkbox gutter must not receive a spreadsheet letter');
  assert.doesNotMatch(body, /const rows=visibleCells\(\),count=rows\[0\]\?\.length\|\|0/,
    'stale spreadsheet selection cache must not determine rendered header width');
});

test('Collection freeze reapplication remains after the letter row is rebuilt', () => {
  const source = read('public/collection-spreadsheet.js');
  const afterRender = source.slice(source.indexOf('function afterRender('), source.indexOf('\n  function selectWholeSpreadsheetRow', source.indexOf('function afterRender(')));
  assert.match(afterRender, /injectLetters\(\);bridge\(\)\?\.reapplyFreeze\?\.\(\);/,
    'freeze offsets must be recalculated after the current letter row exists');
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
