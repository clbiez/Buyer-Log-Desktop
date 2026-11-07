'use strict';
// Kullanım: node scripts/cp-rule-compile-cache-benchmark.js [alternate-source.js]
const fs = require('node:fs'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const sourcePath = require.resolve('../public/cp-rules-engine');
const source = fs.readFileSync(process.argv[2] || sourcePath, 'utf8').replace(
  'function compileExpression(source, options) {',
  'function compileExpression(source, options) { calls.count++;');
const calls = { count: 0 }, context = { module: { exports: {} }, require: createRequire(sourcePath), calls };
vm.runInNewContext(source, context);
const rules = context.module.exports, results = [];
for (const formula of ['=AND(', '=1=1']) {
  const samples = [];
  let compiles, matches, error;
  for (let run = 0; run < 6; run++) {
    calls.count = 0;
    const start = performance.now();
    const rule = rules.normalizeRule({ id: 'demo', mode: 'formula', formula, expressionVersion: rules.EXPRESSION_VERSION });
    matches = 0;
    for (let i = 0; i < 30000; i++) matches += Number(rules.matchesRule(rule, { row: { qty: i } }));
    const elapsed = performance.now() - start;
    compiles = calls.count; error = rule._formulaError || null;
    if (run) samples.push(elapsed);
  }
  samples.sort((a, b) => a - b);
  results.push({ formula, rows: 30000, compiles, matches, error, medianMs: samples[2], samplesMs: samples });
}
console.log(JSON.stringify({ node: process.version, results }, null, 2));
