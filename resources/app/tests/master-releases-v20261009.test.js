'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { promisify } = require('node:util');
const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);
const releases = require('../server/lib/master-releases');
const NOW = '2026-10-09T12:00:00.000Z';
async function root(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-master-releases-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  return dir;
}
function checkpoint(version, records = { 'store:settings.json': { pricingRules: { b: 2, a: 1 } } }) {
  return { head: { revision: version }, envelope: { schemaVersion: 1, revision: version, parentRevision: version - 1, createdAt: NOW, actorId: 'moderator', payload: { authority: 'moderator', records, release: { version, note: 'Demo rules', publishedBy: 'moderator', publishedAt: NOW, changedEntities: ['pricingRules'] } } } };
}

test('archive/read/list roundtrip preserves moderator authority, records and release summaries', async t => {
  const dir = await root(t), source = checkpoint(7);
  const written = await releases.archiveRelease(dir, source);
  assert.equal(written.archived, true);
  const read = await releases.readRelease(dir, '7');
  assert.deepEqual(read.checkpoint, source.envelope);
  assert.equal(read.checkpoint.payload.authority, 'moderator');
  assert.deepEqual(await releases.listReleases(dir), [source.envelope.payload.release]);
  assert.ok((await fsp.stat(path.join(dir, 'master', 'releases', '7.json.gz'))).isFile());
  assert.equal(await fsp.stat(path.join(dir, 'BUYER_LOG_SYNC', 'master')).then(() => true, () => false), false);
});

test('payload SHA follows exact shared-hub stable key ordering and verifies supplied head hash', async t => {
  const dir = await root(t), source = checkpoint(1);
  function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
  }
  const hash = crypto.createHash('sha256').update(stableJson(source.envelope.payload)).digest('hex');
  source.head.payloadSha256 = hash;
  await releases.archiveRelease(dir, source);
  assert.equal((await releases.readRelease(dir, 1)).payloadSha256, hash);
  const changed = checkpoint(2); changed.head.payloadSha256 = hash;
  await assert.rejects(releases.archiveRelease(dir, changed), { code: 'MASTER_RELEASE_CHECKSUM_INVALID' });
});

test('existing revision is immutable and exact retries are idempotent', async t => {
  const dir = await root(t), source = checkpoint(1);
  await releases.archiveRelease(dir, source);
  const file = path.join(dir, 'master', 'releases', '1.json.gz'), before = await fsp.readFile(file);
  assert.equal((await releases.archiveRelease(dir, source)).unchanged, true);
  const other = checkpoint(1); other.envelope.payload.release.note = 'changed';
  await assert.rejects(releases.archiveRelease(dir, other), { code: 'MASTER_RELEASE_REVISION_CONFLICT' });
  assert.deepEqual(await fsp.readFile(file), before);
});

test('retention preserves newest thirty numeric revisions and list order is descending', async t => {
  const dir = await root(t);
  for (let version = 1; version <= 33; version++) await releases.archiveRelease(dir, checkpoint(version));
  const list = await releases.listReleases(dir);
  assert.equal(list.length, 30);
  assert.equal(list[0].version, 33);
  assert.equal(list.at(-1).version, 4);
  await assert.rejects(releases.readRelease(dir, 3), { code: 'MASTER_RELEASE_NOT_FOUND' });
  assert.equal((await fsp.readdir(path.join(dir, 'master', 'releases'))).filter(name => name.endsWith('.json.gz')).length, 30);
});

test('path traversal, leading zero, nonintegral versions and unrelated files are rejected or ignored', async t => {
  const dir = await root(t);
  for (const version of ['../1', '1/../2', '01', '1.json.gz', 0, -1, 1.5, Infinity, {}, null]) await assert.rejects(releases.readRelease(dir, version), { code: 'MASTER_RELEASE_VERSION_INVALID' });
  await releases.archiveRelease(dir, checkpoint(1));
  await fsp.writeFile(path.join(dir, 'master', 'releases', 'current.json'), 'do not read');
  await fsp.writeFile(path.join(dir, 'master', 'releases', '999.json.gz.tmp'), 'do not read');
  assert.equal((await releases.listReleases(dir)).length, 1);
});

test('corrupted payload or envelope metadata cannot be restored as a valid release', async t => {
  const dir = await root(t);
  for (const mutate of [value => { value.checkpoint.payload.records['store:settings.json'].pricingRules.a = 99; }, value => { value.checkpoint.actorId = 'other'; }, value => { value.release.note = 'tampered'; }]) {
    await releases.archiveRelease(dir, checkpoint(1));
    const file = path.join(dir, 'master', 'releases', '1.json.gz');
    const value = JSON.parse((await gunzip(await fsp.readFile(file))).toString());
    mutate(value);
    await fsp.writeFile(file, await gzip(JSON.stringify(value)));
    await assert.rejects(releases.readRelease(dir, 1), error => ['MASTER_RELEASE_CHECKSUM_INVALID', 'MASTER_RELEASE_METADATA_INVALID'].includes(error.code));
    await fsp.unlink(file);
  }
});

