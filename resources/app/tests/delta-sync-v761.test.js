'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');

test('v7.61 · Local DB journal device/sequence/checksum ve duplicate event metadata tutar', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-delta-db-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'BuyerLogLocal.db')); await db.ensure();
  const result = await db.queuePatch({ id: 'r1', entityType: 'order', userId: 'u1', patch: { name: 'A' } });
  const state = await db.read(), item = state.journal[0];
  assert.match(state.deviceId, /^[0-9a-f-]{36}$/); assert.equal(item.localSequence, 1); assert.equal(item.operation, 'create');
  assert.equal(item.entityType, 'order'); assert.equal(item.userId, 'u1'); assert.ok(item.sha256); assert.equal(result.localSequence, 1);
  assert.equal((await db.applyDelta(item)).duplicate, true);
  await db.queuePatch({ id: 'r1', patch: { name: 'B' } });
  assert.equal((await db.read()).records.r1.name, 'B');
  await db.applyDelta({ eventId: 'remote-1', id: 'r1', patch: { name: 'C' }, revision: 1, baseRevision: 1, deviceId: 'foreign', localSequence: 1 });
  const conflicted = await db.read(); assert.equal(conflicted.records.r1.name, 'B'); assert.equal(conflicted.conflicts.length, 1);
});

test('v7.61 · Delta sync cihaz klasörü, atomic paket, ACK ve checkpoint kullanır', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-delta-sync-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared'), db1 = createLocalDb(path.join(root, 'one', 'BuyerLogLocal.db')), db2 = createLocalDb(path.join(root, 'two', 'BuyerLogLocal.db')); await fsp.mkdir(shared, { recursive: true });
  const sync1 = createSyncSettings({ localDataRoot: path.join(root, 'one'), localDb: db1 }), sync2 = createSyncSettings({ localDataRoot: path.join(root, 'two'), localDb: db2 });
  await db1.queuePatch({ id: 'r1', patch: { name: 'from one' } });
  await sync1.save(shared); await sync2.save(shared);
  /* DAVRANIŞ DEĞİŞİKLİĞİ: pendingUpload eskiden "onaylanmamış" demekti, bu
     yüzden paket hub'a yazıldıktan SONRA da 1 kalıyordu. Onay ancak başka bir
     cihaz paketi okuyunca gelir; tek cihazlı kurulumda hiç gelmediği için
     sayaç sonsuza dek şişiyordu (sahada: başarılı sync sonrası kalıcı
     "464 Pending"). Artık iki büyüklük ayrı:
       pendingUpload — hub'a yazılmamış olay  → yazımdan sonra 0
       pendingAck    — hiçbir eşin okumadığı olay → eş okuyunca 0
     Testin çividiği asıl kural (ACK + checkpoint zinciri) aynen korunuyor. */
  const first = await sync1.syncOnce(); assert.equal(first.online, true);
  assert.equal(first.pendingUpload, 0, 'paket hub\'a yazıldı, yüklenecek bir şey kalmadı');
  assert.equal(first.pendingAck, 1, 'henüz hiçbir eş okumadı');
  const second = await sync2.syncOnce(); assert.equal(second.online, true); assert.equal((await db2.read()).records.r1.name, 'from one');
  const afterAck = await sync1.syncOnce(); assert.equal(afterAck.pendingUpload, 0); assert.equal(afterAck.pendingAck, 0, 'eş okudu, ACK geldi');
  const dirs = await fsp.readdir(path.join(shared, 'BUYER_LOG_SYNC', 'changes')); assert.equal(dirs.length, 2);
  const ownerDir = encodeURIComponent(db1.getDeviceId());
  const ownerAcks=await fsp.readdir(path.join(shared, 'BUYER_LOG_SYNC', 'acks', ownerDir),{withFileTypes:true});
  assert.ok(ownerAcks.some(entry=>entry.isFile()&&entry.name.endsWith('.json')),'v2 compact checkpoint ACK bulunmalı');
  assert.ok(ownerAcks.some(entry=>entry.isDirectory()&&entry.name==='packages'),'rollout sırasında package ACK compatibility klasörü korunmalı');
  assert.equal(Number((await db2.read()).syncCheckpoints[db1.getDeviceId()]), 1);
});

test('v7.61 · checksum bozuk delta uygulanmaz ve sync başarılı gibi işaretlenmez', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'buyerlog-delta-corrupt-')); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const shared = path.join(root, 'shared'), db = createLocalDb(path.join(root, 'db', 'BuyerLogLocal.db')), sync = createSyncSettings({ localDataRoot: path.join(root, 'settings'), localDb: db });
  await sync.save(shared);
  const foreign = 'foreign-device';
  const dir = path.join(shared, 'BUYER_LOG_SYNC', 'changes', encodeURIComponent(foreign)); await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, '000000000001-bad.json'), JSON.stringify({ eventId: 'bad', id: 'r1', patch: { name: 'bad' }, revision: 1, deviceId: foreign, localSequence: 1, sha256: 'wrong' }));
  const status = await sync.syncOnce(); assert.equal(status.corruptPackages, 1); assert.match(status.lastError, /bozuk/); assert.equal((await db.read()).records.r1, undefined);
});
