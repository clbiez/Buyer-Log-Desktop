'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const UI = read('public/backup-manager.js');
const SERVER = read('server/server.js');
const SERVICE = read('server/lib/user-restore-service.js');
const BACKUP = read('server/lib/backup-service.js');
const PREFS = read('server/lib/user-preferences.js');
const DB = read('server/db.js');
const COLLECTIONS = read('server/lib/collection-workspaces.js');

test('personal backup UI exposes Restore My Data for every signed-in user', () => {
  assert.match(UI, /data-user-restore/);
  assert.match(UI, /Verilerimi Geri Yükle/);
  assert.match(UI, /\/api\/backups\/user-restore\/inspect/);
  assert.match(UI, /\/api\/backups\/user-restore\/start/);
  assert.match(UI, /buyerLogApplyBrowserStorageSnapshot/);
});

test('personal restore is scoped to the current user and validates user backup type', () => {
  assert.match(SERVICE, /requireType: 'user'/);
  assert.match(SERVICE, /USER_RESTORE_OWNER_MISMATCH/);
  assert.match(SERVICE, /String\(owner\.id \|\| ''\) !== String\(current\.id\)/);
  assert.match(SERVICE, /userPreferences\.restoreSnapshot\(currentUser\.id/);
  assert.match(SERVICE, /collectionWorkspaces\.saveWorkspace\(currentUser\.id/);
  assert.match(SERVICE, /db\.restoreUserBackupStores\(currentUser\.id/);
});

test('shared FX is not part of new personal backups or personal restore', () => {
  assert.doesNotMatch(BACKUP, /jsonEntry\('user\/fx\.json'/);
  assert.match(SERVICE, /user\/fx\.json/);
  assert.match(SERVICE, /ortak veri olduğu için restore edilmeyecek/);
});

test('server exposes streamed personal restore inspect, start and status routes', () => {
  assert.match(SERVER, /\/api\/backups\/user-restore\/inspect/);
  assert.match(SERVER, /\/api\/backups\/user-restore\/start/);
  assert.match(SERVER, /\/api\/backups\/user-restore\/:id\/status/);
  assert.match(SERVER, /receiveRequestToTempFile\(req, USER_RESTORE_MAX_ARCHIVE_BYTES\)/);
});

test('personal preference and profile stores have explicit restore entry points', () => {
  assert.match(PREFS, /function restoreSnapshot\(userId,\s*snapshot\)/);
  assert.match(PREFS, /function restoreSnapshotAsync\(userId,\s*snapshot,options=\{\}\)/);
  const exportStart=PREFS.indexOf('module.exports = {'),exports=PREFS.slice(exportStart,PREFS.indexOf('\n};',exportStart));
  for(const name of ['load','loadAsync','merge','mergeAsync','removeKeys','removeKeysAsync','restoreSnapshot','restoreSnapshotAsync'])assert.match(exports,new RegExp('\\b'+name+'\\b'));
  assert.match(DB, /function userBackupStoreSnapshot\(userId\)/);
  assert.match(DB, /function restoreUserBackupStores\(userId, snapshot/);
});


test('personal Collection restore remains in the signed-in owner workspace', () => {
  assert.match(SERVICE, /collectionWorkspaces\.saveWorkspace\(currentUser\.id, incoming\.collection/);
  assert.match(SERVICE, /collection: selectedSet\.has\('collection'\) && !customCollectionRestore \? clone\(collectionWorkspaces\.loadWorkspace\(currentUser\.id\)\) : null/);
  assert.match(SERVER, /const userRestoreService = createUserRestoreService\(\);/);
  const serviceInit = SERVER.slice(SERVER.indexOf('const userRestoreService ='), SERVER.indexOf('const userRestoreUploads'));
  assert.doesNotMatch(serviceInit, /mergePersonalBackupIntoShared|SHARED_COLLECTION_OWNER|userRestoreSharedCollectionSync/);
  // Legacy merge code may remain for forensic/backward compatibility, but the
  // canonical personal-restore route must no longer call it.
  assert.match(COLLECTIONS, /async function mergePersonalBackupIntoShared\(/);
});

test('personal restore explains which royalty and email data can and cannot return from a user backup', () => {
  assert.match(SERVICE, /Koleksiyon satırlarındaki Royalty\/Hologram değerleri Collection ile geri gelir/);
  assert.match(SERVICE, /merkezi Royalty kuralları ve E-posta Grupları kişisel backup kapsamı dışındadır/);
});
