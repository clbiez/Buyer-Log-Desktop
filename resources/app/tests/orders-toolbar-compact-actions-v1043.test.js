'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const COMPACT_IDS = [
  'ordersRefreshBtn', 'undoBtn', 'redoBtn', 'navCopy', 'navCopyMenuBtn',
  'navExcelBtn', 'ordersPlmSyncBtn', 'ordersToolsBtn', 'ordersMoreBtn'
];

function openingButton(id) {
  const match = INDEX.match(new RegExp(`<button[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `${id} button should exist`);
  return match[0];
}

test('v10.43 Orders actions compact before the desktop toolbar needs horizontal scrolling', () => {
  assert.match(CSS, /@media\(max-width:1000px\)\{[\s\S]*#ordersTableToolbar\{overflow-x:visible;/);
  assert.match(CSS, /#ordersTableToolbar>#ordersRefreshBtn,[\s\S]*#ordersTableToolbar>:is\(#ordersPlmSyncWrap,#ordersToolsWrap,#ordersMoreWrap\)>\.tbtn\{[\s\S]*width:var\(--ctl-h\)/);
  assert.match(CSS, /#ordersTableActions>:is\(#undoBtn,#redoBtn,#navCopy,#navCopyMenuBtn,#navExcelBtn\)\{[\s\S]*width:var\(--ctl-h\)/);
  assert.match(CSS, /#ordersTableToolbar>#ordersRefreshBtn>span,[\s\S]*#ordersTableToolbar>:is\(#ordersPlmSyncWrap,#ordersToolsWrap\)>\.tbtn>span,[\s\S]*#ordersTableActions>:is\(#undoBtn,#redoBtn,#navCopy,#navExcelBtn\)>span\{display:none!important;\}/);
});

test('v10.43 compact Orders actions retain their tooltip text alternatives', () => {
  for (const id of COMPACT_IDS) assert.match(openingButton(id), /\btitle="[^"]+"/);
});
