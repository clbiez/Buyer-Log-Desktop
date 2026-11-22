'use strict';

/* Buyer snapshot'ında orders/backlog/priceanalysis farklı dizi nesneleri olarak
   (ör. #1145 öncesi snapshot'tan yükle→yeniden kaydet ya da aynı ufka ayrı
   sorgular) bayt bayt aynı üç kopya yazılıyordu: kimlik tabanlı takma ad
   yalnız aynı nesneyi yakalıyordu. İçerikçe eşit hedefler bir kez saklanmalı,
   yükleme sonrası anlam aynı kalmalı. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-content-alias-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
const snapshots = require('../server/lib/model-snapshot');

test.after(() => fs.rmSync(root, { recursive:true, force:true }));

function rows(count = 200, model = 'MODEL-A') {
  return Array.from({ length:count }, (_, index) => ({
    ocode:index + 1, model, qty:index * 3, note:null, flag:index % 2 === 0,
    _sourceFields:{ 'Sipariş Kod':String(index + 1), Sezon:'26Y' }, // i18n-ignore
  }));
}
const clone = value => JSON.parse(JSON.stringify(value));

test('equal-length target arrays whose elements are the same references are aliased', () => {
  const cp = rows(50, 'CP');
  const base = rows();
  const { value, aliasCount } = snapshots.compactSnapshotPayload({
    asasOrders:cp,
    asasOrdersByTarget:{ cp, orders:base, backlog:base.slice(), priceanalysis:base.filter(() => true) },
  });
  assert.equal(aliasCount, 3);
  assert.deepEqual(value.targetAliases.asasOrdersByTarget, { cp:'asasOrders', backlog:'orders', priceanalysis:'orders' });
  assert.deepEqual(Object.keys(value.asasOrdersByTarget), ['orders']);
});

test('content-equal target arrays from separate parses (legacy reload) are stored once and share identity after load', async () => {
  const cp = rows(40, 'CP');
  const orders = rows();
  const payload = {
    loadedAt:'2026-11-22T10:00:00.000Z', asasOrders:cp,
    asasOrdersByTarget:{ cp, orders, backlog:clone(orders), priceanalysis:clone(orders) },
    antrepoMap:{}, antrepoMapByTarget:{},
  };
  const saved = await snapshots.saveModelSnapshotAsync('buyer-content', payload);
  assert.equal(saved.aliasCount, 3);

  const loaded = await snapshots.loadModelSnapshotAsync('buyer-content');
  const byTarget = loaded.asasOrdersByTarget;
  assert.equal(byTarget.cp, loaded.asasOrders);
  assert.equal(byTarget.backlog, byTarget.orders);
  assert.equal(byTarget.priceanalysis, byTarget.orders);
  assert.deepEqual(clone(byTarget.backlog), clone(orders));
  assert.deepEqual(clone(byTarget.cp), clone(cp));
  assert.deepEqual(Object.keys(byTarget).sort(), ['backlog', 'cp', 'orders', 'priceanalysis']);
});

test('targets that differ in any value, key order or length are kept separately', () => {
  const orders = rows();
  const changedLast = clone(orders); changedLast[changedLast.length - 1].qty += 1;
  const reordered = clone(orders).map(({ model, ...rest }) => ({ ...rest, model }));
  const shorter = clone(orders).slice(1);
  const nested = clone(orders); nested[7]._sourceFields.Sezon = '27K'; // i18n-ignore
  const { value, aliasCount } = snapshots.compactSnapshotPayload({
    asasOrders:[], asasOrdersByTarget:{ orders, backlog:changedLast, priceanalysis:reordered, cp:shorter, lfl:nested },
  });
  assert.equal(aliasCount, 0);
  assert.equal(value.targetAliases, undefined);
  assert.equal(value.asasOrdersByTarget.backlog, changedLast);
});

test('Date and string values with the same JSON text are not treated as equal', () => {
  const a = [{ ocode:1, date:new Date('2026-08-30T00:00:00.000Z') }];
  const b = [{ ocode:1, date:'2026-08-30T00:00:00.000Z' }];
  const { aliasCount } = snapshots.compactSnapshotPayload({ asasOrders:[], asasOrdersByTarget:{ orders:a, backlog:b } });
  assert.equal(aliasCount, 0);
});

test('content-equal antrepo maps are aliased, including to the base map', () => {
  const map = Object.fromEntries(rows(30).map(row => [String(row.ocode), { qty:row.qty, date:'2026-08-30' }]));
  const { value, aliasCount } = snapshots.compactSnapshotPayload({
    antrepoMap:map, antrepoMapByTarget:{ cp:clone(map), orders:clone(map), backlog:{ ...clone(map), extra:{ qty:1 } } },
  });
  assert.equal(aliasCount, 2);
  assert.deepEqual(value.targetAliases.antrepoMapByTarget, { cp:'antrepoMap', orders:'antrepoMap' });
  const expanded = snapshots.expandSnapshotPayload(value);
  assert.equal(expanded.antrepoMapByTarget.orders, expanded.antrepoMap);
  assert.ok(expanded.antrepoMapByTarget.backlog.extra);
});
