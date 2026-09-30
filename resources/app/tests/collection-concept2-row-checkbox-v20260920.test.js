'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('Concept 2 gutter hem hierarchy toggle hem görünür row checkbox taşır', () => {
  const renderStart = APP.indexOf('function renderKol()');
  const renderEnd = APP.indexOf('function renderKolSummaryFooter', renderStart);
  const block = APP.slice(renderStart, renderEnd);
  assert.match(block, /class=\"rowChk\"/);
  assert.match(block, /data-kol-group-toggle/);
  assert.match(block, /kolSpreadsheetRowGutter/);
  assert.match(CSS, /\.kolSpreadsheetRowGutter \.rowChk\{[^}]*width:14px;[^}]*height:14px;[^}]*margin:0;[^}]*box-sizing:border-box;/s);
  assert.match(block, /kolSpreadsheetGutterCol\" style=\"width:72px;/,
    'expanded hierarchy toggle must leave enough gutter width for the row checkbox');
  assert.match(CSS, /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable \.chkTh,[\s\S]*?#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable td\.kolSpreadsheetRowGutter\{width:72px!important;min-width:72px!important;\}/,
    'Collection gutter width must override the shared 64px checkbox-column width');
  assert.match(INDEX, /collection-spreadsheet\.css\?v=__BL_ASSET_VERSION__&rev=7/);
});

test('Concept 2 checkbox yeni veri sütunu eklemez ve seçim olayı gerçek row id üzerinde kalır', () => {
  assert.match(APP, /tbody\.querySelectorAll\('\.rowChk'\)\.forEach/);
  assert.match(APP, /const id=selectionActualId\(logicalRows,row=>row\.id,chk\.dataset\.id\)/);
  assert.match(APP, /selectionSetId\(kolSelected,id,chk\.checked\)/);
  assert.doesNotMatch(APP, /const id=Number\(chk\.dataset\.id\)/);
  assert.doesNotMatch(APP, /\{k:'(?:groupToggle|hierarchyToggle)'/);
});
