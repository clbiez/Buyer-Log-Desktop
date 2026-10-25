'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = require('./helpers/manifest-css')(['collection-spreadsheet.css','ui-components.css'] );

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
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody input\.editCell,[^{]*\{[^}]*line-height:18px[\s\S]*?\}/
  );
});

test('Collection textarea-backed cells center single-line text instead of sitting high', () => {
  assert.match(css,/textarea\.editCell\{[^}]*line-height:var\(--kol-text-lh\)/);
  assert.match(css,/tr\.kolModelGroupVariant textarea\.editCell\{[^}]*line-height:17px/);
  assert.match(
    css,
    /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody textarea\.editCell\{[\s\S]*?min-height:calc\(var\(--kol-text-lh\) \+ 4px\)!important;[\s\S]*?padding-top:2px!important;[\s\S]*?padding-bottom:2px!important;[\s\S]*?margin:0!important;[\s\S]*?\}/
  );
  assert.match(
    css,
    /tr\.kolModelGroupVariant textarea\.editCell\{[\s\S]*?height:calc\(var\(--kol-variant-row-h,27px\) - 2px\)!important;[\s\S]*?padding-top:4px!important;[\s\S]*?padding-bottom:4px!important;[\s\S]*?\}/
  );
});

test('Collection composite cell wrappers keep content vertically centered and left aligned', () => {
  assert.match(css, /\.plmEditCell,[\s\S]*?\.kolPeriodPickerBtn[\s\S]*?align-items:center!important;[\s\S]*?text-align:left!important;/);
  assert.match(css, /#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody \.endeksmatikCellBtn\{[\s\S]*?text-align:left!important;[\s\S]*?align-items:center!important;[\s\S]*?justify-items:start;/);
});

test('Collection textarea cells fit wrapped text to the row height in whole lines', () => {
  const rule = css.match(/#view-koleksiyon\.kolSpreadsheetWorkspace #kolTable tbody textarea\.editCell\{([^}]*)\}/);
  assert.ok(rule, 'base textarea rule exists');
  // Regression: a fixed 28px one-line box clipped wrapped text in taller rows.
  assert.doesNotMatch(rule[1], /(^|[;\s])height:28px!important/);
  assert.match(rule[1], /max-height:var\(--kol-text-fit-h\)!important;/);
  assert.match(css, /round\(down,var\(--kol-text-h,28px\) - 6px,var\(--kol-text-lh\)\) \+ 4px/);
  // Single-line text is centered by the cell because the editor is sized to its content.
  assert.match(css, /@supports \(field-sizing:content\)\{[\s\S]*?textarea\.editCell\{[\s\S]*?field-sizing:content;[\s\S]*?height:auto!important;/);
  assert.match(css, /textarea\.editCell:focus\{[\s\S]*?overflow-y:auto!important;/);
});
