'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const sourcePath = require.resolve('../public/cp-rules-engine');

function load() {
  const calls = [];
  const source = fs.readFileSync(sourcePath, 'utf8').replace(
    'function compileExpression(source, options) {',
    'function compileExpression(source, options) { calls.push(source);');
  const context = { module: { exports: {} }, require: createRequire(sourcePath), calls };
  vm.runInNewContext(source, context);
  calls.length = 0; // Yerleşik kural normalizasyonu ölçülen işin dışındadır.
  return { rules: context.module.exports, calls };
}

test('invalid formula compiles once; exact diagnostics, false decisions and serialization survive cache hits', () => {
  const { rules, calls } = load();
  for (const formula of ['=AND(', '=NO_SUCH_FN(1)', '=[missing', '=1+']) {
    const expected = rules.validateExpression(formula).errors[0];
    calls.length = 0;
    const rule = rules.normalizeRule({ id: 'bad', mode: 'formula', formula, expressionVersion: rules.EXPRESSION_VERSION });
    const serialized = JSON.stringify(rule);
    for (let i = 0; i < 100; i++) {
      assert.equal(rules.matchesRule(rule, { row: { qty: i } }), false);
      assert.equal(rule._formulaError, expected);
    }
    assert.equal(calls.length, 1, formula + ' must compile once including normalization');
    assert.equal(JSON.stringify(rule), serialized);
    assert.ok(Object.keys(rule).every(key => !key.startsWith('_')));
  }
});

test('formula edits invalidate both successful and failed compilation; engine version is part of the key', () => {
  const { rules, calls } = load();
  const rule = { enabled: true, mode: 'formula', formula: '=AND(' };
  assert.equal(rules.matchesRule(rule, {}), false);
  rule.formula = '=1=1';
  assert.equal(rules.matchesRule(rule, {}), true);
  assert.equal(rule._formulaError, undefined);
  rule.formula = '=1+';
  assert.equal(rules.matchesRule(rule, {}), false);
  assert.equal(rule._formulaError, rules.validateExpression(rule.formula).errors[0]);
  const before = calls.length;
  for (let i = 0; i < 20; i++) assert.equal(rules.matchesRule(rule, {}), false);
  assert.equal(calls.length, before);
  Object.defineProperty(rule, '_compiledFormulaVersion', { value: rules.EXPRESSION_VERSION - 1, configurable: true });
  assert.equal(rules.matchesRule(rule, {}), false);
  assert.equal(calls.length, before + 1, 'stale engine version must recompile the failed source');
  rule.formula = '=1=1';
  assert.equal(rules.matchesRule(rule, {}), true);
  Object.defineProperty(rule, '_compiledFormulaVersion', { value: rules.EXPRESSION_VERSION - 1, configurable: true });
  const validBefore = calls.length;
  assert.equal(rules.matchesRule(rule, {}), true);
  assert.equal(calls.length, validBefore + 1);
});
