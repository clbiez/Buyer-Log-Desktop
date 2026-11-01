'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');

// Exact resource/action pairs emitted before Outlook and Agent Office removal.
const retired = [
  'AGENTS.VIEW', 'AGENTS.CREATE', 'AGENTS.EDIT', 'AGENTS.DELETE', 'AGENTS.APPROVE', 'AGENTS.MANAGE',
  'OUTLOOK.SEARCH', 'OUTLOOK_SHARED_MAIL.SEARCH', 'OUTLOOK_MAIL.LINK', 'OUTLOOK_MAIL.PIN',
  'OUTLOOK_MAIL.TIMELINE_VIEW', 'OUTLOOK_MAIL.ATTACHMENT_VIEW', 'OUTLOOK_MAIL.AI_SUMMARY',
  'OUTLOOK_INTELLIGENCE.VIEW', 'OUTLOOK_INTELLIGENCE.ADMIN', 'OUTLOOK_MANAGED_MAILBOX.ADMIN',
];
function legacySnapshot() {
  const passwordHash = `scrypt$${'a'.repeat(32)}$${'b'.repeat(64)}`;
  const profile = (id, role) => ({ id, username:id, displayName:id, title:'Demo', role, systemRole:role,
    passwordHash, pinHash:passwordHash, enabled:true, status:'ACTIVE', iamVersion:1,
    managerId:role === 'moderator' ? null : 'moderator', collectionAccess:[],
    directPermissions:[], temporaryPermissions:[] });
  const store = iam.migrateStore({ moderator:profile('moderator', 'moderator'), users:[profile('buyer', 'buyer')] });
  const snapshot = central.snapshotFromStore(store, 8, { id:'moderator' });
  const grant = (permission, i) => ({ ...iam.normalizeGrant('CP.VIEW'), id:`legacy-${i}`, permission });
  snapshot.users[0].directPermissions.push(...retired.map(grant));
  snapshot.users[1].directPermissions.push(grant('CP.EDIT', 'active'), ...retired.map(grant));
  snapshot.users[1].temporaryPermissions.push(...retired.map(grant));
  for (const role of Object.values(snapshot.roles)) role.permissions.push(...retired);
  return snapshot;
}
function fixture(t, snapshot = legacySnapshot()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-retired-iam-'));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const shared = path.join(root, 'SYNC'), revision = path.join(shared, 'iam', 'revisions', '0000000000000008');
  fs.mkdirSync(revision, { recursive:true });
  const sha256 = central.digest(snapshot);
  fs.writeFileSync(path.join(revision, 'snapshot.json'), JSON.stringify(snapshot));
  fs.writeFileSync(path.join(revision, 'meta.json'), JSON.stringify({ revision:8, sha256 }));
  fs.writeFileSync(path.join(revision, 'audit.json'), JSON.stringify({ revision:8, action:'IAM_UPDATE' }));
  const cacheFile = path.join(root, 'device', 'user-access.json');
  return { root, revision, snapshot, sha256, cacheFile,
    reader:central.createCentralIam({ sharedRoot:shared, cacheFile }) };
}

test('a no-cache device imports revision 8 with retired direct, temporary and role permissions', async t => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.revision, 'snapshot.json'));
  const store = await f.reader.refresh();
  assert.equal(store._revision, 8);
  assert.deepEqual([store.moderator, ...store.users].map(user => user.username), ['moderator', 'buyer']);
  assert.equal(store._centralIam.sourceSha256, f.sha256);
  assert.deepEqual(store._centralIam.snapshot, f.snapshot, 'the verified source is preserved byte-for-byte semantically');
  assert.deepEqual(fs.readFileSync(path.join(f.revision, 'snapshot.json')), original);
  assert.equal(store.users[0].passwordHash, f.snapshot.users[1].passwordHash);
  assert.equal(f.reader.health().status, 'synced');
  assert.equal(f.reader.readLocal()._revision, 8);
  assert.equal(iam.hasPermission(store.users[0], 'CP.EDIT', store), true);
  for (const code of retired) {
    assert.equal(iam.PERMISSION_CODES.has(code), false, 'retired codes stay outside the active registry');
    assert.equal(iam.hasPermission(store.moderator, code, store), false);
    assert.equal(iam.hasPermission(store.users[0], code, store), false);
  }
});

