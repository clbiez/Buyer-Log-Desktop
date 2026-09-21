'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBackupArchive, validateZip, inspectBackupArchive, extractBackupArchive } = require('../server/lib/backup-archive');
const { createBackupService, sanitize, sanitizeBrowserStorage, dateStamp } = require('../server/lib/backup-service');
const { backupSafeStore } = require('../server/lib/user-access');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SERVICE = read('server/lib/backup-service.js');
const SERVER = read('server/server.js');
const UI = read('public/backup-manager.js');

test('v7.57 · user backup yalnız oturum sahibinin veri ve tarayıcı tercihlerini seçer', () => {
  const own = 'bl.user.alice.lcw.table.columnState.v1', other = 'bl.user.bob.lcw.table.columnState.v1';
  assert.deepEqual(sanitizeBrowserStorage({ [own]: 'A', [other]: 'B', shared: 'C' }, 'alice'), { [own]: 'A' });
  assert.deepEqual(JSON.parse(sanitizeBrowserStorage({ [own]: '{"column":"x","sessionToken":"secret"}' }, 'alice')[own]), { column: 'x' });
  assert.match(SERVICE, /userPreferences\.load\(user\.id\)/);
  assert.match(SERVICE, /loadWorkspace\(user\.id\)/);
  assert.match(SERVICE, /user-source-data', id/);
});

test('v7.57 · moderator full backup rol/yetki ilişkilerini içerir, hassas alanları çıkarır', async () => {
  const cleaned = backupSafeStore({ users: [{ id: 'u1', passwordHash: 'x', roles: ['buyer'], permissions: { read: true } }], sessionToken: 'secret' });
  assert.deepEqual(cleaned, { users: [{ id: 'u1', roles: ['buyer'], permissions: { read: true } }] });
  assert.deepEqual(sanitize({ clientSecret: 'x', nested: { token: 'y', kept: 1 } }), { nested: { kept: 1 } });
  const service = createBackupService({ appVersion: '7.57', userAccess: { backupSnapshot: () => ({}) }, syncSettings: { read: async () => ({}) } });
  await assert.rejects(service.create({ mode: 'full', user: { id: 'buyer', systemRole: 'buyer' } }), /yalnız moderatör/);
  assert.match(SERVICE, /users-roles-permissions\.json/);
  assert.match(SERVER, /req\.currentUser\.systemRole !== 'moderator'/);
});

test('v7.57 · backup kaynak veriyi değiştirmez, manifest ve checksum doğrulanır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-backup-test-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'data.json'); await fsp.writeFile(source, JSON.stringify({ value: 42 }));
  const before = crypto.createHash('sha256').update(await fsp.readFile(source)).digest('hex');
  const archive = await createBackupArchive({ entries: [{ name: 'data/data.json', sourcePath: source, stage: 'data' }], manifest: { app_version: '7.57', created_at: new Date().toISOString(), user: { id: 'u1' }, device: {} }, filename: 'test.zip' });
  t.after(() => archive.cleanup());
  assert.deepEqual(await validateZip(archive.path, ['manifest.json', 'data/data.json']), { size: archive.size, entries: 2 });
  const after = crypto.createHash('sha256').update(await fsp.readFile(source)).digest('hex'); assert.equal(after, before);
  assert.match(path.basename(archive.path), /^test\.zip$/);
});

test('v7.57 · bozuk veya yarım backup başarı sayılmaz', async t => {
  const archive = await createBackupArchive({ entries: [{ name: 'data/item.json', buffer: Buffer.from('{"ok":true}'), stage: 'data' }], manifest: { app_version: '7.57', created_at: new Date().toISOString(), user: {}, device: {} }, filename: 'valid.zip' });
  t.after(() => archive.cleanup());
  const broken = `${archive.path}.broken`; const bytes = await fsp.readFile(archive.path); bytes[40] ^= 0xff; await fsp.writeFile(broken, bytes); t.after(() => fsp.rm(broken, { force: true }));
  await assert.rejects(validateZip(broken, ['manifest.json', 'data/item.json']), /bozuk|checksum|uyuşmuyor|doğrulanamadı/);
  const partial = `${archive.path}.partial`; await fsp.writeFile(partial, bytes.subarray(0, Math.floor(bytes.length / 2))); t.after(() => fsp.rm(partial, { force: true }));
  await assert.rejects(validateZip(partial, ['manifest.json', 'data/item.json']));
});



test('v7.57 · sıfır baytlık dosya backup preflight ve extract sırasında geçerli kayıttır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-backup-empty-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const archive = await createBackupArchive({
    entries: [
      { name: 'system/local-data/empty.db-wal', buffer: Buffer.alloc(0), stage: 'data' },
      { name: 'system/local-data/data.json', buffer: Buffer.from('{"ok":true}'), stage: 'data' },
    ],
    manifest: { app_version: '7.57', created_at: new Date().toISOString(), backup_type: 'full', user: {}, device: {} },
    filename: 'empty-entry.zip',
  });
  t.after(() => archive.cleanup());
  const info = await inspectBackupArchive(archive.path, { requireType: 'full', validateData: true });
  assert.equal(info.fileCount, 2);
  const target = path.join(root, 'extract');
  await extractBackupArchive(archive.path, target, { requireType: 'full', preflight: info });
  const empty = path.join(target, 'system', 'local-data', 'empty.db-wal');
  assert.equal((await fsp.stat(empty)).size, 0);
  assert.equal(await fsp.readFile(path.join(target, 'system', 'local-data', 'data.json'), 'utf8'), '{"ok":true}');
});

test('v7.57 · büyük veri stream edilir ve UI polling ile kilitlenmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-backup-large-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'large.bin'), handle = await fsp.open(source, 'w');
  for (let index = 0; index < 32; index++) await handle.write(Buffer.alloc(256 * 1024, index)); await handle.close();
  let eventLoopAdvanced = false; setImmediate(() => { eventLoopAdvanced = true; });
  const archive = await createBackupArchive({ entries: [{ name: 'data/large.bin', sourcePath: source, stage: 'data' }], manifest: { app_version: '7.57', created_at: new Date().toISOString(), user: {}, device: {} }, filename: 'large.zip' });
  t.after(() => archive.cleanup()); assert.equal(eventLoopAdvanced, true);
  assert.match(UI, /setTimeout\(resolve, ms\)/); assert.match(SERVER, /fs\.createReadStream\(job\.archive\.path\)/);
  assert.equal(dateStamp(new Date(2026, 7, 30, 14, 5)), '20260830-1405');
});
