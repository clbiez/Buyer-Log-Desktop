'use strict';
// Prepared collector, NOT run for Phase 6a. Only post-885 synthetic captures.
// stdout is JSON. No server, network, credentials, application imports or writes.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function readCapture(manifestPath, arm) {
  const root = path.dirname(fs.realpathSync(manifestPath));
  assert.equal(path.dirname(root), fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(root), /^buyerlog-phase6a-/);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.phaseGate, 'post-885-main');
  assert.equal(manifest.shadowStatus, 'passed');
  for (const key of ['mainSha', 'candidateSha', 'fixtureSha256', 'shadowReportSha256']) assert.match(manifest[key], key.endsWith('Sha256') ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{40}$/);
  assert.ok(manifest.rows >= 0 && Number.isSafeInteger(manifest.rows));
  const descriptor = manifest[arm];
  assert.ok(descriptor && ['full.json', 'thin.json'].includes(descriptor.file));
  assert.equal(descriptor.file, arm + '.json');
  const file = path.join(root, descriptor.file);
  assert.equal(fs.lstatSync(file).isSymbolicLink(), false);
  assert.equal(path.dirname(fs.realpathSync(file)), root);
  const bytes = fs.readFileSync(file);
  assert.equal(sha(bytes), descriptor.sha256);
  return { manifest, bytes };
}
function collect(manifestPath, arm) {
  assert.equal(typeof global.gc, 'function', 'Use --expose-gc');
  const { manifest, bytes } = readCapture(manifestPath, arm);
  global.gc();
  const decodeHeapBefore = process.memoryUsage().heapUsed;
  const decodeStart = performance.now();
  const input = bytes.toString('utf8');
  const decodeMs = performance.now() - decodeStart;
  global.gc();
  const decodedStringRetainedBytes = process.memoryUsage().heapUsed - decodeHeapBefore;
  for (let index = 0; index < 20; index++) JSON.parse(input);
  const samples = [];
  for (let index = 0; index < 30; index++) {
    global.gc();
    const before = process.memoryUsage();
    const start = performance.now();
    let parsed = JSON.parse(input);
    const parseMs = performance.now() - start;
    const immediate = process.memoryUsage();
    global.gc();
    const retained = process.memoryUsage();
    // Keep the object observably live through the retained sample.
    const rootKeys = Object.keys(parsed || {}).length;
    samples.push({ index, parseMs, immediateHeapDeltaBytes: immediate.heapUsed - before.heapUsed,
      retainedHeapDeltaBytes: retained.heapUsed - before.heapUsed, beforeHeapUsedBytes: before.heapUsed,
      retainedHeapUsedBytes: retained.heapUsed, rssBytes: retained.rss, externalBytes: retained.external,
      arrayBuffersBytes: retained.arrayBuffers, rootKeys });
    parsed = null;
  }
  // gzip is a size control, outside decode/parse/heap timings. HTTP bytes measured separately.
  return { arm, mainSha: manifest.mainSha, candidateSha: manifest.candidateSha, rows: manifest.rows,
    fixtureSha256: manifest.fixtureSha256, shadowReportSha256: manifest.shadowReportSha256,
    inputSha256: sha(bytes), rawUtf8Bytes: bytes.length, gzipLevel4Bytes: zlib.gzipSync(bytes, { level: 4 }).length,
    decodeMs, decodedStringRetainedBytes, samples };
}
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}
function run(manifestPath) {
  const runs = [];
  for (let pair = 0; pair < 10; pair++) {
    for (const arm of pair % 2 ? ['thin', 'full'] : ['full', 'thin']) {
      const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=4096', __filename, '_child', manifestPath, arm], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      assert.equal(child.status, 0, child.error?.message || child.stderr);
      runs.push({ pair, ...JSON.parse(child.stdout) });
    }
  }
  const summary = Object.fromEntries(['full', 'thin'].map(arm => {
    const samples = runs.filter(run => run.arm === arm).flatMap(run => run.samples);
    return [arm, { parseMedianMs: quantile(samples.map(s => s.parseMs), 0.5), parseP95Ms: quantile(samples.map(s => s.parseMs), 0.95),
      retainedHeapMedianBytes: quantile(samples.map(s => s.retainedHeapDeltaBytes), 0.5), retainedHeapP95Bytes: quantile(samples.map(s => s.retainedHeapDeltaBytes), 0.95) }];
  }));
  return { synthetic: true, kind: 'json-micro-only', collectorSha256: sha(fs.readFileSync(__filename)),
    runtime: { node: process.version, v8: process.versions.v8, platform: process.platform, arch: process.arch,
      cpu: os.cpus()[0]?.model, parallelism: os.availableParallelism(), gc: 'forced outside timing; input Buffer/string retained',
      cpuQuota: fs.existsSync('/sys/fs/cgroup/cpu.max') ? fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim() : null,
      memoryLimit: fs.existsSync('/sys/fs/cgroup/memory.max') ? fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim() : null },
    sampling: { freshPairs: 10, order: 'AB/BA alternating', warmupPerProcess: 20, samplesPerProcess: 30, quantile: 'nearest-rank',
      exclusions: 'none; child error aborts report', scope: 'one payload; excludes hydration, rendering, network, structured clone, application caches' }, summary, runs };
}
const command = process.argv[2];
if (command === 'self-test') {
  assert.equal(quantile([3, 1, 2], 0.5), 2);
  assert.equal(quantile(Array.from({ length: 100 }, (_, i) => i + 1), 0.95), 95);
  assert.equal(sha(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.throws(() => readCapture(__filename, 'full'));
  console.log('PASS: quantile/hash/path guard; no measurement executed');
} else if (command === '_child') console.log(JSON.stringify(collect(process.argv[3], process.argv[4])));
else if (command === 'run' && process.argv[3]) console.log(JSON.stringify(run(process.argv[3]), null, 2));
else { console.error('Usage: node measure-json.cjs self-test | run /tmp/buyerlog-phase6a-*/manifest.json'); process.exitCode = 2; }
