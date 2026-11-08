'use strict';

// Read-only postprocessing; does not run or instrument application code.
const fs = require('node:fs');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
assert.equal(process.argv.length, 3, 'usage: node analyze-profile.cjs TRACE.cpuprofile.gz');
const profile = JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[2])));
assert.equal(profile.samples.length, profile.timeDeltas.length);
const nodes = new Map(profile.nodes.map(n => [n.id, n])), parents = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
function stack(id) {
  const frames = [];
  while (id) { frames.push(nodes.get(id).callFrame); id = parents.get(id); }
  return frames;
}
const buckets = {}, updateStacks = new Map();
let totalUs = 0;
for (let i = 0; i < profile.samples.length; i++) {
  const frames = stack(profile.samples[i]), us = profile.timeDeltas[i]; totalUs += us;
  const phase = frames.some(f => f.functionName === 'snapshotEntry') ? 'snapshot' : frames.some(f => f.functionName === 'validateZip') ? 'validation' : 'other';
  const add = key => { buckets[key] = (buckets[key] || 0) + us / 1000; };
  if (frames[0].functionName === 'crcUpdate') add(`crc_${phase}`);
  if (frames[0].functionName === 'update' && frames.some(f => f.url === 'node:internal/crypto/hash')) {
    add(`sha256_update_${phase}`);
    const key = frames.slice(0, 6).map(f => `${f.functionName} @ ${f.url}`).join('\n');
    updateStacks.set(key, (updateStacks.get(key) || 0) + us / 1000);
  }
}
console.log(JSON.stringify({ sampledWindowMs: totalUs / 1000, sampledSelfMs: buckets, updateStacks: [...updateStacks].map(([stack, sampledSelfMs]) => ({ stack: stack.split('\n'), sampledSelfMs })), interpretation: 'Sampling attribution, not exact isolated function timers or process CPU. Includes idle samples. Profile is separate from six unprofiled measurements.' }, null, 2));
