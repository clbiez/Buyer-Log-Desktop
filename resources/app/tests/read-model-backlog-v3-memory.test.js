'use strict';
/* WS6c (#1079) bellek kabulü: okuma modeli işçisinde tür başına tek Backlog veri kümesi,
 * boşta (IDLE_MS) bırakma ve önbellekten isteklerde de veri kümesi boyutuyla ölçeklenen
 * havuz tahmini (havuz tahmini aşan işi COMPUTE_ESTIMATE_EXCEEDED ile düşürür). */
const test = require('node:test'), assert = require('node:assert/strict'), zlib = require('node:zlib');
const model = require('../server/lib/read-model/backlog-v3-model');
const items = require('../server/lib/read-model/backlog-v3-items');
const register = require('../server/lib/read-model/backlog-v3-routes');

const row = (order, qty) => ({ 'Sipariş Kod': order, 'Model Adı': 'Demo ' + order, 'Renk Kod': '01', Buyer: 'A', 'GÜNCEL DURUM\n(STATUS)': 'Üretimde', Adet: qty });
const day = d => d.toISOString().slice(0, 10);
const v3Buffer = rows => zlib.gzipSync(JSON.stringify(items.build(rows, { today: '2026-01-15' }, day)));
const deliveryBuffer = rows => zlib.gzipSync(JSON.stringify(items.buildDelivery(rows, {}, day)));
const VIEW = { view: { today: '2026-01-15' } };
let collections = 0;
global.gc = () => { collections++; }; // boşta bırakma işçinin gc()'sini çağırır (gerçek yolda --expose-gc ile alınır)

test('tür başına tek veri kümesi; son istekten IDLE_MS sonra hepsi bırakılır', () => {
  const timers = [], original = global.setTimeout;
  global.setTimeout = (fn, ms) => { const t = original(() => {}, 0); timers.push({ fn, ms }); return t; };
  try {
    model._releaseAll();
    model.execute({ datasetKey: 'v3-a', buffer: v3Buffer([row('1', 1)]), request: VIEW });
    model.execute({ datasetKey: 'del-a', buffer: deliveryBuffer([row('1', 1)]), request: { panel: 'delivery', delivery: {} } });
    model.execute({ datasetKey: 'v3-b', buffer: v3Buffer([row('2', 2)]), request: VIEW });
    assert.deepEqual([...model._datasets.keys()].sort(), ['del-a', 'v3-b'], 'yeni Genel Bakış sorgusu eskisini düşürür; Teslimat Riski kalır');
    assert.equal(timers.at(-1).ms, model.IDLE_MS);
    assert.equal(model.IDLE_MS, 60000);
    const before = collections;
    timers.at(-1).fn();
    assert.equal(model._datasets.size, 0, 'boşta bırakılır');
    assert.equal(collections, before + 1, 'bırakılan veri kümesi beklemeden toplanır (RSS düşer)');
    model._releaseAll();
    assert.equal(collections, before + 1, 'boşken tekrar GC yok');
    // Bırakıldıktan sonra yük istenir (rota 'missing' yanıtında yükü yeniden gönderir).
    assert.deepEqual(model.execute({ datasetKey: 'v3-b', request: VIEW }), { missing: true });
  } finally { global.setTimeout = original; model._releaseAll(); }
});

test('rota: önbellekten istek de veri kümesi boyutuyla ölçeklenen bellek tahmini taşır', async () => {
  const buffer = v3Buffer([row('1', 1), row('2', 2)]), uncompressed = 9 * 1024 * 1024, calls = [];
  const app = { post: (path, ...handlers) => { if (path.endsWith('/v3')) app.handler = handlers[handlers.length - 1]; } };
  register(app, { userAccess: { requireArea: () => (_q, _s, next) => next() }, assertSourceFilters() {}, prepareComputeBacklog: async () => {},
    backlogReadConsumer: () => ({ signal: new AbortController().signal, dispose() {} }), apiError: (_res, error) => { throw error; }, sendComputedResponse: () => {},
    getComputeReads: () => ({ run: async () => ({ value: { buffer, uncompressedBytes: uncompressed }, release() {}, assertResponse() {} }) }),
    runReadModelCompute: async (task, payload, options) => { calls.push({ withBuffer: !!payload.buffer, estimated: options.estimatedBytes }); return { value: model.execute(payload), release() {} }; } });
  model._releaseAll();
  await app.handler({ body: { version: 1, query: {}, ...VIEW } }, {});
  await app.handler({ body: { version: 1, query: {}, ...VIEW } }, {});
  const MiB = 1024 * 1024;
  assert.deepEqual(calls.map(c => c.withBuffer), [true, false]);
  for (const call of calls) assert.equal(call.estimated, 96 * MiB + uncompressed * 16, 'ölçüm: 30k tamponsuz istek +131 MB tuttu (tahmin 96 MB idi)');
  model._releaseAll();
});

test('satır belleği süresi dolunca bırakılır ve işçide hemen toplanır; zamanlayıcı yoksa GC yok', () => {
  const tasks = require('../server/lib/compute-tasks');
  const timers = [], original = global.setTimeout;
  global.setTimeout = (fn, ms) => { const t = original(() => {}, 0); timers.push({ fn, ms }); return t; };
  try {
    tasks._clearRowsMemo();
    const source = { loadedAt: 'r1', asasOrders: [], asasOrdersByTarget: { backlog: [] }, antrepoMap: {}, antrepoMapByTarget: { backlog: {} }, lflRows: [] };
    tasks.buildBacklog('v3-items', source, { access: null, overrides: {}, horizons: {}, headers: [], sourceRevision: 'rev', rowsRevision: 'r', calendar: { configured: false }, options: {}, sourceColumns: [], today: '2026-01-15' });
    const before = collections;
    timers.at(-1).fn();
    assert.equal(collections, before + 1);
    timers.at(-1).fn();
    assert.equal(collections, before + 1, 'bellek boşken tekrar GC yok');
  } finally { global.setTimeout = original; tasks._clearRowsMemo(); }
});
