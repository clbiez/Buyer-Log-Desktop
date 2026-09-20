'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('v5.08 frozen body cells keep an opaque layer while a row is hovered', () => {
  assert.match(CSS, /\.tablewrap table tbody td\.frzL\{[\s\S]*?z-index:4;[\s\S]*?isolation:isolate;[\s\S]*?background:var\(--table-bg\)/);
  assert.match(CSS, /\.tablewrap table tbody tr:hover td\.frzL\{[\s\S]*?background:color-mix\(in srgb,var\(--table-bg\) 94%,var\(--ink\) 6%\)/);
  assert.doesNotMatch(CSS, /v5\.08[\s\S]*?tbody tr:hover td\.frzL\{[^}]*var\(--table-hover\)/);
});

test('v5.08 CP Orders and Collection frozen cells cannot become transparent via cell-specific styles', () => {
  assert.match(CSS, /#cpTable tbody td\.frzL,[\s\S]*?#ordersTable tbody td\.frzL,[\s\S]*?#kolTable tbody td\.frzL\{[\s\S]*?background-color:var\(--table-bg\)/);
  assert.match(INDEX, /function applyFreeze\(tableId, tableKey, withChk\)/);
});
