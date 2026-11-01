'use strict';

/* OneDrive çakışma kopyası dedektörü: çok yazarlı ortak dosyalarda OneDrive'ın
   `<ad>-<BilgisayarAdı>.<uzantı>` yan dosyalarını Moderatör sağlık ekranına
   taşır. Tarama yalnız okur; dosya silmez veya birleştirmez. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { findConflictCopies, scanConflictCopies } = require('../server/lib/onedrive-conflict-copies');

test('findConflictCopies: tireli bilgisayar adı, çift uzantı ve klasör adı', () => {
  const found = findConflictCopies([
    'v1.json', 'v1-DESKTOP-AB12C.json',
    '12.json.gz', '12.json-LAPTOP7.gz',
    '0000000000000012', '0000000000000012-PC01',
    'current.json', 'current-PC-2.json',
  ]);
  assert.deepEqual(found, [
    { name: 'v1-DESKTOP-AB12C.json', original: 'v1.json' },
    { name: '12.json-LAPTOP7.gz', original: '12.json.gz' },
    { name: '0000000000000012-PC01', original: '0000000000000012' },
    { name: 'current-PC-2.json', original: 'current.json' },
  ]);
});

test('findConflictCopies: asıl dosya yoksa, geçici/kilit girdisi veya geçersiz ek ise işaretlemez', () => {
  assert.deepEqual(findConflictCopies([
    'owner-a.json',                                 // owner.json yok
    'v1.json', 'v1.json.1234.5f1e-aa.tmp',          // geçici yazım
    'v1.json.write-lock',                           // kira klasörü
    'v1-.json', 'v1-bad name.json',                 // boş/boşluklu ek
    '.hidden', '.hidden-PC',                        // gizli
  ]), []);
});

test('scanConflictCopies: yalnız çok yazarlı klasörleri ve son IAM revizyonlarını tarar, hiçbir dosyayı değiştirmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-onedrive-conflict-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const put = (rel, body = '{}') => { const file = path.join(root, ...rel.split('/')); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
  put('buyerlog-hub.json'); put('buyerlog-hub-PC9.json');
  put('BUYER_LOG_SYNC/collection-permissions/v1.json'); put('BUYER_LOG_SYNC/collection-permissions/v1-DESKTOP-AB12C.json');
  put('BUYER_LOG_SYNC/collection-workspaces/v1/u1.json'); put('BUYER_LOG_SYNC/collection-workspaces/v1/u1-PC2.json');
  put('iam/revisions/0000000000000003/meta.json'); put('iam/revisions/0000000000000003/meta-PC3.json');
  put('iam/derived/order-access.json');
  put('model-images/content-index/a.json'); put('model-images/content-index/a-PC4.json');
  // Tek yazarlı cihaz klasörleri taranmaz (yanlış pozitif üretmesin).
  put('BUYER_LOG_SYNC/changes/dev/1.json'); put('BUYER_LOG_SYNC/changes/dev/1-x.json');
  const before = fs.readdirSync(path.join(root, 'BUYER_LOG_SYNC', 'collection-permissions')).sort();

  const result = await scanConflictCopies(root);
  assert.equal(result.configured, true);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.items.map(item => item.path).sort(), [
    'BUYER_LOG_SYNC/collection-permissions/v1-DESKTOP-AB12C.json',
    'BUYER_LOG_SYNC/collection-workspaces/v1/u1-PC2.json',
    'buyerlog-hub-PC9.json',
    'iam/revisions/0000000000000003/meta-PC3.json',
    'model-images/content-index/a-PC4.json',
  ]);
  assert.equal(result.items.find(item => item.path.endsWith('v1-DESKTOP-AB12C.json')).original, 'BUYER_LOG_SYNC/collection-permissions/v1.json');
  assert.deepEqual(fs.readdirSync(path.join(root, 'BUYER_LOG_SYNC', 'collection-permissions')).sort(), before, 'tarama dosya değiştirmemeli');

  const limited = await scanConflictCopies(root, { limit: 2 });
  assert.equal(limited.items.length, 2);
  assert.equal(limited.truncated, true);
  assert.deepEqual(await scanConflictCopies(''), { configured: false, items: [], truncated: false, scannedFolders: 0 });
});

test('Moderatör sağlık ekranı çakışma kopyalarını TR/EN ve Motion+ ile gösterir; endpoint taramayı hata yalıtımlı ekler', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'public', 'sync-health-ui.js'), 'utf8');
  assert.match(ui, /data-health-conflict-copies/);
  assert.match(ui, /tx\('Olası OneDrive çakışma kopyaları','Possible OneDrive conflict copies'\)/);
  assert.match(ui, /tx\('Asıl dosya','Original file'\)/);
  assert.match(ui, /class="syncConflictPanel blMotionEnter"/);
  assert.match(ui, /escapeHtml\(item\.path\)/, 'dosya adı HTML olarak yorumlanmamalı');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
  const route = server.slice(server.indexOf("app.get('/api/sync-health',"), server.indexOf("app.get('/api/sync-health/diff'"));
  assert.match(route, /oneDriveConflictCopies\.scanConflictCopies/);
  assert.match(route, /\.catch\(error => \{ logRuntimeFailure\('syncHealth:conflictCopies'/);
  assert.match(route, /userAccess\.requireModerator/);
});

test('Ortak klasör taramaları OneDrive reparse point girdilerini hub-dirent ile çözer', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', 'server', ...rel.split('/')), 'utf8');
  const server = read('server.js');
  const health = server.slice(server.indexOf('async function readSyncHealthReports'), server.indexOf('async function rememberModeratorMasterRevision'));
  assert.match(health, /hubDirent\.hubFiles\(healthRoot/);
  assert.match(health, /hubDirent\.hubDirectories\(changes/);
  assert.doesNotMatch(health, /entry\.isDirectory\(\)|entry\.isFile\(\)/);
  const heads = server.slice(server.indexOf('async function readSharedSyncHeads'), server.indexOf('async function publishBusinessCheckpoint'));
  assert.match(heads, /hubDirent\.hubDirectories\(changesRoot/);
  const sync = read('lib/sync-settings.js');
  assert.doesNotMatch(sync, /\.isDirectory\(\) \|\| entry\.name === encode|!source\.isDirectory\(\)|!entry\.isFile\(\) \|\| !entry\.name\.endsWith/);
  assert.match(read('lib/shared-image-store.js'), /hubFiles\(path\.join\(root, HEADS\)/);
});
