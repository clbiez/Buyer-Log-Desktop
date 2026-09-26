'use strict';

/* Çok cihazlı gerçek kullanım senaryosunda bulunan veri kaybı riski:
   fiyat talepleri (quotations.requests) ve e-posta grupları (records) tek bir
   paylaşımlı belge alanında dizi olarak tutuluyor. İki kullanıcı aynı senkron
   aralığında AYRI kayıt eklediğinde alan çakışması oluşuyor, yeni kayıt karşı
   cihaza hiç ulaşmıyor ve çakışma çözümü iki taraftan birini kaybettiriyordu.
   Bu listeler artık kayıt kimliğiyle birleştirilir (aynı kayıtta en yeni
   updatedAt kazanır); e-posta kaydı silmesi silindi işaretiyle korunur. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLocalDb } = require('../server/lib/local-db');

async function devices(t, names) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-list-merge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const out = {};
  for (const name of names) out[name] = createLocalDb(path.join(root, name, 'BuyerLogLocal.db'));
  return out;
}
async function sync(devs) {
  const outgoing = [];
  for (const [name, db] of Object.entries(devs)) {
    const state = await db.read();
    for (const item of await db.pending()) outgoing.push({ from: name, delta: { id: item.id, eventId: item.eventId, patch: item.patch, revision: item.revision, baseRevision: item.baseRevision, deviceId: state.deviceId } });
    await db.markSynced((await db.pending()).map(item => item.eventId));
  }
  for (const { from, delta } of outgoing) for (const [name, db] of Object.entries(devs)) if (name !== from) await db.applyDelta(delta);
}
const field = async (db, id, key) => ((await db.read()).records[id] || {})[key];

test('Eşzamanlı eklenen fiyat talepleri her iki cihazda da birleşir; çakışma açılmaz', async t => {
  const devs = await devices(t, ['a', 'b']), id = 'store:quotations.json';
  const q = (qid, at, note = '') => ({ id: qid, updatedAt: at, note });
  await devs.a.queuePatch({ id, patch: { requests: [q('q0', '2026-09-26T00:00:00.000Z')] } });
  await sync(devs);
  await devs.a.queuePatch({ id, patch: { requests: [q('qa', '2026-09-26T00:01:00.000Z'), q('q0', '2026-09-26T00:00:00.000Z')] } });
  await devs.b.queuePatch({ id, patch: { requests: [q('qb', '2026-09-26T00:02:00.000Z'), q('q0', '2026-09-26T00:03:00.000Z', 'B düzenledi')] } });
  await sync(devs);
  for (const name of ['a', 'b']) {
    const list = await field(devs[name], id, 'requests');
    assert.deepEqual(list.map(item => item.id).sort(), ['q0', 'qa', 'qb'], `${name}: iki yeni talep de var`);
    assert.equal(list.find(item => item.id === 'q0').note, 'B düzenledi', `${name}: aynı kayıtta en yeni sürüm kazanır`);
    assert.deepEqual((await devs[name].listConflicts()).filter(item => !item.resolved), [], `${name}: çakışma yok`);
  }
});

test('E-posta kaydı silmesi eşzamanlı eklemeyle birleşir ve silinen kayıt geri gelmez', async t => {
  const devs = await devices(t, ['a', 'b']), id = 'store:email-groups.json';
  const r = (rid, at) => ({ id: rid, manufacturer: rid, updatedAt: at });
  await devs.a.queuePatch({ id, patch: { records: [r('r1', '2026-09-26T00:00:00.000Z')], deletedRecords: {} } });
  await sync(devs);
  await devs.a.queuePatch({ id, patch: { records: [], deletedRecords: { r1: '2026-09-26T00:05:00.000Z' } } });
  await devs.b.queuePatch({ id, patch: { records: [r('r1', '2026-09-26T00:00:00.000Z'), r('r2', '2026-09-26T00:04:00.000Z')] } });
  await sync(devs);
  for (const name of ['a', 'b']) {
    assert.deepEqual((await field(devs[name], id, 'records')).map(item => item.id), ['r2'], `${name}: r1 silinmiş, r2 eklenmiş`);
    assert.deepEqual((await devs[name].listConflicts()).filter(item => !item.resolved), [], `${name}: çakışma yok`);
  }
});

test('Çakışma algılanmasa bile (uzak sayaç ileride) uzak liste yerel yeni kaydı silmez', async t => {
  // 5 kullanıcılı paralel senaryoda bulundu: cihaz sayaçları bağımsız ilerlediği
  // için yerel kaydı hiç görmemiş cihazın yüksek tabanlı olayı "sıralı düzenleme"
  // sanılıyor, liste bütün olarak yazılıyor ve yerel yeni fiyat talebi sessizce
  // kayboluyordu (çakışma kaydı da açılmıyordu).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-list-race-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createLocalDb(path.join(dir, 'L.db'));
  await db.queuePatch({ id: 'store:quotations.json', patch: { requests: [{ id: 'q0', updatedAt: '1' }] } });
  await db.queuePatch({ id: 'store:quotations.json', patch: { requests: [{ id: 'q0', updatedAt: '1' }, { id: 'q-yerel', updatedAt: '3' }] } });
  await db.applyDelta({ id: 'store:quotations.json', patch: { requests: [{ id: 'q0', updatedAt: '1' }, { id: 'q-uzak', updatedAt: '2' }] }, revision: 41, baseRevision: 40, deviceId: 'X', eventId: 'x1', localSequence: 1 });
  const state = await db.read();
  assert.deepEqual(state.records['store:quotations.json'].requests.map(item => item.id).sort(), ['q-uzak', 'q-yerel', 'q0']);
  assert.equal(state.conflicts.length, 0);
});

test('Saklama süresi dolan fiyat talebi silme izi bırakır; eski uzak kopya onu geri getirmez', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-list-tomb-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const db = createLocalDb(path.join(dir, 'L.db'));
  await db.queuePatch({ id: 'store:quotations.json', patch: { requests: [{ id: 'q-yeni', updatedAt: '5' }], deletedRequests: { 'q-eski': '9' } } });
  await db.applyDelta({ id: 'store:quotations.json', patch: { requests: [{ id: 'q-eski', updatedAt: '1' }, { id: 'q-yeni', updatedAt: '5' }] }, revision: 50, baseRevision: 49, deviceId: 'Y', eventId: 'y1', localSequence: 1 });
  const record = (await db.read()).records['store:quotations.json'];
  assert.deepEqual(record.requests.map(item => item.id), ['q-yeni']);
  const store = require('../server/lib/quotations-store');
  assert.match(fs.readFileSync(require.resolve('../server/lib/quotations-store'), 'utf8'), /deletedRequests\[request\.id\] = stamp|deletedRequests\[id\] = stamp/);
  assert.equal(typeof store.cleanupExpired, 'function');
});
