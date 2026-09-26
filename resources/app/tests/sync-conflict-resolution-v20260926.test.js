'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan hata: aynı CP notuna iki
   cihaz eşzamanlı yazınca her cihazda çakışma kaydı açılıyor. Bir kullanıcı
   çakışmayı "benimkini koru" ile çözünce yalnız kendi kaydı işaretleniyordu;
   diğer cihazlar karşı değerde kalıyor (kalıcı ayrışma) ve oradaki çakışma
   sonsuza dek açık görünüyordu. Çözüm artık korunan değeri gelen revizyonu
   aşan tabanla yayar; alan daha yeni bir olayla çakışmasız güncellenince eski
   çakışma "superseded" olarak kapanır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');

async function devices(t, names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-conflict-resolution-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = {};
  for (const name of names) out[name] = createLocalDb(path.join(root, name, 'BuyerLogLocal.db'));
  return out;
}
// Hub taşıma bandının yaptığı gibi: gönderilmemiş yerel olayları diğer cihazlara uygular.
async function sync(devs) {
  const outgoing = [];
  for (const [name, db] of Object.entries(devs)) {
    const state = await db.read();
    for (const item of await db.pending()) outgoing.push({ from: name, delta: { id: item.id, eventId: item.eventId, patch: item.patch, revision: item.revision, baseRevision: item.baseRevision, deviceId: state.deviceId, origin: item.origin } });
    await db.markSynced((await db.pending()).map(item => item.eventId));
  }
  for (const { from, delta } of outgoing) for (const [name, db] of Object.entries(devs)) if (name !== from) await db.applyDelta(delta);
}
const notes = value => ({ notes: { Notes: value } });
const openConflicts = async db => (await db.listConflicts()).filter(item => !item.resolved);
const value = async (db, id) => ((await db.read()).records[id] || {}).notes;

for (const choice of ['current', 'incoming']) {
  test(`"${choice}" çözümünden sonra tüm cihazlar tek değere yakınsar ve çakışmalar kapanır`, async t => {
    const devs = await devices(t, ['a', 'b', 'c']), id = 'cp-order:4100003';
    await devs.a.queuePatch({ id, patch: notes('ortak') });
    await sync(devs);
    await devs.a.queuePatch({ id, patch: notes('A yazdı') });
    await devs.b.queuePatch({ id, patch: notes('B yazdı') });
    await sync(devs);
    const [conflict] = await openConflicts(devs.b);
    assert.ok(conflict, 'B cihazında çakışma açılır');
    await devs.b.resolveConflict(conflict.conflictId, choice);
    await sync(devs);
    await sync(devs);
    const winner = choice === 'current' ? { Notes: 'B yazdı' } : { Notes: 'A yazdı' };
    for (const name of ['a', 'b', 'c']) {
      assert.deepEqual(await value(devs[name], id), winner, `${name} cihazı B'nin seçimine yakınsar`);
      assert.deepEqual((await openConflicts(devs[name])).map(item => item.field), [], `${name} cihazında açık çakışma kalmaz`);
    }
  });
}
