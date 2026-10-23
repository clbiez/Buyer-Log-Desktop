'use strict';

/* FİYAT DEFTERİ (v2026-10-22).

   Kök sorunlar:
   1) Fiyat değişikliği satırın son hâlinin üstüne yazılıyordu; pazarlık turları
      ve kimin ne zaman hangi fiyatı girdiği kayboluyordu.
   2) Tek bir fiyat girişi bütün talebi PUT ile yeniden gönderiyordu; aynı
      talepte farklı satırları düzenleyen iki kişiden eski kopyayla kaydeden,
      diğerinin fiyatını sessizce siliyordu.
   3) Cihazlar arası senkronda aynı talebin iki kopyasından en yenisi BÜTÜN
      OLARAK kazanıyor, diğer cihazdaki satır değişikliği kayboluyordu.

   Bu testler satır olay defterini, satır PATCH'ini, eski-revizyon korumasını,
   pazarlık turlarını ve satır bazlı cihaz birleşimini korur. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-pricing-ledger-'));
process.env.BUYER_LOG_SERVER_DATA_ROOT = path.join(tmpRoot, 'server-data');
test.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

const store = require(path.join(ROOT, 'server', 'lib', 'quotations-store.js'));
const ledger = require(path.join(ROOT, 'server', 'lib', 'quotation-ledger.js'));
const { createLocalDb } = require(path.join(ROOT, 'server', 'lib', 'local-db.js'));

const owner = { id: 'owner-1', role: 'user', displayName: 'Owner' };
const editor = { id: 'editor-1', role: 'user', displayName: 'Editor' };
const viewer = { id: 'viewer-1', role: 'user', displayName: 'Viewer' };

function makeRequest(items) {
  const request = store.createRequest(owner, { source: 'collection', manufacturers: [{ name: 'A' }, { name: 'B' }], items });
  store.setEditors(owner, request.id, [editor.id], [owner.id, editor.id, viewer.id]);
  return store.loadStore().requests.find(item => item.id === request.id);
}
const line = (req, id) => store.loadStore().requests.find(item => item.id === req.id).items.find(item => item.id === id);

test('yeni talepteki ilk fiyat deftere ilk teklif olayı olarak yazılır', () => {
  const req = makeRequest([{ id: 'l1', modelKey: 'M1', manufacturer: 'A', price: '9,40' }, { id: 'l2', modelKey: 'M1', manufacturer: 'B' }]);
  const first = req.items.find(item => item.id === 'l1'), empty = req.items.find(item => item.id === 'l2');
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].type, 'offer');
  assert.equal(first.history[0].price, '9,40');
  assert.equal(first.history[0].by, owner.id);
  assert.equal(first.history[0].round, 1);
  assert.equal(first.rev, 1);
  assert.deepEqual(empty.history, [], 'fiyatsız satırın defteri boş başlar');
  assert.equal(empty.rev, 0);
});

test('satır PATCH yalnız değişen alanı deftere ekler; aynı fiyat olay üretmez', () => {
  const req = makeRequest([{ id: 'p1', modelKey: 'M2', manufacturer: 'A', price: '9,80' }]);
  const changed = store.patchLine(editor, req.id, 'p1', { price: '9,45', baseRev: 1 });
  assert.equal(changed.changed, true);
  assert.equal(changed.conflict, false);
  let current = line(req, 'p1');
  assert.equal(current.price, '9,45');
  assert.equal(current.rev, 2);
  assert.deepEqual(current.history.map(event => [event.type, event.price, event.by]), [['offer', '9,80', owner.id], ['offer', '9,45', editor.id]]);
  const same = store.patchLine(editor, req.id, 'p1', { price: '9.45' });
  assert.equal(same.changed, false, '9,45 ile 9.45 aynı fiyattır');
  current = line(req, 'p1');
  assert.equal(current.history.length, 2);
  const stale = store.patchLine(owner, req.id, 'p1', { price: '9,30', baseRev: 1 });
  assert.equal(stale.conflict, true, 'eski revizyona dayanan yazım çakışma olarak bildirilir');
  assert.equal(line(req, 'p1').history.length, 3, 'önceki değer defterde kalır, yeni değer yazılır');
});

test('görüntüleme yetkisi olan kullanıcı satır PATCH yapamaz', () => {
  const req = makeRequest([{ id: 'v1', modelKey: 'M3', manufacturer: 'A', price: '5,00' }]);
  assert.throws(() => store.patchLine(viewer, req.id, 'v1', { price: '4,00' }), /QUOTATION_EDIT_DENIED|yetkiniz/);
  assert.equal(line(req, 'v1').price, '5,00');
});

test('onay geçerli fiyat ister ve aynı modeldeki diğer onayları defterli olarak kaldırır', () => {
  const first = makeRequest([{ id: 'a1', modelKey: 'M4', manufacturer: 'A', price: '8,00' }, { id: 'a2', modelKey: 'M4', manufacturer: 'B' }]);
  const second = makeRequest([{ id: 'a3', modelKey: 'M4', manufacturer: 'B', price: '7,90' }]);
  assert.throws(() => store.patchLine(owner, first.id, 'a2', { approved: true }), error => error.code === 'QUOTATION_PRICE_REQUIRED');
  store.patchLine(owner, first.id, 'a1', { approved: true });
  assert.equal(line(first, 'a1').approved, true);
  const result = store.patchLine(owner, second.id, 'a3', { approved: true });
  assert.deepEqual(result.affected.map(item => item.id), [first.id], 'kaldırılan onay başka talepteyse affected listesinde döner');
  assert.equal(line(first, 'a1').approved, false);
  assert.equal(line(second, 'a3').approved, true);
  const removed = line(first, 'a1').history.at(-1);
  assert.equal(removed.type, 'unapprove');
  assert.equal(removed.source, 'exclusive');
});

test('fiyat silinirse onay düşer ve iki olay da deftere yazılır', () => {
  const req = makeRequest([{ id: 'c1', modelKey: 'M5', manufacturer: 'A', price: '6,00' }]);
  store.patchLine(owner, req.id, 'c1', { approved: true });
  store.patchLine(owner, req.id, 'c1', { price: '' });
  const current = line(req, 'c1');
  assert.equal(current.approved, false);
  assert.deepEqual(current.history.slice(-2).map(event => event.type), ['offer', 'unapprove']);
  assert.equal(current.history.at(-2).price, '');
});

test('tam talep PUT eski satır revizyonuyla başka kullanıcının fiyatını ezmez; istemci defteri kabul edilmez', () => {
  const req = makeRequest([{ id: 's1', modelKey: 'M6', manufacturer: 'A', price: '10,00' }, { id: 's2', modelKey: 'M6', manufacturer: 'B', price: '11,00' }]);
  const staleCopy = JSON.parse(JSON.stringify(store.loadStore().requests.find(item => item.id === req.id)));
  store.patchLine(editor, req.id, 's1', { price: '9,50' });
  staleCopy.note = 'Kapasite notu';
  staleCopy.items.find(item => item.id === 's1').history = [{ id: 'forged', type: 'offer', price: '1,00', at: '2020-01-01T00:00:00.000Z', by: 'x' }];
  const saved = store.updateRequest(owner, req.id, staleCopy);
  assert.equal(saved.note, 'Kapasite notu');
  const s1 = saved.items.find(item => item.id === 's1');
  assert.equal(s1.price, '9,50', 'editörün fiyatı korunur');
  assert.ok(!s1.history.some(event => event.id === 'forged'), 'istemci defteri yok sayılır');
  const legacy = JSON.parse(JSON.stringify(saved));
  legacy.items.forEach(item => { delete item.rev; delete item.history; });
  legacy.items.find(item => item.id === 's2').price = '10,75';
  const legacySaved = store.updateRequest(owner, req.id, legacy);
  const s2 = legacySaved.items.find(item => item.id === 's2');
  assert.equal(s2.price, '10,75', 'rev göndermeyen eski istemci yazabilir');
  assert.equal(s2.history.at(-1).price, '10,75', 'eski istemcinin değişikliği de deftere girer');
  assert.equal(legacySaved.items.find(item => item.id === 's1').price, '9,50', 'değişmeyen satır olduğu gibi kalır');
});

test('yeni pazarlık turu sonraki teklifleri yeni tur numarasıyla kaydeder', () => {
  const req = makeRequest([{ id: 'r1', modelKey: 'M7', manufacturer: 'A', price: '9,10' }]);
  const round = store.startRound(owner, req.id, 'Karşı teklif 8,95');
  assert.equal(round.round, 2);
  assert.equal(round.rounds[0].n, 2);
  assert.equal(round.rounds[0].note, 'Karşı teklif 8,95');
  store.patchLine(owner, req.id, 'r1', { price: '8,95' });
  assert.deepEqual(line(req, 'r1').history.map(event => event.round), [1, 2]);
  assert.throws(() => store.startRound(viewer, req.id, ''), /QUOTATION_EDIT_DENIED|yetkiniz/);
});

test('talep birleştirme iki defteri ve turları korur', () => {
  const target = makeRequest([{ id: 'm1', modelKey: 'M8', manufacturer: 'A', price: '7,00' }]);
  const source = makeRequest([{ id: 'm2', modelKey: 'M8', manufacturer: 'A', price: '6,80' }]);
  store.startRound(owner, source.id, '');
  const merged = store.mergeRequests(owner, source.id, target.id).request;
  const item = merged.items.find(entry => entry.modelKey === 'M8');
  assert.equal(item.history.length, 2, 'iki kopyanın teklif olayı birleşir');
  assert.equal(merged.round, 2);
});

test('eski satır için defter okunurken tek legacy teklif türetilir, diske yazılmaz', () => {
  const history = ledger.effectiveHistory({ id: 'x', price: '9,00', approved: true, history: [] }, { createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-05T00:00:00.000Z', ownerId: 'o', ownerName: 'O' });
  assert.deepEqual(history.map(event => [event.type, event.source, event.at]), [['offer', 'legacy', '2026-01-02T00:00:00.000Z'], ['approve', 'legacy', '2026-01-05T00:00:00.000Z']]);
});

test('aynı talebin iki cihaz kopyası satır bazında birleşir; birleşim değişmelidir', () => {
  const base = { id: 'q1', updatedAt: '2026-10-22T10:00:00.000Z', note: '', items: [
    { id: 'i1', price: '10,00', approved: false, dropped: false, rev: 1, updatedAt: '2026-10-22T10:00:00.000Z', history: [{ id: 'e1', type: 'offer', price: '10,00', at: '2026-10-22T10:00:00.000Z', by: 'a', round: 1 }] },
    { id: 'i2', price: '12,00', approved: false, dropped: false, rev: 1, updatedAt: '2026-10-22T10:00:00.000Z', history: [{ id: 'e2', type: 'offer', price: '12,00', at: '2026-10-22T10:00:00.000Z', by: 'a', round: 1 }] },
  ] };
  const a = JSON.parse(JSON.stringify(base)), b = JSON.parse(JSON.stringify(base));
  a.updatedAt = '2026-10-22T10:05:00.000Z';
  Object.assign(a.items[0], { price: '9,50', rev: 2, updatedAt: '2026-10-22T10:05:00.000Z' });
  a.items[0].history.push({ id: 'ea', type: 'offer', price: '9,50', at: '2026-10-22T10:05:00.000Z', by: 'a', round: 1 });
  b.updatedAt = '2026-10-22T10:09:00.000Z'; b.note = 'B notu';
  Object.assign(b.items[1], { price: '11,40', rev: 2, updatedAt: '2026-10-22T10:09:00.000Z' });
  b.items[1].history.push({ id: 'eb', type: 'offer', price: '11,40', at: '2026-10-22T10:09:00.000Z', by: 'b', round: 1 });
  const ab = ledger.mergeRequestCopies(a, b), ba = ledger.mergeRequestCopies(b, a);
  assert.deepEqual(ab, ba, 'birleşim değişmeli');
  assert.equal(ab.note, 'B notu', 'talep alanları daha yeni kopyadan gelir');
  assert.equal(ab.items[0].price, '9,50', 'A cihazının satır 1 değişikliği korunur');
  assert.equal(ab.items[1].price, '11,40', 'B cihazının satır 2 değişikliği korunur');
  assert.deepEqual(ab.items[0].history.map(event => event.id), ['e1', 'ea']);
});

test('yerel veritabanı senkronu quotation satırlarını kaybetmeden birleştirir', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-ledger-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const devs = { a: createLocalDb(path.join(root, 'a', 'BuyerLogLocal.db')), b: createLocalDb(path.join(root, 'b', 'BuyerLogLocal.db')) };
  const sync = async () => {
    const outgoing = [];
    for (const [name, db] of Object.entries(devs)) {
      const state = await db.read();
      for (const item of await db.pending()) outgoing.push({ from: name, delta: { id: item.id, eventId: item.eventId, patch: item.patch, revision: item.revision, baseRevision: item.baseRevision, deviceId: state.deviceId } });
      await db.markSynced((await db.pending()).map(item => item.eventId));
    }
    for (const { from, delta } of outgoing) for (const [name, db] of Object.entries(devs)) if (name !== from) await db.applyDelta(delta);
  };
  const id = 'store:quotations.json';
  const item = (lid, price, at, events) => ({ id: lid, price, rev: events.length, updatedAt: at, history: events });
  const ev = (eid, price, at) => ({ id: eid, type: 'offer', price, at, by: 'u', round: 1 });
  const t0 = '2026-10-22T10:00:00.000Z';
  const base = { id: 'q1', updatedAt: t0, items: [item('i1', '10,00', t0, [ev('e1', '10,00', t0)]), item('i2', '12,00', t0, [ev('e2', '12,00', t0)])] };
  await devs.a.queuePatch({ id, patch: { requests: [base] } });
  await sync();
  const ta = '2026-10-22T10:05:00.000Z', tb = '2026-10-22T10:09:00.000Z';
  await devs.a.queuePatch({ id, patch: { requests: [{ ...base, updatedAt: ta, items: [item('i1', '9,50', ta, [ev('e1', '10,00', t0), ev('ea', '9,50', ta)]), base.items[1]] }] } });
  await devs.b.queuePatch({ id, patch: { requests: [{ ...base, updatedAt: tb, items: [base.items[0], item('i2', '11,40', tb, [ev('e2', '12,00', t0), ev('eb', '11,40', tb)])] }] } });
  await sync();
  for (const name of ['a', 'b']) {
    const request = ((await devs[name].read()).records[id] || {}).requests.find(entry => entry.id === 'q1');
    assert.equal(request.items.find(entry => entry.id === 'i1').price, '9,50', `${name}: A'nın satırı korunur`);
    assert.equal(request.items.find(entry => entry.id === 'i2').price, '11,40', `${name}: B'nin satırı korunur`);
  }
});
