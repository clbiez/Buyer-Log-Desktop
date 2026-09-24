'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'lfl.css'), 'utf8');

function readyFilterBlock() {
  const start = LFL.indexOf('function renderReadyPanel(){');
  const end = LFL.indexOf('function toggleReadyPanel()', start);
  assert.ok(start >= 0, 'renderReadyPanel should exist');
  assert.ok(end > start, 'ready filter block should be bounded by toggleReadyPanel');
  return LFL.slice(start, end);
}

test('LFL ready filter save does not use unsupported browser prompt()', () => {
  const block = readyFilterBlock();
  assert.doesNotMatch(block, /\b(?:window\.)?prompt\s*\(/);
  assert.match(block, /data-ready-editor/);
  assert.match(block, /data-ready-name/);
  assert.match(block, /data-ready-confirm/);
  assert.match(block, /data-ready-cancel/);
});

test('LFL ready filter name editor supports save, cancel, Enter and Escape', () => {
  const block = readyFilterBlock();
  assert.match(block, /const saveNamedFilter=/);
  assert.match(block, /readySave\(all\);renderReadyPanel\(\)/);
  assert.match(block, /event\.key==='Enter'/);
  assert.match(block, /event\.key==='Escape'/);
  assert.match(block, /nameInput\?\.focus\(\)/);
  assert.match(CSS, /\.lflReadyNameEditor\{/);
  assert.match(CSS, /\.lflReadyNameEditor\[hidden\]/);
  assert.match(CSS, /\.lflReadyNameInput:focus\{/);
});
