'use strict';
/*
 * Fiyat Masası'nda tablodan manuel üretici eklendiğinde matris yenilenmiyordu;
 * üretici ancak başka ekrana gidip dönünce görünüyordu.
 *
 * Kök neden: qHydrateShared(true) (canlı senkron refresh'i, kullanıcının kendi
 * kaydından doğan 'quotation' revizyonu dahil) qState'i YENİ talep nesneleriyle
 * değiştiriyordu. Görünen içerik imzası aynıysa masa yeniden çizilmiyor, matris
 * dinleyicileri artık depoda olmayan eski `req` nesnesini tutuyordu. Üretici o
 * eski nesneye ekleniyor (ve sunucuya gidiyor), qRenderDetail ise depodaki yeni
 * nesneyi çizdiği için tablo değişmemiş görünüyordu.
 *
 * Çözüm: qReplaceRequest ile aynı ilke — hydrate de mevcut talep nesnesini
 * yerinde günceller, kimlik korunur (bkz. quotations-drop-identity-v424).
 */
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/quotations.js'), 'utf8');

function slice(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start, `kaynak bloğu bulunamadı: ${startMarker}`);
  return source.slice(start, end);
}

function fixture(serverRequests) {
  const local = [{ id: 'q1', ownerId: 'u1', updatedAt: '1', manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'm1', manufacturer: 'A', price: '' }], stale: true }];
  const ctx = {
    qState: { version: 2, requests: local }, qHydrated: true, qProfiles: [],
    MIGRATION_KEY: 'mig', BLStorage: { getItem: () => '1', setItem() {} },
    qServerState: new Map(), qExpectedState: new Map(),
    qApi: async () => ({ profiles: [], requests: JSON.parse(JSON.stringify(serverRequests)) }),
    qNormalizeRequest: req => JSON.parse(JSON.stringify(req)),
    qTrackOwners: req => req, qRememberServerState() {}, qReapplyPendingLines: req => req,
    qPersistLocal() {}, qProjectForeignLineEdits() {}, qNotifyCollectionQuotes() {},
    qLang: tr => tr, showToast() {},
  };
  ctx.qLoad = () => ctx.qState;
  vm.createContext(ctx);
  vm.runInContext(`var qState=this.qState,qHydrated=this.qHydrated,qProfiles=this.qProfiles;
    function qLoad(){return qState;}
    ${slice('  function qMergeRequestInPlace(', '\n  function qReplaceRequest(')}
    ${slice('  async function qHydrateShared(', '\n  /* Koleksiyon')}
    this.hydrate=qHydrateShared;this.state=()=>qState;`, ctx);
  return ctx;
}
const server = [{ id: 'q1', ownerId: 'u1', updatedAt: '1', manufacturers: [{ name: 'A' }], items: [{ id: 'l1', modelKey: 'm1', manufacturer: 'A', price: '' }] }];

test('hydrate ekrandaki talep nesnesinin kimliğini korur', async () => {
  const f = fixture(server);
  const rendered = f.state().requests[0];
  await f.hydrate(true);
  assert.equal(f.state().requests[0], rendered, 'matris dinleyicilerinin kapattığı nesne depoda kalmalı');
  assert.equal('stale' in rendered, false, 'sunucuda olmayan alan temizlenir');
});

test('hydrate sonrası tablodan eklenen üretici depodaki aktif talepte görünür', async () => {
  const f = fixture(server);
  const rendered = f.state().requests[0];
  await f.hydrate(true);
  rendered.manufacturers.push({ name: 'Yeni Üretici' });
  rendered.items.push({ id: 'l2', modelKey: 'm1', manufacturer: 'Yeni Üretici', price: '' });
  const active = f.state().requests.find(req => req.id === 'q1');
  assert.deepEqual(active.manufacturers.map(m => m.name), ['A', 'Yeni Üretici']);
  assert.equal(active.items.length, 2);
});

test('sunucudan gelen yeni talep eklenir, sunucuda olmayan talep düşer', async () => {
  const f = fixture([...server, { id: 'q2', ownerId: 'u1', items: [] }]);
  await f.hydrate(true);
  assert.deepEqual(f.state().requests.map(req => req.id), ['q1', 'q2']);
  const g = fixture([]);
  await g.hydrate(true);
  assert.deepEqual(g.state().requests, []);
});
