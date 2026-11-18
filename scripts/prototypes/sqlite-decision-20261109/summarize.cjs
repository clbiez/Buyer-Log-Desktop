'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
assert.equal(raw.validation, 'subset-passed', 'Incomplete benchmark cannot be summarized');
const median = a => {
  const sorted = [...a].sort((x, y) => x - y), middle = Math.floor(a.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const mb = bytes => bytes / (1024 ** 2);
const fmt = n => n.toFixed(n < 10 ? 3 : 1);
function table(title, headers, get) {
  console.log(`\n${title}\n\n| ${['Events', 'Engine', ...headers].join(' | ')} |`);
  console.log(`| ${headers.map(() => '---:').concat(['---:', '---:']).join(' | ')} |`);
  for (const size of raw.config.sizes) for (const engine of ['local', 'sqlite']) {
    const trials = raw.trials.filter(t => t.size === size && t.engine === engine);
    assert.equal(trials.length, raw.config.rounds);
    console.log(`| ${[size.toLocaleString('en-US'), engine, ...get(trials).map(fmt)].join(' | ')} |`);
  }
}
const med = (a, f) => median(a.map(f));
table('Median wall time (ms)', ['Open + first queries', 'First full hydrate', 'Open through full records ready', 'Mixed trace', 'Repeat full records', 'Compaction'], a => [
  med(a, t => t.startupMs), med(a,t=>t.initialHydrateMs), med(a,t=>t.readyMs), med(a, t => t.mixedMs), med(a, t => t.fullReadMs), med(a, t => t.compactMs),
]);
table('Median of per-run p95 latency (ms; batch = 20 events)', ['Point', 'Filter', 'Pending 100', 'Single write', 'Batch 20', 'Max write (median)'], a => [
  ...['get', 'filter', 'pending', 'singleWrite', 'batch20'].map(k => med(a, t => t.latencies[k].p95Ms)),
  med(a, t => Math.max(t.latencies.singleWrite.maxMs, t.latencies.batch20.maxMs)),
]);
table('Median process memory (MiB; RSS includes native memory)', ['Open RSS', 'Steady RSS', 'Steady heap', 'Post-compact RSS', 'Peak RSS'], a => [
  med(a, t => mb(t.memory.opened.rss)), med(a, t => mb(t.memory.steady.rss)), med(a, t => mb(t.memory.steady.heapUsed)),
  med(a, t => mb(t.memory.compacted.rss)), med(a, t => mb(t.memory.peakRssBytes)),
]);
table('Median disk footprint (MiB; primary + WAL + all backups/recovery files)', ['Before compact', 'After compact', 'After close', 'Primary after compact'], a => [
  med(a, t => mb(t.disk.before.totalBytes)), med(a, t => mb(t.disk.after.totalBytes)), med(a, t => mb(t.disk.closed.totalBytes)),
  med(a, t => mb(t.disk.after.files.find(f => ['BuyerLogLocal.db', 'prototype.sqlite'].includes(f.path)).bytes)),
]);
console.log(`\n${raw.trials.length} trials; ${raw.crashes.length} SIGKILL probes; validation=${raw.validation}.`);

table('CPU and maximum event-loop turn gap (includes I/O/GC)', ['User CPU ms','System CPU ms','Max turn gap ms','Sampled peak heap MiB'],a=>[
 med(a,t=>t.cpuMicros.user/1000), med(a,t=>t.cpuMicros.system/1000), med(a,t=>t.maxEventLoopGapMs),med(a,t=>mb(t.sampledPeakHeapBytes))]);
table('Quiescent backup lower bound (not production protocol parity)', ['Backup ms','Copy restore ms','Restore through verification ms','Independent backup MiB','Post-compact disk + independent backup MiB'],a=>[
 med(a,t=>t.backup.backupMs),med(a,t=>t.backup.copyRestoreMs),med(a,t=>t.backup.restoreReadyVerifyMs),med(a,t=>mb(t.backup.bytes)),med(a,t=>mb(t.disk.after.totalBytes+t.backup.bytes))]);
