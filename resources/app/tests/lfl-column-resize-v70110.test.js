'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
const LFL_JS = read('lfl.js');
const LFL_CSS = read('lfl.css');
const RESIZE_JS = read('table-column-resize.js');

test('LFL CP-style tablolar ortak resize modülünü görünür sütun sırasıyla kullanır', () => {
  assert.match(LFL_JS, /function attachLflColumnResize\(tableId,viewName,columns\)/);
  assert.match(LFL_JS, /querySelectorAll\('thead tr\.colRow th\[data-k\]'\)/);
  assert.match(LFL_JS, /resize\.apply\(table,\{scope:\`lfl\.\$\{viewName\}\`,columns:visible\}\)/);
  assert.match(LFL_JS, /attachLflColumnResize\(tableId,viewName,columns\);/);
});

test('LFL resize görünür sütunu 60px alt sınıra kadar serbest bırakır ve kalıcı scope kullanır', () => {
  assert.match(LFL_JS, /minPx:60/);
  assert.match(RESIZE_JS, /'lcw\.tableColWidth\.' \+ name \+ '\.v1'/);
  assert.match(RESIZE_JS, /store\.set\(col\.key, next\)/);
  assert.match(RESIZE_JS, /if \(store\.save\) store\.save\(\)/);
});

test('dar LFL sütununda başlık görünür kalır ve hücre içinde alt satıra geçer', () => {
  assert.match(LFL_CSS, /#view-lfl \.lflTable\.blResizableTable\{table-layout:fixed;\}/);
  assert.match(LFL_CSS, /#view-lfl \.lflTable\.blResizableTable thead th\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere[^}]*height:auto/s);
  assert.match(LFL_CSS, /#view-lfl \.lflTable\.blResizableTable \.lflTableSortLabel\{[^}]*white-space:normal[^}]*overflow-wrap:anywhere/s);
  assert.match(LFL_CSS, /#view-lfl \.lflTableWrap\.tablewrap\{[^}]*overflow:auto/s);
});
