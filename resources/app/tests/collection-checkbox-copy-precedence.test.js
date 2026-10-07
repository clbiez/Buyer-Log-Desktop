'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const COLLECTION = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.js'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

// Same regression as CP/Orders (grid-checkbox-copy-precedence.test.js) for the
// Collection page: click a normal cell (active-cell selection) then check
// model row checkboxes — the stale cell/range selection must not survive, and
// Copy must resolve to the checked models even if it somehow did.

test('checking a Collection row checkbox clears the stale active-cell/range selection', () => {
  const changeStart = COLLECTION.indexOf("document.addEventListener('change',e=>{");
  const changeEnd = COLLECTION.indexOf('},true);', changeStart);
  const block = COLLECTION.slice(changeStart, changeEnd);
  assert.match(block, /closest\('#kolTable \.rowChk,#kolSelAll'\)/,
    'row/select-all checkbox change is no longer observed');
  assert.match(block, /if\(chk\.checked&&state\.active\)clearActive\(\)/,
    'checking a row checkbox does not clear the stale active-cell/range selection');
});

test('Collection Copy resolves checked models over a stale cell/range selection', () => {
  const fnStart = COLLECTION.indexOf('function handleCopyShortcut(');
  const fnEnd = COLLECTION.indexOf('\n  function selectedCoordinates', fnStart);
  const block = COLLECTION.slice(fnStart, fnEnd);
  assert.match(block, /if\(!options\.forceCellCopy&&\(bridge\(\)\?\.selectedCount\?\.\(\)\|\|0\)>0\)return false;/,
    'global/keyboard Copy must still yield to checked models unless the user explicitly chose cell Copy from the cell context menu');

  const fnAppStart = APP.indexOf('function copyGridSelection(');
  const fnAppEnd = APP.indexOf('\nlet _gridClipboardOutsideHandler', fnAppStart);
  const copyGridBlock = APP.slice(fnAppStart, fnAppEnd);
  assert.match(copyGridBlock, /kolCopySelectedBtn/,
    'copyGridSelection does not fall back to the row-copy button when checked models win');
});
