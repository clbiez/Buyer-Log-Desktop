'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-phase3-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(root, 'server-data');
process.env.BUYER_LOG_DATA_ROOT = path.join(root, 'app-data');
process.env.BUYER_LOG_LOCAL_DATA_ROOT = path.join(root, 'local-data');
process.env.BUYER_LOG_CONFIG_PATH = path.join(root, 'config.json');

const db = require('../server/db');
const userData = require('../server/user-data');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('revisioned profile stores reject stale writes', () => {
  const initial = db.loadViews();
  assert.equal(initial._revision, 0);
  const one = db.addView('A', { __page: 'cp' }, initial._revision);
  assert.equal(one._revision, 1);
  assert.throws(() => db.addView('Stale', { __page: 'cp' }, 0), err => err && err.code === 'REVISION_CONFLICT' && err.currentRevision === 1);
  const two = db.addView('B', { __page: 'cp' }, one._revision);
  assert.equal(two._revision, 2);
  assert.equal(two.items.length, 2);
});

test('view and filter profiles persist per user and per table with a stable favorite fallback', () => {
  const start = db.loadViews('alice');
  const cpOne = db.addView('alice', 'CP görünüm', { __page: 'cp', cp: { order: ['Order Code'] } }, start._revision);
  const cpTwo = db.addView('alice', 'CP alternatif', { __page: 'cp', cp: { order: ['Model Name'] } }, cpOne._revision);
  const orders = db.addView('alice', 'Sipariş görünüm', { __page: 'orders', orders: { order: ['Order Code'] } }, cpTwo._revision);

  assert.equal(db.loadViews('bob').items.length, 0, 'başka kullanıcının profilleri görünmemeli');
  const cpTwoId = cpTwo.items.find(item => item.name === 'CP alternatif').id;
  const ordersId = orders.items.find(item => item.tableId === 'orders').id;
  const ordersFavorite = db.setFavoriteView('alice', ordersId, orders._revision);
  const cpFavorite = db.setFavoriteView('alice', cpTwoId, ordersFavorite._revision);
  assert.equal(cpFavorite.favoriteByPage.cp, cpTwoId);
  assert.equal(cpFavorite.favoriteByPage.orders, ordersId);
  assert.equal(cpFavorite.items.find(item => item.id === cpTwoId).userId, 'alice');
  assert.equal(cpFavorite.items.find(item => item.id === cpTwoId).tableId, 'cp');

  const cpOneId = cpOne.items.find(item => item.tableId === 'cp').id;
  const usedCp = db.markUsedView('alice', cpOneId, cpFavorite._revision);
  const usedOrders = db.markUsedView('alice', ordersId, usedCp._revision);
  const afterDelete = db.deleteView('alice', cpTwoId, usedOrders._revision);
  assert.equal(afterDelete.favoriteByPage.cp, cpOneId, "favori silinince aynı tablonun güvenli fallback'i seçilmeli");
  assert.equal(afterDelete.favoriteByPage.orders, ordersId, 'başka tablonun favorisi etkilenmemeli');

  const filter = db.addFilterProfile('alice', 'Aktif filtre', { __page: 'cp', cp: { search: 'MINE', selects: { cpFStatus: 'In Time' } } }, 0);
  const filterId = filter.items[0].id;
  const renamed = db.updateFilterProfile('alice', filterId, { __page: 'cp', cp: { search: 'KARO' } }, filter._revision, 'Karo filtresi');
  assert.equal(renamed.items[0].name, 'Karo filtresi');
  assert.equal(db.loadFilterProfiles('bob').items.length, 0, 'filtre profilleri de kullanıcıdan izole olmalı');
});

test('pricing and transit rules have independent optimistic revisions', () => {
  const p1 = db.replacePricingRules([{ id: 'p1' }], 0);
  assert.equal(p1.revision, 1);
  const t1 = db.replaceTransitRules([{ id: 't1' }], 0);
  assert.equal(t1.revision, 1);
  assert.throws(() => db.replacePricingRules([{ id: 'p2' }], 0), err => err && err.code === 'REVISION_CONFLICT');
  const p2 = db.replacePricingRules([{ id: 'p2' }], 1);
  assert.equal(p2.revision, 2);
  assert.equal(db.loadOverrides()._revisions.transitRules, 1);
});

test('shipping and open costing preserve revisions', () => {
  const ship = db.addShippingRows([{ orderCode: '1' }], 0);
  assert.equal(ship._revision, 1);
  const id = ship.rows[0]._shipId;
  const patched = db.patchShippingRow(id, { note: 'ok' }, ship._revision);
  assert.equal(patched._revision, 2);
  assert.throws(() => db.deleteShippingRows([id], 1), err => err && err.code === 'REVISION_CONFLICT');

  const costing = db.createOpenCosting({ title: 'One' }, 0);
  assert.equal(costing._revision, 1);
  const updated = db.updateOpenCosting(costing.item.id, { title: 'Two' }, costing._revision);
  assert.equal(updated._revision, 2);
  assert.throws(() => db.deleteOpenCosting(costing.item.id, 1), err => err && err.code === 'REVISION_CONFLICT');
});

