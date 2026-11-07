'use strict';

// Altı taze süreç sırayla; ilk tanı profili resmi kohorta dahil edilmez.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const app = path.join(root, 'resources/app');
const output = path.resolve(process.argv[2] || path.join(__dirname, 'artifacts/cohort'));
const lock = path.join(os.tmpdir(), 'buyer-log-int01-measurement.lock');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const files = [
  'resources/app/scripts/benchmark-int-01-parse.js', 'resources/app/scripts/lib/int-01-fixture.js',
  'resources/app/scripts/lib/int-01-refresh-harness.js', 'resources/app/scripts/lib/int-01-parse-prototype.js',
  'docs/performance-program/int-01/measure.cjs', 'resources/app/scripts/generate-demo-data.js',
  'resources/app/server/lib/model-refresh.js', 'resources/app/server/lib/parse.js', 'resources/app/server/lib/lfl.js',
  'resources/app/server/lib/canonical-fields.js', 'resources/app/public/canonical-fields.js',
  'resources/app/public/business-rules.js', 'resources/app/public/cp-readiness-engine.js',
  'resources/app/public/order-importance.js', 'resources/app/public/date-dimension.js',
  'resources/app/public/excel-date-utils.js', 'resources/app/server/lib/horizon-source-planner.js',
  'resources/app/server/lib/model-scopes.js', 'resources/app/server/lib/model-fields.js',
  // #892 kodu iki kolda aynı; özel dosya kilidi istisnası genişletilmez.
  'resources/app/public/app-main.js', 'resources/app/public/cp-overview-assistant.js',
  'resources/app/public/cp-checklist-engine.js', 'resources/app/public/checklist-supplier-sync.js',
];
const snapshot = () => Object.fromEntries(files.map(file => [file, sha(file)]));
const readOptional = file => { try { return fs.readFileSync(file, 'utf8').trim(); } catch { return null; } };
const median = values => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

function main() {
  fs.mkdirSync(output, { recursive: true });
  const lockFd = fs.openSync(lock, 'wx');
  try {
    fs.writeFileSync(lockFd, `${process.pid}\n`);
    const main892 = '5a1656e98deeb573f6245f4b24a8135cc77a0d7b';
    git('merge-base', '--is-ancestor', main892, 'HEAD');
    assert.equal(git('diff', main892, '--', 'resources/app/server', 'resources/app/public'), '', 'production source must match Main #892');
    const hashes = snapshot();
    const plan = {
      baseSha: main892, headSha: git('rev-parse', 'HEAD'), hashes,
      order: ['before', 'after', 'after', 'before', 'before', 'after'], rows: 30000,
      runtime: { node: process.version, platform: process.platform, release: os.release(), arch: process.arch,
        parallelism: os.availableParallelism(), cpuModel: os.cpus()[0].model,
        cpuMax: readOptional('/sys/fs/cgroup/cpu.max'), memoryMax: readOptional('/sys/fs/cgroup/memory.max'),
        nodeProcessesAtStart: execFileSync('ps', ['-eo', 'pid=,comm=,args='], { encoding: 'utf8' })
          .split('\n').filter(line => /^\s*\d+\s+(node|MainThread)\s/.test(line)).join('\n'),
      },
      limitations: ['synthetic mock DB transport; no HTTP or POST', 'diagnostic full-copy prototype; no production optimization',
        'fresh processes; no forced GC; OS cache not cleared', 'RSS is OS process high-water through measured completion, including fixture/setup',
        'event-loop monitor covers 30ms idle before/after synchronous refresh; p95 is diagnostic only',
        'not a post-#885/6c production acceptance or Windows/Electron measurement'],
    };
    fs.writeFileSync(path.join(output, 'plan.json'), JSON.stringify(plan, null, 2) + '\n');
    const reports = [];
    for (const [index, mode] of plan.order.entries()) {
      const basename = `${index + 1}-${mode}`;
      const reportPath = path.join(output, basename + '.json');
      if (fs.existsSync(reportPath)) throw Error(`Refusing to overwrite measurement: ${reportPath}`);
      assert.deepEqual(snapshot(), hashes, 'source changed during cohort');
      const startedAt = new Date().toISOString();
      const child = spawnSync(process.execPath, ['scripts/benchmark-int-01-parse.js', mode, reportPath, String(plan.rows)], { cwd: app, encoding: 'utf8', timeout: 180000 });
      const completedAt = new Date().toISOString();
      fs.writeFileSync(path.join(output, basename + '.log'), (child.stdout || '') + (child.stderr || '') + `\nexit=${child.status}; signal=${child.signal}; error=${child.error?.message || ''}\n`);
      if (child.status !== 0) throw Error(`Measurement failed; evidence retained: ${basename}`);
      assert.deepEqual(snapshot(), hashes, 'source changed during measurement');
      const report = JSON.parse(fs.readFileSync(reportPath));
      reports.push({ basename, startedAt, completedAt, ...report });
      fs.writeFileSync(path.join(output, 'attempts.json'), JSON.stringify(reports.map(({ basename, startedAt, completedAt }) => ({ basename, startedAt, completedAt })), null, 2) + '\n');
      assert.deepEqual(report.fixture, reports[0].fixture, 'fixture mismatch');
      assert.deepEqual(report.outputs, reports[0].outputs, 'output equivalence failed');
      assert.equal(report.transportCalls, 2);
      assert.equal(report.parses.filter(p => p.kind === 'asas').length, mode === 'before' ? 4 : 1);
      assert.equal(report.parses.filter(p => p.kind === 'antrepo').length, mode === 'before' ? 3 : 1);
      console.log(`${basename}: ${report.wallMs.toFixed(1)} ms, peak ${(report.peakRssKiB / 1024).toFixed(1)} MiB; parity PASS`);
    }
    const metrics = {
      wallMs: r => r.wallMs, cpuMs: r => r.cpuMs, peakRssMiB: r => r.peakRssKiB / 1024,
      eventLoopMaxMs: r => r.eventLoop.maxMs,
      nativeParseMs: r => r.parses.reduce((sum, p) => sum + p.durationMs, 0),
      targetCopyAndKeyMs: r => r.targetMaterializations.reduce((sum, p) => sum + p.durationMs - p.nativeParseMs, 0),
    };
    const summary = { sampleCountPerArm: 3, fixture: reports[0].fixture, parity: true,
      medians: Object.fromEntries(Object.entries(metrics).map(([name, read]) => [name, Object.fromEntries(['before', 'after'].map(mode => [mode, median(reports.filter(r => r.mode === mode).map(read))]))])),
    };
    fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}
try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }
