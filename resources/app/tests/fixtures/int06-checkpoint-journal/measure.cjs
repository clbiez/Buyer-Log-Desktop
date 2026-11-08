'use strict';

// Checkpoint-only replay, NOT a connector refresh benchmark. Both arms consume
// the same prepared fixture transport trace, with queries/retries outside timing.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createFixture, assertEquivalent, identity, digest } = require('./inherited/resources/app/scripts/lib/powerbi-checkpoint-fixture.js.source');
const { observeCheckpointWrites } = require('./inherited/resources/app/scripts/lib/powerbi-checkpoint-metrics.js.source');
const { createDashboardCheckpointStore, createDashboardRefreshManifest } = require('../../../server/lib/power-bi-import-dashboard');
const { openCheckpointJournal } = require('../../../server/lib/power-bi-checkpoint-journal');
const appRoot = path.resolve(__dirname, '../../..');
const shaFile = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const config = JSON.parse(process.argv[2]);

async function traceFor(fixture, batchSize) {
  const transport = fixture.transport({ trace: false }), trace = [];
  async function batch(codes) {
    let rows, error;
    for (let attempt = 0; attempt <= 1; attempt += 1) {
      try { rows = await transport.queryBatch(codes, { attempt }); error = null; break; }
      catch (e) { error = e; }
    }
    if (error && codes.length > 1) {
      const middle = Math.ceil(codes.length / 2);
      await batch(codes.slice(0, middle)); await batch(codes.slice(middle)); return;
    }
    const returned = new Set((rows || []).map(row => identity(row['Sipariş Kod'])));
    trace.push({ seq: trace.length + 1, orderStates: Object.fromEntries(codes.map(code => [identity(code),
      error ? 'FAILED' : returned.has(identity(code)) ? 'SUCCESS' : 'NOT_FOUND'])), rows: rows || [],
    lastBatch: { orderCodes: codes, error: error ? error.message : null }, retryPending: 0, updatedAt: '2026-11-08T00:00:00.000Z' });
  }
  for (let i = 0; i < fixture.orderCodes.length; i += batchSize) await batch(fixture.orderCodes.slice(i, i + batchSize));
  return { trace, stats: transport.stats };
}

async function run() {
  assert.ok(['legacy-store', 'journal'].includes(config.arm));
  const fixture = createFixture(config), { trace, stats } = await traceFor(fixture, config.batchSize);
  const traceSha256 = digest(trace);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int06-checkpoint-measure-'));
  const observer = observeCheckpointWrites(root);
  let checkpointWallMs = 0, checkpointCpuMs = 0, writes = 0;
  function timed(fn) {
    const cpu = process.cpuUsage(), start = performance.now();
    try { return fn(); }
    finally {
      checkpointWallMs += performance.now() - start;
      const used = process.cpuUsage(cpu); checkpointCpuMs += (used.user + used.system) / 1000;
    }
  }
  try {
    const initial = createDashboardRefreshManifest(fixture.orderCodes, { refreshId: 'int06-measure', startedAt: '2026-11-08T00:00:00.000Z' });
    let load;
    if (config.arm === 'journal') {
      const journal = timed(() => openCheckpointJournal({ root, initial, snapshotEvery: 64 }));
      for (const d of trace) { timed(() => journal.commit(d)); writes += 1; }
      timed(() => journal.compact()); // include final snapshot, not only append
      load = () => openCheckpointJournal({ root }).materialize();
    } else {
      const store = createDashboardCheckpointStore({ root, userId: 'synthetic' });
      const mirror = { ...initial, rows: [], _allOrderCodes: fixture.orderCodes };
      const remaining = new Map(fixture.orderCodes.map(code => [identity(code), code])), failed = new Set();
      // Excluded input preparation is incremental for BOTH arms. We do not
      // attribute today's production refreshManifestCounts scans to store cost.
      for (const d of trace) {
        Object.assign(mirror.orderStates, d.orderStates);
        for (const [code, state] of Object.entries(d.orderStates)) {
          remaining.delete(code);
          if (state === 'FAILED') failed.add(code); else failed.delete(code);
        }
        for (const row of d.rows) mirror.rows.push(row);
        mirror.processedOrders += Object.keys(d.orderStates).length;
        for (const state of Object.values(d.orderStates)) mirror[state === 'SUCCESS' ? 'successfulOrders'
          : state === 'NOT_FOUND' ? 'notFoundOrders' : 'failedOrders'] += 1;
        mirror.lastBatch = d.lastBatch; mirror.updatedAt = d.updatedAt;
        // Input preparation excludes source scans/normalization. Full copies
        // of compatibility lists still enter the measured store snapshot.
        timed(() => store.save({ ...mirror, orderStates: { ...mirror.orderStates }, rows: mirror.rows.slice(),
          remainingOrders: [...remaining.values()], failedOrderCodes: [...failed] }));
        writes += 1;
      }
      load = () => store.load();
    }
    const peakRssBytes = process.resourceUsage().maxRSS * 1024;
    observer.restore();
    const saved = load();
    assertEquivalent({ ok: true, stopped: false, manifest: saved, rows: saved.rows }, fixture.expected);
    return { stage: 'isolated-checkpoint-replay', productionGainAccepted: false, parity: true,
      config, traceBatches: trace.length, transport: stats, traceSha256,
      fixtureSha256: digest([fixture.orderCodes, fixture.expected]), outputSha256: digest([saved.orderStates, saved.rows]),
      metrics: { checkpointBytes: observer.metrics.bytes, payloadWriteCalls: observer.metrics.calls,
        checkpointWallMs, checkpointCpuMs, peakRssBytes, committedBatches: writes },
      source: { revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8' }).trim(),
        journalSha256: shaFile(path.join(appRoot, 'server/lib/power-bi-checkpoint-journal.js')),
        productionSha256: shaFile(path.join(appRoot, 'server/lib/power-bi-import-dashboard.js')),
        harnessSha256: shaFile(__filename) },
      environment: { node: process.version, platform: process.platform, cpu: os.cpus()[0].model },
      limitations: [
        'Synthetic fixture/mock transport; no real Power BI, credentials, Windows, Electron or SMB.',
        'Checkpoint-only trace replay. No total refresh timing and no production integration gain.',
        'Legacy input counters/compatibility sets prepared incrementally outside timer; current production full state rescans/normalization excluded.',
        'Legacy copy/compatibility-list/store path versus journal initialization/commit/final compaction, not durability-equivalent: legacy has no fsync.',
        'Logical payload bytes (unchanged #890 observer); not physical I/O, metadata or device writes.',
        'OS process-lifetime maxRSS before load/oracle, including trace generation; no forced GC/cold-cache claim.'
      ] };
  } finally { observer.restore(); fs.rmSync(root, { recursive: true, force: true }); }
}
run().then(report => fs.writeFileSync(config.output, JSON.stringify(report, null, 2) + '\n')).catch(error => {
  fs.writeFileSync(config.output, JSON.stringify({ config, parity: false, error: { code: error.code, message: error.message, stack: error.stack } }, null, 2));
  console.error(error); process.exitCode = 1;
});
