'use strict';
// One isolated process per arm. Both arms use identical synthetic stream and
// canonical storage. This does not measure UI visibility or production acceptance.
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const h = require('./harness');
const { envelopeBytes, B, OLD, IO } = require('./runtime');
const arm = process.argv[2];
if (!['before', 'after'].includes(arm)) throw new Error('Expected before or after');
const xs = h.fixture.fixture(2048);
const samples = [];
const peak = { rss: 0, external: 0, arrayBuffers: 0 };
let start = performance.now();
function sample(event) {
  const m = process.memoryUsage();
  for (const key of Object.keys(peak)) peak[key] = Math.max(peak[key], m[key]);
  if (samples.length < 12000) samples.push({ event, ms: performance.now() - start, ...m });
}
async function main() {
  const first = h.context(xs.slice(0, 1024), { arm, writeDelayMs: 1,
    transportHooks: { spec: i => ({ chunked: i.urlId % 3 === 0 }), onOpen() { sample('open'); }, onSettle() { sample('transport-settled'); } }, onSave() { sample('save'); } });
  const second = h.context(xs.slice(1024), { arm, writeDelayMs: 1, runtime: first.runtime,
    transportHooks: { spec: i => ({ chunked: i.urlId % 3 === 0 }), onOpen() { sample('open'); }, onSettle() { sample('transport-settled'); } }, onSave() { sample('save'); } });
  // Both supported service inputs receive the same ownership snapshot object.
  // Otherwise the unmodified baseline overwrites the other job's owner records.
  // No source or oracle is weakened; the harness policy is explicit in results.
  first.input.store = second.input.store = h.owner.loadOwnership();
  start = performance.now();
  const initialMemory = process.memoryUsage(); sample('start');
  const timer = setInterval(() => sample('timer'), 5);
  let results;
  try { results = await Promise.all([first.run(), second.run()]); }
  finally { clearInterval(timer); }
  const totalMs = performance.now() - start; sample('end');
  const measuredPeakRss = process.resourceUsage().maxRSS * 1024;
  const state = h.snapshot();
  const outputs = h.output(xs);
  const statuses = results.map(r => r.status);
  const failures = results.flatMap(r => r.failures);
  const expected = xs.map(i => ({ key: h.baseIngest.canonicalKeyFor(i), hash: h.fixture.hash(h.fixture.png(i.size, i.contentTag)) }));
  const actual = outputs.map(({ key, hash }) => ({ key, hash }));
  const outputMatches = JSON.stringify(actual) === JSON.stringify(expected);
  const ownership = xs.map(i => { const x = state.store.owners[h.baseIngest.canonicalKeyFor(i)]; return x && { key: h.baseIngest.canonicalKeyFor(i), hash: x.hash, sourceIdentity: x.sourceIdentity, owner: x.owner }; });
  const ownerMatches = ownership.every((v, i) => v && v.hash === expected[i].hash && v.owner === 'plm' && v.sourceIdentity);
  const final = first.runtime.snapshot();
  const noRetention = final.reservedBytes === 0 && final.activePermits === 0 && final.waitingCount === 0 && final.stagedBytes === 0 && final.buffers === 0 && final.scopes === 0 && [first, second].every(c => c.transport.stats.active === 0 && c.transport.stats.retainedBodies === 0);
  const patches = first.metrics.patchCalls + second.metrics.patchCalls;
  const firstCanonicalLinkMs = Math.min(...[first, second].map(c => c.metrics.startedAt - start + c.metrics.firstCanonicalLinkMs));
  // Captured before post-measurement oracle hashing so it is not benchmark work.
  const report = { arm, label: 'prototype; synthetic; local durable link is not UI visibility', node: process.version, platform: process.platform, architecture: process.arch,
    machine: { cpu: os.cpus()[0].model, cpuCount: os.cpus().length, totalMemory: os.totalmem() },
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), fixtureSha256: h.fixture.hash(JSON.stringify(xs)), items: xs.length, jobs: 2,
    perJobConcurrency: 8, writeDelayMs: 1, ownershipPolicy: 'shared initial mutable ownership snapshot in both arms',
    acceptanceBytes: B, oldFileAcceptanceBytes: OLD, ioHeadroomBytes: IO, reservationEnvelopeBytes: envelopeBytes,
    totalBudgetBytes: first.runtime.budget.snapshot().limitBytes, initialMemory,
    osPeakRssBytes: measuredPeakRss, sampledPeakRssBytes: peak.rss, sampledPeakExternalBytes: peak.external, sampledPeakArrayBufferBytes: peak.arrayBuffers,
    peakReservationBytes: final.peakReservedBytes, peakStagedBytes: final.peakStagedBytes, firstCanonicalLinkMs, totalMs,
    jobsMetrics: [first, second].map(c => ({ ...c.metrics, transport: c.transport.stats })),
    statuses, failures, outputMatches, ownerMatches, noRetention, patchCalls: patches, revisionDelta: state.revision,
    outputSha256: h.fixture.hash(JSON.stringify(actual)), ownershipSha256: h.fixture.hash(JSON.stringify(ownership)),
    outcomesSha256: h.fixture.hash(JSON.stringify(results.flatMap(r => r.outcomes).map(o => ({ key: o.key, status: o.status, hash: o.contentHash, sourceIdentity: o.sourceIdentity })).sort((a, b) => a.key.localeCompare(b.key)))),
    files: h.user.readCollectionImageIndex().length, checkpoints: [first, second].map(c => c.metrics.checkpoints.length), final, samples,
  };
  if (!outputMatches || !ownerMatches || !noRetention || statuses.some(s => s !== 'completed') || failures.length || patches !== 2 || state.revision !== 2 || report.files !== 2048) throw new Error('Measurement canonical oracle failed');
  process.stdout.write(JSON.stringify(report) + '\n');
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(h.cleanup);
