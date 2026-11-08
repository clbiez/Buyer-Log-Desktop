'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const { percentile, summarizeCohort } = require('../scripts/benchmark-backup-crc-sha');
const { createFixture, verifyRestored } = require('../scripts/lib/backup-diagnostic-fixture');
const { createBackupArchive, inspectBackupArchive, extractBackupArchive, validateZip } = require('../server/lib/backup-archive');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'buyerlog-admin01-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const data = await createFixture(root, { diskFiles: 2, diskBytes: 524305, bufferBytes: 1024 });
  return { root, ...data };
}
async function archive(t, data, onProgress) {
  const result = await createBackupArchive({ entries: data.entries, manifest: data.manifest, filename: 'synthetic.zip', onProgress });
  t.after(() => result.cleanup());
  return result;
}

test('ADMIN-01 harness: nearest-rank p95, medians and all failed HTTP attempts remain visible', () => {
  assert.equal(percentile([9, 1, 3], .5), 3);
  assert.equal(percentile([9, 1, 3], .95), 9);
  assert.equal(percentile([], .95), null);
  const runs = [3, 1, 2].map(n => ({ source: 'same', fixtureSha256: 'fixture', probeKind: 'synthetic', cohort: 'baseline', wallMs: n * 10, cpuMs: n, eventLoop: { p95Ms: n, maxMs: n + 1 }, health: { p95Ms: n * 2, attempts: 10, failures: 1 }, correctness: true }));
  const result = summarizeCohort(runs);
  assert.equal(result.wallMs, 20);
  assert.equal(result.healthP95Ms, 4);
  assert.equal(result.httpFailures, 3);
  assert.equal(result.performanceAcceptance, false);
  assert.throws(() => summarizeCohort(runs.slice(1)), /three/);
  assert.throws(() => summarizeCohort([runs[0], { ...runs[1], source: 'different' }, runs[2]]), /source/);
  assert.throws(() => summarizeCohort([runs[0], { ...runs[1], fixtureSha256: 'different' }, runs[2]]), /fixture/);
  assert.throws(() => summarizeCohort([runs[0], { ...runs[1], correctness: false }, runs[2]]), /correctness/);
});

test('ADMIN-01 fixture: deterministic bytes, known CRC/SHA vectors and restored multi-chunk/empty entries', async t => {
  const data = await fixture(t), copy = await fixture(t);
  assert.equal(data.fixtureSha256, copy.fixtureSha256);
  const result = await archive(t, data);
  const info = await inspectBackupArchive(result.path, { requireType: 'full', validateData: true });
  const known = info.records.find(r => r.name === 'system/local-data/vector.txt');
  assert.equal(known.crc32, 0xcbf43926);
  const declared = info.manifest.contents.find(r => r.path === known.name);
  assert.equal(declared.sha256, '15e2b0d3c33891ebb0f1ef609ec419420c20e320ce94c65fbc8c3312448eb225');
  assert.equal(info.records.find(r => r.name.endsWith('/empty.bin')).crc32, 0);
  const target = path.join(data.root, 'restored');
  await extractBackupArchive(result.path, target, { preflight: info, requireType: 'full' });
  await verifyRestored(target, data.expected);
});

test('ADMIN-01 snapshot: source mutation between entries is rejected', async t => {
  const data = await fixture(t);
  let changed = false;
  await assert.rejects(archive(t, data, p => {
    if (!changed && p.item === data.entries[1].name) {
      changed = true;
      require('node:fs').appendFileSync(data.entries[0].sourcePath, 'changed');
    }
  }), /kaynak değişti/);
  assert.equal(changed, true);
});

test('ADMIN-01 snapshot: a source changed during its stream is rejected', async t => {
  const data = await fixture(t), nodeFs = require('node:fs');
  const original = nodeFs.createReadStream; let changed = false;
  nodeFs.createReadStream = function (file, options) {
    const stream = original.call(this, file, options);
    if (file === data.entries[0].sourcePath) stream.once('data', () => {
      changed = true; nodeFs.appendFileSync(file, 'changed during snapshot');
    });
    return stream;
  };
  try { await assert.rejects(archive(t, data), /kaynak değişti/); }
  finally { nodeFs.createReadStream = original; }
  assert.equal(changed, true);
});

