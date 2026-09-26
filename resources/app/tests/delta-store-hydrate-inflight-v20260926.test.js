'use strict';

/* 5 kullanıcılı paralel senaryoda bulunan hata: fiyat talebi oluşturulduktan
   hemen sonra aynı cihazda "Quotation kaydı bulunamadı" (404) dönüyor, kayıt
   kalıcı olarak kayboluyordu.

   Sebep: kayıt belleğe hemen yazılır (stage), diske yazım (ayna) sırayla arka
   planda yürür. Arka plan senkronu bu arada hydrate() çağırırsa bellek diskten
   yeniden kuruluyor, henüz diske inmemiş kayıt bellekten düşüyordu; sonraki
   kayıt bu bayat bellekten hesaplandığı için kayıt kalıcı olarak siliniyordu.
   Artık yoldaki yazımlar hydrate sonrasında belleğe yeniden uygulanır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeltaStore } = require('../server/lib/delta-store');

test('hydrate, diske henüz inmemiş yazımı bellekten düşürmez', async () => {
  let releaseWrite;
  const diskRecords = { 'store:quotations.json': { requests: [{ id: 'q-eski' }], _revision: 1 } };
  const localDb = {
    read: async () => ({ records: JSON.parse(JSON.stringify(diskRecords)) }),
    queuePatches: items => new Promise(resolve => { releaseWrite = () => { for (const item of items) diskRecords[item.id] = { ...(diskRecords[item.id] || {}), ...item.patch }; resolve({ count: items.length }); }; }),
    transaction: async fn => fn({ migrations: {} }),
  };
  const store = createDeltaStore({ localDb, mode: 'delta' });
  await store.hydrate();
  const pending = store.mirror('store', { 'quotations.json': { requests: [{ id: 'q-eski' }, { id: 'q-yeni' }], _revision: 2 } });
  await new Promise(resolve => setImmediate(resolve));
  await store.hydrate(); // arka plan senkronu: disk henüz eski
  const mid = store.readAllSync('store')['quotations.json'];
  assert.deepEqual(mid.requests.map(item => item.id), ['q-eski', 'q-yeni'], 'yoldaki yazım bellekte kalmalı');
  releaseWrite();
  await pending;
  await store.hydrate();
  assert.deepEqual(store.readAllSync('store')['quotations.json'].requests.map(item => item.id), ['q-eski', 'q-yeni']);
});
