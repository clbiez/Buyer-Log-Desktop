'use strict';

// TR: Yalnız sentetik veri; her ölçümü yeni Node sürecinde çalıştırın.
// EN: Synthetic data only; run each measurement in a fresh Node process.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createFixture, assertEquivalent, digest } = require('./lib/powerbi-checkpoint-fixture');
const { observeCheckpointWrites } = require('./lib/powerbi-checkpoint-metrics');
const { fileSha, captureSource, assertSourceUnchanged, acquireMeasurementLock } = require('./lib/powerbi-checkpoint-provenance');

function parseArgs(args) {
  const flags = new Map();
  const allowed = ['--orders', '--batch-size', '--scenario', '--app-root', '--output', '--max-write-amplification'];
  for (let i = 0; i < args.length; i += 2) {
    assert.ok(allowed.includes(args[i]) && args[i + 1] !== undefined, `Unknown/incomplete option: ${args[i]}`);
    assert.ok(!flags.has(args[i]), `Duplicate option: ${args[i]}`);
    flags.set(args[i], args[i + 1]);
  }
  const orders = Number(flags.get('--orders') || 30000), batchSize = Number(flags.get('--batch-size') || 250);
  const scenario = flags.get('--scenario') || 'steady';
  const maxAmplification = flags.has('--max-write-amplification') ? Number(flags.get('--max-write-amplification')) : null;
  assert.ok(maxAmplification === null || Number.isFinite(maxAmplification) && maxAmplification >= 0);
  return { orders, batchSize, scenario, maxAmplification,
    appRoot: path.resolve(flags.get('--app-root') || path.join(__dirname, '..')), output: flags.get('--output') };
}

const harnessSha = () => digest([fileSha(__filename), fileSha(path.join(__dirname, 'lib/powerbi-checkpoint-fixture.js')),
  fileSha(path.join(__dirname, 'lib/powerbi-checkpoint-metrics.js')), fileSha(path.join(__dirname, 'lib/powerbi-checkpoint-provenance.js'))]);

async function run(options) {
  const release = acquireMeasurementLock();
  try { return await measure(options); } finally { release(); }
}

async function measure(options) {
  const modulePath = path.join(options.appRoot, 'server/lib/power-bi-import-dashboard.js');
  const target = captureSource(options.appRoot);
  const harnessSha256 = harnessSha();
  const { PowerBiImportDashboardConnector, createDashboardCheckpointStore } = require(modulePath);
  const fixture = createFixture(options), transport = fixture.transport({ trace: false });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'powerbi-checkpoint-bench-'));
  const store = createDashboardCheckpointStore({ root, userId: 'synthetic' });
  const observer = observeCheckpointWrites(root);
  let checkpoints = 0, progressEvents = 0;
  let storeSaveWallMs = 0, storeSaveCpuUserMs = 0, storeSaveCpuSystemMs = 0;
  let completed = false;
  try {
    const connector = new PowerBiImportDashboardConnector({ transport, batchSize: options.batchSize, maxRetries: 1, backoffMs: 1 });
    const cpu = process.cpuUsage(), start = performance.now();
    const result = await connector.refresh({ orderCodes: fixture.orderCodes,
      checkpoint: value => {
        const saveCpu = process.cpuUsage(), saveStart = performance.now();
        store.save(value);
        storeSaveWallMs += performance.now() - saveStart;
        const saveUsage = process.cpuUsage(saveCpu);
        storeSaveCpuUserMs += saveUsage.user / 1000;
        storeSaveCpuSystemMs += saveUsage.system / 1000;
        checkpoints += 1;
      },
      onProgress: value => { assert.ok(value.processedOrders > 0); progressEvents += 1; } });
    const wallMs = performance.now() - start, usage = process.cpuUsage(cpu);
    // OS high water captures synchronous work, unlike a timer on the blocked loop.
    // Capture before load/oracle/hash allocation. Linux/macOS Node reports KiB.
    const peakRssBytes = process.resourceUsage().maxRSS * 1024;
    observer.restore();
    assertSourceUnchanged(options.appRoot, target);
    assert.equal(harnessSha(), harnessSha256, 'Harness source changed during measurement');
    assert.ok(observer.metrics.calls > 0, 'No supported checkpoint writes observed');
    const saved = store.load();
    assertEquivalent(result, fixture.expected);
    assertEquivalent({ ok: true, stopped: false, manifest: saved, rows: saved.rows }, fixture.expected);
    const files = fs.readdirSync(root).filter(name => fs.statSync(path.join(root, name)).isFile());
    const finalCheckpointBytes = files.reduce((sum, name) => sum + fs.statSync(path.join(root, name)).size, 0);
    const amplification = observer.metrics.bytes / finalCheckpointBytes;
    completed = true;
    return { schemaVersion: 1, stage: 'preparation-rehearsal', measuredAt: new Date().toISOString(),
      target, harnessSha256,
      environment: { node: process.version, platform: process.platform, arch: process.arch,
        cpu: os.cpus()[0].model, availableParallelism: os.availableParallelism(), peakRssMethod: 'process.resourceUsage().maxRSS KiB × 1024; process lifetime before oracle/load' },
      fixture: { orders: options.orders, batchSize: options.batchSize, scenario: options.scenario, version: 1 },
      fixtureSha256: digest([fixture.orderCodes, fixture.expected]), outputSha256: digest([result.manifest.orderStates, result.rows]),
      parity: true, checkpoints, progressEvents, transport: transport.stats, coverage: fixture.expected.counts,
      metrics: { checkpointBytes: observer.metrics.bytes, checkpointWrites: observer.metrics.calls,
        finalCheckpointBytes, writeAmplification: amplification, wallMs,
        cpuUserMs: usage.user / 1000, cpuSystemMs: usage.system / 1000, peakRssBytes,
        storeSaveWallMs, storeSaveCpuUserMs, storeSaveCpuSystemMs },
      budget: options.maxAmplification === null ? null : { maxWriteAmplification: options.maxAmplification, passed: amplification <= options.maxAmplification },
      limitations: ['Synthetic zero-latency transport; no Power BI service, Electron, Windows or SMB claim.',
        'Logical successful sync writeFileSync/appendFileSync payload bytes; no physical I/O or power-loss durability claim.',
        'CPU/wall cover refresh with real disk checkpoints and progress; RSS is process lifetime high water.',
        'Preparation only. Re-run paired before/after on post-885 Main; no forced GC or cold-cache claim.'] };
  } catch (error) {
    error.measurement = { target, harnessSha256, scratchRoot: root,
      checkpoints, progressEvents, transport: transport.stats, checkpointWrites: { ...observer.metrics } };
    throw error;
  } finally {
    observer.restore();
    if (completed) fs.rmSync(root, { recursive: true, force: true });
  }
}

if (require.main === module) {
  (async () => {
    const options = parseArgs(process.argv.slice(2));
    let report;
    try { report = await run(options); }
    catch (error) {
      report = { schemaVersion: 1, stage: 'preparation-rehearsal', measuredAt: new Date().toISOString(), parity: false,
        fixture: { orders: options.orders, batchSize: options.batchSize, scenario: options.scenario, version: 1 },
        ...error.measurement, failure: { code: error.code || 'BENCHMARK_FAILED', message: error.message, stack: error.stack } };
      console.error(error);
      process.exitCode = 1;
    }
    const json = JSON.stringify(report, null, 2) + '\n';
    if (options.output) fs.writeFileSync(options.output, json);
    process.stdout.write(json);
    if (report.budget && !report.budget.passed) process.exitCode = 1;
  })().catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { parseArgs, run };
