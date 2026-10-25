'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const SELECTED_IDS = ['kolCopySelectedBtn', 'kolDuplicateBtn', 'kolDropSelectedBtn', 'kolDelRowBtn'];

function openingButton(id) {
  const match = INDEX.match(new RegExp(`<button[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `${id} button should exist`);
  return match[0];
}

test('v10.42 Collection selected-row actions stay compact without a redundant Selected Models label', () => {
  assert.doesNotMatch(INDEX, /kolSelectedGroupLabel/);
  assert.match(CSS, /#kolTableActions>:is\(#kolCopySelectedBtn,#kolDuplicateBtn,#kolDropSelectedBtn,#kolDelRowBtn\)\{[\s\S]*width:var\(--ui-control-height\)/);
  assert.match(CSS, /#kolTableActions>:is\(#kolCopySelectedBtn,#kolDuplicateBtn,#kolDropSelectedBtn,#kolDelRowBtn\)>span\{display:none!important;\}/);
});

test('v10.42 compact Collection actions retain a text alternative through their existing tooltip contract', () => {
  for (const id of SELECTED_IDS) assert.match(openingButton(id), /\btitle="[^"]+"/);
});
