'use strict';

// Preparation control only. No refresh HTTP requests or production acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { captureSource, fileSha } = require('./lib/powerbi-checkpoint-provenance');
const { parseArgs } = require('./benchmark-powerbi-checkpoint');

function assertComparableSources(before, after) {
  assert.equal(before.contains892, true, 'before must include merged #892');
  assert.equal(after.contains892, true, 'after must include merged #892');
  for (const field of ['protectedFiles', 'canonicalFiles', 'integrationSha256']) {
    assert.ok(before[field], `missing source evidence: ${field}`);
    assert.deepEqual(after[field], before[field], `Both arms must use the same ${field}, including #892 code`);
  }
}

function summarize(samples) {
  assert.equal(samples.length, 6, 'Exactly three before and three after samples are required');
  const reference = samples[0].report;
  const arms = {};
  for (const arm of ['before', 'after']) {
    const reports = samples.filter(sample => sample.arm === arm).map(sample => sample.report);
    assert.equal(reports.length, 3, 'Exactly three samples per arm are required');
    for (const report of reports) {
      assert.equal(report.stage, 'preparation-rehearsal');
      assert.equal(report.parity, true, 'Output parity must pass');
      assert.ok(!report.budget || report.budget.passed, 'Failed budgets cannot be accepted');
      assert.deepEqual(report.target, reports[0].target, 'Source changed within an arm');
      for (const field of ['fixture', 'fixtureSha256', 'outputSha256', 'harnessSha256', 'environment']) {
        assert.deepEqual(report[field], reference[field], `Mismatched ${field}`);
      }
    }
    const values = reports.map(report => ({ ...report.metrics,
      cpuMs: report.metrics.cpuUserMs + report.metrics.cpuSystemMs,
      storeSaveCpuMs: report.metrics.storeSaveCpuUserMs + report.metrics.storeSaveCpuSystemMs }));
    const median = {}, range = {};
    for (const field of ['checkpointBytes', 'wallMs', 'cpuMs', 'peakRssBytes', 'storeSaveWallMs', 'storeSaveCpuMs']) {
      const sorted = values.map(value => value[field]).sort((a, b) => a - b);
      assert.ok(sorted.every(value => Number.isFinite(value) && value >= 0), `Invalid metric: ${field}`);
      median[field] = sorted[1]; range[field] = [sorted[0], sorted[2]];
    }
    arms[arm] = { samples: 3, target: reports[0].target, median, range };
  }
  assertComparableSources(arms.before.target, arms.after.target);
  return { schemaVersion: 1, stage: 'preparation-source-control', optimizationAccepted: false,
    fixture: reference.fixture, fixtureSha256: reference.fixtureSha256,
    outputSha256: reference.outputSha256, harnessSha256: reference.harnessSha256,
    environment: reference.environment, arms };
}

function run(args) {
  const flags = new Map(), allowed = ['--before-app-root', '--after-app-root', '--output-dir', '--orders', '--batch-size', '--scenario'];
  for (let index = 0; index < args.length; index += 2) {
    assert.ok(allowed.includes(args[index]) && args[index + 1] !== undefined && !flags.has(args[index]), 'Invalid cohort option');
    flags.set(args[index], args[index + 1]);
  }
  for (const flag of ['--before-app-root', '--after-app-root', '--output-dir']) assert.ok(flags.get(flag), `${flag} required`);
  const output = path.resolve(flags.get('--output-dir'));
  fs.mkdirSync(output); // Never overwrite evidence from an earlier/failed invocation.
  const samples = [];
  try {
    const roots = Object.fromEntries(['before', 'after'].map(arm => [arm, path.resolve(flags.get(`--${arm}-app-root`))]));
    const sources = Object.fromEntries(Object.entries(roots).map(([arm, root]) => [arm, captureSource(root)]));
    assertComparableSources(sources.before, sources.after);
    const common = ['--orders', '--batch-size', '--scenario'].filter(flag => flags.has(flag)).flatMap(flag => [flag, flags.get(flag)]);
    parseArgs(common);
    const count = { before: 0, after: 0 }, script = path.join(__dirname, 'benchmark-powerbi-checkpoint.js');
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    for (const arm of ['before', 'after', 'after', 'before', 'before', 'after']) {
      const name = `${arm}-${++count[arm]}`;
      const jsonPath = path.join(output, `${name}.json`);
      const child = spawnSync(process.execPath, [script, ...common, '--app-root', roots[arm], '--output', jsonPath], { env, encoding: 'utf8' });
      fs.writeFileSync(path.join(output, `${name}.log`), `${child.stdout || ''}${child.stderr || ''}`);
      assert.equal(child.status, 0, `${name} failed; retained JSON/log, no retry`);
      const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      assert.deepEqual(report.target, sources[arm], 'Source changed since cohort preflight');
      samples.push({ arm, report });
    }
    const summary = { ...summarize(samples), runnerSha256: fileSha(__filename),
      order: samples.map(sample => sample.arm), measuredAt: new Date().toISOString() };
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
    return summary;
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ stage: 'preparation-source-control',
      optimizationAccepted: false, completedSamples: samples.length, failure: { message: error.message, stack: error.stack } }, null, 2) + '\n');
    throw error;
  }
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(run(process.argv.slice(2)), null, 2) + '\n'); }
  catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { summarize, run };
