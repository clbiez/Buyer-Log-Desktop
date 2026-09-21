'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb, offloadLegacyAssets, sweepWriteDebris } = require('../server/lib/local-db');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

async function freshDb(t, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db'));
  await db.ensure();
  return { root, db };
}

test('okunmayan legacy assetler arşive taşınır ve sıcak durumdan çıkar', async t => {
  const { db } = await freshDb(t, 'buyerlog-assets-offload-');
  await db.putAssets([
    { id: 'a1', buffer: Buffer.alloc(64 * 1024, 1), mimeType: 'image/png', filename: 'one.png' },
    { id: 'a2', buffer: Buffer.alloc(64 * 1024, 2), mimeType: 'image/png', filename: 'two.png' },
  ]);
  const before = fs.statSync(db.getFile()).size;

  const result = await offloadLegacyAssets(db);
  assert.equal(result.moved, 2);

  const state = await db.read();
  assert.deepEqual(state.assets, {});
  assert.equal(state.migrations.legacyAssets.count, 2);
  assert.ok(fs.statSync(db.getFile()).size < before / 10, 'DB küçülmeli');

  // Veri silinmez; yanındaki arşivde tam olarak durur.
  const archive = JSON.parse(await fsp.readFile(`${db.getFile()}.assets-legacy.json`, 'utf8'));
  assert.equal(archive.count, 2);
  assert.equal(archive.assets.a1.filename, 'one.png');
  assert.equal(archive.assets.a2.sha256.length, 64);
});

test('asset boşaltımı idempotenttir ve ikinci kez arşiv yazmaz', async t => {
  const { db } = await freshDb(t, 'buyerlog-assets-idempotent-');
  await db.putAsset({ id: 'a1', buffer: Buffer.from('x'), filename: 'x.bin' });
  assert.equal((await offloadLegacyAssets(db)).moved, 1);

  const archive = `${db.getFile()}.assets-legacy.json`;
  const stamp = fs.statSync(archive).mtimeMs;
  const second = await offloadLegacyAssets(db);
  assert.equal(second.skipped, true);
  assert.equal(second.moved, 0);
  assert.equal(fs.statSync(archive).mtimeMs, stamp, 'arşiv yeniden yazılmamalı');
});

test('yetim temp/rollback dosyaları süpürülür, gerçek veri korunur', async t => {
  const { root, db } = await freshDb(t, 'buyerlog-debris-');
  await db.queuePatch({ id: 'r1', patch: { name: 'korunmalı' } });
  // .bak ancak ikinci anlık görüntü yazımında oluşur; transaction her zaman
  // görüntü yazar (sıcak yol olan queuePatch yalnız WAL'a ekler).
  await db.transaction(async state => { state.migrations = { ...(state.migrations || {}), sweepTest: true }; return null; });
  await db.transaction(async state => { state.migrations = { ...(state.migrations || {}), sweepTest: 2 }; return null; });
  const old = Date.now() - 7200000;
  const debris = [
    'BuyerLogLocal.db.10572.1788098446410.95dc2b4f.tmp',
    'BuyerLogLocal.db.bak.10572.1788098446410.tmp',
    'BuyerLogLocal.db.10572.1788098446410.rollback',
    'sync-settings.json.5216.1788125810783.tmp',
  ];
  for (const name of debris) {
    const file = path.join(root, name);
    await fsp.writeFile(file, 'x'.repeat(1024));
    await fsp.utimes(file, new Date(old), new Date(old));
  }
  const fresh = path.join(root, 'BuyerLogLocal.db.99.1788098446410.aabbccdd.tmp');
  await fsp.writeFile(fresh, 'in-flight');

  const swept = await sweepWriteDebris(root);
  assert.equal(swept.removed, debris.length);
  assert.equal(swept.bytes, debris.length * 1024);

  for (const name of debris) assert.equal(fs.existsSync(path.join(root, name)), false);
  assert.ok(fs.existsSync(fresh), 'uçuştaki yazıma dokunulmamalı');
  assert.ok(fs.existsSync(db.getFile()), 'DB korunmalı');
  assert.ok(fs.existsSync(`${db.getFile()}.bak`), 'yedek korunmalı');
  // WAL ve bir önceki kuşağı da gerçek veridir: süpürücü onlara dokunmamalı,
  // yoksa son yazmalar sessizce kaybolurdu.
  await db.queuePatch({ id: 'r2', patch: { name: 'wal içinde' } });
  await sweepWriteDebris(root);
  assert.ok(fs.existsSync(`${db.getFile()}.wal`), 'WAL korunmalı');
  assert.equal((await db.read()).records.r2.name, 'wal içinde', 'süpürme sonrası veri okunabilmeli');
});

