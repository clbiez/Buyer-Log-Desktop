'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

// Regression: click a normal cell (active-cell selection) then check row
// checkboxes — the stale cell/range selection must not survive, and Copy
// must resolve to the checked rows even if it somehow did.

test('row checkbox selection clears the stale managed-grid cell/range state', () => {
  const selAllStart = APP.indexOf("selAll.addEventListener('change'");
  const selAllEnd = APP.indexOf('});', selAllStart);
  const selAllBlock = APP.slice(selAllStart, selAllEnd);
  assert.match(selAllBlock, /BLGridClipboard\?\.clear\?\.\(tableId\)/,
    'header Select All checkbox does not clear the stale active-cell/range selection');

  const delegatedStart = APP.indexOf("if(!chk.classList || !chk.classList.contains('rowChk')) return;");
  const delegatedEnd = APP.indexOf('});', delegatedStart);
  const delegatedBlock = APP.slice(delegatedStart, delegatedEnd);
  assert.match(delegatedBlock, /BLGridClipboard\?\.clear\?\.\(meta\.tableId\)/,
    'row checkbox change does not clear the stale active-cell/range selection');
  assert.match(APP, /tbody\._chkMeta = \{ selSet, table, tableKey, tableId, rows/,
    'checkbox delegation metadata does not carry tableId for clearing the grid clipboard');
});

test('Copy resolves checked rows over a stale cell/range selection (CP and Orders)', () => {
  assert.match(APP, /function managedTableHasCheckedRows\(tab\)\{/,
    'no defensive checked-row precedence resolver exists');

  const copyGridStart = APP.indexOf('function copyGridSelection(');
  const copyGridEnd = APP.indexOf('\n}', copyGridStart);
  const copyGridBlock = APP.slice(copyGridStart, copyGridEnd);
  assert.match(copyGridBlock, /if\(!managedTableHasCheckedRows\(tab\)&&managedGridHasRange\(tab\)\)/,
    'copyGridSelection still lets a stale cell/range win over checked rows');

  const navCopyStart = APP.indexOf("document.getElementById('navCopy').addEventListener('click'");
  const navCopyEnd = APP.indexOf('});', navCopyStart);
  const navCopyBlock = APP.slice(navCopyStart, navCopyEnd);
  assert.match(navCopyBlock, /!managedTableHasCheckedRows\(info\.tableKey\)&&managedGridHasRange\(info\.tableKey\)/,
    'navCopy click handler still lets a stale cell/range win over checked rows');
});

test('normal cell/range copy is unchanged when no rows are checked', () => {
  // Both precedence guards must still fall through to the existing cell/range
  // copy path once managedTableHasCheckedRows(tab) is false.
  assert.match(APP, /void window\.BLGridClipboard\.copyActive\(event,\{includeHeaders\}\);return true;/);
  assert.match(APP, /void window\.BLGridClipboard\.copyActive\(event,\{includeHeaders:true\}\);return;/);
});
