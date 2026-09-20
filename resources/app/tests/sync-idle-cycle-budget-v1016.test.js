'use strict';

/* v10.16 — SHARED SYNC: DEĞİŞİKLİK YOKKEN DÖNGÜ BOŞ KALMALI.
 *
 * Bu bir PERFORMANS BÜTÇESİDİR ve bilinçli olarak milisaniye ölçmez —
 * milisaniye eşiği makine yüküne göre flake verir. Ölçülen şey İŞ MİKTARI:
 * değişmeyen bir akranın klasörü hiç listelenmemeli, tek bir paket bile
 * taranmamalı.
 *
 * Neden korunuyor: indirme yolu her cihaz için `head.latestSequence` ile
 * kayıtlı checkpoint'i karşılaştırıp klasörü topluca atlıyor. Biri bu
 * karşılaştırmayı kaldırırsa döngü sessizce her turda tüm paketleri yeniden
 * listelemeye başlar — ağ klasöründe bu, her senkronda yüzlerce dosya
 * okuması demektir ve hiçbir test kırılmadan yavaşlar.
 *
 * Ölçülen (8 akran × 60 olay, yerel disk):
 *   tur 1 (değişiklik var) : 8 paket tarandı · 480 olay indi · 51 KB
 *   tur 3 (değişiklik yok) : 0 paket tarandı · 8/8 cihaz atlandı · 0 KB
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

const PEERS = 4;
const EVENTS_PER_PEER = 8;

test('v10.16 · değişiklik yokken sync turu HİÇ paket taramaz ve tüm akranları atlar', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-sync-idle-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });

  for (let peer = 0; peer < PEERS; peer += 1) {
    const db = createLocalDb(path.join(root, 'peer' + peer, 'BuyerLogLocal.db'));
    await db.ensure();
    for (let event = 0; event < EVENTS_PER_PEER; event += 1) {
      await db.queuePatch({ id: 'p' + peer + '-r' + event, entityType: 'order', userId: 'u' + peer, patch: { name: 'v' + event } });
    }
    const sync = createSyncSettings({ localDataRoot: path.join(root, 'peer' + peer), localDb: db });
    await sync.save(shared);
    await sync.syncOnce();
  }

  const readerDb = createLocalDb(path.join(root, 'reader', 'BuyerLogLocal.db'));
  await readerDb.ensure();
  const reader = createSyncSettings({ localDataRoot: path.join(root, 'reader'), localDb: readerDb });
  await reader.save(shared);

  // 1. tur: her şeyi indirir.
  const first = await reader.syncOnce();
  assert.equal(first.online, true);
  assert.equal(first.downloadedEvents, PEERS * EVENTS_PER_PEER, 'ilk tur tüm olayları indirmeli');
  assert.ok(first.scannedPackages > 0, 'ilk tur paket taramalı');

  // 2. tur: hiçbir şey değişmedi.
  const idle = await reader.syncOnce();
  assert.equal(idle.online, true);
  assert.equal(idle.downloadedEvents, 0, 'boş turda olay inmemeli');
  assert.equal(idle.scannedPackages, 0,
    'boş turda TEK BİR PAKET bile taranmamalı — checkpoint karşılaştırması kaldırılmış olabilir');
  assert.equal(idle.skippedDeviceFolders, PEERS,
    'değişmeyen her akran klasörü listelenmeden atlanmalı');
  assert.equal(idle.networkBytesRead, 0, 'boş turda ağdan bayt okunmamalı');
});

test('v10.16 · boş turdan sonra yeni bir olay gelirse YALNIZ o akran taranır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-sync-delta-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });

  const peers = [];
  for (let peer = 0; peer < PEERS; peer += 1) {
    const db = createLocalDb(path.join(root, 'peer' + peer, 'BuyerLogLocal.db'));
    await db.ensure();
    await db.queuePatch({ id: 'p' + peer + '-r0', entityType: 'order', userId: 'u' + peer, patch: { name: 'ilk' } });
    const sync = createSyncSettings({ localDataRoot: path.join(root, 'peer' + peer), localDb: db });
    await sync.save(shared);
    await sync.syncOnce();
    peers.push({ db, sync });
  }

  const readerDb = createLocalDb(path.join(root, 'reader', 'BuyerLogLocal.db'));
  await readerDb.ensure();
  const reader = createSyncSettings({ localDataRoot: path.join(root, 'reader'), localDb: readerDb });
  await reader.save(shared);
  await reader.syncOnce();
  assert.equal((await reader.syncOnce()).scannedPackages, 0, 'ara tur boş olmalı');

  // TEK akran yeni bir olay yazar.
  await peers[1].db.queuePatch({ id: 'p1-r1', entityType: 'order', userId: 'u1', patch: { name: 'yeni' } });
  await peers[1].sync.syncOnce();

  const after = await reader.syncOnce();
  assert.equal(after.downloadedEvents, 1, 'yalnız yeni olay inmeli');
  assert.equal(after.skippedDeviceFolders, PEERS - 1,
    'değişmeyen akranlar yine atlanmalı; yalnız değişen taranmalı');
  assert.equal((await readerDb.read()).records['p1-r1'].name, 'yeni');
});
