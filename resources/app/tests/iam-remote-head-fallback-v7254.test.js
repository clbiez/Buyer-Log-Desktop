'use strict';
// Regression: OneDrive'dan eşitlenen yeni cihazda giriş ekranı
// "Merkezi kullanıcı dizini alınamadı" + IAM_REMOTE_INVALID gösteriyordu.
// En yeni IAM revizyon klasörü bu cihazda henüz okunamıyorsa (OneDrive dosyaları
// indirmedi ya da daha yeni bir sürüm bilinmeyen alan yazdı) bütün dizin
// reddediliyordu. Artık en yeni GEÇERLİ revizyon kullanılır (yerel tabanın
// altına inmeden), sağlık 'stale' + okunamayan nedeni (alan adı) bildirir.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const iam = require('../server/lib/iam-core');
const central = require('../server/lib/central-iam');

function verifier(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function seed() {
  const admin = verifier('Test-admin-123'), buyer = verifier('Buyer-pass-123');
  const base = { directPermissions: [], temporaryPermissions: [], collectionAccess: [], accessAreas: {}, permissions: {}, mags: [], mmygs: [], buyingGroups: [] };
  return iam.migrateStore({ schemaVersion: 8, _revision: 1,
    moderator: { ...base, id: 'moderator', username: 'admin', displayName: 'Admin', role: 'moderator', systemRole: 'moderator', enabled: true, status: 'ACTIVE',
      passwordHash: admin, pinHash: admin, title: 'Admin', orgLevel: 'manager', managerId: null, supervisorId: null },
    users: [{ ...base, id: 'buyer-1', username: 'demo.buyer', displayName: 'Demo', role: 'buyer', systemRole: 'buyer', enabled: true, status: 'ACTIVE',
      passwordHash: buyer, pinHash: buyer, title: 'Buyer', orgLevel: 'job_title', managerId: 'moderator', supervisorId: 'moderator' }] });
}
async function twoRevisions(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-iam-head-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sharedRoot = path.join(root, 'shared'); await fsp.mkdir(sharedRoot);
  const writer = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'a', 'user-access.json') });
  await writer.initialize(seed(), { id: 'moderator' });
  const next = writer.readLocal(); next.users[0].title = 'Senior Buyer';
  await writer.commit(next, 1, { id: 'moderator' });
  const reader = central.createCentralIam({ sharedRoot, cacheFile: path.join(root, 'b', 'user-access.json') });
  return { reader, head: path.join(sharedRoot, 'iam', 'revisions', '0000000000000002') };
}

test('no-cache device uses the newest valid revision while OneDrive still downloads the head', async t => {
  const { reader, head } = await twoRevisions(t);
  const parked = path.join(path.dirname(head), '..', 'parked-snapshot.json');
  fs.renameSync(path.join(head, 'snapshot.json'), parked);
  const store = await reader.refresh();
  assert.equal(store._revision, 1);
  assert.deepEqual([store.moderator, ...store.users].map(u => u.username).sort(), ['admin', 'demo.buyer']);
  const health = reader.health();
  assert.equal(health.status, 'stale');
  assert.equal(health.lastError, 'IAM_REMOTE_INVALID');
  assert.equal(health.lastErrorDetail, 'rev 2 snapshot.json ENOENT');
  assert.equal(health.localRevision, 1);
  assert.equal(health.remoteRevision, 2);
  // Once the head is fully synced the next refresh moves forward.
  fs.renameSync(parked, path.join(head, 'snapshot.json'));
  assert.equal((await reader.refresh())._revision, 2);
  assert.equal(reader.health().status, 'synced');
  assert.equal(reader.health().lastErrorDetail, null);
});

test('a head written with a field this build does not know is named, not silently fatal', async t => {
  const { reader, head } = await twoRevisions(t);
  const file = path.join(head, 'snapshot.json'), snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  snapshot.users[1].futureField = true;
  fs.writeFileSync(file, JSON.stringify(snapshot));
  assert.equal((await reader.refresh())._revision, 1);
  assert.equal(reader.health().lastErrorDetail, 'rev 2 users[1].unknownField:futureField');
  // A device already on revision 1 keeps its cache and still reports the failure.
  await assert.rejects(reader.refresh(), { code: 'IAM_REMOTE_INVALID', detail: 'rev 2 users[1].unknownField:futureField' });
  assert.equal(reader.readLocal()._revision, 1);
});

test('no valid revision at all still fails closed with the reason', async t => {
  const { reader, head } = await twoRevisions(t);
  fs.rmSync(path.join(path.dirname(head), '0000000000000001', 'meta.json'));
  fs.rmSync(path.join(head, 'meta.json'));
  await assert.rejects(reader.refresh(), { code: 'IAM_REMOTE_INVALID', detail: 'rev 2 meta.json ENOENT' });
  assert.equal(reader.readLocal(), null);
  assert.equal(reader.health().status, 'invalid');
});
