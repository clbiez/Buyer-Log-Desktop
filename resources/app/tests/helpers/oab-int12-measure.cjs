'use strict';
// Fixture-only rehearsal; sequential arms, immutable raw samples, no network.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { runCase, equivalent, sourceIdentity, scenarios } = require('./oab-int12-harness.cjs');
const repo = path.resolve(__dirname, '../../../..');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => fs.readFileSync(path.join(repo, file));
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const percentile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b); // Numeric timing samples only; never result/failure arrays.
  return sorted[Math.ceil(sorted.length * q) - 1];
};
const preflightOnly = process.argv.includes('--preflight-only');
const output = path.resolve(process.argv.slice(2).find(arg => arg !== '--preflight-only') || path.join(repo, 'docs/performance-program/int-12/followup-evidence/ab-3pairs'));
const lock = path.join(os.tmpdir(), 'buyerlog-int12-measure.lock');

async function main() {
  const identity = sourceIdentity();
  // Versioned integration evidence; historical GREEN/RED/measurements stay intact.
  const gate = JSON.parse(read('docs/performance-program/int-12/main-integration/green-gate.json'));
  assert.deepEqual(gate.counts, { tests: 17, pass: 17, fail: 0, skipped: 0, cancelled: 0 });
  assert.equal(gate.harnessSha256, identity.harnessSha256, 'Harness changed after GREEN');
  assert.equal(gate.testSha256, sha(read('resources/app/tests/oab-int12-preparation.test.js')), 'Tests changed after GREEN');
  assert.equal(gate.logSha256, sha(read('docs/performance-program/int-12/main-integration/preparation-green.txt')));
  assert.equal(gate.authHelperSha256, identity.authHelperSha256, 'Native auth changed after GREEN');
  assert.equal(identity.serviceSha256, identity.expectedServiceSha256);
  git(['merge-base', '--is-ancestor', identity.mainWith892, 'HEAD']);
  assert.match(gate.productionBase, /^[a-f0-9]{40}$/);
  git(['merge-base', '--is-ancestor', gate.productionBase, 'HEAD']);
  assert.equal(git(['diff', '--name-only', gate.productionBase, '--', 'resources/app/server', 'resources/app/public', 'CLAUDE.md', 'AGENTS.md']), '', 'Protected production files changed');
  if (preflightOnly) {
    console.log(JSON.stringify({ mode: 'preflight-only', productionBase: gate.productionBase, identity, measurementRun: false }));
    return;
  }
  const processes = execFileSync('ps', ['-eo', 'pid=,comm='], { encoding: 'utf8' }).trim();
  const competing = processes.split('\n').map(line => line.trim().split(/\s+/)).filter(([pid, name]) =>
    Number(pid) !== process.pid && /^(node|nodejs|chromium|chrome|firefox)$/.test(name));
  assert.deepEqual(competing, [], 'Another Node/browser process is active; do not overlap measurements');
  const fd = fs.openSync(lock, 'wx');
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, output, startedAt: new Date().toISOString() }));
    fs.mkdirSync(output); // Refuse to overwrite any previous successful or failed cohort.
    const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
    const preflight = { kind: 'mock-only-AB-BA-AB-rehearsal', identity, gitHead: git(['rev-parse', 'HEAD']),
      environment: { node: process.version, platform: os.platform(), release: os.release(), cpuCount: os.cpus().length,
        cpuMax: fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(), memoryMax: fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() },
      pid: process.pid, processes, gate, startedAt: new Date().toISOString(), enterpriseAcceptance: false, productionChange: false };
    save('preflight.json', preflight);
    const samples = [];
    try {
      for (let pair = 1; pair <= 3; pair++) {
        const order = pair === 2 ? [2, 1] : [1, 2];
        for (const scenario of scenarios) {
          const arms = new Map();
          for (const width of order) {
            const startedAt = new Date().toISOString();
            const result = await runCase({ scenario, width });
            const sample = { pair, order, startedAt, finishedAt: new Date().toISOString(), ...result };
            // Preserve all raw data BEFORE any assertion can fail.
            save(`pair-${pair}-${scenario}-width-${width}.json`, sample);
            samples.push(sample); arms.set(width, result);
            assert.deepEqual(result.identity, identity);
            assert.ok(result.metrics.peakReports <= width);
            assert.equal(result.metrics.activeAtFinish, 0);
            // A 429/ordinary failure never causes an automatic report retry.
            if (!['auth-recovery', 'revoke-recovery'].includes(scenario))
              assert.ok(result.events.every(e => e.type !== 'report-start' || e.attempt === 1));
          }
          assert.deepEqual(equivalent(arms.get(2)), equivalent(arms.get(1)));
          assert.deepEqual(arms.get(2).outcome.job.failures, arms.get(1).outcome.job.failures);
          console.log(`pair=${pair} scenario=${scenario} order=${order.join('/')} equality=PASS`);
        }
      }
    } catch (error) {
      save('stopped.json', { status: 'RED_STOPPED', completedSamples: samples.length, message: error.message, stack: error.stack });
      throw error;
    }
    const summary = { kind: preflight.kind, status: 'REHEARSAL_PASS_ONLY', identity, samples: samples.length,
      pairCount: 3, scenarioCount: scenarios.length, percentiles: 'nearest rank; n=3 p95=max; no tail/capacity inference',
      enterpriseAcceptance: false, productionChange: false, finishedAt: new Date().toISOString(), scenarios: {} };
    for (const scenario of scenarios) {
      summary.scenarios[scenario] = {};
      for (const width of [1, 2]) {
        const rows = samples.filter(s => s.scenario === scenario && s.width === width);
        const requestTimes = rows.flatMap(r => r.events.filter(e => e.type === 'report-end').map(e => e.durationMs));
        summary.scenarios[scenario][width] = { n: rows.length, wallMs: rows.map(r => r.metrics.wallMs),
          wallP50Ms: percentile(rows.map(r => r.metrics.wallMs), .5), wallP95Ms: percentile(rows.map(r => r.metrics.wallMs), .95),
          reportP50Ms: percentile(requestTimes, .5), reportP95Ms: percentile(requestTimes, .95),
          reports: rows.map(r => r.metrics.reports), transportErrors: rows.map(r => r.metrics.errors),
          combinationFailures: rows.map(r => r.outcome.job.failures.length), throttles: rows.map(r => r.metrics.throttles),
          recoveries: rows.map(r => r.metrics.recoveries), cacheHits: rows.map(r => r.metrics.cacheHits),
          peakReports: rows.map(r => r.metrics.peakReports), errorCodes: rows.map(r => r.outcome.job.errorCode) };
      }
    }
    save('summary.json', summary);
    save('manifest.json', { identity, files: Object.fromEntries(fs.readdirSync(output).filter(n => n !== 'manifest.json')
      .map(name => [name, sha(fs.readFileSync(path.join(output, name)))])) });
    console.log(`Saved ${samples.length} raw samples to ${output}; no production acceptance.`);
  } finally {
    fs.closeSync(fd); fs.unlinkSync(lock);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
