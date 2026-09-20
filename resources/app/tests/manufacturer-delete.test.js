'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Üretici silme UI'si index.html'den public/app-main.js'e taşındı.
const html = fs.readFileSync(path.join(__dirname, '../public/app-main.js'), 'utf8');

test('Send to Pricing places a trash delete button immediately beside Edit', () => {
  const rowStart = html.indexOf('<div class="mfrNavActionRow">');
  const rowEnd = html.indexOf('</div>', rowStart);
  assert.ok(rowStart >= 0 && rowEnd > rowStart);
  const actionRow = html.slice(rowStart, rowEnd);
  const editIndex = actionRow.indexOf('data-mfr-edit');
  const deleteIndex = actionRow.indexOf('data-mfr-delete');
  assert.ok(editIndex >= 0 && deleteIndex > editIndex, 'delete must be immediately after edit in the action row');
  assert.match(actionRow, /#i-trash/);
  assert.match(actionRow, /Delete manufacturer/);
  assert.match(actionRow, /Üreticiyi sil/);
});

test('manufacturer deletion remaps selected indexes without changing historical data', () => {
  const start = html.indexOf('function kolRemapManufacturerSelectionAfterDelete');
  const end = html.indexOf('function renderKolMfrModal', start);
  assert.ok(start >= 0 && end > start);
  const context = { Set };
  vm.createContext(context);
  vm.runInContext(html.slice(start, end), context);
  assert.deepEqual([...context.kolRemapManufacturerSelectionAfterDelete(new Set([0, 2, 4]), 2)], [0, 3]);
  assert.deepEqual([...context.kolRemapManufacturerSelectionAfterDelete(new Set([1, 3]), 0)], [0, 2]);
  const handlerStart = html.indexOf("const deleteBtn=e.target.closest('[data-mfr-delete]')");
  const handlerEnd = html.indexOf("const editBtn=e.target.closest('[data-mfr-edit]')", handlerStart);
  const handler = html.slice(handlerStart, handlerEnd);
  assert.match(handler, /kolManufacturers\.splice\(i,1\)/);
  assert.match(handler, /saveKolManufacturers\(\)/);
  assert.doesNotMatch(handler, /kolRows\.forEach|BL_QUOTATIONS.*delete|delete.*pricing/i);
  assert.match(handler, /quotation history and entered prices will be kept/);
});