test('collection images are stored outside localStorage and deleted explicitly', () => {
  const pixel = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000020001e221bc330000000049454e44ae426082', 'hex');
  const first = userData.saveCollectionImage({ rowId: 10, filename: 'a.png', mimeType: 'image/png', base64: pixel.toString('base64') });
  assert.ok(first.url.startsWith('/api/collection-images/'));
  assert.equal(userData.getCollectionImage(first.id).item.size, pixel.length);
  const second = userData.saveCollectionImage({ rowId: 10, filename: 'b.png', mimeType: 'image/png', base64: pixel.toString('base64') });
  assert.notEqual(second.id, first.id);
  assert.ok(userData.getCollectionImage(first.id), 'old reference remains available for duplicated rows');
  assert.equal(userData.deleteCollectionImage(first.id), true);
  assert.equal(userData.getCollectionImage(first.id), null);
  assert.ok(userData.getCollectionImage(second.id));
});

test('temp inventory ignores directories that disappear while being scanned', () => {
  const volatileDir = fs.mkdtempSync(path.join(userData.TEMP_ROOT, 'buyerlog-inventory-race-'));
  const volatileFile = path.join(volatileDir, 'gone.txt');
  fs.writeFileSync(volatileFile, 'gone');
  const originalReaddirSync = fs.readdirSync;
  let injected = false;
  fs.readdirSync = function patchedReaddirSync(target, ...args) {
    if (!injected && path.resolve(String(target)) === path.resolve(volatileDir)) {
      injected = true;
      fs.unlinkSync(volatileFile);
      fs.rmdirSync(volatileDir);
    }
    return originalReaddirSync.call(this, target, ...args);
  };
  try {
    assert.doesNotThrow(() => userData.getUserDataInventory());
    assert.equal(injected, true, 'test must exercise the disappearing-directory race');
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(volatileDir, { recursive: true, force: true });
  }
});

test('full backup restores server files, model/image files, config and browser storage', () => {
  // Tam yedek, yedek anında boş olan kapsamları da tanımlar.
  fs.rmSync(userData.COLLECTION_IMAGES_ROOT, { recursive: true, force: true });
  fs.mkdirSync(userData.MODEL_FILES_ROOT, { recursive: true });
  fs.writeFileSync(path.join(userData.MODEL_FILES_ROOT, 'sample.bin'), Buffer.from('model-file'));
  fs.writeFileSync(userData.CONFIG_PATH, JSON.stringify({ sourceFolder: 'X:/Source' }));
  const beforeInventory = userData.getUserDataInventory();
  assert.ok(beforeInventory.totalBackupBytes > 0);

  const gzip = userData.exportBackup({ appVersion: '2.71', browserStorage: { 'lcw.test': 'browser-value' } });
  assert.ok(gzip.length > 0);
  const parsed = userData.parseBackup(gzip);
  assert.equal(parsed.browserStorage['lcw.test'], 'browser-value');
  assert.ok(parsed.managedScopes.includes('collectionImages'));

  fs.writeFileSync(path.join(userData.MODEL_FILES_ROOT, 'sample.bin'), Buffer.from('changed'));
  fs.writeFileSync(path.join(userData.MODEL_FILES_ROOT, 'extra.bin'), Buffer.from('remove-me'));
  fs.mkdirSync(userData.COLLECTION_IMAGES_ROOT, { recursive: true });
  fs.writeFileSync(path.join(userData.COLLECTION_IMAGES_ROOT, 'created-after-backup.bin'), Buffer.from('remove-from-empty-scope'));
  fs.writeFileSync(userData.CONFIG_PATH, JSON.stringify({ sourceFolder: 'Y:/Wrong' }));
  const result = userData.restoreBackup(gzip);
  assert.equal(result.browserStorage['lcw.test'], 'browser-value');
  assert.equal(fs.readFileSync(path.join(userData.MODEL_FILES_ROOT, 'sample.bin'), 'utf8'), 'model-file');
  assert.equal(fs.existsSync(path.join(userData.MODEL_FILES_ROOT, 'extra.bin')), false);
  assert.equal(fs.existsSync(path.join(userData.COLLECTION_IMAGES_ROOT, 'created-after-backup.bin')), false);
  assert.equal(JSON.parse(fs.readFileSync(userData.CONFIG_PATH, 'utf8')).sourceFolder, 'X:/Source');
  assert.throws(() => userData.resolveStoredFile(userData.MODEL_FILES_ROOT, '../outside.bin'), /Geçersiz depolama/);
  assert.throws(() => userData.resolveStoredFile(userData.COLLECTION_IMAGES_ROOT, '..\\outside.bin'), /Geçersiz depolama/);
});