test('süpürücü erişilemeyen klasörde sessizce boş sonuç döner', async () => {
  const result = await sweepWriteDebris(path.join(os.tmpdir(), 'buyerlog-yok-olan-klasor-x9'));
  assert.deepEqual(result, { removed: 0, bytes: 0, failed: 0 });
});

test('arka plan hatası sunucuyu düşürmez; yalnız uncaughtException ölümcüldür', () => {
  assert.match(SERVER, /process\.on\('uncaughtException', error => scheduleFatalRestart\('uncaughtException', error\)\)/);
  assert.match(SERVER, /process\.on\('unhandledRejection', error => logRuntimeFailure\('unhandledRejection', error\)\)/);
  assert.doesNotMatch(SERVER, /unhandledRejection', error => scheduleFatalRestart/);
});

test('createLocalDb açılışta diske hiç dokunmaz', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-lazy-open-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'BuyerLogLocal.db');
  await fsp.writeFile(file, JSON.stringify({ deviceId: 'cihaz-1', schemaVersion: 2, records: {} }));

  const readFileSync = fs.readFileSync;
  const readdirSync = fs.readdirSync;
  let reads = 0, scans = 0;
  fs.readFileSync = (...args) => { if (String(args[0]).includes('BuyerLogLocal')) reads += 1; return readFileSync(...args); };
  fs.readdirSync = (...args) => { if (String(args[0]).includes('recovery')) scans += 1; return readdirSync(...args); };
  try {
    const db = createLocalDb(file);
    assert.equal(reads, 0, 'yapıcı DB dosyasını okumamalı');
    assert.equal(scans, 0, 'yapıcı recovery klasörünü taramamalı');

    // Kimlik ihtiyaç anında, dosyadan doğru okunur — üretilmez.
    assert.equal(db.getDeviceId(), 'cihaz-1');
    assert.ok(reads > 0 && scans > 0, 'ilk gerçek erişimde okuma ve kurtarma çalışmalı');
    assert.equal((await db.read()).deviceId, 'cihaz-1', 'kimlik yazma yolunda da korunmalı');
  } finally { fs.readFileSync = readFileSync; fs.readdirSync = readdirSync; }
});

test('yeni bir kurulumda cihaz kimliği bir kez üretilip kalıcı olur', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-device-id-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'BuyerLogLocal.db');

  const first = createLocalDb(file);
  const id = first.getDeviceId();
  assert.match(id, /^[0-9a-f-]{36}$/, 'geçerli bir UUID üretilmeli');
  await first.ensure();
  assert.equal(first.getDeviceId(), id, 'ensure kimliği değiştirmemeli');

  // Süreç yeniden başlasa bile aynı kimlik okunur; yoksa her açılış yeni bir
  // cihaz gibi görünür ve sync checkpoint'leri sıfırlanırdı.
  assert.equal(createLocalDb(file).getDeviceId(), id);
});

test('local DB bakımı normal açılışta arka planda kalır, Shared Hub bootstrap gerektiğinde aynı işi bekleyebilir', () => {
  assert.match(SERVER, /setTimeout\(\(\) => \{ void ensureLocalDbMaintenanceReady\(\)\.catch\(error => logRuntimeFailure\('localDbMaintenance', error\)\); \}, LOCAL_DB_MAINTENANCE_DELAY_MS\)/);
  assert.match(SERVER, /function ensureLocalDbMaintenanceReady\(\)/);
  const bootstrap = SERVER.slice(SERVER.indexOf('async function bootstrapSharedHub'), SERVER.indexOf('// Local auth starts first.'));
  assert.match(bootstrap, /await ensureLocalDbMaintenanceReady\(\)/);
  const maintenance = SERVER.slice(SERVER.indexOf('async function runLocalDbMaintenance'), SERVER.indexOf('// Runtime failures are persisted'));
  assert.match(maintenance, /logRuntimeFailure\('localDbAssetOffload', error\)/);
  assert.match(maintenance, /logRuntimeFailure\('localDbDebrisSweep', error\)/);
});
