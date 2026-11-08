'use strict';
const { fs, path, assert, quantiles, save } = require('./common.cjs'), zlib = require('node:zlib');
function attribution(file) {
  const profile = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));
  const nodes = new Map(profile.nodes.map(n => [n.id, n])), parents = new Map();
  for (const n of profile.nodes) for (const id of n.children || []) parents.set(id, n.id);
  const buckets = {}; let totalUs = 0;
  assert.equal(profile.samples.length, profile.timeDeltas.length);
  for (let i = 0; i < profile.samples.length; i++) {
    const frames = []; let id = profile.samples[i];
    while (id) { frames.push(nodes.get(id).callFrame); id = parents.get(id); }
    const us = profile.timeDeltas[i]; totalUs += us;
    const phase = frames.some(f => f.functionName === 'snapshotEntry') ? 'snapshot' : frames.some(f => f.functionName === 'validateZip') ? 'validation' : 'other';
    const add = k => { buckets[k] = (buckets[k] || 0) + us / 1000; };
    if (frames[0].functionName === 'crcUpdate') add('crc_' + phase);
    if (frames[0].functionName === 'update' && frames.some(f => f.url === 'node:internal/crypto/hash')) add('sha256_update_' + phase);
    if (frames[0].functionName === '(idle)') add('idle');
  }
  return { sampledWindowMs: totalUs / 1000, sampledSelfMs: buckets,
    sampledWindowPercent: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v / (totalUs / 1000) * 100])),
    interpretation: 'Sampled self time over the backup-only profile window, including idle. Not exact function timers or process CPU. Separate profiled fresh servers; excluded from latency medians.' };
}
function summarize(root) {
  const runs = [];
  for (const scenario of ['backup-only', 'backup-interactive', 'profile']) for (const ordinal of [1, 2, 3]) {
    const dir = path.join(root, scenario + '-' + ordinal), r = JSON.parse(fs.readFileSync(path.join(dir, 'report.json')));
    assert.equal(r.status, 'passed'); assert.equal(r.correctness, true);
    if (scenario === 'profile') save(path.join(dir, 'attribution.json'), attribution(path.join(dir, 'observation.json.cpuprofile.gz')));
    runs.push({ scenario, ordinal, wallMs: r.measurement.wallMs, postToReadyMs: r.postToReadyMs, cpuMs: r.measurement.cpuMs,
      http: r.http, eventLoop: r.eventLoop, parentPeakRssMiB: r.sampledParentPeakRssBytes / 2 ** 20,
      treePeakRssSumMiB: r.sampledTreePeakRssSumBytes / 2 ** 20, generation: r.before.generation,
      sourceRevision: r.before.sourceRevision, revisions: r.before.revisions, identity: r.identity,
      inheritedFixtureSha256: r.before.inheritedFixtureSha256, sourceHashes: r.before.sourceHashes });
  }
  for (const key of ['generation', 'sourceRevision', 'revisions', 'identity', 'inheritedFixtureSha256', 'sourceHashes']) assert.equal(new Set(runs.map(r => JSON.stringify(r[key]))).size, 1, key + ' cohort mismatch');
  const median = values => quantiles(values.map(latencyMs => ({ latencyMs, status: 200 }))).p50Ms;
  const medians = Object.fromEntries(['backup-only', 'backup-interactive'].map(scenario => {
    const group = runs.filter(r => r.scenario === scenario);
    const value = { wallMs: median(group.map(r => r.wallMs)), cpuMs: median(group.map(r => r.cpuMs)),
      eventLoopP95Ms: median(group.map(r => r.eventLoop.p95Ms)), eventLoopMaxMs: median(group.map(r => r.eventLoop.maxMs)),
      parentPeakRssMiB: median(group.map(r => r.parentPeakRssMiB)), treePeakRssSumMiB: median(group.map(r => r.treePeakRssSumMiB)),
      http: Object.fromEntries(Object.keys(group[0].http).map(endpoint => [endpoint, Object.fromEntries(['p50Ms', 'p95Ms', 'maxMs'].map(k => [k, median(group.map(r => r.http[endpoint][k]))]))])) };
    return [scenario, value];
  }));
  const summary = { runs, medians, scenariosAreBeforeAfter: false, productionOptimization: false, workerBenefitProven: false };
  save(path.join(root, 'summary.json'), summary); return summary;
}
if (require.main === module) summarize(path.resolve(process.argv[2]));
module.exports = { attribution, summarize };