test('gzip and decoded bounds reject oversized or bomb archives before parsing', async t => {
  const dir = await root(t);
  await releases.archiveRelease(dir, checkpoint(1));
  await assert.rejects(releases.readRelease(dir, 1, { maxCompressedBytes: 1 }), { code: 'MASTER_RELEASE_FILE_INVALID' });
  await assert.rejects(releases.readRelease(dir, 1, { maxDecodedBytes: 1 }), { code: 'MASTER_RELEASE_DECODE_INVALID' });
  const file = path.join(dir, 'master', 'releases', '1.json.gz');
  await fsp.writeFile(file, await gzip('x'.repeat(1000000)));
  await assert.rejects(releases.readRelease(dir, 1, { maxDecodedBytes: 1000 }), { code: 'MASTER_RELEASE_DECODE_INVALID' });
});

test('a file growing between stat and read is rejected without an unbounded readFile allocation', async t => {
  const dir = await root(t);
  await releases.archiveRelease(dir, checkpoint(1));
  const file = path.join(dir, 'master', 'releases', '1.json.gz');
  const originalOpen = fsp.open;
  t.mock.method(fsp, 'open', async function(target, flags, ...args) {
    const handle = await originalOpen.call(fsp, target, flags, ...args);
    if (target === file && typeof flags === 'number') {
      const originalStat = handle.stat.bind(handle);
      handle.stat = async () => { const stat = await originalStat(); await fsp.appendFile(file, Buffer.alloc(1024 * 1024)); return stat; };
      handle.readFile = async () => { throw new Error('Unbounded readFile must not be used'); };
    }
    return handle;
  });
  await assert.rejects(releases.readRelease(dir, 1), { code: 'MASTER_RELEASE_FILE_INVALID' });
});

test('archive rejects non-moderator authority, mismatched versions and excessive output before publishing', async t => {
  const dir = await root(t);
  const foreign = checkpoint(1); foreign.envelope.payload.authority = 'user';
  await assert.rejects(releases.archiveRelease(dir, foreign), { code: 'MASTER_RELEASE_AUTHORITY_INVALID' });
  const mismatch = checkpoint(1); mismatch.head.revision = 2;
  await assert.rejects(releases.archiveRelease(dir, mismatch), { code: 'MASTER_RELEASE_VERSION_INVALID' });
  const badMeta = checkpoint(1); badMeta.envelope.payload.release.version = 2;
  await assert.rejects(releases.archiveRelease(dir, badMeta), { code: 'MASTER_RELEASE_METADATA_INVALID' });
  await assert.rejects(releases.archiveRelease(dir, checkpoint(1), { maxDecodedBytes: 1 }), { code: 'MASTER_RELEASE_FILE_INVALID' });
  assert.deepEqual(await releases.listReleases(dir), []);
});

test('symbolic link releases cannot expose files outside the archive', async t => {
  const dir = await root(t), other = await root(t);
  await releases.archiveRelease(other, checkpoint(1));
  await fsp.mkdir(path.join(dir, 'master', 'releases'), { recursive: true });
  try {
    await fsp.symlink(path.join(other, 'master', 'releases', '1.json.gz'), path.join(dir, 'master', 'releases', '1.json.gz'));
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows file symlink privilege is unavailable; archive symlink security is not verified on this host.');
      return;
    }
    throw error;
  }
  await assert.rejects(releases.readRelease(dir, 1), { code: 'MASTER_RELEASE_FILE_INVALID' });
});

test('concurrent exact publication has one archive and no temporary or lock leftovers', async t => {
  const dir = await root(t), source = checkpoint(1);
  const results = await Promise.all([releases.archiveRelease(dir, source), releases.archiveRelease(dir, source)]);
  assert.equal(results.filter(item => item.archived).length, 1);
  const archive = path.join(dir, 'master', 'releases');
  assert.deepEqual((await fsp.readdir(archive)).sort(), ['1.json.gz', 'archive.write-fence.json']);
  const fence = JSON.parse(await fsp.readFile(path.join(archive, 'archive.write-fence.json'), 'utf8'));
  assert.equal(fence.schemaVersion, 1);
  assert.ok(Number.isSafeInteger(fence.generation) && fence.generation >= 2, 'both publications retain a monotonic fencing generation');
  assert.equal((await releases.listReleases(dir)).length, 1, 'fencing metadata is never returned as a release');
});

test('list can report a corrupt release and continue without silently returning its metadata', async t => {
  const dir = await root(t), warnings = [];
  await releases.archiveRelease(dir, checkpoint(1));
  await fsp.writeFile(path.join(dir, 'master', 'releases', '2.json.gz'), 'not gzip');
  const listed = await releases.listReleases(dir, { onError: (error, version) => warnings.push({ code: error.code, version }) });
  assert.equal(listed.length, 1);
  assert.deepEqual(warnings, [{ code: 'MASTER_RELEASE_DECODE_INVALID', version: 2 }]);
});
