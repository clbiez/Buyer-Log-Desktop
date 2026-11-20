'use strict';
/* WS6c (#1079): POST /api/read-model/backlog/v3 rota sözleşmesi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const express = require('express');
const source = require('./helpers/server-source')();
const captureBacklogRequest = require('./helpers/computed-backlog-request');
const register = require('../server/lib/read-model/backlog-v3-routes');
const model = require('../server/lib/read-model/backlog-v3-model');
const items = require('../server/lib/read-model/backlog-v3-items');
const { sendComputedResponse } = require('../server/lib/compute-response');

const QUERIES = [
  { format: 'json', lazyDimensions: '1', groupBy: 'status,antrepoDate', antrepoDateLevels: 'year,month,week,day' },
  { format: 'json', lazyDimensions: '1', retailFrom: '2026-01-01', retailTo: '2026-06-30', groupBy: 'season,antrepoDate', antrepoDateLevels: 'year,month', buyerGrup: 'G1,G2',
    dimFilters: JSON.stringify({ country: ['China'], antrepoDate: { granularity: 'month', values: ['2026-02'] } }), analysisFilters: JSON.stringify([{ id: 'cp:Buyer', rowKey: 'Buyer', values: ['A'] }]), sourceColumns: 'asas:1, ias:2', exFactoryFrom: '2026-02-01' },
  { format: 'json', dimFilters: '{bozuk' },
];

test('hesap parametreleri GET /api/backlog-export?format=json ile aynı satırları üretir (yalnız görev ve gün farklı)', async () => {
  for (const q of QUERIES) {
    const get = await captureBacklogRequest(q);
    let captured; const app = { handlers: {}, post: (path, ...handlers) => { app.handlers[path] = handlers[handlers.length - 1]; } };
    register(app, { userAccess: { requireArea: () => (_q, _s, next) => next() }, assertSourceFilters() {}, prepareComputeBacklog: async () => {},
      backlogReadConsumer: () => ({ signal: new AbortController().signal, dispose() {} }), apiError: (_res, error) => { throw error; },
      sendComputedResponse: () => {}, getComputeReads: () => ({ run: async (_req, area, task, parts, options) => { captured = { area, task, parts, cache: options.cache }; return { value: { buffer: zlib.gzipSync(JSON.stringify(task === 'backlog-delivery-items' ? items.buildDelivery([], {}, String) : items.build([], {}, String))), uncompressedBytes: 1 }, release() {}, assertResponse() {} }; } }),
      runReadModelCompute: async (task, payload) => ({ value: model.execute(payload), release() {} }) });
    for (const [path, task] of [['/api/read-model/backlog/v3', 'backlog-v3-items'], ['/api/read-model/backlog/delivery', 'backlog-delivery-items']]) {
      captured = null;
      await app.handlers[path]({ body: { version: 1, query: q, view: { today: '2026-01-15' } } }, {}).catch(() => {});
      assert.equal(get.task, 'backlog-export'); assert.equal(captured.task, task); assert.equal(captured.area, 'backlog'); assert.equal(captured.cache, true);
      const { today, ...parts } = JSON.parse(JSON.stringify(captured.parts));
      assert.equal(today, '2026-01-15', '"bugün" istemciden gelir (iki panel aynı satır belleği anahtarını kullanır)');
      assert.deepEqual(parts, JSON.parse(JSON.stringify(get.parts)));
    }
  }
});

test('istek doğrulama: sürüm zorunlu, bilinmeyen anahtar yok sayılır, nesne değer, geçersiz gün ve drill-down reddedilir', () => {
  assert.throws(() => register.normalizeRequest({ query: {} }), { code: 'READ_MODEL_QUERY_INVALID', statusCode: 400 });
  assert.throws(() => register.normalizeRequest({ version: 1, query: { dimFilters: { country: ['x'] } } }), { code: 'READ_MODEL_QUERY_INVALID' });
  assert.throws(() => register.normalizeRequest({ version: 1, view: { today: '15.01.2026' } }), { code: 'READ_MODEL_QUERY_INVALID' });
  assert.throws(() => register.normalizeRequest({ version: 1, drill: { k: 'eval' } }), { code: 'READ_MODEL_QUERY_INVALID' });
  assert.throws(() => register.normalizeRequest({ version: 1, drill: [] }), { code: 'READ_MODEL_QUERY_INVALID' });
  assert.deepEqual(register.normalizeRequest({ version: 1, query: { lazyDimensions: '1', format: 'json', groupBy: 'season', previewLimit: 5, projection: 'global-flow', hack: 'x' } }).query, { groupBy: 'season' });
});

test('kayıt server.js içinde global 100 MB JSON ayrıştırıcısından önce, ortak okuma modeli havuz girişiyle yapılır', () => {
  const at = source.indexOf("require('./lib/read-model/backlog-v3-routes')"), parser = source.indexOf("app.use(express.json({ limit: '100mb' }));");
  assert.ok(at > 0 && parser > at);
  const block = source.slice(at, parser);
  assert.match(block, /getComputeReads: \(\) => computeReads/, 'compute okuma servisi tembel alınmalı (TDZ)');
  assert.match(block, /runReadModelCompute: readModelPrewarm\.runCompute,/);
  assert.match(block, /assertSourceFilters, prepareComputeBacklog, backlogReadConsumer/);
});

// Gerçek görev yükü: üç Backlog satırı (iki buyer) → hesap işçisi kodlaması.
function itemsBuffer() {
  const row = (order, buyer, qty) => ({ 'Sipariş Kod': order, 'Model Adı': 'Demo ' + order, 'Renk Kod': '01', Buyer: buyer, 'GÜNCEL DURUM\n(STATUS)': 'Üretimde', Adet: qty, 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': '2026-01-10' });
  return zlib.gzipSync(JSON.stringify(items.build([row('101', 'A', 60), row('102', 'A', 40), row('103', 'B', 10)], { today: '2026-01-15' }, d => d.toISOString().slice(0, 10))));
}
async function serve(t, { stale = 0, drop = false } = {}) {
  const app = express(), buffer = itemsBuffer(), state = { runs: 0, computes: 0, withBuffer: 0, releases: 0, workerReleases: 0, stale };
  register(app, { userAccess: { requireArea: area => (req, res, next) => { assert.equal(area, 'backlog'); return req.headers['x-deny'] ? res.status(403).json({ code: 'ACCESS_AREA_REQUIRED' }) : next(); } },
    assertSourceFilters: (areas, req) => { if (req.headers['x-filter']) throw Object.assign(new Error('filter'), { code: 'SOURCE_FILTER_REQUIRED', statusCode: 409 }); },
    prepareComputeBacklog: async () => {}, backlogReadConsumer: () => ({ signal: new AbortController().signal, dispose() {} }),
    apiError: (res, error) => res.status(error.statusCode || 500).json({ code: error.code }), sendComputedResponse,
    getComputeReads: () => ({ run: async () => {
      state.runs++; const staleNow = state.stale > 0; if (staleNow) state.stale--;
      return { value: { buffer, uncompressedBytes: 1 }, release() { state.releases++; }, assertResponse() { if (staleNow) throw Object.assign(new Error('stale'), { code: 'COMPUTE_STALE_GENERATION', statusCode: 409 }); } };
    } }),
    runReadModelCompute: async (task, payload, options) => {
      assert.equal(task, 'read-model-backlog-v3'); assert.equal(options.ownerKey, 'read-model');
      state.computes++; if (payload.buffer) state.withBuffer++;
      // İşçi emekli edilmiş gibi: veri kümesi yok.
      if (drop) model._datasets.clear();
      return { value: model.execute(payload), release() { state.workerReleases++; } };
    } });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/read-model/backlog/v3`;
  const post = (body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { post, state };
}
const VIEW = { lang: 'tr', groupBy: 'buyer', timeField: 'exFactory', granularity: 'week', timelineDimension: 'buyingGroup', importanceScope: 'all', today: '2026-01-15' };

test('model ve drill-down: yalnız sonuç döner; yük işçiye bir kez gider, düşerse yeniden gönderilir', async t => {
  const { post, state } = await serve(t);
  const first = await post({ version: 1, query: {}, view: VIEW });
  assert.equal(first.status, 200); assert.equal(first.headers.get('cache-control'), 'no-store');
  const timing = JSON.parse(first.headers.get('x-read-model-timing'));
  assert.equal(timing.rows, 3); assert.ok(Number.isFinite(timing.itemsMs));
  const body = await first.json();
  assert.equal(body.kind, 'model'); assert.equal(body.model.total.qty, 110); assert.equal(body.model.total.overdueQty, 110);
  assert.deepEqual(body.model.group.groups.map(g => [g.name, g.qty]), [['A', 100], ['B', 10]]);
  assert.equal(/"(items|row|riskItems)":/.test(JSON.stringify(body)), false, 'model satır listesi taşımaz');
  const drill = await (await post({ version: 1, query: {}, view: VIEW, drill: { k: 'group', dim: 'buyer', name: 'A' } })).json();
  assert.equal(drill.kind, 'drill'); assert.equal(drill.count, 2); assert.deepEqual(drill.rows.map(r => r.orderCode), ['101', '102']);
  assert.equal(drill.identities.length, 2); assert.equal(drill.rows[0].row['Sipariş Kod'], '101'); assert.equal(drill.rows[0].row.Adet, undefined, 'satır yalnız kimlik anahtarlarını taşır');
  assert.equal(state.withBuffer, 1, 'aynı yük işçiye bir kez gönderilir'); assert.equal(state.computes, 2);
  assert.equal(state.releases, 2); assert.equal(state.workerReleases, 2);
});

test('işçi veri kümesini kaybederse yük yeniden gönderilir', async t => {
  const { post, state } = await serve(t, { drop: true });
  assert.equal((await post({ version: 1, query: {}, view: VIEW })).status, 200);
  assert.equal((await post({ version: 1, query: {}, view: VIEW })).status, 200);
  assert.equal(state.withBuffer, 2); assert.equal(state.computes, 3);
});

test('yetki, kaynak filtresi, gövde ve eski nesil', async t => {
  const { post, state } = await serve(t, { stale: 2 });
  assert.equal((await post({ version: 1, query: {}, view: VIEW }, { 'x-deny': '1' })).status, 403);
  assert.equal(state.runs, 0, 'yetkisiz istek hesap başlatmaz');
  assert.equal((await post({ version: 1, query: {}, view: VIEW }, { 'x-filter': '1' })).status, 409);
  assert.equal((await post('{bozuk')).status, 400);
  assert.equal((await post({ version: 2 })).status, 400);
  assert.equal((await post({ version: 1, view: VIEW, pad: 'x'.repeat(3 * 1024 * 1024) })).status, 413);
  // İki eski nesil yanıtı: üçüncü denemede başarılı, her kira bırakılır.
  const ok = await post({ version: 1, query: {}, view: VIEW });
  assert.equal(ok.status, 200); assert.equal(state.runs, 3); assert.equal(state.releases, 3);
});

test('Teslimat Riski: tarih sözlüğü, analiz ve drill-down tam satırları (satır sırası → backlog-rows)', async t => {
  const Engine = require('../public/backlog-delivery-engine.js');
  const row = (order, qty) => ({ 'Sipariş Kod': order, 'Model Adı': 'Demo ' + order, 'Renk Kod': '01', Buyer: 'A', 'GÜNCEL DURUM\n(STATUS)': 'Üretimde', Adet: qty,
    'Retail Depo Tarih Yıl Ay Gün': '2026-02-01', 'REVİZE YÜKLEME TARİHİ\n(EX-FACTORY)': '2026-01-10', Extra: 'tam satır' });
  const rows = [row('101', 60), row('102', 40), row('103', 10)];
  const deliveryBuffer = zlib.gzipSync(JSON.stringify(items.buildDelivery(rows, {}, d => d.toISOString().slice(0, 10))));
  const app = express(), calls = [];
  register(app, { userAccess: { requireArea: () => (_req, _res, next) => next() }, assertSourceFilters() {}, prepareComputeBacklog: async () => {},
    backlogReadConsumer: () => ({ signal: new AbortController().signal, dispose() {} }), apiError: (res, error) => res.status(error.statusCode || 500).json({ code: error.code }), sendComputedResponse,
    getComputeReads: () => ({ run: async (_req, _area, task, parts, options) => {
      calls.push({ task, cache: options.cache, indices: parts.rowIndices });
      const value = task === 'backlog-rows' ? { rows: parts.rowIndices.map(index => rows[index]) } : null;
      return { value: value ? { buffer: zlib.gzipSync(JSON.stringify(value)), uncompressedBytes: 1 } : { buffer: deliveryBuffer, uncompressedBytes: 1 }, release() {}, assertResponse() {} };
    } }),
    runReadModelCompute: async (task, payload) => ({ value: model.execute(payload), release() {} }) });
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/read-model/backlog/delivery`;
  const post = body => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const delivery = { settings: Engine.DEFAULT_SETTINGS, bounds: null, today: Engine.defaultOrdinal('2026-01-20T12:00:00'), lang: 'tr' };
  const first = await (await post({ version: 1, query: {}, view: { today: '2026-01-20' }, delivery })).json();
  assert.equal(first.needDates, true); assert.ok(first.dateKeys.includes('string:2026-02-01'));
  const ordinals = { token: first.dataset, values: first.dateKeys.map(key => Engine.defaultOrdinal(Engine.valueOfDateKey(key))) };
  const body = await (await post({ version: 1, query: {}, view: { today: '2026-01-20' }, delivery: { ...delivery, ordinals } })).json();
  assert.equal(body.kind, 'delivery'); assert.equal(body.model.orderCount, 3); assert.deepEqual(body.model.orders, []);
  assert.deepEqual(body.parity, { qty: 110, orders: 3 });
  assert.equal(/"(sourceRow|rows)":\[\{/.test(JSON.stringify(body)), false, 'analiz yanıtı satır taşımaz');
  const outcome = Engine.OUTCOMES.find(key => body.model.deliveryOutcome[key].rows > 0);
  const drill = await (await post({ version: 1, query: {}, view: { today: '2026-01-20' }, delivery: { ...delivery, ordinals }, drill: { k: 'outcome', key: outcome } })).json();
  assert.ok(drill.rows.length > 0 && drill.rows.every(item => item.Extra === 'tam satır'), 'drill-down tam export satırlarını döner');
  const rowsCall = calls.find(call => call.task === 'backlog-rows');
  assert.equal(rowsCall.cache, false); assert.deepEqual(rowsCall.indices, drill.rows.map(item => rows.findIndex(r => r['Sipariş Kod'] === item['Sipariş Kod'])));
  // Eski tarih sözlüğüyle drill-down (veri kümesi değişti): işçinin sözlük isteği istemciye geçer, satır hesabı başlamaz.
  const before = calls.length;
  const stale = await post({ version: 1, query: {}, view: { today: '2026-01-20' }, delivery: { ...delivery, ordinals: { ...ordinals, token: 'eski' } }, drill: { k: 'outcome', key: outcome } });
  assert.equal(stale.status, 200);
  const staleBody = await stale.json();
  assert.equal(staleBody.needDates, true); assert.ok(staleBody.dateKeys.length > 0);
  assert.equal(calls.slice(before).some(call => call.task === 'backlog-rows'), false);
  // Genel Bakış drill türleri Teslimat Riski rotasında geçersizdir (ve tersi).
  assert.equal((await post({ version: 1, query: {}, view: { today: '2026-01-20' }, delivery, drill: { k: 'all' } })).status, 400);
  assert.equal((await fetch(url.replace('/delivery', '/v3'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: 1, drill: { k: 'outcome', key: 'AT_RISK' } }) })).status, 400);
});
