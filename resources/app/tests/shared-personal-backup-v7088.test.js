'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBackupArchive } = require('../server/lib/backup-archive');
const { createSharedPersonalBackupService } = require('../server/lib/shared-personal-backup');
const sharedSyncPolicy = require('../server/lib/shared-sync-policy');

async function box(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-personal-shared-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  let value = 'one';
  const backupService = {
    async create({ user, browserStorage }) {
      return createBackupArchive({
        filename: 'personal.zip',
        entries: [
          { name: 'user/preferences.json', stage: 'settings', buffer: Buffer.from(JSON.stringify({ value }), 'utf8') },
          { name: 'user/browser-storage.json', stage: 'settings', buffer: Buffer.from(JSON.stringify(browserStorage || {}), 'utf8') },
        ],
        manifest: {
          app_version: '7.0.88',
          created_at: new Date().toISOString(),
          backup_type: 'user',
          user: { id: user.id, username: user.username },
          device: { hostname: 'test' },
        },
      });
    },
  };
  const syncSettings = { read: async () => ({ sharedSyncRoot: root }) };
  const sharedHub = { validate: async () => ({ root, manifest: { hubId: '11111111-1111-4111-8111-111111111111', layout: { personalBackups: 'personal-backups' } } }) };
  const service = createSharedPersonalBackupService({ backupService, syncSettings, sharedHub, retentionCount: 3 });
  return { root, service, user: { id: 'buyer-1', username: 'buyer.one', displayName: 'Buyer One' }, setValue: next => { value = next; } };
}

test('personal data is kept out of ordinary shared business delta sync', () => {
  assert.equal(sharedSyncPolicy.classifyRecordId('store:user-preferences/buyer-1.json'), 'USER_OR_DEVICE');
  assert.equal(sharedSyncPolicy.sanitizeDelta({ id: 'store:user-preferences/buyer-1.json', patch: { theme: 'dark' } }), null);
});

test('shared personal backup writes a restorable user ZIP and deduplicates unchanged snapshots', async t => {
  const b = await box(t);
  const first = await b.service.create(b.user, { 'bl.user.buyer-1.x': '1' });
  assert.equal(first.saved, true);
  assert.equal(first.latest.userId, 'buyer-1');

  const dir = path.join(b.root, 'personal-backups', 'buyer-1');
  assert.ok(fs.existsSync(path.join(dir, first.latest.filename)));
  assert.ok(fs.existsSync(path.join(dir, 'latest.json')));

  const second = await b.service.create(b.user, { 'bl.user.buyer-1.x': '1' });
  assert.equal(second.saved, false);
  assert.equal(second.unchanged, true);
  assert.equal((await fsp.readdir(dir)).filter(name => name.endsWith('.zip')).length, 1);

  const status = await b.service.status(b.user);
  assert.equal(status.available, true);
  assert.equal(status.latest.filename, first.latest.filename);
});

test('changed personal data creates a new version and old versions are bounded', async t => {
  const b = await box(t);
  for (let i = 0; i < 6; i++) {
    b.setValue('v' + i);
    const result = await b.service.create(b.user, { 'bl.user.buyer-1.x': String(i) });
    assert.equal(result.saved, true);
    await new Promise(resolve => setTimeout(resolve, 8));
  }
  const dir = path.join(b.root, 'personal-backups', 'buyer-1');
  const zips = (await fsp.readdir(dir)).filter(name => name.endsWith('.zip'));
  assert.ok(zips.length <= 3, `retention should keep at most 3 versions, got ${zips.length}`);
  const latest = await b.service.latestFile(b.user);
  assert.ok(latest && fs.existsSync(latest.file));
});

test('no Shared Hub means local operation continues without a network backup', async () => {
  const service = createSharedPersonalBackupService({
    backupService: { create: async () => { throw new Error('must not run'); } },
    syncSettings: { read: async () => ({ sharedSyncRoot: '' }) },
    sharedHub: { validate: async () => { throw new Error('must not run'); } },
  });
  const result = await service.create({ id: 'u1' }, {});
  assert.deepEqual(result, { configured: false, saved: false, reason: 'not-configured' });
});
