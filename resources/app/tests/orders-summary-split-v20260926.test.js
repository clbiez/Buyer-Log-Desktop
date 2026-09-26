'use strict';

/* Siparişler ilk girişi (30k satır) ~4 sn sürüyordu: orders projeksiyonu
   ~100MB idi ve bunun ~36MB'ı istemcinin Siparişler ekranında hiç okumadığı
   orderSummary (CP tabanlı sipariş özeti) listesiydi. Tarayıcı her ilk girişte
   bu fazlalığı indirip JSON.parse ediyordu.

   Çözüm: sipariş özeti ayrı 'order-summary' önbellek modülünde tutulur;
   orders projeksiyonu yalnız satırları taşır. Eski generation'larda gömülü
   orderSummary okunmaya devam eder (geriye dönük uyum); özet hiçbir yerde
   yoksa önbellek isabet sayılmaz (boş özetle yanlış veri sunulmaz). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'bl-order-summary-split-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = ROOT;
const pageCache = require('../server/lib/page-projection-cache');
const { runProjectionWorker } = require('../server/lib/projection-worker-client');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
test.after(() => fs.rmSync(ROOT, { recursive: true, force: true }));

function sourceRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    ocode: 5000 + index, mcode: `M${index}`, mname: `Model ${index}`, color: 'Siyah',
    season: 'SS27', qty: 100 + index, status: 'Açık',
  }));
}

test('işçi orders projeksiyonunda sipariş özetini taşımaz; özet ayrı modüldür', async () => {
  const rows = sourceRows(30);
  const result = await runProjectionWorker({ cpSource: rows, ordersSource: rows, cpAntrepo: {}, ordersAntrepo: {}, overrides: {}, cpModelColumns: [], shared: true, orderSummaryAllowed: true, editableOrderCodes: rows.map(row => row.ocode) });
  const orders = JSON.parse(zlib.gunzipSync(Buffer.from(result.compressed.orders.buffer)));
  assert.ok(Array.isArray(orders.rows));
  assert.equal(orders.orderSummary, undefined, 'Siparişler ekranı özet listesini indirmemeli');
  assert.ok(result.compressed['order-summary'], 'özet ayrı modül olarak üretilmeli');
  const summary = JSON.parse(zlib.gunzipSync(Buffer.from(result.compressed['order-summary'].buffer)));
  assert.ok(Array.isArray(summary.rows) && summary.rows.length > 0);
});

test('sayfa önbelleği order-summary modülünü yazar ve okur', async () => {
  await pageCache.writeGeneration('split-user', { contextHash: 'ctx', projections: { orders: { rows: [{ id: 1 }] }, 'order-summary': { rows: [{ id: 2 }] } } });
  const summary = await pageCache.readProjection('split-user', 'order-summary', 'ctx');
  assert.deepEqual(summary.data.rows, [{ id: 2 }]);
  const orders = await pageCache.readProjection('split-user', 'orders', 'ctx');
  assert.deepEqual(orders.data, { rows: [{ id: 1 }] });
});

test('sunucu özeti ayrı modülden, yoksa eski gömülü alandan okur; ikisi de yoksa isabet saymaz', () => {
  const start = SERVER.indexOf('function orderSummaryFromCache(');
  assert.ok(start > 0, 'orderSummaryFromCache yardımcı fonksiyonu olmalı');
  const body = SERVER.slice(start, SERVER.indexOf('\n}\n', start) + 2);
  const orderSummaryFromCache = new Function(`${body}; return orderSummaryFromCache;`)();
  assert.deepEqual(orderSummaryFromCache({ 'order-summary': { data: { rows: [{ a: 1 }] } }, orders: { data: { rows: [] } } }), [{ a: 1 }]);
  assert.deepEqual(orderSummaryFromCache({ orders: { data: { rows: [], orderSummary: [{ b: 2 }] } } }), [{ b: 2 }]);
  assert.equal(orderSummaryFromCache({ orders: { data: { rows: [] } } }), null);
  assert.match(SERVER, /orderSummary = orderSummaryFromCache\(cached\.byModule\)/);
  assert.match(SERVER, /if \(orderSummaryFromCache\(byModule\) === null\) return \{ ctx, hit: false, manifest \};/);
  assert.match(SERVER, /'order-summary': \{ rows: orderSummaryRows \}/);
  assert.match(SERVER, /projections\['order-summary'\] = \{ rows: orderSummary \|\| \[\] \};/);
  assert.match(SERVER, /storeOnDemandProjection\(req\.currentUser,ctx,'order-summary',\{rows:orderSummary\},active\)/);
});
