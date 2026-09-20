'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-zero-loss-'));
Object.assign(process.env, {
  BUYER_LOG_SERVER_DATA_ROOT: path.join(root, 'server-data'),
  BUYER_LOG_DATA_ROOT: path.join(root, 'app-data'),
  BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local-data'),
  BUYER_LOG_CONFIG_PATH: path.join(root, 'config.json'),
});

const { createDurableFileRecovery } = require('../server/lib/durable-file-recovery');
const { createLocalDb } = require('../server/lib/local-db');
const collectionStore = require('../server/lib/collection-workspaces');
const quotationStore = require('../server/lib/quotations-store');

const PROJECT_ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(PROJECT_ROOT, 'public', 'app-main.js'), 'utf8');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('unfinished durable write is replayed after process restart', () => {
  const dataRoot = path.join(root, 'wal-replay');
  const target = path.join(dataRoot, 'business.json');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ value: 'before' }));
  const recovery = createDurableFileRecovery({
    recoveryRoot: path.join(dataRoot, 'recovery'),
    allowedRoots: [dataRoot],
  });

  recovery.prepareSync(target, Buffer.from(JSON.stringify({ value: 'after' })));
  const result = recovery.recoverSync();

  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).value, 'after');
  assert.equal(result.recovered, 1);
  assert.equal(recovery.recoverSync().recovered, 0, 'recovery must be idempotent');
});

test('stale recovery intent never overwrites a newer unknown target', () => {
  const dataRoot = path.join(root, 'wal-conflict');
  const target = path.join(dataRoot, 'business.json');
  fs.mkdirSync(dataRoot, { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ value: 'before' }));
  const recovery = createDurableFileRecovery({
    recoveryRoot: path.join(dataRoot, 'recovery'),
    allowedRoots: [dataRoot],
  });

  recovery.prepareSync(target, Buffer.from(JSON.stringify({ value: 'stale-intent' })));
  fs.writeFileSync(target, JSON.stringify({ value: 'newer' }));
  const result = recovery.recoverSync();

  assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).value, 'newer');
  assert.equal(result.conflicts, 1);
  assert.equal(result.recovered, 0);
});

test('corrupt local DB recovers a validated backup instead of creating an empty state', async () => {
  const dbFile = path.join(root, 'db-backup', 'BuyerLogLocal.db');
  const db = createLocalDb(dbFile);
  await db.queuePatch({ id: 'order-1', patch: { price: 13 } });
  await fsp.copyFile(dbFile, `${dbFile}.bak`);
  await fsp.writeFile(dbFile, '{broken');

  const state = await db.read();
  assert.equal(state.records['order-1'].price, 13);
  assert.equal(JSON.parse(await fsp.readFile(dbFile, 'utf8')).records['order-1'].price, 13,
    'validated backup must be restored to the primary');
});

test('corrupt primary and backup fail closed and preserve both files', async () => {
  const dbFile = path.join(root, 'db-fail-closed', 'BuyerLogLocal.db');
  await fsp.mkdir(path.dirname(dbFile), { recursive: true });
  await fsp.writeFile(dbFile, '{primary-corrupt');
  await fsp.writeFile(`${dbFile}.bak`, '{backup-corrupt');
  const db = createLocalDb(dbFile);

  await assert.rejects(db.read(), error => error && error.code === 'DATA_INTEGRITY_ERROR');
  assert.equal(await fsp.readFile(dbFile, 'utf8'), '{primary-corrupt');
  assert.equal(await fsp.readFile(`${dbFile}.bak`, 'utf8'), '{backup-corrupt');
});

test('business stores do not interpret corrupt existing files as empty datasets', () => {
  const collectionFile = path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, 'collection-workspaces', 'corrupt.json');
  fs.mkdirSync(path.dirname(collectionFile), { recursive: true });
  fs.writeFileSync(collectionFile, '{broken');
  fs.writeFileSync(`${collectionFile}.bak`, '{also-broken');
  assert.throws(() => collectionStore.loadWorkspace('corrupt'), error => error && error.code === 'DATA_INTEGRITY_ERROR');

  const quotationFile = path.join(process.env.BUYER_LOG_SERVER_DATA_ROOT, 'quotations.json');
  fs.writeFileSync(quotationFile, '{broken');
  fs.writeFileSync(`${quotationFile}.bak`, '{also-broken');
  assert.throws(() => quotationStore.loadStore(), error => error && error.code === 'DATA_INTEGRITY_ERROR');
});

test('Collection conflict and live reload paths preserve dirty local edits', () => {
  const save = APP.slice(APP.indexOf('async function kolSaveWorkspaceNow'), APP.indexOf('function kolQueueWorkspaceSave'));
  assert.doesNotMatch(save, /await kolLoadWorkspace\(ownerId\)/,
    'a revision conflict must not reload over the attempted edit');
  assert.match(save, /kolPersistPendingWorkspace/,
    'failed/conflicting edits must remain in durable client storage');

  const remote = APP.slice(APP.indexOf('async function kolHandleRemoteChange'), APP.indexOf('/* ===================================================================', APP.indexOf('async function kolHandleRemoteChange')));
  assert.match(remote, /kolHasDirtyWorkspace\(\)/,
    'a full remote event must test unsaved local state before reloading');
});

test('manual Save reports durable-local, pending and failure states truthfully', () => {
  const saveNow = APP.slice(APP.indexOf('async function kolSaveWorkspaceNow'), APP.indexOf('function kolQueueWorkspaceSave'));
  assert.match(saveNow, /return \{ok:true,durable:true/,
    'a successful Collection save must return an explicit durability result');
  assert.match(saveNow, /return \{ok:false,pending:true/,
    'a failed Collection save must remain explicitly pending');

  const button = APP.slice(APP.indexOf("document.getElementById('saveAllBtn')"), APP.indexOf('// Sekme kapatılmadan', APP.indexOf("document.getElementById('saveAllBtn')")));
  assert.match(button, /await kolSaveWorkspaceNow\(\)/,
    'manual Save must wait for the local server durability boundary');
  assert.match(button, /Cihazda güvenli şekilde bekliyor/,
    'offline/failure state must not claim that everything was saved');
  assert.doesNotMatch(button, /Tüm değişiklikler kaydedildi/,
    'the old unconditional success message is unsafe');
});
