'use strict';
// İç tıklama/frame örnekleri birleştirilmez; bağımsızlık birimi tarayıcı koludur.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const directory = path.resolve(process.argv[2]);
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
assert.ok(manifest.finishedAt, 'all independent pairs must finish first');
assert.equal(new Set(manifest.runs.map(run => run.processId)).size, manifest.runs.length);
for (let i = 1; i < manifest.runs.length; i++) assert.ok(manifest.runs[i - 1].finishedAt <= manifest.runs[i].startedAt, 'arms must not overlap');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const groups = new Map();
function add(key, pair, order, a, b) {
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({ pair, order, baseline: a, candidate: b, p95ChangePercent: 100 * (b.p95Ms / a.p95Ms - 1) });
}
for (const target of new Set(manifest.runs.map(run => run.target))) for (let pair = 1; pair <= 3; pair++) {
  const arm = variant => {
    const run = manifest.runs.find(run => run.target === target && run.pair === pair && run.variant === variant);
    assert.ok(run); return { run, data: JSON.parse(fs.readFileSync(path.join(directory, run.file), 'utf8')) };
  };
  const a = arm('A'), b = arm('B'); assert.equal(a.data.chromium, b.data.chromium);
  if (target === 'card') for (const baseline of a.data.results) {
    const candidate = b.data.results.find(row => row.module === baseline.module && row.count === baseline.count);
    assert.equal(baseline.requestSha256, candidate.requestSha256);
    for (const metric of ['select', 'search', 'save']) if (baseline[metric]) {
      assert.equal(baseline[metric].observationsMs.length, metric === 'save' ? 5 : 10);
      assert.equal(candidate[metric].observationsMs.length, baseline[metric].observationsMs.length);
      add(`${baseline.module}/${baseline.count}/${metric}`, pair, a.run.order, baseline[metric], candidate[metric]);
    }
  } else {
    assert.equal(a.data.paints, 40); assert.equal(b.data.paints, 40);
    add('lcwai/100-history/paint', pair, a.run.order, { p50Ms: a.data.p50Ms, p95Ms: a.data.p95Ms, mdCalls: a.data.mdCalls, longTasks: a.data.longTasks.length }, { p50Ms: b.data.p50Ms, p95Ms: b.data.p95Ms, mdCalls: b.data.mdCalls, longTasks: b.data.longTasks.length });
  }
}
const results = [...groups].map(([condition, pairs]) => {
  assert.equal(pairs.length, 3);
  return { condition, independentPairs: 3, pairs,
    medianRunP95BaselineMs: median(pairs.map(pair => pair.baseline.p95Ms)),
    medianRunP95CandidateMs: median(pairs.map(pair => pair.candidate.p95Ms)),
    medianPairedP95ChangePercent: median(pairs.map(pair => pair.p95ChangePercent)),
    pairedP95ChangeRangePercent: [Math.min(...pairs.map(pair => pair.p95ChangePercent)), Math.max(...pairs.map(pair => pair.p95ChangePercent))] };
});
console.log(JSON.stringify({ independentArms: manifest.runs.length, independentPairsPerCondition: 3,
  warning: 'Descriptive paired results only (n=3); nested click/frame observations are not independent replicates and do not establish whole-app speedup.', results }, null, 2));
