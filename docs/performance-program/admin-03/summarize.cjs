'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const dir = path.join(__dirname, 'artifacts');
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const median = values => values.slice().sort((a,b) => a-b)[Math.floor(values.length / 2)];
const runs = ['before-1', 'after-1', 'after-2', 'before-2', 'before-3', 'after-3'].map(name => ({ name, ...read(name + '.json') }));
for (let i = 0; i < runs.length; i++) {
  const run = runs[i]; assert.equal(run.failed, undefined);
  assert.equal(run.sourceCommit, run.requiredMain);
  assert.deepEqual(run.sourceHashes, runs[0].sourceHashes);
  assert.equal(run.harnessSha256, runs[0].harnessSha256);
  assert.equal(run.fixtureSourceSha256, runs[0].fixtureSourceSha256);
  if (i) assert.ok(Date.parse(run.startedAt) >= Date.parse(runs[i - 1].endedAt), 'measurements overlapped');
}
const summary = { kind: 'preparation-AA-no-production-optimization', requiredMain: runs[0].requiredMain, runs: runs.map(r => r.name),
  method: 'Three fresh processes per arm; AB/BA/AB; identical fixture/harness/production hashes; nearest-rank percentiles; median of three run percentiles. Handler timing excludes response serialization and output hashing.',
  sourceHashes: runs[0].sourceHashes, environment: runs[0].environment, scenarios: [] };
for (let i = 0; i < runs[0].scenarios.length; i++) {
  const first = runs[0].scenarios[i];
  const item = { users: first.users, fanout: first.fanout, depth: first.depth, fixtureSha256: first.fixtureSha256 };
  for (const run of runs) {
    const value = run.scenarios[i]; assert.equal(value.fixtureSha256, first.fixtureSha256);
    for (const metric of ['publicProfile', 'adminList']) assert.equal(value[metric].dtoSha256, first[metric].dtoSha256);
  }
  for (const label of ['before', 'after']) {
    const group = runs.filter(r => r.label === label);
    item[label] = Object.fromEntries(['publicProfile', 'adminList'].map(metric => [metric,
      Object.fromEntries(['p50Ms', 'p95Ms'].map(percentile => [percentile, median(group.map(r => r.scenarios[i][metric][percentile]))]))]));
  }
  summary.scenarios.push(item);
}
const profile = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'trace.json.cpuprofile.gz'))));
const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
const times = new Map();
for (let i = 0; i < profile.samples.length; i++) {
  let id = profile.samples[i]; const seen = new Set();
  while (id) {
    const frame = nodes.get(id).callFrame;
    if (/\/(iam-core|user-access)\.js$/.test(frame.url)) {
      const name = `${path.basename(frame.url)}:${frame.functionName}`;
      if (!seen.has(name)) { times.set(name, (times.get(name) || 0) + profile.timeDeltas[i] / 1000); seen.add(name); }
    }
    id = parent.get(id);
  }
}
summary.profile = { sampledMs: profile.timeDeltas.reduce((a,b) => a+b, 0) / 1000,
  inclusiveFunctionsMsNotAdditive: [...times.entries()].sort((a,b) => b[1]-a[1]).slice(0,15) };
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
