'use strict';

/* OneDrive "Files On-Demand" reparse point'leri Node Dirent'inde
   isDirectory()=false, isSymbolicLink()=true görünebilir (central-iam.js saha
   düzeltmesi). Bu test, eş senkron indirmesi, ACK ve sağlık taramalarının bu
   girdileri sessizce atlamadığını sabitler. Linux'ta gerçek symlink aynı Dirent
   biçimini üretir; Windows'ta symlink oluşturmak yetki istediği için atlanır. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { hubEntryKind, hubDirectories, hubFiles } = require('../server/lib/hub-dirent');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

const fakeDirent = (name, { dir = false, file = false, link = false } = {}) => ({
  name, isDirectory: () => dir, isFile: () => file, isSymbolicLink: () => link,
});

test('hubEntryKind: Dirent türüne güvenir, bağlantıyı stat ile doğrular', async () => {
  const stat = async file => {
    if (file.endsWith('peer')) return { isDirectory: () => true, isFile: () => false };
    if (file.endsWith('report.json')) return { isDirectory: () => false, isFile: () => true };
    throw Object.assign(new Error('missing'), { code: 'ENOENT' });
  };
  assert.equal(await hubEntryKind('/hub', fakeDirent('a', { dir: true }), { stat }), 'directory');
  assert.equal(await hubEntryKind('/hub', fakeDirent('b.json', { file: true }), { stat }), 'file');
  assert.equal(await hubEntryKind('/hub', fakeDirent('peer', { link: true }), { stat }), 'directory');
  assert.equal(await hubEntryKind('/hub', fakeDirent('report.json', { link: true }), { stat }), 'file');
  assert.equal(await hubEntryKind('/hub', fakeDirent('broken', { link: true }), { stat }), 'other');
  assert.equal(await hubEntryKind('/hub', fakeDirent('socket'), { stat }), 'other');
  const entries = [fakeDirent('a', { dir: true }), fakeDirent('peer', { link: true }), fakeDirent('report.json', { link: true }), fakeDirent('broken', { link: true })];
  assert.deepEqual((await hubDirectories('/hub', entries, { stat })).map(e => e.name), ['a', 'peer']);
  assert.deepEqual((await hubFiles('/hub', entries, { stat })).map(e => e.name), ['report.json']);
});

function linkInPlace(target) {
  const real = `${target}.cloud-real`;
  fs.renameSync(target, real);
  fs.symlinkSync(real, target, fs.statSync(real).isDirectory() ? 'dir' : 'file');
}

test('eş cihaz klasörü reparse point (symlink) göründüğünde paketleri yine indirilir', { skip: process.platform === 'win32' }, async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-onedrive-dirent-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sharedRoot = path.join(root, 'shared');
  await fsp.mkdir(sharedRoot, { recursive: true });
  const dbA = createLocalDb(path.join(root, 'a', 'BuyerLogLocal.db'));
  const dbB = createLocalDb(path.join(root, 'b', 'BuyerLogLocal.db'));
  const syncA = createSyncSettings({ localDataRoot: path.join(root, 'a-settings'), localDb: dbA });
  const syncB = createSyncSettings({ localDataRoot: path.join(root, 'b-settings'), localDb: dbB });
  await syncA.save(sharedRoot); await syncB.save(sharedRoot);

  await dbA.queuePatches([{ id: 'row-1', patch: { name: 'A1' } }, { id: 'row-2', patch: { name: 'A2' } }]);
  const uploaded = await syncA.syncOnce();
  assert.equal(uploaded.uploadedEvents, 2);

  const changesRoot = path.join(sharedRoot, 'BUYER_LOG_SYNC', 'changes');
  const peerFolders = fs.readdirSync(changesRoot).filter(name => !name.endsWith('.cloud-real'));
  assert.equal(peerFolders.length, 1, 'A cihazının tek delta klasörü beklenir');
  linkInPlace(path.join(changesRoot, peerFolders[0]));
  assert.ok(fs.readdirSync(changesRoot, { withFileTypes: true }).some(e => e.isSymbolicLink() && !e.isDirectory()),
    'simülasyon OneDrive Dirent biçimini üretmeli');

  const downloaded = await syncB.syncOnce();
  assert.equal(downloaded.downloadedEvents, 2, 'reparse point klasöründeki paketler sessizce atlanmamalı');
  const state = await dbB.read();
  assert.equal(state.records['row-1'].name, 'A1');
  assert.equal(state.records['row-2'].name, 'A2');
});

test('ACK klasörleri ve dosyaları reparse point göründüğünde yükleme onaylanır', { skip: process.platform === 'win32' }, async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-onedrive-ack-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const sharedRoot = path.join(root, 'shared');
  await fsp.mkdir(sharedRoot, { recursive: true });
  const dbA = createLocalDb(path.join(root, 'a', 'BuyerLogLocal.db'));
  const dbB = createLocalDb(path.join(root, 'b', 'BuyerLogLocal.db'));
  const syncA = createSyncSettings({ localDataRoot: path.join(root, 'a-settings'), localDb: dbA });
  const syncB = createSyncSettings({ localDataRoot: path.join(root, 'b-settings'), localDb: dbB });
  await syncA.save(sharedRoot); await syncB.save(sharedRoot);
  await dbA.queuePatches([{ id: 'row-1', patch: { name: 'A1' } }]);
  await syncA.syncOnce();
  await syncB.syncOnce();

  const ackRoot = path.join(sharedRoot, 'BUYER_LOG_SYNC', 'acks');
  assert.ok(fs.existsSync(ackRoot), 'B cihazı ACK yazmış olmalı');
  // Bütün ACK alt klasör ve dosyalarını OneDrive biçimine çevir.
  const walk = dir => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (name.endsWith('.cloud-real')) continue;
      if (fs.lstatSync(full).isDirectory()) walk(full);
      if (path.dirname(full) !== ackRoot) linkInPlace(full);
    }
  };
  walk(ackRoot);
  const before = (await dbA.read()).journal.filter(item => item.acknowledged).length;
  await syncA.syncOnce();
  const after = (await dbA.read()).journal.filter(item => item.acknowledged).length;
  assert.ok(after > before, 'reparse point ACK kayıtları okunmalı');
});