test('an old verified local cache remains usable without access to the share', t => {
  const f = fixture(t), store = central.storeFromSnapshot(f.snapshot);
  store._centralIam = { snapshot:f.snapshot, sourceSha256:f.sha256, iamRevision:8, syncedAt:new Date().toISOString() };
  fs.mkdirSync(path.dirname(f.cacheFile), { recursive:true });
  fs.writeFileSync(f.cacheFile, JSON.stringify(store));
  fs.rmSync(path.dirname(f.revision), { recursive:true });
  assert.equal(f.reader.readLocal()?._revision, 8);
  assert.deepEqual(central.validateCache(store), store);
});

test('retired compatibility cannot bypass snapshot or local-cache integrity checks', async t => {
  const f = fixture(t);
  const edited = structuredClone(f.snapshot);
  edited.users[1].displayName = 'Unverified change';
  fs.writeFileSync(path.join(f.revision, 'snapshot.json'), JSON.stringify(edited));
  await assert.rejects(f.reader.refresh(), { code:'IAM_REMOTE_INVALID', detail:'rev 8 snapshot.sha256' });
  assert.equal(f.reader.readLocal(), null);
  const cache = { ...central.storeFromSnapshot(f.snapshot), _centralIam:{ snapshot:f.snapshot, sourceSha256:f.sha256 } };
  cache.users[0].passwordHash = `scrypt$${'c'.repeat(32)}$${'d'.repeat(64)}`;
  assert.throws(() => central.validateCache(cache), { code:'IAM_LOCAL_INVALID' });
});

test('only historically emitted permission codes are compatible; malformed and invented grants still fail', () => {
  for (const code of ['INVENTED.ADMIN', 'AGENTS.ADMIN', 'OUTLOOK_MAIL.DELETE']) {
    for (const field of ['directPermissions', 'temporaryPermissions']) {
      const snapshot = legacySnapshot(); snapshot.users[1][field].push({ permission:code });
      assert.throws(() => central.validateSnapshot(snapshot), { code:'IAM_REMOTE_INVALID' });
    }
    const snapshot = legacySnapshot(); snapshot.roles.buyer.permissions.push(code);
    assert.throws(() => central.validateSnapshot(snapshot), { code:'IAM_REMOTE_INVALID' });
  }
  for (const value of [null, 'CP.VIEW', { code:'CP.VIEW' }, { permission:null }]) {
    const snapshot = legacySnapshot(); snapshot.users[1].directPermissions.push(value);
    assert.throws(() => central.validateSnapshot(snapshot), { code:'IAM_REMOTE_INVALID' });
  }
});

test('retired grants cannot replace a live administrator or carry embedded credentials', () => {
  const snapshot = legacySnapshot();
  snapshot.roles.moderator.permissions = [...retired];
  assert.throws(() => central.validateSnapshot(snapshot), { code:'IAM_LAST_ADMIN_REQUIRED' });
  const secret = legacySnapshot(); secret.users[0].directPermissions[0].token = 'forbidden';
  assert.throws(() => central.validateSnapshot(secret), { code:'IAM_REMOTE_INVALID' });
});

test('the next normal IAM mutation drops retired grants without changing passwords or shared history', async t => {
  const f = fixture(t), previous = await f.reader.refresh();
  const next = iam.migrateStore(previous); next.users[0].title = 'Demo updated';
  const saved = await f.reader.commit(next, 8, { id:'moderator' }, { action:'USER_UPDATE' });
  assert.equal(saved._revision, 9);
  assert.equal(saved.users[0].title, 'Demo updated');
  assert.equal(saved.users[0].passwordHash, previous.users[0].passwordHash);
  assert.equal(saved.users[0].credentialRevision, previous.users[0].credentialRevision);
  for (const user of saved._centralIam.snapshot.users) for (const field of ['directPermissions', 'temporaryPermissions']) {
    assert.equal(user[field].some(grant => retired.includes(grant.permission)), false);
  }
  for (const role of Object.values(saved._centralIam.snapshot.roles)) assert.equal(role.permissions.some(code => retired.includes(code)), false);
  assert.equal(central.digest(JSON.parse(fs.readFileSync(path.join(f.revision, 'snapshot.json')))), f.sha256);
});
