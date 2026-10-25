'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = require('./helpers/manifest-css')();
const rules = require('./helpers/manifest-css').rules;
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('v5.08 frozen body cells keep an opaque raised layer while hovered', () => {
  const frozen = rules(/\.tablewrap table tbody td\.frzL$/);
  assert.match(frozen, /z-index:var\(--ui-z-raised\)/);
  assert.match(frozen, /isolation:isolate/);
  assert.match(frozen, /background:var\(--ui-surface\) !important/);
  const hover = rules(/\.tablewrap table tbody tr:hover td\.frzL$/);
  assert.match(hover, /background:color-mix\(in srgb,var\(--ui-surface\) 94%,var\(--ui-text\) 6%\) !important/);
  assert.doesNotMatch(hover, /transparent|--ui-row-hover/);
});

test('v5.08 CP Orders and Collection frozen cells cannot become transparent via cell styles', () => {
  for (const id of ['cpTable','ordersTable','kolTable']) {
    const frozen = rules(new RegExp('#'+id+' tbody td\\.frzL'));
    assert.match(frozen, /background-color:var\(--ui-surface\) !important/, id);
  }
  assert.match(INDEX, /function applyFreeze\(tableId, tableKey, withChk\)/);
});
