'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'cp-overview-assistant.css'), 'utf8');

test('expanded rule cards keep their full editor height so conditions are not clipped', () => {
  assert.match(css, /\.cpaRule\{[^}]*flex:\s*0\s+0\s+auto/);
  assert.match(css, /\.cpaRule\{[^}]*min-height:\s*min-content/);
});

test('rule list remains the single bounded scroll surface after an editor expands', () => {
  assert.match(css, /\.cpaRuleList\{[^}]*flex:\s*1\s+1\s+auto/);
  assert.match(css, /\.cpaRuleList\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.cpaRuleList\{[^}]*overscroll-behavior:\s*contain/);
});

test('rules modal grows with its content until the viewport, then remains bounded', () => {
  assert.match(css, /\.cpaRulesModal\{[^}]*height:\s*auto/);
  assert.match(css, /\.cpaRulesModal\{[^}]*max-height:\s*calc\(100vh\s*-\s*2\s*\*\s*var\(--sp-5\)\)/);
  assert.match(css, /\.cpaRulesModal\{[^}]*box-sizing:\s*border-box/);
});
