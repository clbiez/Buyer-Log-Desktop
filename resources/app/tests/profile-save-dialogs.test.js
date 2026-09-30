'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function block(startNeedle, endNeedle) {
  const start = APP.indexOf(startNeedle);
  const end = APP.indexOf(endNeedle, start + startNeedle.length);
  assert.ok(start >= 0, `missing start: ${startNeedle}`);
  assert.ok(end > start, `missing end after: ${startNeedle}`);
  return APP.slice(start, end);
}

test('CP, Collection and Orders view/filter profiles do not use unsupported prompt()', () => {
  assert.match(APP, /const VIEW_TABLES = \['cp', 'orders', 'ship', 'koleksiyon'\]/);

  const viewSave = block("document.getElementById('viewSaveAsBtn')", "document.getElementById('viewSelect')");
  const rename = block('async function renameProfile(kind)', "document.getElementById('viewRenameBtn')");
  const filterSave = block("document.getElementById('filterSaveAsBtn')", "document.getElementById('filterSelect')");

  for (const source of [viewSave, rename, filterSave]) {
    assert.doesNotMatch(source, /\b(?:window\.)?prompt\s*\(/);
    assert.match(source, /await openHorizonTextInput\(/);
  }
});

test('CP/Orders note-column naming also avoids prompt()', () => {
  const add = block('async function addCpNoteColumn', 'async function renameCpNoteColumn');
  const rename = block('async function renameCpNoteColumn', 'async function removeCpNoteColumn');
  assert.doesNotMatch(add, /\b(?:window\.)?prompt\s*\(/);
  assert.doesNotMatch(rename, /\b(?:window\.)?prompt\s*\(/);
  // v7.0.175: not sütunu adı EN/TR uygulama içi pencereden (openColumnNameDialog) alınır.
  assert.match(add, /await promptBilingualColumnName\(/);
  assert.match(rename, /await promptBilingualColumnName\(/);
});

test('main CP/Collection/Orders runtime contains no prompt() calls', () => {
  assert.doesNotMatch(APP, /\b(?:window\.)?prompt\s*\(/);
});
