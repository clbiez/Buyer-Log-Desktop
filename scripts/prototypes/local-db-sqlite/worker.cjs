'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { open } = require('./adapters.cjs');
const { event, query, projection, hash } = require('./workload.cjs');

function memory() {
  global.gc?.();
  return { ...process.memoryUsage(), maxRssBytes: process.resourceUsage().maxRSS * 1024 };
}
function files(folder) {
  const result = [];
  function walk(dir) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, e.name);
    if (e.isDirectory()) walk(file);
    else { const s = fs.statSync(file); result.push({ path: path.relative(folder, file), bytes: s.size, allocatedBytes: s.blocks * 512 }); }
  } }
  walk(folder);
  return { totalBytes: result.reduce((n, f) => n + f.bytes, 0), files: result };
}
function latencies(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: sorted.length, totalMs: values.reduce((a, b) => a + b, 0),
    p50Ms: sorted[Math.floor((sorted.length - 1) * .5)], p95Ms: sorted[Math.floor((sorted.length - 1) * .95)], maxMs: sorted.at(-1) };
}
async function digest(db) { return hash(projection(await db.records())); }
async function run({ mode, engine, folder, size, operations = 300 }) {
  if (mode === 'seed') {
    const db = open(engine, folder); await db.ensure(); await db.initialize();
    const start = performance.now();
    for (let i = 0; i < size; i += 10000) {
      await db.queuePatches(Array.from({ length: Math.min(10000, size - i) }, (_, j) => event(i + j, size)));
      process.send?.({ progress: `${engine} seed ${Math.min(i + 10000, size)}/${size}` });
    }
    await db.markSynced(Array.from({ length: Math.floor(size * .8) }, (_, i) => `seed-${i}`));
    // Leave a small, real replay tail in both stores; no custom snapshot format.
    const result = { seedMs: performance.now() - start, counts: await db.counts(), digest: await digest(db),
      disk: files(folder), memory: memory() };
    db.close(); return result;
  }
  if (mode === 'measure') {
    const baseline = memory();
    const start = performance.now();
    const db = open(engine, folder); await db.ensure();
    await db.get('order:0'); await db.pendingCount();
    const startupMs = performance.now() - start;
    const opened = memory();
    const samples = { get: [], filter: [], pending: [], singleWrite: [], batch20: [] };
    let eventIndex = size;
    let checksum = 0;
    const mixedStart = performance.now();
    for (let i = 0; i < operations; i++) {
      const slot = i % 10;
      const kind = slot < 5 ? 'get' : slot < 7 ? 'filter' : slot === 7 ? 'pending' : slot === 8 ? 'singleWrite' : 'batch20';
      const t = performance.now();
      if (kind === 'get') checksum += (await db.get(event(i % size, size).id))?._revision || 0;
      if (kind === 'filter') checksum += (await db.filter(query(i, size))).length;
      if (kind === 'pending') checksum += (await db.pending(100)).length;
      if (kind === 'singleWrite') await db.queuePatch(event(eventIndex++, size, 'mixed'));
      if (kind === 'batch20') {
        const items = Array.from({ length: 20 }, () => event(eventIndex++, size, 'mixed'));
        await db.queuePatches(items);
      }
      samples[kind].push(performance.now() - t);
    }
    const mixedMs = performance.now() - mixedStart;
    const steady = memory();
    const beforeDisk = files(folder);
    const fullStart = performance.now();
    { const records = await db.records(); checksum += Object.keys(records).length; }
    const fullReadMs = performance.now() - fullStart;
    const fullReadMemory = memory();
    const countsBefore = await db.counts();
    const t = performance.now(); await db.compact(); const compactMs = performance.now() - t;
    const compactedMemory = memory();
    const afterDisk = files(folder);
    const countsAfter = await db.counts();
    // Peak below excludes expensive full business hashing used only for verification.
    const peakRssBytes = process.resourceUsage().maxRSS * 1024;
    const finalDigest = await digest(db);
    const pending = await db.pendingCount();
    const eventIds = hash(await db.eventIds());
    if (engine === 'sqlite') assert.equal(db.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    db.close();
    return { startupMs, mixedMs, fullReadMs, compactMs, latencies: Object.fromEntries(
      Object.entries(samples).map(([k, v]) => [k, latencies(v)])), memory: { baseline, opened, steady, fullRead: fullReadMemory,
      compacted: compactedMemory, peakRssBytes }, disk: { before: beforeDisk, after: afterDisk, closed: files(folder) },
      countsBefore, countsAfter, pending, finalDigest, eventIds, checksum, addedEvents: eventIndex - size };
  }
  if (mode === 'crash-write') {
    const db = open(engine, folder); await db.ensure();
    for (let i = 0; i < 5; i++) await db.queuePatch(event(size + i, size, 'ack'));
    process.send({ barrier: 'acknowledged' });
    await new Promise(resolve => process.once('message', resolve));
    // Parent kills at an explicitly observed in-flight boundary.
    if (engine === 'local') {
      const original = fsp.open;
      fsp.open = async (...args) => {
        const handle = await original(...args);
        if (String(args[0]).endsWith('.wal') && args[1] === 'a') handle.sync = async () => {
          process.send({ barrier: 'inflight-before-fsync' }); await new Promise(() => {});
        };
        return handle;
      };
      await db.queuePatch(event(size + 5, size, 'inflight'));
    } else {
      db.db.exec('BEGIN IMMEDIATE');
      db.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').run('inflight-only', '{"kind":"order"}', 'order', 'open', 'buyer-0');
      process.send({ barrier: 'inflight-before-commit' }); await new Promise(() => {});
    }
  }
  if (mode === 'crash-compact') {
    const db = open(engine, folder); await db.ensure();
    if (engine === 'local') {
      const original = fsp.open;
      fsp.open = async (...args) => {
        const handle = await original(...args);
        if (String(args[0]).endsWith('.compacting')) handle.sync = async () => {
          process.send({ barrier: 'compacting-temp-before-fsync' }); await new Promise(() => {});
        };
        return handle;
      };
      await db.compact();
    } else {
      db.db.exec('BEGIN IMMEDIATE; UPDATE events SET body=NULL WHERE uploaded=1');
      process.send({ barrier: 'compacting-before-commit' }); await new Promise(() => {});
    }
  }
  if (mode === 'verify') {
    const t = performance.now(); const db = open(engine, folder); await db.ensure();
    const replayMs = performance.now() - t;
    const ids = await db.eventIds();
    const result = { replayMs, digest: await digest(db), counts: await db.counts(),
      ackRetained: Array.from({ length: 5 }, (_, i) => ids.includes(`ack-${size + i}`)),
      inflightPresent: engine === 'local' ? ids.includes(`inflight-${size + 5}`) : Boolean(await db.get('inflight-only')),
      eventIds: hash(ids), pending: await db.pendingCount() };
    if (engine === 'sqlite') result.integrity = db.db.prepare('PRAGMA integrity_check').get().integrity_check;
    db.close(); return result;
  }
  throw Error(`Unknown mode: ${mode}`);
}

if (require.main === module) run(JSON.parse(process.argv[2])).then(result => {
  process.send?.({ result });
  process.disconnect?.();
}).catch(error => { console.error(error.stack); process.exitCode = 1; process.disconnect?.(); });
module.exports = { run, files };
