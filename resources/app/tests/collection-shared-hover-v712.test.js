
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const JS=fs.readFileSync(path.join(ROOT,'public','app-main.js'),'utf8');
const CSS=fs.readFileSync(path.join(ROOT,'public','app.css'),'utf8');

test('v7.12 Collection View workspace keeps image pointer events for large hover preview',()=>{
  assert.match(CSS,/#view-koleksiyon\[data-workspace-readonly="1"\] \.kolThumb\{[^}]*pointer-events:auto;[^}]*opacity:1!important;[^}]*cursor:zoom-in!important;/);
  assert.doesNotMatch(CSS,/#view-koleksiyon\[data-workspace-readonly="1"\][^\n{}]*\.kolThumb\{pointer-events:none/);
  assert.match(JS,/img\.addEventListener\('mouseenter',e=>BLImageRuntime\.scheduleHover\(img,e\)/);
  assert.match(JS,/img\.addEventListener\('mousemove'/);
  assert.match(JS,/img\.addEventListener\('mouseleave',kolHideImgPopup\)/);
});

test('v7.12 Collection View workspace does not expose image edit/delete actions',()=>{
  const block=JS.match(/if\(kolWorkspaceCanEdit\)\{[\s\S]*?img\.addEventListener\('contextmenu'[\s\S]*?\n    \}/);
  assert.ok(block,'image mutation handlers should be guarded by kolWorkspaceCanEdit');
  assert.match(block[0],/img\.addEventListener\('click'/);
  assert.match(block[0],/img\.addEventListener\('dblclick'/);
  assert.match(block[0],/img\.addEventListener\('contextmenu'/);
});
