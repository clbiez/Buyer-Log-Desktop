'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-restore-worker-'));
const env = {
  BUYER_LOG_SERVER_DATA_ROOT:path.join(root, 'server-data'),
  BUYER_LOG_DATA_ROOT:path.join(root, 'app-data'),
  BUYER_LOG_LOCAL_DATA_ROOT:path.join(root, 'local-data'),
  BUYER_LOG_CONFIG_PATH:path.join(root, 'config.json'),
};
for (const [key,value] of Object.entries(env)) process.env[key]=value;

const userData = require('../server/user-data');
const { runBackupRestore } = require('../server/lib/backup-restore-worker-client');

test.after(() => fsp.rm(root, { recursive:true, force:true }));

test('legacy backup restore ayrı worker içinde çalışır ve ana olay döngüsünü serbest bırakır', async () => {
  await fsp.mkdir(userData.SERVER_DATA_ROOT, { recursive:true });
  const restoredFile = path.join(userData.SERVER_DATA_ROOT, 'worker-restore.json');
  await fsp.writeFile(restoredFile, JSON.stringify({ version:1, payload:'x'.repeat(4 * 1024 * 1024) }));
  const backupFile = path.join(root, 'legacy.blgbackup');
  await fsp.writeFile(backupFile, userData.exportBackup({ appVersion:'7.0.91', browserStorage:{ theme:'dark' } }));
  await fsp.writeFile(restoredFile, JSON.stringify({ version:2 }));

  let timerFired = false;
  const pending = runBackupRestore(backupFile, { env, timeoutMs:30000 });
  await new Promise(resolve => setTimeout(() => { timerFired=true; resolve(); }, 10));
  assert.equal(timerFired, true, 'restore sürerken ana Node olay döngüsü ilerlemeli');
  const result = await pending;
  assert.equal(result.sourceAppVersion, '7.0.91');
  assert.equal(JSON.parse(await fsp.readFile(restoredFile, 'utf8')).version, 1);
});

test('legacy restore route worker kullanır ve transaction boyunca diğer yazmaları kilitler', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.post('/api/backup/restore'"), server.indexOf('const FULL_RESTORE_MAX_ARCHIVE_BYTES'));
  assert.match(route, /systemRestoreState\.legacyRestoreLocked = true; refreshSystemRestoreWriteLock\(\)/);
  assert.match(route, /await runBackupRestore\(/);
  assert.match(route, /systemRestoreState\.legacyRestoreLocked = false; refreshSystemRestoreWriteLock\(\)/);
  assert.doesNotMatch(route, /restoreBackupFromFile\(/);
});
