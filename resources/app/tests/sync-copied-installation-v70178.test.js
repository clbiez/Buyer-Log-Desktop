'use strict';
/*
 * v7.0.178 — Kopyalanmış kurulum (klonlanmış deviceId) regresyonu.
 *
 * Saha olayı: çalışan bir Buyer Log klasörü data\ dâhil yeni kullanıcılara
 * kopyalandı. Bütün kopyalar aynı deviceId'yi taşıdı; Shared Hub'da aynı
 * changes/<deviceId> klasörüne yazdılar ve o klasörü "kendi klasörüm" diye
 * okumadıkları için birbirlerinin değişikliklerini HİÇ almadılar.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createSyncSettings } = require('../server/lib/sync-settings');
const { installationFingerprint } = require('../server/lib/installation-fingerprint');

async function tmp(t, prefix) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}
async function copyDir(from, to) { await fsp.cp(from, to, { recursive: true }); }
function device(root, name, fingerprint) {
  const db = createLocalDb(path.join(root, name, 'data', 'BuyerLogLocal.db'));
  const sync = createSyncSettings({ localDataRoot: path.join(root, name, 'settings'), localDb: db, installationFingerprint: () => fingerprint });
  return { db, sync };
}

test('kurulum parmak izi bilgisayar + kullanıcıya bağlıdır, klasör yoluna bağlı değildir', () => {
  const a = installationFingerprint({ COMPUTERNAME: 'PC-1', USERNAME: 'ayse' });
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.equal(a, installationFingerprint({ COMPUTERNAME: 'pc-1', USERNAME: 'AYSE', LOCALAPPDATA: 'D:\\baska' }));
  assert.notEqual(a, installationFingerprint({ COMPUTERNAME: 'PC-2', USERNAME: 'ayse' }));
  assert.notEqual(a, installationFingerprint({ COMPUTERNAME: 'PC-1', USERNAME: 'mehmet' }));
});

test('rotateDeviceId: yerel olaylar aynı eventId ile yeni kimlik altında 1..n sırayla yeniden kuyruğa girer ve yeniden açılışta korunur', async t => {
  const root = await tmp(t, 'bl-rotate-');
  const file = path.join(root, 'BuyerLogLocal.db');
  const db = createLocalDb(file);
  await db.queuePatch({ id: 'r1', patch: { v: 1 } });
  await db.queuePatch({ id: 'r2', patch: { v: 2 } });
  const before = await db.read();
  const oldId = before.deviceId;
  await db.markSynced(before.journal.map(item => item.eventId));
  assert.equal(await db.pendingCount(), 0);

  const result = await db.rotateDeviceId({ reason: 'test', fingerprint: 'fp-b' });
  assert.equal(result.previousDeviceId, oldId);
  assert.notEqual(result.deviceId, oldId);
  assert.equal(db.getDeviceId(), result.deviceId);
  assert.equal(result.reissued, 2);

  const reopened = createLocalDb(file);
  const state = await reopened.read();
  assert.equal(state.deviceId, result.deviceId);
  assert.equal(reopened.getDeviceId(), result.deviceId);
  assert.deepEqual(state.journal.map(item => item.eventId), before.journal.map(item => item.eventId));
  assert.deepEqual(state.journal.map(item => item.localSequence), [1, 2]);
  assert.ok(state.journal.every(item => item.deviceId === result.deviceId && item.uploaded === false));
  assert.equal(await reopened.pendingCount(), 2, 'eski WAL "yüklendi" işaretleri yeniden kuyruğu geri almamalı');
  assert.equal(state.localSequence, 2);
  assert.equal(state.causalKnowledge[oldId], 2);
  assert.equal(state.deviceBinding.fingerprint, 'fp-b');
  assert.equal(state.records.r1.v, 1);
  assert.equal(state.records.r2.v, 2);
});

test('ensureDeviceBinding: mühürsüz DB sahiplenilir; başka kuruluma mühürlü DB kopyası kimlik yeniler', async t => {
  const root = await tmp(t, 'bl-binding-');
  const original = createLocalDb(path.join(root, 'a', 'BuyerLogLocal.db'));
  await original.queuePatch({ id: 'x', patch: { v: 1 } });
  const adopted = await original.ensureDeviceBinding('fp-a');
  assert.equal(adopted.status, 'adopted');
  assert.equal((await original.ensureDeviceBinding('fp-a')).status, 'bound');

  await copyDir(path.join(root, 'a'), path.join(root, 'b'));
  const copy = createLocalDb(path.join(root, 'b', 'BuyerLogLocal.db'));
  assert.equal(copy.getDeviceId(), original.getDeviceId());
  const rotated = await copy.ensureDeviceBinding('fp-b');
  assert.equal(rotated.status, 'rotated');
  assert.notEqual(copy.getDeviceId(), original.getDeviceId());
  assert.equal((await copy.ensureDeviceBinding('fp-b')).status, 'bound');
  assert.equal((await copy.read()).records.x.v, 1, 'iş verisi kimlik yenilemede değişmez');
});

test('eski sürümle kopyalanmış iki kurulum güncellemeden sonra ayrışır ve kaçırdıkları değişiklikleri alır', async t => {
  const root = await tmp(t, 'bl-cloned-');
  const shared = path.join(root, 'shared');
  await fsp.mkdir(shared, { recursive: true });

  // Kaynak kurulum (A) ve ayrı bir eş (C) — 7.0.177 davranışı: parmak izi yok.
  const legacyA = device(root, 'a', '');
  const legacyC = device(root, 'c', '');
  await legacyA.sync.save(shared); await legacyC.sync.save(shared);
  await legacyA.db.queuePatch({ id: 'ortak', patch: { v: 'ilk' } });
  await legacyA.sync.syncOnce(); await legacyC.sync.syncOnce(); await legacyA.sync.syncOnce();

  // Klasör komple B'ye kopyalanır (data + ayarlar).
  await copyDir(path.join(root, 'a'), path.join(root, 'b'));
  const legacyB = device(root, 'b', '');
  assert.equal(legacyB.db.getDeviceId(), legacyA.db.getDeviceId());

  // Eski sürümde iki kopya da çalışır: birbirinin kaydını hiç görmez.
  await legacyA.db.queuePatch({ id: 'a-kaydi', patch: { v: 'A' } });
  await legacyB.db.queuePatch({ id: 'b-kaydi', patch: { v: 'B' } });
  for (const d of [legacyA, legacyB, legacyC, legacyA, legacyB]) await d.sync.syncOnce();
  assert.equal((await legacyA.db.read()).records['b-kaydi'], undefined, 'hata ön koşulu: A, B kaydını görmüyor');
  assert.equal((await legacyB.db.read()).records['a-kaydi'], undefined, 'hata ön koşulu: B, A kaydını görmüyor');

  // 7.0.178: her kurulum kendi bilgisayar/kullanıcı parmak iziyle açılır.
  const a = device(root, 'a', 'fp-a'), b = device(root, 'b', 'fp-b'), c = device(root, 'c', 'fp-c');
  for (const d of [a, b, c, a, b, c, a, b]) await d.sync.syncOnce();

  const A = await a.db.read(), B = await b.db.read(), C = await c.db.read();
  assert.notEqual(a.db.getDeviceId(), b.db.getDeviceId(), 'kopyalar farklı cihaz kimliğine ayrılmalı');
  for (const [name, state] of [['A', A], ['B', B], ['C', C]]) {
    assert.equal(state.records['a-kaydi'] && state.records['a-kaydi'].v, 'A', `${name} A kaydını almalı`);
    assert.equal(state.records['b-kaydi'] && state.records['b-kaydi'].v, 'B', `${name} B kaydını almalı`);
    assert.equal(state.records.ortak.v, 'ilk');
  }
  assert.equal(await a.db.pendingCount(), 0);
  assert.equal(await b.db.pendingCount(), 0);

  // Ayrıştıktan sonra normal senkron devam eder ve tekrar kimlik yenilenmez.
  const idA = a.db.getDeviceId(), idB = b.db.getDeviceId();
  await b.db.queuePatch({ id: 'sonra', patch: { v: 'B2' } });
  for (const d of [b, a, c]) await d.sync.syncOnce();
  assert.equal((await a.db.read()).records.sonra.v, 'B2');
  assert.equal((await c.db.read()).records.sonra.v, 'B2');
  assert.equal(a.db.getDeviceId(), idA);
  assert.equal(b.db.getDeviceId(), idB);
});

function represented(state, id, field, value) {
  const record = state.records[id] || {};
  if (JSON.stringify(record[field]) === JSON.stringify(value)) return true;
  return state.conflicts.some(item => !item.resolved && item.id === id && item.field === field
    && (JSON.stringify(item.incoming) === JSON.stringify(value) || JSON.stringify(item.current) === JSON.stringify(value)));
}

for (const order of ['a-first', 'b-first']) {
  test(`kopyaların aynı alandaki farklı düzenlemesi sessizce kaybolmaz (${order})`, async t => {
    const root = await tmp(t, 'bl-cloned-conflict-');
    const shared = path.join(root, 'shared');
    await fsp.mkdir(shared, { recursive: true });
    const legacyA = device(root, 'a', '');
    await legacyA.sync.save(shared);
    await legacyA.db.queuePatch({ id: 'ayar', patch: { renk: 'mavi' } });
    await legacyA.sync.syncOnce();
    await copyDir(path.join(root, 'a'), path.join(root, 'b'));
    const legacyB = device(root, 'b', '');
    // A'nın düzenlemesi B'ninkinden daha yüksek ortak sıra numarası alır:
    // eski "aynı cihazın eski olayı" kuralı B'nin değerini sessizce atlardı.
    await legacyA.db.queuePatch({ id: 'ayar', patch: { not: 'A' } });
    await legacyA.db.queuePatch({ id: 'ayar', patch: { renk: 'kirmizi' } });
    await legacyB.db.queuePatch({ id: 'ayar', patch: { renk: 'yesil' } });
    await legacyA.sync.syncOnce(); await legacyB.sync.syncOnce();

    const a = device(root, 'a', 'fp-a'), b = device(root, 'b', 'fp-b');
    const sequence = order === 'a-first' ? [a, b, a, b, a] : [b, a, b, a, b];
    for (const d of sequence) await d.sync.syncOnce();
    const A = await a.db.read(), B = await b.db.read();
    for (const [name, state] of [['A', A], ['B', B]]) {
      assert.ok(represented(state, 'ayar', 'renk', 'kirmizi'), `${name}: A'nın "kirmizi" düzenlemesi kaybolmamalı`);
      assert.ok(represented(state, 'ayar', 'renk', 'yesil'), `${name}: B'nin "yesil" düzenlemesi kaybolmamalı`);
      assert.equal(state.records.ayar.not, 'A');
    }
  });
}
