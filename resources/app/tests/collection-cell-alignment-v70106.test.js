'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'collection-spreadsheet.css'), 'utf8');

test('Collection business cells are left aligned and vertically centered', () => {
  assert.match(
    css,
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody td:not\(\.chkCell\):not\(\.kolSpreadsheetRowGutter\)\{[\s\S]*?vertical-align:middle!important;[\s\S]*?text-align:left!important;[\s\S]*?\}/
  );
});

test('Collection editors share left-aligned text geometry', () => {
  assert.match(
    css,
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody :is\(input\.editCell,select\.editCell,textarea\.editCell\)\{[\s\S]*?text-align:left!important;[\s\S]*?box-sizing:border-box;[\s\S]*?\}/
  );
  assert.match(
    css,
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody :is\(input\.editCell,select\.editCell\)\{[\s\S]*?line-height:18px!important;[\s\S]*?\}/
  );
});

test('Collection textarea-backed cells center single-line text instead of sitting high', () => {
  assert.match(
    css,
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody textarea\.editCell\{[\s\S]*?height:28px!important;[\s\S]*?line-height:18px!important;[\s\S]*?padding-top:5px!important;[\s\S]*?padding-bottom:5px!important;[\s\S]*?margin:0!important;[\s\S]*?\}/
  );
  assert.match(
    css,
    /tr\.kolModelGroupVariant textarea\.editCell\{[\s\S]*?height:calc\(var\(--kol-variant-row-h,27px\) - 2px\)!important;[\s\S]*?line-height:17px!important;[\s\S]*?padding-top:4px!important;[\s\S]*?padding-bottom:4px!important;[\s\S]*?\}/
  );
});

test('Collection composite cell wrappers keep content vertically centered and left aligned', () => {
  assert.match(css, /\.plmEditCell,[\s\S]*?\.kolPeriodPickerBtn[\s\S]*?align-items:center!important;[\s\S]*?text-align:left!important;/);
  assert.match(css, /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody \.endeksmatikCellBtn\{[\s\S]*?text-align:left!important;[\s\S]*?align-items:center!important;[\s\S]*?justify-items:start;/);
});
