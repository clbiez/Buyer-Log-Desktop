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
