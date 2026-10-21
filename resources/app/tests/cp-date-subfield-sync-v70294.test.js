'use strict';
/*
 * v7.0.294 — CP tarih revizyonlarının cihazlar arası alt alan birleşimi.
 *
 * Ex-Factory / Retail Date / MB Date tek `dates` nesnesinde paylaşılıyordu.
 * Aynı satırda bir cihaz Ex-Factory'yi, öteki Retail Date'i eşzamanlı revize
 * edince son yazan nesnenin TAMAMINI yazıyor, diğer revizyon çakışma bile
 * açılmadan kayboluyordu. Olay artık yazdığı alt alanları `subfields` ile
 * bildirir; alıcı yalnız onları birleştirir. Eski sürüm olayı (bildirimsiz)
 * aynen bütün nesne olarak uygulanır.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');
const { createOwnershipResolver } = require('../server/lib/cp-field-ownership');
const { createDeltaStore } = require('../server/lib/delta-store');
const { coalescePendingEvents } = require('../server/lib/sync-package');
const cpSharedStore = require('../server/lib/cp-shared-store');
const parse = require('../server/lib/parse');
const { createSimulation } = require('./helpers/sync-sim');

const resolve = createOwnershipResolver(
  { 1001: [{ buyer: 'Demo Owner' }], 2002: [{ buyer: 'Demo Second' }] },
  [{ id: 'owner', username: 'Demo Owner' }, { id: 'second', username: 'Demo Second' }, { id: 'other', username: 'Demo Other' }],
);
const ownerOf = (id, userId) => resolve({ recordId: id, userId });
const ID = 'cp-order:1001';
const BASE = { ex: '2026-08-01', retail: '2026-10-07', mb: '2026-09-23' };

async function simulation(t, { devices = 3, owned = true, seed = 7294 } = {}) {
  const sim = await createSimulation({ seed, devices, clock: index => 1000 + index });
  t.after(() => sim.close());
  if (owned) for (const device of sim.devices) device.db.setSharedOwnerResolver(ownerOf);
  await sim.syncRound(); await sim.replicator.flush();
  return sim;
}
async function seedBase(sim, dates = BASE) {
  await sim.devices[0].db.queuePatch({ id: ID, patch: { dates: { ...dates } }, userId: 'owner', subfields: { dates: ['ex', 'mb', 'retail'] } });
  await sim.syncRound(); await sim.settle();
}
// Gerçek uygulamadaki gibi: yazar kendi yerel görünümünün tamamını gönderir.
async function revise(device, sub, value, at, userId = 'owner') {
  const current = (await device.db.read()).records[ID]?.dates || {};
  const dates = { ...current };
  if (value == null) delete dates[sub]; else dates[sub] = value;
  return device.db.queuePatch({ id: ID, patch: { dates: Object.keys(dates).length ? dates : null }, userId, at, subfields: { dates: [sub] } });
}
async function datesEverywhere(sim, id = ID) {
  return Promise.all(sim.devices.map(async device => {
    const state = await device.db.read();
    return { dates: state.records[id]?.dates ?? null, open: state.conflicts.filter(item => !item.resolved) };
  }));
}

test('üç cihaz aynı satırın üç tarihini eşzamanlı revize eder: hiçbiri kaybolmaz, çakışma yok', async t => {
  const sim = await simulation(t);
  await seedBase(sim);
  const [a, b, c] = sim.devices;
  await revise(a, 'ex', '2026-08-15', '2026-10-21T10:00:00Z');
  await revise(b, 'retail', '2026-10-20', '2026-10-21T10:00:01Z');
  await revise(c, 'mb', '2026-09-30', '2026-10-21T10:00:02Z');
  await sim.syncRound(); await sim.settle();
  for (const result of await datesEverywhere(sim)) {
    assert.deepEqual(result.dates, { ex: '2026-08-15', retail: '2026-10-20', mb: '2026-09-30' });
    assert.equal(result.open.length, 0);
  }
  await sim.assertInvariants();
});

test('aynı tarih iki cihazda eşzamanlı revize edilirse sahibin son yazımı kazanır, diğer tarihler korunur', async t => {
  const sim = await simulation(t, { devices: 2 });
  await seedBase(sim);
  const [a, b] = sim.devices;
  await revise(a, 'ex', '2026-08-10', '2026-10-21T10:00:00Z');
  await revise(b, 'ex', '2026-08-20', '2026-10-21T11:00:00Z');
  await revise(b, 'mb', '2026-09-25', '2026-10-21T11:00:05Z');
  await sim.syncRound(); await sim.settle();
  for (const result of await datesEverywhere(sim)) {
    assert.deepEqual(result.dates, { ex: '2026-08-20', retail: '2026-10-07', mb: '2026-09-25' });
    assert.equal(result.open.length, 0);
  }
});

test('sahipliği bilinmeyen gerçek aynı-alan yarışı sessizce ezilmez, çakışma olarak açılır', async t => {
  const sim = await simulation(t, { devices: 2, owned: false, seed: 7295 });
  await seedBase(sim);
  const [a, b] = sim.devices;
  await revise(a, 'retail', '2026-10-11', '2026-10-21T10:00:00Z');
  await revise(b, 'retail', '2026-10-12', '2026-10-21T10:00:01Z');
  await revise(b, 'ex', '2026-08-05', '2026-10-21T10:00:02Z');
  await sim.syncRound(); await sim.settle();
  const [ra, rb] = await datesEverywhere(sim);
  // Ex-Factory yarışmadı: iki tarafta da uygulanır; Retail kendi tarafında kalır ve çakışma açılır.
  assert.equal(ra.dates.ex, '2026-08-05'); assert.equal(rb.dates.ex, '2026-08-05');
  assert.equal(ra.dates.retail, '2026-10-11'); assert.equal(rb.dates.retail, '2026-10-12');
  for (const result of [ra, rb]) {
    assert.equal(result.open.length, 1);
    assert.equal(result.open[0].field, 'dates');
    assert.notEqual(result.open[0].current.retail, result.open[0].incoming.retail);
    assert.equal(result.open[0].incoming.ex, '2026-08-05', 'çakışma seçeneği diğer revizyonu geri almaz');
  }
});

test('yeni satırda iki cihaz farklı tarihleri ilk kez revize eder: sahiplik bilinmese de sahte çakışma yok', async t => {
  const sim = await simulation(t, { devices: 2, owned: false, seed: 7301 });
  const [a, b] = sim.devices;
  await revise(a, 'ex', '2026-08-09', '2026-10-21T10:00:00Z');
  await revise(b, 'retail', '2026-10-09', '2026-10-21T10:00:01Z');
  await sim.syncRound(); await sim.settle();
  await revise(a, 'mb', '2026-09-09', '2026-10-21T10:00:02Z');
  await sim.syncRound(); await sim.settle();
  for (const result of await datesEverywhere(sim)) {
    assert.deepEqual(result.dates, { ex: '2026-08-09', retail: '2026-10-09', mb: '2026-09-09' });
    assert.equal(result.open.length, 0);
  }
});

test('revizyon kaldırma (null) yalnız o tarihi siler ve eşlere taşınır', async t => {
  const sim = await simulation(t, { devices: 2, seed: 7296 });
  await seedBase(sim);
  const [a, b] = sim.devices;
  await revise(a, 'retail', null, '2026-10-21T10:00:00Z');
  await revise(b, 'mb', '2026-09-01', '2026-10-21T10:00:01Z');
  await sim.syncRound(); await sim.settle();
  for (const result of await datesEverywhere(sim)) assert.deepEqual(result.dates, { ex: '2026-08-01', mb: '2026-09-01' });
});

test('iki kullanıcı kendi siparişlerini revize eder; sahibi olmayanın tarih yazımı reddedilir', async t => {
  const sim = await simulation(t, { devices: 2, seed: 7297 });
  const [a, b] = sim.devices;
  await a.db.queuePatch({ id: ID, patch: { dates: { ex: '2026-08-02' } }, userId: 'owner', subfields: { dates: ['ex'] } });
  await b.db.queuePatch({ id: 'cp-order:2002', patch: { dates: { retail: '2026-11-02' } }, userId: 'second', subfields: { dates: ['retail'] } });
  await assert.rejects(b.db.queuePatch({ id: ID, patch: { dates: { ex: '2027-01-01' } }, userId: 'other', subfields: { dates: ['ex'] } }), error => error.code === 'ORDER_SHARED_OWNER_ONLY');
  await sim.syncRound(); await sim.settle();
  for (const device of sim.devices) {
    const state = await device.db.read();
    assert.deepEqual(state.records[ID].dates, { ex: '2026-08-02' });
    assert.deepEqual(state.records['cp-order:2002'].dates, { retail: '2026-11-02' });
  }
});

test('eski sürüm olayı (subfields yok) bütün nesne olarak uygulanır; sonraki alt alan yazımı onu esas alır', async t => {
  const sim = await simulation(t, { devices: 2, seed: 7298 });
  await seedBase(sim);
  const [a, b] = sim.devices;
  // Eski sürüm: yalnız Ex-Factory'yi değiştirdi ama nesnenin tamamını yazar.
  await a.db.queuePatch({ id: ID, patch: { dates: { ...BASE, ex: '2026-07-01' } }, userId: 'owner', at: '2026-10-21T09:00:00Z' });
  await sim.syncRound(); await sim.settle();
  await revise(b, 'retail', '2026-10-30', '2026-10-21T10:00:00Z');
  await sim.syncRound(); await sim.settle();
  for (const result of await datesEverywhere(sim)) {
    assert.deepEqual(result.dates, { ex: '2026-07-01', retail: '2026-10-30', mb: '2026-09-23' });
    assert.equal(result.open.length, 0);
  }
});

test('kapat-aç: alt alan saatleri ve tarihler WAL/anlık görüntüden aynen geri gelir', async t => {
  const sim = await simulation(t, { devices: 2, seed: 7299 });
  await seedBase(sim);
  const [a, b] = sim.devices;
  await revise(a, 'ex', '2026-08-11', '2026-10-21T10:00:00Z');
  await revise(b, 'retail', '2026-10-21', '2026-10-21T10:00:01Z');
  await sim.syncRound(); await sim.settle();
  for (const device of sim.devices) {
    const reopened = createLocalDb(device.db.file); reopened.setSharedOwnerResolver(ownerOf);
    const record = (await reopened.read()).records[ID];
    assert.deepEqual(record.dates, { ex: '2026-08-11', retail: '2026-10-21', mb: '2026-09-23' });
    assert.ok(record._subfieldWriters && record._subfieldWriters.dates && record._subfieldWriters.dates.ex, 'alt alan saati kalıcı');
  }
});

test('paket birleştirme alt alan bildirimlerini birleştirir; bütün yazım bildirimi düşürür', () => {
  const base = { entityType: 'cp-order', id: ID, userId: 'owner', origin: 'local', deviceId: 'D' };
  const hinted = coalescePendingEvents([
    { ...base, eventId: 'e1', localSequence: 1, patch: { dates: { ex: '2026-08-02' } }, subfields: { dates: ['ex'] } },
    { ...base, eventId: 'e2', localSequence: 2, patch: { dates: { ex: '2026-08-02', mb: '2026-09-02' } }, subfields: { dates: ['mb'] } },
  ]);
  assert.equal(hinted.length, 1); assert.deepEqual(hinted[0].subfields, { dates: ['ex', 'mb'] });
  const mixed = coalescePendingEvents([
    { ...base, eventId: 'e3', localSequence: 3, patch: { dates: { ex: '2026-08-03' } } },
    { ...base, eventId: 'e4', localSequence: 4, patch: { dates: { ex: '2026-08-03', mb: '2026-09-03' } }, subfields: { dates: ['mb'] } },
  ]);
  assert.equal(mixed.length, 1); assert.equal(mixed[0].subfields, undefined);
  const other = coalescePendingEvents([
    { ...base, eventId: 'e5', localSequence: 5, patch: { suppFob: 1 } },
    { ...base, eventId: 'e6', localSequence: 6, patch: { dates: { retail: '2026-10-05' } }, subfields: { dates: ['retail'] } },
  ]);
  assert.deepEqual(other[0].subfields, { dates: ['retail'] });
});

test('CP tarih patch\'i yazılan alt alanları bildirir; biçimsiz değer bildirilmez', () => {
  assert.deepEqual(cpSharedStore.subfieldsFromOrderPatch({ dates: { exFactory: '2026-08-01' } }), { dates: ['ex'] });
  assert.deepEqual(cpSharedStore.subfieldsFromOrderPatch({ dates: { retailDate: null, inStoreDate: '2026-09-01' } }), { dates: ['retail', 'mb'] });
  assert.equal(cpSharedStore.subfieldsFromOrderPatch({ dates: { exFactory: '01.08.2026' } }), null);
  assert.equal(cpSharedStore.subfieldsFromOrderPatch({ notes: { Notes: 'x' } }), null);
});

test('delta-store aynası bildirimi taşır; no-op ile düşen tarih alanının bildirimi geçersizdir', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-date-subfields-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const db = createLocalDb(path.join(root, 'db')); await db.ensure();
  const store = createDeltaStore({ localDb: db, mode: 'delta' }); await store.hydrate();
  await store.mirror('cp-order', { 1001: { dates: { ex: '2026-08-01' } } }, { userId: 'owner', subfields: { dates: ['ex'] } });
  await store.mirror('cp-order', { 1001: { dates: { ex: '2026-08-01' }, subManufacturer: 'SUB' } }, { userId: 'owner', subfields: { dates: ['ex'] } });
  const events = await db.pending(10);
  assert.deepEqual(events[0].subfields, { dates: ['ex'] });
  assert.deepEqual(events[1].patch, { subManufacturer: 'SUB' });
  assert.equal(events[1].subfields, undefined);
});

test('birleşen revizyonlar CP/Orders/Backlog tarih projeksiyonuna aynen yansır', async t => {
  const sim = await simulation(t, { devices: 2, seed: 7300 });
  await seedBase(sim);
  const [a, b] = sim.devices;
  await revise(a, 'ex', '2026-08-18', '2026-10-21T10:00:00Z');
  await revise(b, 'mb', '2026-09-28', '2026-10-21T10:00:01Z');
  await sim.syncRound(); await sim.settle();
  const iso = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  for (const device of sim.devices) {
    const dates = (await device.db.read()).records[ID].dates;
    const [order] = parse.applyDateOverrides([{ ocode: 1001, ex: new Date(2026, 7, 1), retail: new Date(2026, 9, 7), mb: new Date(2026, 8, 23) }], { datemap: { 1001: dates } });
    assert.equal(iso(order.ex), '2026-08-18'); assert.equal(iso(order.retail), '2026-10-07'); assert.equal(iso(order.mb), '2026-09-28');
    assert.equal(iso(order._asasEx), '2026-08-01', 'ASAS orijinali Backlog karşılaştırması için korunur');
  }
});

/* Uçtan uca: gerçek CP kayıt yolu (db.patchOrderOverride) → ortak kayıt →
   başka cihazdan gelen alt alan revizyonu → overrides.datemap projeksiyonu. */
