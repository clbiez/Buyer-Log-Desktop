'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = require('./helpers/manifest-css')();
const rules = require('./helpers/manifest-css').rules;
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'public', 'table-freeze.js'), 'utf8');

test('v5.08 frozen body cells keep an opaque raised layer while hovered', () => {
  // Donmuş gövde hücresi kayan hücrelerin üstünde tek katmandır ve opak zemin alır.
  assert.match(ENGINE, /'>tbody>' \+ plain \+ '>' \+ n \+ '\{position:sticky!important;left:' \+ px \+ '!important;z-index:var\(--ui-z-frozen-cell\)!important\}'/);
  assert.match(ENGINE, /\{background-color:var\(--ui-surface\)\}/);
  // Satır üzeri zemini donmuş hücreye de opak olarak gelir: token yüzeyle karışımdır.
  assert.match(CSS, /--ui-row-hover:color-mix\(in srgb,var\(--ui-accent\) 6%,var\(--ui-surface\)\)/);
  assert.match(CSS, /--ui-z-frozen-cell:20;--ui-z-sticky:30;--ui-z-sticky-column:31;/);
});

test('v5.08 CP Orders and Collection frozen cells cannot become transparent via cell styles', () => {
  // Eski kimlik seçicili zemin/katman yamaları kaldırıldı; tek sahibi motor.
  for (const id of ['cpTable','ordersTable','kolTable'])
    assert.doesNotMatch(CSS, new RegExp('#'+id+'[^{]*frzL'), id);
  assert.match(INDEX, /function applyFreeze\(tableId, tableKey, withChk\)/);
  assert.match(ENGINE, /'>thead>tr>th\{z-index:var\(--ui-z-sticky\)!important\}'/,
    'scrolling headers must stay above frozen body cells');
});
