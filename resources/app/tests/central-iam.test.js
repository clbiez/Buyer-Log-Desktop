'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');

function fixture(count = 2) {
  const passwordHash = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
  const profile = (id, role) => ({ id, username: id, displayName: id, role, systemRole: role,
    enabled: true, status: 'ACTIVE', passwordHash, pinHash: passwordHash, iamVersion: 1,
    orgLevel: role === 'moderator' ? 'manager' : 'job_title', managerId: id === 'moderator' ? null : 'moderator',
    supervisorId: id === 'moderator' ? null : 'moderator', directPermissions: [], temporaryPermissions: [],
    collectionAccess: [], accessAreas: { cp: false }, permissions: {}, mags: [], mmygs: [], buyingGroups: [] });
  return iam.migrateStore({ schemaVersion: 8, _revision: 10, moderator: profile('moderator', 'moderator'),
    users: Array.from({ length: count - 1 }, (_, i) => profile(`user-${i}`, 'buyer')),
    orderAccess: { privateBusinessRow: [1] }, scopeCatalog: { mags: ['local catalog'] }, sessionSecret: 'DO_NOT_SYNC' });
}
async function environment(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-central-iam-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sharedRoot = path.join(root, 'shared'); await fsp.mkdir(sharedRoot);
  const a = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'a', 'user-access.json') });
  const b = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'b', 'user-access.json') });
  return { root, sharedRoot, a, b };
}
test('migration preserves verifiers, effective access and legacy bindings; excludes local/business data', () => {
  const store = fixture(), snapshot = central.snapshotFromStore(store, 1, { id: 'moderator' });
  central.validateSnapshot(snapshot);
  const restored = central.storeFromSnapshot(snapshot, store);
  for (const before of [store.moderator, ...store.users]) {
    const after = [restored.moderator, ...restored.users].find(u => u.id === before.id);
    assert.equal(after.passwordHash, before.passwordHash);
    assert.deepEqual([...iam.effectivePermissionSet(after, restored)], [...iam.effectivePermissionSet(before, store)]);
    assert.equal(after.managerId, before.managerId);
  }
  assert.match(snapshot.users[0].id, /^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(snapshot).includes('DO_NOT_SYNC'));
  assert.ok(!JSON.stringify(snapshot).includes('privateBusinessRow'));
});
test('two isolated caches use central commit, reject stale writes and retain offline login source', async t => {
  const { a, b } = await environment(t), source = fixture();
  await a.initialize(source, { id: 'moderator' });
  await b.refresh();
  assert.equal(b.readLocal()._revision, 1);
  const next = a.readLocal(); next.users[0].displayName = 'Changed';
  await a.commit(next, 1, { id: 'moderator' }, { action: 'USER_UPDATE' });
  await assert.rejects(b.commit(b.readLocal(), 1, { id: 'moderator' }), { code: 'IAM_REVISION_CONFLICT' });
  assert.equal(b.readLocal()._revision, 1);
  await b.refresh(); assert.equal(b.readLocal().users[0].displayName, 'Changed');
  const before = { ...b.metrics }; await b.refresh();
  assert.equal(b.metrics.snapshotReads, before.snapshotReads);
  assert.equal(b.metrics.cacheWrites, before.cacheWrites);
  for (let i = 0; i < 100; i++) b.readLocal();
  assert.equal(b.metrics.remoteReads, before.remoteReads + 1);
});
test('concurrent writers commit once with one audit transaction', async t => {
  const { a, b } = await environment(t); await a.initialize(fixture(), { id: 'moderator' }); await b.refresh();
  const results = await Promise.allSettled([a.commit(a.readLocal(), 1, { id: 'moderator' }), b.commit(b.readLocal(), 1, { id: 'moderator' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'IAM_REVISION_CONFLICT');
  const audits = await a.readAudit(); assert.equal(audits.length, 2);
  assert.ok(!/passwordHash|pinHash|sessionSecret|DO_NOT_SYNC/.test(JSON.stringify(audits)));
});
test('corrupt cache recovers latest backup; invalid remote never replaces cache', async t => {
  const { a, b, sharedRoot } = await environment(t); await a.initialize(fixture(), { id: 'moderator' }); await b.refresh();
  fs.writeFileSync(b.cacheFile, '{broken'); assert.equal(b.readLocal()._revision, 1);
  const next = a.readLocal(); next.users[0].enabled = false; next.users[0].status = 'INACTIVE'; await a.commit(next, 1, { id: 'moderator' });
  const dirs = fs.readdirSync(path.join(sharedRoot, 'iam', 'revisions')).sort();
  fs.writeFileSync(path.join(sharedRoot, 'iam', 'revisions', dirs.at(-1), 'snapshot.json'), '{}');
  await assert.rejects(b.refresh(), { code: 'IAM_REMOTE_INVALID' });
  assert.equal(b.readLocal()._revision, 1);
});
test('offline write is forbidden, no-cache bootstrap never invents admin', async t => {
  const { a, b, sharedRoot } = await environment(t); await a.initialize(fixture(), { id: 'moderator' });
  fs.renameSync(sharedRoot, sharedRoot + '-offline');
  await assert.rejects(a.commit(a.readLocal(), 1, { id: 'moderator' }), { code: 'IAM_OFFLINE' });
  assert.equal(a.readLocal()._revision, 1);
  assert.equal(b.readLocal(), null);
  await assert.rejects(b.refresh(), { code: 'IAM_OFFLINE' });
});
test('validation rejects identity duplicates, malformed verifier, unknown permissions and last administrator', () => {
  const good = central.snapshotFromStore(fixture(), 1, { id: 'moderator' });
  for (const mutate of [s => s.users.push(s.users[0]), s => s.users[0].passwordHash = 'bad',
    s => s.roles.buyer.permissions.push('INVENTED.ADMIN'), s => { s.users[0].enabled = false; s.users[0].status = 'INACTIVE'; }]) {
    const candidate = structuredClone(good); mutate(candidate);
    assert.throws(() => central.validateSnapshot(candidate));
  }
});
test('100 and 1000 users migrate with unchanged semantic baseline', () => {
  for (const count of [100, 1000]) {
    const before = fixture(count), snapshot = central.snapshotFromStore(before, 1, { id: 'moderator' });
    central.validateSnapshot(snapshot);
    assert.deepEqual(central.baseline(central.storeFromSnapshot(snapshot, before)), central.baseline(before));
  }
});
test('revision regression, equal revision hash conflict, unsupported schema and revision jumps', async t => {
  const { a, b, sharedRoot } = await environment(t); await a.initialize(fixture(), { id: 'moderator' }); await b.refresh();
  const revisions = path.join(sharedRoot, 'iam', 'revisions');
  const metaFile = path.join(revisions, '0000000000000001', 'meta.json'), meta = JSON.parse(fs.readFileSync(metaFile));
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, sha256: '0'.repeat(64) }));
  await assert.rejects(b.refresh(), { code: 'IAM_REVISION_HASH_CONFLICT' });
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  for (let revision = 1; revision < 4; revision++) await a.commit(a.readLocal(), revision, { id: 'moderator' });
  await b.refresh(); assert.equal(b.readLocal()._revision, 4);
  for (const n of [2,3,4]) fs.renameSync(path.join(revisions, String(n).padStart(16,'0')), path.join(sharedRoot, `saved-${n}`));
  await assert.rejects(b.refresh(), { code: 'IAM_REMOTE_REVISION_REGRESSION' });
  const s = central.snapshotFromStore(fixture(), 1, { id: 'moderator' }); s.schemaVersion = 500;
  assert.throws(() => central.validateSnapshot(s), { code: 'IAM_REMOTE_INVALID' });
});
test('crash before commit leaves old canonical; crash after commit is explicitly recoverable', async t => {
  const { a, root, sharedRoot } = await environment(t); await a.initialize(fixture(), { id: 'moderator' });
  let phase = 'beforeCommit';
  const writer = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'writer', 'user-access.json'), fault: async point => { if (point === phase) throw new Error('injected crash'); } });
  await writer.refresh();
  await assert.rejects(writer.commit(writer.readLocal(), 1, { id: 'moderator' }), { code: 'IAM_WRITE_FAILED' });
  assert.equal(writer.readLocal()._revision, 1); await a.refresh(); assert.equal(a.readLocal()._revision, 1);
  phase = 'afterCommit';
  await assert.rejects(writer.commit(writer.readLocal(), 1, { id: 'moderator' }), { code: 'IAM_COMMITTED_CACHE_PENDING' });
  assert.equal(writer.readLocal()._revision, 1); await writer.refresh(); assert.equal(writer.readLocal()._revision, 2);
  assert.equal((await writer.readAudit()).length, 2);
});
test('expired lease cannot let a paused stale writer replace the winning revision', async t => {
  const { a, b, sharedRoot, root } = await environment(t); await a.initialize(fixture(), { id: 'moderator' }); await b.refresh();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const paused = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'paused', 'user-access.json'), fault: async point => { if (point === 'beforeCommit') { entered(); await gate; } } });
  await paused.refresh();
  const attempted = paused.commit(paused.readLocal(), 1, { id: 'moderator' });
  await started;
  const ownerFile = path.join(sharedRoot, 'iam', 'locks', 'mutation.write-lock', 'owner.json');
  const owner = JSON.parse(fs.readFileSync(ownerFile)); owner.createdAt = new Date(Date.now() - 120000).toISOString(); fs.writeFileSync(ownerFile, JSON.stringify(owner));
  const child = require('node:child_process').fork(path.join(__dirname, 'helpers', 'iam-commit.js'), [sharedRoot, b.cacheFile], { stdio: ['ignore','ignore','pipe','ipc'] });
  const [result] = await require('node:events').once(child, 'message');
  release(); await assert.rejects(attempted, { code: 'IAM_REVISION_CONFLICT' }); assert.equal(result.ok, true, JSON.stringify(result));
  await a.refresh(); assert.equal(a.readLocal().users[0].displayName, 'Winner');
});
test('initialization requires admin and never republishes missing authority from central cache', async t => {
  const { a, sharedRoot } = await environment(t);
  await assert.rejects(a.initialize(fixture(), { id: 'user-0' }), { code: 'IAM_ADMIN_REQUIRED' });
  await a.initialize(fixture(), { id: 'moderator' });
  const sourceBackup = fs.readFileSync(path.join(path.dirname(a.cacheFile), 'user-access.pre-iam-migration.json'), 'utf8');
  assert.equal(JSON.parse(sourceBackup).users.length, 1);
  fs.renameSync(path.join(sharedRoot, 'iam'), path.join(sharedRoot, 'iam-old'));
  await assert.rejects(a.initialize(a.readLocal(), { id: 'moderator' }), { code: 'IAM_ALREADY_INITIALIZED' });
});
test('independent legacy users cannot be overwritten by first remote refresh', async t => {
  const { a, b } = await environment(t); await a.initialize(fixture(), { id: 'moderator' });
  fs.mkdirSync(path.dirname(b.cacheFile), { recursive: true });
  const own = fixture(3); fs.writeFileSync(b.cacheFile, JSON.stringify(own));
  await assert.rejects(b.refresh(), { code: 'IAM_MIGRATION_CONFLICT' });
  assert.equal(JSON.parse(fs.readFileSync(b.cacheFile)).users.length, 2);
});
test('first-run single Moderator placeholder can be replaced only by a richer Central IAM', async t => {
  const { a, b } = await environment(t);
  await a.initialize(fixture(8), { id: 'moderator' });
  fs.mkdirSync(path.dirname(b.cacheFile), { recursive: true });
  fs.writeFileSync(b.cacheFile, JSON.stringify(fixture(1)));

  await assert.rejects(b.refresh(), { code: 'IAM_MIGRATION_CONFLICT' });
  assert.equal(JSON.parse(fs.readFileSync(b.cacheFile)).users.length, 0);

  const restored = await b.refresh({ allowBootstrapPlaceholderReplace: true });
  assert.equal(central.baseline(restored).users, 8);
  assert.equal(central.baseline(restored).admins, 1);
  assert.equal(b.readLocal()._revision, 1);
});

test('bootstrap placeholder override never replaces a real multi-user local directory', async t => {
  const { a, b } = await environment(t);
  await a.initialize(fixture(8), { id: 'moderator' });
  fs.mkdirSync(path.dirname(b.cacheFile), { recursive: true });
  fs.writeFileSync(b.cacheFile, JSON.stringify(fixture(3)));

  await assert.rejects(
    b.refresh({ allowBootstrapPlaceholderReplace: true }),
    { code: 'IAM_MIGRATION_CONFLICT' },
  );
  assert.equal(JSON.parse(fs.readFileSync(b.cacheFile)).users.length, 2);
});
test('short login preflight timeout leaves the event loop responsive', async t => {
  const { root } = await environment(t);
  let finish; const unavailable = new Promise(resolve => { finish = resolve; });
  const client = central.createCentralIam({ cacheFile: path.join(root, 'timeout.json'), getSharedRoot: () => unavailable });
  let responsive = false; setImmediate(() => { responsive = true; });
  assert.equal(await client.preflight(25), null);
  assert.equal(responsive, true); assert.equal(client.health().status, 'offline'); finish('');
});

