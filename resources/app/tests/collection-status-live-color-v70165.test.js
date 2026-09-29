'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function between(start, end) {
  const a = APP.indexOf(start);
  const b = APP.indexOf(end, a + start.length);
  assert.ok(a >= 0, `missing start: ${start}`);
  assert.ok(b > a, `missing end: ${end}`);
  return APP.slice(a, b);
}

test('Collection Status appearance helper updates both select and owning cell immediately', () => {
  const block = between('function kolApplyStatusCellAppearance(', 'function kolStatusDisplayLabel(');
  assert.match(block, /kolStatusColor\(kolStatusCanonicalName\(name\)\)/);
  assert.match(block, /el\.style\?\.setProperty\?\.\('--kol-status-color',color\)/);
  assert.match(block, /el\.closest\?\.\('td\.kolStatusTd'\)/);
  assert.match(block, /td\?\.style\?\.setProperty\?\.\('--kol-status-color',color\)/);
});

test('native Collection Status change repaints without waiting for a table refresh', () => {
  const start = APP.indexOf("document.addEventListener('change',e=>{", APP.indexOf("document.addEventListener('focusin',e=>{"));
  const end = APP.indexOf("document.addEventListener('pointerover'", start);
  const block = APP.slice(start, end);
  assert.match(block, /kolStatusNoArrow\[data-k="durum"\]/);
  assert.match(block, /kolApplyStatusCellAppearance\(status,status\.value\)/);
  assert.doesNotMatch(block, /renderKol\(\)/);
});

test('status commits and Escape rollback keep the live color synchronized with the visible value', () => {
  const commit = between('function commitKolEditor(', 'function commitKolPriceEditor(');
  assert.match(commit, /if\(k==='durum'\|\|k==='status'\)kolApplyStatusCellAppearance\(el,val\)/);
  const keyboard = between('function kolHandleSpreadsheetKey(', 'function kolClipboardMatrix(');
  assert.match(keyboard, /if\(el\.dataset\.k==='durum'\|\|el\.dataset\.k==='status'\)kolApplyStatusCellAppearance\(el,el\.value\)/);
});
