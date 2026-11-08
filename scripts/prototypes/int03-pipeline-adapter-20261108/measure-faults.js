'use strict';
const { performance } = require('node:perf_hooks');
const h = require('./harness');
const arm = process.argv[2], scenario = process.argv[3];
if (!['before', 'after'].includes(arm) || !['partial', 'cancel'].includes(scenario)) throw new Error('arm/scenario required');
const xs = h.fixture.fixture(48);
const controller = new AbortController();
let peakExternal = process.memoryUsage().external;
function sample() { peakExternal = Math.max(peakExternal, process.memoryUsage().external); }
const c = h.context(xs, { arm, signal: controller.signal, isCancelled: () => controller.signal.aborted, writeDelayMs: 1,
  transportHooks: { spec: i => ({ chunked: i.urlId % 3 === 0, invalid: scenario === 'partial' && i.urlId === 7 }), onSettle: sample },
  onSave() { sample(); if (scenario === 'cancel') controller.abort(); },
});
(async () => {
  const started = performance.now();
  const r = await c.run(); const totalMs = performance.now() - started; sample();
  const osPeakRssBytes = process.resourceUsage().maxRSS * 1024;
  const outputs = h.output(xs).map(({ key, hash }) => ({ key, hash }));
  const expected = xs.map(i => ({ key: h.baseIngest.canonicalKeyFor(i), hash: scenario === 'partial' && i.urlId === 7 ? null : h.fixture.hash(h.fixture.png(i.size, i.contentTag)) }));
  const snap = c.runtime.snapshot();
  const report = { arm, scenario, fixtureSha256: h.fixture.hash(JSON.stringify(xs)), items: xs.length,
    osPeakRssBytes, sampledPeakExternalBytes: peakExternal, peakReservationBytes: snap.peakReservedBytes, firstCanonicalLinkMs: c.metrics.firstCanonicalLinkMs, totalMs,
    status: r.status, failures: r.failures.map(x => ({ key: h.baseIngest.canonicalKeyFor(x), code: x.code })),
    outputSha256: h.fixture.hash(JSON.stringify(outputs)), oracleMatches: JSON.stringify(outputs) === JSON.stringify(expected),
    revisionDelta: h.snapshot().revision, patchCalls: c.metrics.patchCalls, checkpoints: c.metrics.checkpoints,
    noRetention: snap.reservedBytes === 0 && snap.activePermits === 0 && snap.waitingCount === 0 && snap.buffers === 0 && snap.stagedBytes === 0 && snap.scopes === 0 && c.transport.stats.active === 0 && c.transport.stats.retainedBodies === 0,
  };
  if (!report.oracleMatches || !report.noRetention || report.status !== (scenario === 'partial' ? 'partial' : 'cancelled') || report.revisionDelta !== 1 || report.patchCalls !== 1) throw new Error('Fault oracle failed: '+JSON.stringify(report));
  process.stdout.write(JSON.stringify(report)+'\n');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(h.cleanup);
