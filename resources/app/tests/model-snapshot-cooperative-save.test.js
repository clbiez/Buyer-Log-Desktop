'use strict';

// Büyük model snapshot'ı kaydedilirken JSON serileştirme ana thread'i tek
// parça kilitlemez: parça parça üretilir ve olay döngüsüne düzenli söz verilir.
// Üretilen baytlar senkron yolla birebir aynı kalmalıdır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buyerlog-coop-save-'));
process.env.BUYER_LOG_LOCAL_DATA_ROOT = root;
const { jsonToBuffer, jsonToBufferAsync } = require('../server/lib/large-json');
const snapshots = require('../server/lib/model-snapshot');

test.after(() => fs.rmSync(root, { recursive:true, force:true }));
const yieldControl = () => new Promise(resolve => setImmediate(resolve));

function payload(rowCount) {
  const orders = Array.from({ length:rowCount }, (_, index) => ({
    ocode:index + 1, model:`MODEL-${index % 97}`, text:'Türkçe \\" \n {}[] 💙 ' + 'x'.repeat(index % 40),
    shipDate:new Date(Date.UTC(2026, index % 12, 1 + (index % 27))), missing:undefined, fn() {}, nested:{ values:[null, false, 0, -1.25, {}, []] },
  }));
  const antrepo = Object.fromEntries(orders.slice(0, 500).map(row => [String(row.ocode), { qty:row.ocode, date:'2026-08-30T21:00:00.000Z' }]));
  return {
    loadedAt:'2026-08-30T10:00:00.000Z', asasOrders:orders,
    asasOrdersByTarget:{ cp:orders, orders, backlog:orders.slice(0, 100) },
    antrepoMap:antrepo, antrepoMapByTarget:{ cp:antrepo, orders:antrepo, backlog:antrepo },
    lflRows:[{ id:1, toJSON() { return { custom:true }; } }], sources:{ asas:'Excel: ASAS.xlsx' },
  };
}

test('jsonToBufferAsync, jsonToBuffer ile bayt bayt aynıdır ve büyük girdide olay döngüsüne söz verir', async () => {
  const value = payload(20000);
  let yields = 0;
  const actual = await jsonToBufferAsync(value, { yieldControl:async () => { yields += 1; await yieldControl(); } });
  assert.ok(actual.equals(jsonToBuffer(value)));
  assert.ok(actual.equals(Buffer.from(JSON.stringify(value), 'utf8')));
  assert.ok(yields > 0, 'large serialization must yield');
  for (const small of [null, 0, 'a', [], {}, { a:undefined }, [undefined, () => 1], { d:new Date(0) }]) {
    assert.ok((await jsonToBufferAsync(small, { yieldControl })).equals(jsonToBuffer(small)));
  }
  assert.equal((await jsonToBufferAsync(undefined, { yieldControl })).length, 0);
  await assert.rejects(jsonToBufferAsync(value, { yieldControl:async () => { throw Object.assign(Error('stop'), { code:'STOP' }); } }), { code:'STOP' });
  await assert.rejects(jsonToBufferAsync(value, {}), TypeError);
});

test('saveModelSnapshotAsync serileştirme sırasında olay döngüsünü bırakır; dosya senkron kayıtla aynı baytlardır', async () => {
  const value = payload(60000);
  const sync = snapshots.saveModelSnapshot('sync-user', value);
  const syncRaw = zlib.gunzipSync(fs.readFileSync(sync.file));
  let ticks = 0, maxGap = 0, last = performance.now(), running = true;
  const probe = () => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; ticks += 1; if (running) setImmediate(probe); };
  setImmediate(probe);
  const saved = await snapshots.saveModelSnapshotAsync('async-user', value);
  running = false;
  const asyncRaw = zlib.gunzipSync(fs.readFileSync(saved.file));
  // savedAt dışında gövde aynıdır; checksum gövdeye bağlı olduğundan savedAt eşitlenip karşılaştırılır.
  const normalize = raw => raw.toString('utf8').replace(/"savedAt":"[^"]+"/, '"savedAt":"X"').replace(/"checksum":"[0-9a-f]{64}"/, '"checksum":"X"');
  assert.equal(normalize(asyncRaw), normalize(syncRaw));
  assert.equal(asyncRaw.toString('utf8').match(/"contentKey":"([0-9a-f]{64})"/)[1], syncRaw.toString('utf8').match(/"contentKey":"([0-9a-f]{64})"/)[1]);
  const withoutSavedAt = value => { const copy = { ...value }; delete copy.savedAt; return copy; };
  assert.deepEqual(withoutSavedAt(snapshots.loadModelSnapshot('async-user')), withoutSavedAt(snapshots.loadModelSnapshot('sync-user')));
  // Senkron serileştirmede bu veri ~0,7 sn tek blok (main); kooperatif yolda boşluk ~8 ms dilimlere iner.
  assert.ok(ticks > 20 && maxGap < 300, `serialization must let the event loop run (ticks=${ticks}, maxGap=${Math.round(maxGap)}ms)`);
  // Aynı içerik ikinci kayıtta yeniden kullanılır (contentKey sözleşmesi korunur).
  assert.equal((await snapshots.saveModelSnapshotAsync('async-user', value)).reused, true);
});