test('ADMIN-01 snapshot: mutations after snapshot boundary cannot change archived bytes', async t => {
  const data = await fixture(t);
  let changed = false;
  const result = await archive(t, data, p => {
    if (!changed && p.phase === 'Doğrulanıyor') {
      changed = true;
      require('node:fs').writeFileSync(data.entries[0].sourcePath, 'new live source');
    }
  });
  assert.equal(changed, true);
  const info = await inspectBackupArchive(result.path, { validateData: true });
  const target = path.join(data.root, 'restored');
  await extractBackupArchive(result.path, target, { preflight: info });
  await verifyRestored(target, data.expected);
});

test('ADMIN-01 integrity: valid CRC with wrong manifest SHA is still rejected', async t => {
  const data = await fixture(t), result = await archive(t, data);
  const info = await inspectBackupArchive(result.path, { validateData: true });
  const record = info.records.find(r => r.name.endsWith('/vector.txt'));
  const bytes = await fs.readFile(result.path);
  const offset = record.localOffset + 30 + bytes.readUInt16LE(record.localOffset + 26) + bytes.readUInt16LE(record.localOffset + 28);
  bytes[offset] ^= 1;
  const crc = zlib.crc32(bytes.subarray(offset, offset + record.size));
  bytes.writeUInt32LE(crc, record.localOffset + 14);
  const tail = bytes.length - 22;
  let central = bytes.readUInt32LE(tail + 16);
  while (central < tail) {
    if (bytes.readUInt32LE(central + 42) === record.localOffset) bytes.writeUInt32LE(crc, central + 16);
    central += 46 + bytes.readUInt16LE(central + 28) + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  const broken = path.join(data.root, 'sha-mismatch.zip'); await fs.writeFile(broken, bytes);
  await assert.rejects(validateZip(broken, info.records.map(r => r.name)), /manifest checksum/);
  await assert.rejects(inspectBackupArchive(broken, { validateData: true }), { code: 'RESTORE_CHECKSUM_FAILED' });
});

test('ADMIN-01 interruption: rejected progress cannot return success; partial ZIP is rejected', async t => {
  const data = await fixture(t);
  await assert.rejects(archive(t, data, p => { if (p.phase === 'Doğrulanıyor') throw new Error('synthetic interruption'); }), /synthetic interruption/);
  const result = await archive(t, data), bytes = await fs.readFile(result.path);
  const partial = path.join(data.root, 'partial.zip'); await fs.writeFile(partial, bytes.subarray(0, Math.floor(bytes.length / 2)));
  await assert.rejects(inspectBackupArchive(partial, { validateData: true }));
});

test('ADMIN-01 interruption: process death before ZIP publication leaves no completed archive', async t => {
  const data = await fixture(t), temp = path.join(data.root, 'child-temp'); await fs.mkdir(temp);
  const modulePath = require.resolve('../server/lib/backup-archive');
  const result = spawnSync(process.execPath, ['-e', `
    const { createBackupArchive } = require(process.argv[1]);
    createBackupArchive({ entries: [{ name: 'system/local-data/disk.bin', sourcePath: process.argv[2] }], manifest: {}, filename: 'never-published.zip',
      onProgress(p) { if (p.phase === 'Doğrulanıyor') process.kill(process.pid, 'SIGKILL'); }
    }).catch(() => process.exit(2));
  `, modulePath, data.entries[0].sourcePath], { env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp }, timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, 'SIGKILL');
  const names = await fs.readdir(temp, { recursive: true });
  assert.ok(names.some(n => n.includes('snapshot')));
  assert.equal(names.some(n => n.endsWith('.zip')), false);
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(data.entries[0].sourcePath)).digest('hex'), data.expected[0].sha256);
});

test('ADMIN-01 restore cancellation: incomplete entry is not committed and temporary bytes are removed', async t => {
  const data = await fixture(t), result = await archive(t, data);
  const info = await inspectBackupArchive(result.path, { validateData: true });
  const target = path.join(data.root, 'cancelled'); let cancel = false;
  await assert.rejects(extractBackupArchive(result.path, target, {
    preflight: info, shouldCancel: () => cancel, onProgress: p => { if (p.bytesDone > 0) cancel = true; },
  }), { code: 'RESTORE_CANCELLED' });
  const names = await fs.readdir(target, { recursive: true });
  assert.equal(names.some(n => n.endsWith('.tmp') || n.endsWith('disk-0.bin')), false);
  // The live source is separate from staging and remains unchanged.
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(data.entries[0].sourcePath)).digest('hex'), data.expected[0].sha256);
});
