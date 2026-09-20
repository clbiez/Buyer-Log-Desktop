'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

function functionSlice(name, nextName) {
  const start = APP.indexOf(`function ${name}(`);
  const end = APP.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `${name} function boundary should exist`);
  return APP.slice(start, end);
}

test('v10.41 workspace access must not re-enable Collection actions that still need a row selection', () => {
  const workspaceGate = functionSlice('kolWorkspaceSetReadonly', 'kolApplyWorkspace');
  for (const id of ['kolDuplicateBtn', 'kolDropSelectedBtn', 'kolDelRowBtn']) {
    assert.doesNotMatch(workspaceGate, new RegExp(`'${id}'`));
  }

  const selectionGate = functionSlice('updateKolSendBtnState', 'kolRemapManufacturerSelectionAfterDelete');
  assert.match(selectionGate, /duplicateBtn\.disabled=!actionReady/);
  assert.match(selectionGate, /dropBtn\.disabled=!hasSelection/);
  assert.match(selectionGate, /deleteBtn\.disabled=!actionReady/);
});

test('v10.41 selection-only Collection actions start disabled before asynchronous workspace rendering', () => {
  for (const id of ['kolCopySelectedBtn', 'kolDuplicateBtn', 'kolDropSelectedBtn', 'kolDelRowBtn']) {
    assert.match(INDEX, new RegExp(`<button[^>]*id="${id}"[^>]*\\bdisabled(?:[\\s>])`));
  }
});
