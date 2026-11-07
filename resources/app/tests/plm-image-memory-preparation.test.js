'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const fixtureLib = require('../scripts/lib/plm-image-memory-fixture');
const measurement = require('../scripts/benchmark-plm-image-memory');
const probe = path.join(__dirname, '../scripts/lib/plm-image-memory-probe.js');

function run(scenario) {
  const child = spawnSync(process.execPath, [probe, scenario], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout);
}

test('INT-03 collector accounts for bytes and the first durable canonical link', () => {
  const r = run('retention');
  assert.equal(r.status, 'completed');
  assert.equal(r.downloads, 24);
  // Do not make the current accumulation bug a required production behavior.
  // Exact before observations live in the retained measurement artifacts.
  assert.ok(r.commitCalls >= 1);
  assert.ok(r.downloadsAtFirstLink > 0 && r.downloadsAtFirstLink <= 24);
  assert.ok(r.peakCommitInputBytes > 0 && r.peakCommitInputBytes <= r.bytesDownloaded);
  assert.ok(r.firstCanonicalLinkMs > 0 && r.firstCanonicalLinkMs <= r.totalMs);
  assert.ok(r.sampledPeakExternalBytes > r.initialExternalBytes);
  assert.ok(r.osPeakRssBytes >= r.sampledPeakRssBytes);
  assert.equal(r.oracleMatches, true);
});

test('real ingest preserves manual ownership, URL/content dedup and no-op revision', () => {
  const r = run('contracts');
  assert.equal(r.status, 'completed');
  assert.equal(r.manualPreserved, 1);
  assert.equal(r.manualRefUnchanged, true);
  assert.equal(r.downloads, 4, 'one manual skipped; two identities share one URL');
  assert.equal(r.filesAfter, 4, 'manual + three content hashes; two URLs share bytes');
  assert.equal(r.revisionDelta, 1);
  assert.equal(r.repeat.downloads, 0);
  assert.equal(r.repeat.revisionDelta, 0);
  assert.equal(r.oracleMatches, true);
});

test('partial failure and cancellation only link completed valid downloads', () => {
  for (const scenario of ['partial', 'cancel']) {
    const r = run(scenario);
    assert.equal(r.status, scenario === 'partial' ? 'partial' : 'cancelled');
    assert.equal(r.oracleMatches, true);
    if (scenario === 'partial') assert.equal(r.failures, 1);
    else assert.ok(r.downloads > 0 && r.downloads < r.requested);
  }
});

test('dropOldFiles keeps an aliased old ref and the false option keeps all old files', () => {
  const drop = run('drop');
  assert.equal(drop.removedFiles, 1);
  assert.equal(drop.oldSharedExists, true);
  assert.equal(drop.oldUnsharedExists, false);
  const keep = run('keep');
  assert.equal(keep.removedFiles, 0);
  assert.equal(keep.oldSharedExists, true);
  assert.equal(keep.oldUnsharedExists, true);
});

test('failed canonical link commit rolls back newly created files and preserves revision', () => {
  const r = run('patch-failure');
  assert.equal(r.errorCode, 'SYNTHETIC_PATCH_FAILURE');
  assert.equal(r.revisionDelta, 0);
  assert.equal(r.filesAfter, r.filesBefore);
  assert.equal(r.ownerCountAfter, r.ownerCountBefore);
});

test('variable-sized fixtures are deterministic, structurally valid PNGs with a real pixel', () => {
  for (const size of [512, 8192, 32768, 131072, 524288]) {
    const bytes = fixtureLib.png(size, 42);
    assert.equal(bytes.length, size);
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    const types = [];
    for (let offset = 8; offset < bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      assert.equal(bytes.readUInt32BE(offset + 8 + length), fixtureLib.crc32(bytes.subarray(offset + 4, offset + 8 + length)));
      if (type === 'IDAT') assert.deepEqual([...zlib.inflateSync(bytes.subarray(offset + 8, offset + 8 + length))], [0, 40, 80, 120, 255]);
      types.push(type);
      offset += length + 12;
      assert.ok(offset <= bytes.length);
    }
    assert.deepEqual(types, ['IHDR', 'IDAT', 'tEXt', 'IEND']);
    assert.ok(bytes.equals(fixtureLib.png(size, 42)));
    assert.notEqual(fixtureLib.hash(bytes), fixtureLib.hash(fixtureLib.png(size, 43)));
  }
});

function cohorts() {
  const run = {
    oracleMatches: true, status: 'completed', fixtureSha256: 'fixture-v1',
    osPeakRssBytes: 100, sampledPeakRssBytes: 90, sampledPeakExternalBytes: 80,
    sampledPeakArrayBufferBytes: 70, firstCanonicalLinkMs: 60, totalMs: 50, peakCommitInputBytes: 40,
  };
  const before = { arm: 'before', includes892: true, environment: { machine: 'same' },
    protectedSources: { app: 'same' }, harnessSources: { collector: 'same' },
    targetSources: { queue: 'before' }, runs: [run, run, run] };
  return [before, { ...structuredClone(before), arm: 'after', targetSources: { queue: 'after' } }];
}

test('comparison requires three equivalent runs per arm and computes a median', () => {
  const [before, after] = cohorts();
  before.runs = before.runs.map((r, i) => ({ ...r, totalMs: [20, 99, 30][i] }));
  assert.equal(measurement.compareCohorts(before, after).before.totalMs, 30);
  after.runs.pop();
  assert.throws(() => measurement.compareCohorts(before, after), /three/);
});

test('comparison rejects fixture, #892, environment, harness and protected-source drift', () => {
  for (const mutate of [
    a => { a.includes892 = false; },
    a => { a.environment.machine = 'other'; },
    a => { a.harnessSources.collector = 'other'; },
    a => { a.protectedSources.app = 'other'; },
    a => { a.runs[0].fixtureSha256 = 'other'; },
    a => { a.runs[0].oracleMatches = false; },
    a => { a.runs[0].sampledPeakRssBytes = null; },
  ]) {
    const [before, after] = cohorts(); mutate(after);
    assert.throws(() => measurement.compareCohorts(before, after));
  }
});

test('an unchanged source or a missing after arm cannot masquerade as an optimization', () => {
  const [before, after] = cohorts();
  after.targetSources = before.targetSources;
  assert.throws(() => measurement.compareCohorts(before, after), /pending/);
  assert.throws(() => measurement.compareCohorts(before, before), /Both before and after/);
});

test('all rotated trace segments survive lossless compression; missing traces fail closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'int03-trace-test-'));
  try {
    const stem = path.join(root, 'before-1');
    for (const i of [1, 2]) fs.writeFileSync(`${stem}.trace.${i}.json`, JSON.stringify({ traceEvents: [{ name: `part-${i}` }] }));
    const archived = measurement.archiveTraces(stem);
    assert.equal(archived.length, 2);
    for (const [i, item] of archived.entries()) {
      const unzipped = zlib.gunzipSync(fs.readFileSync(path.join(root, item.file)));
      assert.equal(fixtureLib.hash(unzipped), item.rawSha256);
      assert.equal(JSON.parse(unzipped).traceEvents[0].name, `part-${i + 1}`);
    }
    assert.throws(() => measurement.archiveTraces(path.join(root, 'missing')), /missing/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
