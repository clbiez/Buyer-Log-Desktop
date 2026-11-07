'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const inspector = require('node:inspector');
const zlib = require('node:zlib');
const { fork, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { promisify } = require('node:util');
const assert = require('node:assert/strict');
const { createFixture, verifyRestored, sha256 } = require('./lib/backup-diagnostic-fixture');
const { createBackupArchive, inspectBackupArchive, extractBackupArchive } = require('../server/lib/backup-archive');
const APP = path.resolve(__dirname, '..');
const now = () => Number(process.hrtime.bigint()) / 1e6;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}
function summarizeCohort(runs) {
  assert.ok(runs.length >= 3, 'at least three runs required');
  for (const key of ['source', 'fixtureSha256', 'probeKind', 'cohort']) assert.equal(new Set(runs.map(r => r[key])).size, 1, `${key} mismatch`);
  assert.ok(runs.every(r => r.correctness === true), 'correctness failure');
  const median = get => percentile(runs.map(get), .5);
  return { runs: runs.length, wallMs: median(r => r.wallMs), cpuMs: median(r => r.cpuMs), eventLoopP95Ms: median(r => r.eventLoop.p95Ms), eventLoopMaxMs: median(r => r.eventLoop.maxMs), healthP95Ms: median(r => r.health.p95Ms), httpAttempts: runs.reduce((n, r) => n + r.health.attempts, 0), httpFailures: runs.reduce((n, r) => n + r.health.failures, 0), performanceAcceptance: false, reason: 'preparation only; synthetic probe; no production after implementation' };
}
function sourceIdentity() {
  const git = args => execFileSync('git', args, { cwd: APP, encoding: 'utf8' }).trim();
  // A frozen comparison must carry #892 on both sides. This preparation uses its
  // Main merge commit directly, with no rebase or mutation of any review branch.
  const requiredAncestor = '5a1656e98deeb573f6245f4b24a8135cc77a0d7b';
  git(['merge-base', '--is-ancestor', requiredAncestor, 'HEAD']);
  const files = ['server/lib/backup-service.js', 'server/lib/backup-archive.js', 'server/server.js', 'public/app-main.js', 'public/cp-checklist-engine.js', 'public/cp-overview-assistant.js', 'public/checklist-supplier-sync.js'];
  const fileHashes = Object.fromEntries(files.map(file => [file, sha256(fs.readFileSync(path.join(APP, file)))]));
  assert.equal(git(['status', '--porcelain', '--', ...files]), '', 'production source must be clean');
  const harnessFiles = ['scripts/benchmark-backup-crc-sha.js', 'scripts/lib/backup-diagnostic-fixture.js', 'tests/helpers/backup-health-probe.cjs', 'tests/fixtures/backup-crc-sha-v1.json'];
  const harnessHashes = Object.fromEntries(harnessFiles.map(file => [file, sha256(fs.readFileSync(path.join(APP, file)))]));
  return { head: git(['rev-parse', 'HEAD']), requiredAncestor, fileHashes, harnessHashes, source: sha256(JSON.stringify(fileHashes)), node: process.version, platform: process.platform, arch: process.arch, cpuModel: os.cpus()[0]?.model, cpuQuota: fs.existsSync('/sys/fs/cgroup/cpu.max') ? fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null, memoryLimit: fs.existsSync('/sys/fs/cgroup/memory.max') ? fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : null };
}
async function startProbe(port) {
  const child = fork(path.join(APP, 'tests/helpers/backup-health-probe.cjs'), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('exit', code => reject(new Error(`probe exited before ready: ${code}`)));
    child.on('message', m => { if (m.ready) resolve(); });
  });
  child.send({ port }); await ready;
  return { child, stop: () => new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', m => { if (m.attempts) resolve(m.attempts); });
    child.send({ stop: true });
  }) };
}
function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map(n => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const f = nodes.get(profile.samples[i]).callFrame;
    const key = `${f.functionName || '(anonymous)'} @ ${f.url}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + profile.timeDeltas[i]);
  }
  return [...self].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([frame, us]) => ({ frame, sampledSelfMs: us / 1000 }));
}
async function runOne(output, cohort, ordinal, identity, trace) {
  const prefix = `${cohort}-${ordinal}`;
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-admin01-diagnostic-'));
  const server = http.createServer((req, res) => {
    res.writeHead(req.url === '/api/health' ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end('{"probe":"synthetic-admin01"}');
  });
  let archive, probe, session;
  const partial = { cohort, ordinal, root, probeKind: 'synthetic', source: identity.source, trace };
  try {
    const fixture = await createFixture(root);
    partial.fixtureSha256 = fixture.fixtureSha256;
    partial.fixture = { config: fixture.config, expected: fixture.expected };
    await fsp.writeFile(path.join(output, `${prefix}.started.json`), JSON.stringify(partial, null, 2));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    probe = await startProbe(server.address().port);
    await pause(500);
    let post;
    if (trace) {
      session = new inspector.Session(); session.connect(); post = promisify(session.post.bind(session));
      await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 }); await post('Profiler.start');
    }
    const loop = monitorEventLoopDelay({ resolution: 1 }); loop.enable(); await pause(20); loop.reset();
    const utilization = performance.eventLoopUtilization(), cpu = process.cpuUsage(), started = now();
    const phases = []; partial.phases = phases; partial.startedMs = started;
    archive = await createBackupArchive({ entries: fixture.entries, manifest: fixture.manifest, filename: 'synthetic.zip', onProgress: p => {
      if (phases.at(-1)?.phase !== p.phase) phases.push({ phase: p.phase, atMs: now() });
    } });
    const ended = now(), cpuUsed = process.cpuUsage(cpu), elu = performance.eventLoopUtilization(utilization);
    // Let the delayed monitor sample catch up; this is outside archive wall/CPU.
    await pause(10); loop.disable();
    if (trace) {
      const { profile } = await post('Profiler.stop');
      await fsp.writeFile(path.join(output, `${prefix}.cpuprofile.gz`), zlib.gzipSync(JSON.stringify(profile)));
      partial.profile = profileSummary(profile); session.disconnect(); session = null;
    }
    const attempts = await probe.stop(); probe = null;
    const samples = attempts.filter(a => a.sentMs >= started && a.sentMs < ended);
    assert.ok(samples.length >= 20, 'insufficient independent probe samples');
    const idle = attempts.filter(a => a.sentMs < started);
    const health = { endpoint: '/api/health', kind: 'synthetic-harness-not-application', cadenceMs: 10, timeoutMs: 2000, attempts: samples.length, failures: samples.filter(a => a.error || a.status !== 200).length, p50Ms: percentile(samples.map(a => a.latencyMs), .5), p95Ms: percentile(samples.map(a => a.latencyMs), .95), maxMs: Math.max(...samples.map(a => a.latencyMs)), idleP95Ms: percentile(idle.map(a => a.latencyMs), .95) };
    Object.assign(partial, { health, attempts });
    assert.equal(health.failures, 0, 'HTTP probe failure; retain evidence and stop');
    const info = await inspectBackupArchive(archive.path, { requireType: 'full', validateData: true });
    assert.deepEqual(info.manifest.contents, fixture.expected);
    const restored = path.join(root, 'restored');
    await extractBackupArchive(archive.path, restored, { preflight: info, requireType: 'full' });
    await verifyRestored(restored, fixture.expected);
    Object.assign(partial, { wallMs: ended - started, cpuMs: (cpuUsed.user + cpuUsed.system) / 1000, cpuUserMs: cpuUsed.user / 1000, cpuSystemMs: cpuUsed.system / 1000, eventLoop: { p95Ms: loop.percentile(95) / 1e6, maxMs: loop.max / 1e6, utilization: elu.utilization }, health, attempts, phases, archiveBytes: archive.size, archiveSha256: info.archiveSha256, correctness: true });
    await fsp.writeFile(path.join(output, `${prefix}.json`), JSON.stringify(partial, null, 2));
    await archive.cleanup(); archive = null; await fsp.rm(root, { recursive: true, force: true });
    return partial;
  } catch (error) {
    Object.assign(partial, { error: { message: error.message, stack: error.stack }, correctness: false });
    await fsp.writeFile(path.join(output, `${prefix}.failed.json`), JSON.stringify(partial, null, 2));
    throw error; // Keep failed fixture/archive evidence. Never retry POST or work.
  } finally {
    if (probe) probe.child.kill();
    if (session) session.disconnect();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
async function main() {
  const args = process.argv.slice(2);
  assert.ok(args.length === 2 && args[0] === '--output', 'usage: node scripts/benchmark-backup-crc-sha.js --output NEW_DIRECTORY');
  const output = path.resolve(args[1]); await fsp.mkdir(output);
  // Cross-checkouts on this machine share the same lock; no overlapping cohorts.
  const lockPath = path.join(os.tmpdir(), 'buyerlog-admin01-measurement.lock');
  const lock = await fsp.open(lockPath, 'wx');
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, output }));
    const identity = sourceIdentity(); await fsp.writeFile(path.join(output, 'manifest.json'), JSON.stringify(identity, null, 2));
    const runs = [];
    // AB/BA/AB; A and B intentionally execute identical frozen production code.
    for (const [cohort, ordinal] of [['baseline', 1], ['unchanged-control', 1], ['unchanged-control', 2], ['baseline', 2], ['baseline', 3], ['unchanged-control', 3]]) {
      const result = await runOne(output, cohort, ordinal, identity, false); runs.push(result);
      console.log(JSON.stringify({ cohort, ordinal, wallMs: result.wallMs, healthP95Ms: result.health.p95Ms, loopMaxMs: result.eventLoop.maxMs }));
    }
    assert.equal(new Set(runs.map(r => r.fixtureSha256)).size, 1, 'cross-cohort fixture mismatch');
    assert.equal(sourceIdentity().source, identity.source, 'production source changed during measurements');
    const trace = await runOne(output, 'trace', 1, identity, true);
    const summary = { identity, fixtureSha256: runs[0].fixtureSha256, baseline: summarizeCohort(runs.filter(r => r.cohort === 'baseline')), unchangedControl: summarizeCohort(runs.filter(r => r.cohort === 'unchanged-control')), trace: { profile: trace.profile, wallMs: trace.wallMs }, officialBeforeAfter: false, productionChanged: false };
    await fsp.writeFile(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } finally { await lock.close(); await fsp.unlink(lockPath); }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { percentile, summarizeCohort };
