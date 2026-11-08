'use strict';
// Synthetic Linux cost observation only. No baseline or speedup assertion.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createLocalDb } = require('./preparation/tests/helpers/native-verifier-subject.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const milliseconds = start => Number(process.hrtime.bigint() - start) / 1e6;
const summary = samples => {
  const sorted = [...samples].sort((a, b) => a - b);
  return { min: sorted[0], median: (sorted[9] + sorted[10]) / 2, p95: sorted[18], max: sorted[19] };
};
async function memberHashes(file) {
  const members = {};
  for (const suffix of ['', '.wal', '.wal.bak']) {
    try { const bytes = await fs.readFile(file + suffix); members[suffix] = { bytes: bytes.length, sha256: sha(bytes) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; members[suffix] = null; }
  }
  return members;
}
async function observe(db, file, instrument) {
  const stop = new Error('measured read-only native prepare');
  const boundaryStart = process.hrtime.bigint(); let observation;
  try {
    await db.privateRecordTransaction(async state => {
      const originalOpen = fs.open;
      const io = { fileSyncs: 0, directorySyncs: 0, bytesRead: 0 };
      const folder = path.dirname(file), directories = new Set([folder, path.join(folder, '.buyerlog-db-recovery')]);
      if (instrument) fs.open = async function (target, ...args) {
        const handle = await originalOpen.call(this, target, ...args);
        const sync = handle.sync.bind(handle), readFile = handle.readFile.bind(handle);
        handle.sync = async () => { directories.has(String(target)) ? io.directorySyncs++ : io.fileSyncs++; return sync(); };
        handle.readFile = async (...input) => { const bytes = await readFile(...input); io.bytesRead += Buffer.byteLength(bytes); return bytes; };
        return handle;
      };
      const cpuStart = process.cpuUsage(), start = process.hrtime.bigint();
      try {
        const proof = await db.verifyPrivateRecordDurability(state);
        const elapsed = milliseconds(start), cpu = process.cpuUsage(cpuStart);
        assert.deepEqual(proof, { verified: true, nativeRevision: state.revision });
        observation = { verifierMs: elapsed, cpuMs: (cpu.user + cpu.system) / 1000, ...io };
      } finally { fs.open = originalOpen; }
      throw stop;
    });
  } catch (error) { if (error !== stop) throw error; }
  return { ...observation, nativeBoundaryMs: milliseconds(boundaryStart) };
}
(async () => {
  assert.ok(process.env.BL_NATIVE_VERIFIER_SOURCE, 'Explicit candidate source required');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bl-verifier-cost-'));
  const report = { kind: 'synthetic-verifier-cost-no-speedup-claim', node: process.version,
    platform: process.platform, architecture: process.arch, cpus: os.availableParallelism(),
    candidateSha256: sha(await fs.readFile(process.env.BL_NATIVE_VERIFIER_SOURCE)),
    filesystem: execFileSync('df', ['-T', directory], { encoding: 'utf8' }).trim(),
    warmups: 3, samplesPerCase: 20,
    method: 'Elapsed time around the actual verifier only; nativeBoundaryMs additionally includes lease admission/cleanup and sentinel. Timings have no I/O wrapper; one separate untimed invocation counts real read/sync calls. Warm caches, one Linux container, synthetic data; no storage power-loss or Windows/Electron claim.',
    cases: [] };
  try {
    for (const rows of [100, 1000, 10000]) for (const layout of ['current', 'previous-and-current']) {
      const folder = path.join(directory, rows + '-' + layout); await fs.mkdir(folder);
      const file = path.join(folder, 'BuyerLogLocal.db'), db = createLocalDb(file, { walMaxBytes: 64 * 1024 * 1024 });
      const records = Object.fromEntries(Array.from({ length: rows }, (_, i) => ['native-cost:r' + i,
        { doc: { kind: 'native-cost', index: i, synthetic: 'x'.repeat(160), keep: [0, false, null, ''] } }]));
      await db.privateRecordTransaction(() => ({ records }));
      if (layout === 'previous-and-current') {
        await db.transaction(() => null);
        await db.privateRecordTransaction(() => ({ records: { 'native-cost:marker': { doc: { kind: 'native-cost', synthetic: 'current-member' } } } }));
      }
      const before = await memberHashes(file), revision = (await db.read()).revision;
      for (let i = 0; i < 3; i++) await observe(db, file, false);
      const samples = [];
      for (let i = 0; i < 20; i++) samples.push(await observe(db, file, false));
      const io = await observe(db, file, true);
      assert.deepEqual(await memberHashes(file), before, 'Read-only proof changed native bytes');
      assert.equal((await db.read()).revision, revision);
      assert.equal(io.fileSyncs, layout === 'current' ? 2 : 3); assert.equal(io.directorySyncs, 2);
      report.cases.push({ rows, layout, members: before, revision, verifierMs: summary(samples.map(v => v.verifierMs)),
        verifierCpuMs: summary(samples.map(v => v.cpuMs)), nativeBoundaryMs: summary(samples.map(v => v.nativeBoundaryMs)),
        untimedIo: { fileSyncs: io.fileSyncs, directorySyncs: io.directorySyncs, bytesRead: io.bytesRead }, samples });
    }
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
