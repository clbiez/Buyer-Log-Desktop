'use strict';
/* TR/YD Landed Avantaj — sipariş × vasıta eşlemesi (IAS runtime haritası) ve
   "Geçmiş veriden öner" endpoint'i. Yeni küp bağlantısı açılmaz. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../server/lib/postfob-report');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');
const index = require('../server/lib/tryd-vehicle-index');

const liveSchema = () => intakeReport.allowedSchema({
  columns: report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
  measures: report.MEASURES.map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
});

function harness(modelRows, cache) {
  const handlers = {};
  const app = { get: (url, ...fns) => { handlers[`GET ${url}`] = fns; }, put: (url, ...fns) => { handlers[`PUT ${url}`] = fns; }, post: (url, ...fns) => { handlers[`POST ${url}`] = fns; } };
  const prefs = new Map();
  const calls = [];
  const userAccess = { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: () => {} };
  const modelQuery = {
    discoverSchema: async () => ({ columns: liveSchema().filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column', dataType: 'WChar' })), measures: liveSchema().filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })) }),
    runModelRows: async input => { calls.push(input); return { rows: modelRows }; },
  };
  const userPreferences = { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } };
  const store = createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'tryd-vehicle-')) });
  const cacheCalls = [];
  require('../server/routes/postfob-routes')(app, {
    express: { json: () => (req, res, next) => next() }, userAccess, modelQuery, userPreferences,
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    cacheForUser: req => { cacheCalls.push(req.currentUser.id); return cache; }, store,
  });
  async function call(key, req) {
    const fns = handlers[key];
    assert.ok(fns, `${key} kayıtlı değil`);
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const request = { currentUser: { id: 'u1' }, body: {}, ...req };
    let i = 0;
    const next = async () => { const fn = fns[i++]; if (fn) await fn(request, res, next); };
    await next();
    return res;
  }
  return { call, calls, cacheCalls };
}

const ias = (ocode, vasita, loadedQty, arr) => ({ ocode, vasita, loadedQty, arr });
const antrepoMap = {
  __ias_row_1: ias('1000001', 'Gemi', 600, '2026-03-01T00:00:00.000Z'),
  __ias_row_2: ias('1000001', 'Uçak', 200, '2026-03-20T00:00:00.000Z'),
  __ias_row_3: ias('1000001', 'GEMI', 200, null),
  __ias_row_4: ias('1000002', 'Gemi + Uçak', null, '2026-04-02'),
  __ias_row_5: ias('1000003', '', 50, null),
  __ias_row_6: ias('1000005', 'Tır', 0, null),
  __ias_row_7: ias('1000005', 'Kamyon', 300, null),
};
const rows = [
  { order: '1000000', model: 'M1', season: 'S6', originCountry: 'TÜRKİYE', qty: '100', fob: '5' },
  { order: '1000001', model: 'M1', season: 'S6', colour: 'A', originCountry: 'BANGLADEŞ', qty: '1000', fob: '3', landedActual: '3,5' },
  { order: '1000001', model: 'M1', season: 'S6', colour: 'B', originCountry: 'BANGLADEŞ', qty: '500', fob: '3', landedActual: '3,4' },
  { order: '1000002', model: 'M1', season: 'S6', originCountry: 'ÇİN', qty: '300', fob: '3', landedActual: '4' },
  { order: '1000003', model: 'M1', season: 'S6', originCountry: 'ÇİN', qty: '300', fob: '3', landedActual: '3.3' },
  { order: '1000004', model: 'M1', season: 'S6', originCountry: 'PAKİSTAN', qty: '300', fob: '3', landedActual: '3.3' },
  { order: '1000005', model: 'M1', season: 'S6', originCountry: 'PAKİSTAN', qty: '300', fob: '3', landedActual: '3.3' },
];

test('indeks: parsiyeller vasıtaya göre toplanır, anahtar normalize edilir, 0 adetli vasıta düşer', () => {
  const built = index.buildIndex(antrepoMap);
  assert.equal(built.parsiyels, 7);
  assert.deepEqual(index.partsOf(built, '1000001'), [{ key: 'GEMI', label: 'Gemi', qty: 800 }, { key: 'UCAK', label: 'Uçak', qty: 200 }]);
  assert.deepEqual(index.partsOf(built, '1000002'), [{ key: 'GEMI+UCAK', label: 'Gemi + Uçak', qty: null }]);
  assert.deepEqual(index.partsOf(built, '1000003'), []);
  assert.deepEqual(index.partsOf(built, '1000005'), [{ key: 'KAMYON', label: 'Kamyon', qty: 300 }]);
  // Sipariş kodu biçim farkı (ondalık gösterim) aynı siparişe bağlanır.
  assert.equal(index.partsOf(built, '1000001.00').length, 2);
  // Aynı harita nesnesi için indeks yeniden kurulmaz.
  assert.equal(index.buildIndex(antrepoMap), built);
  assert.equal(index.antrepoMapOf({ antrepoMap: { a: 1 }, antrepoMapByTarget: { orders: antrepoMap } }), antrepoMap);
});

test('TR/YD rapor ve state: YD siparişlerinin vasıtası yanıta eklenir; TR siparişi ve bulunamayan sipariş eklenmez', async () => {
  const h = harness(rows, { antrepoMap, loadedAt: '2026-11-20T08:00:00.000Z' });
  const fetched = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(fetched.statusCode, 200);
  const vehicles = fetched.body.vehicles;
  assert.deepEqual(Object.keys(vehicles.byOrder).sort(), ['1000001', '1000002', '1000005']);
  assert.deepEqual(vehicles.byOrder['1000001'], [['GEMI', 'Gemi', 800], ['UCAK', 'Uçak', 200]]);
  assert.equal(vehicles.ydOrders, 5);
  assert.equal(vehicles.matched, 3);
  assert.equal(vehicles.source.loaded, true);
  // Vasıta önbelleğe yazılmaz: kaynak satırlarda vasıta alanı yoktur.
  assert.equal(fetched.body.rows.some(row => 'vehicle' in row), false);
  const state = await h.call('GET /api/postfob/tryd/state', {});
  assert.deepEqual(state.body.data.vehicles.byOrder['1000002'], [['GEMI+UCAK', 'Gemi + Uçak', null]]);
});

test('TR/YD: IAS verisi yüklü değilse eşleme boş döner ve kaynak yüklenmedi olarak işaretlenir', async () => {
  const h = harness(rows, { antrepoMap: {} });
  const fetched = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.deepEqual(fetched.body.vehicles.byOrder, {});
  assert.equal(fetched.body.vehicles.source.loaded, false);
  assert.equal(fetched.body.vehicles.matched, 0);
});

test('öneri endpoint: son TR/YD sorgusundan tek vasıtalı geçerli YD satırları; az örnekte öneri yok', async () => {
  const many = [{ order: '9000000', model: 'M9', season: 'S6', originCountry: 'TÜRKİYE', qty: '100', fob: '5' }];
  const map = {};
  for (let i = 0; i < 24; i += 1) {
    const order = String(9000100 + i);
    map[`__ias_row_${i}`] = ias(order, 'Gemi', 100, `2026-0${1 + (i % 6)}-15`);
    many.push({ order, model: 'M9', season: i % 2 ? 'S6' : 'W6', colour: 'A', originCountry: 'BANGLADEŞ', qty: '100', fob: '2', landedActual: String(2 * (1.05 + (i % 3) / 100)) });
  }
  for (let i = 0; i < 3; i += 1) { map[`__ias_air_${i}`] = ias(String(9000500 + i), 'Uçak', 10, null); many.push({ order: String(9000500 + i), model: 'M9', season: 'S6', originCountry: 'ÇİN', qty: '50', fob: '2', landedActual: '3' }); }
  // Landed < FOB örnek olamaz.
  map.__ias_bad = ias('9000900', 'Gemi', 10, null);
  many.push({ order: '9000900', model: 'M9', season: 'S6', originCountry: 'ÇİN', qty: '50', fob: '2', landedActual: '1' });
  const h = harness(many, { antrepoMap: map });
  const none = await h.call('GET /api/postfob/tryd/vehicle-suggestions', {});
  assert.equal(none.body.ok, true);
  assert.equal(none.body.data, null);
  await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6', 'W6'] } } } });
  const out = await h.call('GET /api/postfob/tryd/vehicle-suggestions', {});
  const gemi = out.body.data.items.find(item => item.key === 'GEMI');
  assert.equal(gemi.count, 24);
  assert.equal(gemi.enough, true);
  // P90 (ürün kararı): 1,05 / 1,06 / 1,07 eşit ağırlıkta → 1,07.
  assert.ok(Math.abs(gemi.suggestion - 1.07) < 1e-9, String(gemi.suggestion));
  assert.equal(gemi.percentile, 0.9);
  assert.equal(out.body.data.percentile, 0.9);
  assert.equal(gemi.from, '2026-01-15');
  assert.equal(gemi.to, '2026-06-15');
  const ucak = out.body.data.items.find(item => item.key === 'UCAK');
  assert.equal(ucak.enough, false);
  assert.equal(ucak.suggestion, null);
  assert.equal(ucak.reason, 'fewRows');
  assert.equal(out.body.data.skipped.invalidOrNoLanded, 1);
  assert.deepEqual(out.body.data.seasons, ['S6', 'W6']);
  assert.equal(out.body.data.thresholds.rows, 20);
  // Öneri hiçbir şey kaydetmez: tek model sorgusu, tercih dışında yazım yok.
  assert.equal(h.calls.length, 1);
});
