'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ui = fs.readFileSync('public/ui-components.css', 'utf8');
const grid = fs.readFileSync('public/grid-clipboard.js', 'utf8');

test('shared grid paints a range independently from the active keyboard cell', () => {
  assert.match(grid, /td\.classList\.add\('blGridRangeCell'\)/);
  assert.match(grid, /td\.classList\.add\('blGridActiveCell'\)/);
  assert.match(grid, /classList\.remove\('blGridActiveCell','blGridRangeCell','blGridRangeEdge'\)/);
});

test('CP Tracker and Orders selected cells have a soft surface, even on frozen and hovered rows', () => {
  const rule = ui.match(/html\[data-ui-system="manifest"\] #cpTable tbody td\.blGridRangeCell,\s*html\[data-ui-system="manifest"\] #ordersTable tbody td\.blGridRangeCell\s*\{([^}]+)\}/);
  assert.ok(rule, 'Shared selected-range rule must address the cell, not the whole row');
  assert.match(rule[1], /background-color:\s*var\(--ui-selected\)\s*!important/);
  assert.match(ui, /#cpTable tbody td\.frzL,html\[data-ui-system="manifest"\] #ordersTable tbody td\.frzL/);
  assert.match(ui, /#cpTable tbody tr:hover>td/);
});

test('detail-report ranges use the selected surface, not a floating overlay shadow', () => {
  const rule = ui.match(/\.blDetailDrawer \.blDetailTable td\.blGridRangeCell\s*\{([^}]+)\}/);
  assert.ok(rule);
  assert.match(rule[1], /background-color:\s*var\(--ui-selected\)\s*!important/);
  assert.match(rule[1], /box-shadow:\s*none\s*!important/);
  assert.match(ui, /#cpTable td\.blGridActiveCell,html\[data-ui-system="manifest"\] #ordersTable td\.blGridActiveCell\s*\{outline:2px solid var\(--ui-accent\)/);
});

test('range sides produce one continuous outline, including corners and single cells', () => {
  const grid = require('../public/grid-clipboard.js');
  const edges = grid.edgeClassesForCell;
  const range = { startRow: 1, endRow: 3, startColumn: 2, endColumn: 4 };
  assert.deepEqual(edges(1, 2, range), ['blGridRangeTop', 'blGridRangeLeft']);
  assert.deepEqual(edges(1, 3, range), ['blGridRangeTop']);
  assert.deepEqual(edges(2, 2, range), ['blGridRangeLeft']);
  assert.deepEqual(edges(2, 3, range), [], 'Interior cells must not have a border');
  assert.deepEqual(edges(3, 4, range), ['blGridRangeBottom', 'blGridRangeRight']);
  assert.deepEqual(edges(0, 3, range), [], 'Cells outside selection remain untouched');
  assert.deepEqual(edges(2, 3, {startRow:2,endRow:2,startColumn:3,endColumn:3}), [
    'blGridRangeTop', 'blGridRangeBottom', 'blGridRangeLeft', 'blGridRangeRight',
  ]);
});

test('grid clears previous perimeter classes when a range moves', () => {
  assert.match(grid, /classList\.remove\('blGridRangeTop','blGridRangeRight','blGridRangeBottom','blGridRangeLeft'\)/);
  assert.match(grid, /td\.classList\.add\(\.\.\.edgeClassesForCell\(row,column,range\)\)/);
  assert.match(grid, /td\.setAttribute\('aria-selected','true'\)/);
});

test('cell-range styling is distinct from row selection and joins four theme-aware edges', () => {
  const patch = ui.slice(ui.lastIndexOf('/* Cell-range selection must remain distinct'));
  assert.ok(patch.startsWith('/* Cell-range selection must remain distinct'), 'New range styles must be present');
  assert.match(patch, /background-color:color-mix\(in srgb,var\(--ui-selected\) 72%,var\(--ui-accent\) 28%\) !important/);
  assert.match(patch, /box-shadow:[\s\S]*?var\(--ui-grid-range-top,[\s\S]*?var\(--ui-grid-range-left,[\s\S]*?!important/);
  for (const side of ['Top','Right','Bottom','Left']) {
    assert.match(patch, new RegExp('td\\.blGridRange' + side + ' \\{[\\s\\S]*?--ui-grid-range-' + side.toLowerCase() + ':inset'));
  }
  assert.match(ui, /#cpTable td\.blGridActiveCell,html\[data-ui-system="manifest"\] #ordersTable td\.blGridActiveCell\s*\{outline:2px solid var\(--ui-accent\)/);
});
