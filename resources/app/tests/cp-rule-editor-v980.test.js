'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const view = fs.readFileSync(path.join(__dirname, '..', 'public', 'cp-overview-assistant.js'), 'utf8');

test('v9.80 rule editor exposes basic/formula modes and datasource-aware operands', () => {
  assert.match(view, /data-cpa-rule-mode/);
  assert.match(view, /data-cpa-rule-formula/);
  assert.match(view, /data-cpa-cond-left/);
  assert.match(view, /data-cpa-cond-right-type/);
  assert.match(view, /data-cpa-cond-right-field/);
  assert.match(view, /data-cpa-cond-\$\{side\}-offset/);
});

test('v9.80 rule editor validates and previews formulas through the shared engine', () => {
  assert.match(view, /Rules\.validateExpression\(/);
  assert.match(view, /Rules\.evaluateExpression\(/);
  assert.match(view, /data-cpa-formula-test/);
  assert.match(view, /data-cpa-formula-error/);
  assert.match(view, /data-cpa-formula-diagnostics/);
});

test('v9.80 rule editor does not execute formula text as JavaScript', () => {
  assert.doesNotMatch(view, /new Function\(|\beval\(/);
});
