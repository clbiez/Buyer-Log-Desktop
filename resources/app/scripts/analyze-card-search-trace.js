'use strict';
const fs = require('node:fs'), path = require('node:path'), { gunzipSync } = require('node:zlib');
const assert = require('node:assert/strict');
const directory = path.resolve(process.argv[2]);
const read = name => JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, name))));
const variants = {};
for (const variant of ['A', 'B']) {
  const events = read(variant + '.trace.json.gz').traceEvents;
  const marks = events.filter(event => /^search-\d+-(start|end)$/.test(event.name));
  assert.equal(marks.length, 20);
  const thread = marks[0];
  const main = events.filter(event => event.pid === thread.pid && event.tid === thread.tid && event.ph === 'X' && event.dur > 0);
  const samples = [];
  for (let index = 0; index < 10; index++) {
    const start = marks.find(event => event.name === `search-${index}-start`).ts;
    const end = marks.find(event => event.name === `search-${index}-end`).ts;
    const points = [[start, '', 0], [end, '', 0]];
    for (const event of main) {
      const category = /^(V8\.GC|MajorGC|MinorGC)/.test(event.name) ? 'gcRelatedMs'
        : event.name === 'ParseHTML' ? 'htmlParsingMs'
          : ['Layout', 'UpdateLayoutTree', 'RecalculateStyles'].includes(event.name) ? 'styleLayoutMs' : '';
      const a = Math.max(start, event.ts), b = Math.min(end, event.ts + event.dur);
      if (category && b > a) { points.push([a, category, 1], [b, category, -1]); }
    }
    points.sort((a, b) => a[0] - b[0]);
    const active = {}, totals = { gcRelatedMs: 0, htmlParsingMs: 0, styleLayoutMs: 0, otherMs: 0 };
    let previous = start;
    for (const [time, category, delta] of points) {
      const selected = ['gcRelatedMs', 'htmlParsingMs', 'styleLayoutMs'].find(key => active[key] > 0) || 'otherMs';
      totals[selected] += (time - previous) / 1000;
      active[category] = (active[category] || 0) + delta; previous = time;
    }
    samples.push({ index, query: index % 2 ? 'clear (5000 rows)' : '000 (filtered)', startUs: start, endUs: end, durationMs: (end - start) / 1000, ...totals });
  }
  const profile = read(variant + '.cpuprofile.json.gz');
  const nodes = new Map(profile.nodes.map(node => [node.id, node])), parent = new Map(), self = new Map();
  for (const node of profile.nodes) for (const id of node.children || []) parent.set(id, node.id);
  let time = profile.startTime, sampledModelMs = 0, sampledSelectorsMs = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = profile.timeDeltas[i]; time += delta;
    if (!samples.some(sample => time >= sample.startUs && time <= sample.endUs)) continue;
    const id = profile.samples[i], frame = nodes.get(id).callFrame;
    const key = `${frame.functionName || '(anonymous)'} @ ${frame.url}:${frame.lineNumber + 1}`;
    self.set(key, (self.get(key) || 0) + delta / 1000);
    if (['querySelector', 'querySelectorAll'].includes(frame.functionName)) sampledSelectorsMs += delta / 1000;
    let ancestor = id;
    while (ancestor) {
      const call = nodes.get(ancestor).callFrame;
      if (call.functionName === 'rows' && call.url.includes('license-cards-engine.js')) { sampledModelMs += delta / 1000; break; }
      ancestor = parent.get(ancestor);
    }
  }
  const totals = Object.fromEntries(['durationMs', 'gcRelatedMs', 'htmlParsingMs', 'styleLayoutMs', 'otherMs'].map(key => [key, samples.reduce((sum, sample) => sum + sample[key], 0)]));
  variants[variant] = { samples, totals, sampledModelMs, sampledSelectorsMs,
    topSampledFrames: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12),
    memory: JSON.parse(fs.readFileSync(path.join(directory, variant + '.metadata.json'), 'utf8')) };
}
console.log(JSON.stringify({ method: 'Only the 10 marked search samples. Main-thread X events clipped to each sample; overlapping/nested spans partitioned with GC > HTML parsing > style/layout > other priority. Other includes JS and unclassified native work; CPU samples are not JS-exclusive. Profiler arms are diagnostics, not additional independent pairs.', variants }, null, 2));