const DATA_ROOT_VARS = ['BUYER_LOG_SERVER_DATA_ROOT', 'BUYER_LOG_DATA_ROOT', 'BUYER_LOG_LOCAL_DATA_ROOT'];
function resetServerModules() {
  const root = path.join(__dirname, '..', 'server') + path.sep;
  for (const key of Object.keys(require.cache)) if (key.startsWith(root)) delete require.cache[key];
}
test('CP kaydı yalnız yazılan tarihi bildirir; eşin eşzamanlı revizyonu datemap\'te ikisini birden gösterir', async t => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'bl-date-e2e-'));
  const previous = DATA_ROOT_VARS.map(name => [name, process.env[name]]);
  t.after(async () => {
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    resetServerModules();
    await new Promise(done => setTimeout(done, 30));
    await fsp.rm(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 50 });
  });
  const dataDir = path.join(root, 'server-data'); await fsp.mkdir(dataDir, { recursive: true });
  Object.assign(process.env, { BUYER_LOG_SERVER_DATA_ROOT: dataDir, BUYER_LOG_DATA_ROOT: path.join(root, 'app'), BUYER_LOG_LOCAL_DATA_ROOT: path.join(root, 'local') });
  resetServerModules();
  const db = require('../server/db');
  const { createLocalDb: createDb } = require('../server/lib/local-db');
  const { createDeltaStore: createStore } = require('../server/lib/delta-store');
  const localDb = createDb(path.join(root, 'local', 'BuyerLogLocal.db')); await localDb.ensure();
  localDb.setSharedOwnerResolver(ownerOf);
  const store = createStore({ localDb, mode: 'delta' }); await store.hydrate();
  db.attachDeltaStore(store); t.after(() => db.attachDeltaStore(null));

  db.patchOrderOverride(1001, { dates: { exFactory: '2026-08-01', retailDate: '2026-10-07', inStoreDate: '2026-09-23' } }, null, null, { actor: { id: 'owner' } });
  await store.flush();
  db.patchOrderOverride(1001, { dates: { retailDate: '2026-10-20' } }, null, null, { actor: { id: 'owner' } });
  await store.flush();
  const events = await localDb.pending(10);
  assert.deepEqual(events.at(-1).subfields, { dates: ['retail'] });
  assert.deepEqual(events.at(-1).patch.dates, { ex: '2026-08-01', retail: '2026-10-20', mb: '2026-09-23' });

  // Başka cihaz, Retail revizyonunu görmeden Ex-Factory'yi revize etti (eski Retail'i taşır).
  const remote = createDb(path.join(root, 'peer', 'BuyerLogLocal.db')); await remote.ensure();
  remote.setSharedOwnerResolver(ownerOf);
  await remote.applyDelta(events[0]);
  await remote.queuePatch({ id: ID, patch: { dates: { ex: '2026-08-25', retail: '2026-10-07', mb: '2026-09-23' } }, userId: 'owner', subfields: { dates: ['ex'] } });
  const [peerEvent] = (await remote.pending(10)).filter(event => event.subfields && event.subfields.dates.includes('ex') && event.patch.dates.ex === '2026-08-25');
  await localDb.applyDelta(peerEvent);
  await store.hydrate();
  assert.deepEqual(db.loadOverrides().datemap['1001'], { ex: '2026-08-25', retail: '2026-10-20', mb: '2026-09-23' });
  assert.equal((await localDb.read()).conflicts.filter(item => !item.resolved).length, 0);
});
