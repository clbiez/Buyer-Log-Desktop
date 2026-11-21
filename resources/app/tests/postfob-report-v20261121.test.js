'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../server/lib/postfob-report');
const analysis = require('../public/postfob-analysis');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const liveSchema = () => intakeReport.allowedSchema({
  columns: report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
  measures: report.MEASURES.filter(item => item.key !== 'tpMultiplier').map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
});

test('bağlantı: ayarlarda aynı katalog varsa o, yoksa kaynak Excel sunucusu kullanılır', () => {
  assert.deepEqual(
    [report.resolveConnection([]).server, report.resolveConnection([]).catalog, report.resolveConnection([]).source],
    ['F5_S41', 'FiyatMaliyetKontrolRapor', 'default']);
  const custom = report.resolveConnection([{ id: 'x', role: 'intake', server: 'lcwtabular_s20', catalog: 'WSSI_Intake_Raporu4' }, { id: 'mc1', role: 'custom', server: 'lcwtabular_s41', catalog: 'FiyatMaliyetKontrolRapor' }]);
  assert.equal(custom.server, 'lcwtabular_s41');
  assert.equal(custom.source, 'settings');
});

test('sorgu sezon filtresi olmadan üretilmez', () => {
  assert.throws(() => report.buildQuery({ liveFields: liveSchema(), filterValues: {} }), error => error.code === 'POSTFOB_SEASON_REQUIRED');
});

test('sorgu sabit sipariş düzeyi boyutlar, TREATAS filtreleri ve mevcut ölçülerle üretilir', () => {
  const built = report.buildQuery({ liveFields: liveSchema(), filterValues: { season: ['S6'], mag: ['CU4C', 'CU4C', ''], unknown: ['x'] } });
  assert.match(built.query, /^EVALUATE\nTOPN\(10000,/);
  assert.match(built.query, /'Urun'\[sipariskod\]/);
  assert.match(built.query, /'SatisUlke'\[Satış Ülkesi\]/);
  assert.match(built.query, /TREATAS\(\{ "S6" \}, 'Urun'\[SezonKod\]\)/);
  assert.match(built.query, /TREATAS\(\{ "CU4C" \}, 'Urun'\[MerchAltGrupKod\]\)/);
  assert.match(built.query, /"landedActual", \[TR Antrepo Landed Gerceklesen USD\]/);
  // Doğrulanmamış ilişki: Cari tablosu sorguya girmez (çapraz çarpım riski).
  assert.doesNotMatch(built.query, /'Cari'/);
  // Canlı şemada olmayan isteğe bağlı ölçü düşer ve raporlanır.
  assert.doesNotMatch(built.query, /TP-Carpan/);
  assert.deepEqual(built.missing, ['tpMultiplier']);
  assert.deepEqual(built.filterValues, { season: ['S6'], mag: ['CU4C'] });
  assert.equal(built.headerMap["'Urun'[sipariskod]"], 'order');
  assert.equal(built.headerMap['Urun[sipariskod]'], 'order');
  assert.equal(built.headerMap['[fob]'], 'fob');
});

test('zorunlu FOB veya adet ölçüsü yoksa açık şema hatası verilir', () => {
  const fields = liveSchema().filter(field => field.name !== 'FOB_USD_');
  assert.throws(() => report.buildQuery({ liveFields: fields, filterValues: { season: ['S6'] } }), error => error.code === 'POSTFOB_SCHEMA_MISMATCH' && /fob/.test(error.message));
});

test('model satırları kararlı anahtarlara ve sayılara normalize edilir (ondalık virgül dahil)', () => {
  const built = report.buildQuery({ liveFields: liveSchema(), filterValues: { season: ['S6'] } });
  const [row] = report.normalizeRows([{ order: ' 1235868 ', model: 'S62641Z4', qty: '1.200', fob: '3,88', landedActual: '4.33', customsRate: '' }], built);
  assert.equal(row.order, '1235868');
  assert.equal(row.qty, 1.2); // "1.200" son ayraç nokta: ondalık nokta kabul edilir
  assert.equal(row.fob, 3.88);
  assert.equal(row.landedActual, 4.33);
  assert.equal(row.customsRate, null);
  assert.equal(report.toNumber('1.234,5'), 1234.5);
  assert.equal(report.toNumber('1,234.5'), 1234.5);
});

test('görünüm normalize edilir: bilinmeyen gruplama/kapsam varsayılana döner', () => {
  const view = report.normalizeView({ groupBy: 'drop table', segment: 'x', filterValues: { season: ['S6'], bad: ['1'] }, sort: { key: 'fob', dir: 1 } });
  assert.equal(view.groupBy, 'originCountry');
  assert.equal(view.segment, 'all');
  assert.deepEqual(view.filterValues, { season: ['S6'] });
  assert.deepEqual(view.sort, { key: 'fob', dir: 1 });
});

test('dağıtık değer sorgusu metin alanında CONTAINSSTRING kullanır, tırnak kaçar', () => {
  const item = report.resolveFields(liveSchema()).dimensions.find(entry => entry.key === 'mag');
  const plan = report.distinctQuery(item, { search: 'CU"4', limit: 99999 });
  assert.equal(plan.limit, 5000);
  assert.match(plan.query, /CONTAINSSTRING\('Urun'\[MerchAltGrupKod\], "CU""4"\)/);
});

/* ---------- Analiz ---------- */
const rows = [
  { order: '1', originCountry: 'BANGLADEŞ', mag: 'A', qty: 100, fob: 4, landedActual: 4.4, landedForecast: 4.0, integralLast: 6 },
  { order: '2', originCountry: 'BANGLADEŞ', mag: 'A', qty: 300, fob: 2, landedActual: 2.4, landedForecast: 2.4, integralLast: 3 },
  { order: '3', originCountry: 'TÜRKİYE', mag: 'B', qty: 100, fob: 6, landedActual: 6, integralLast: 6.6 },
  { order: '4', originCountry: 'MISIR', mag: 'B', qty: 0, fob: 99, landedActual: 999 },
  { order: '5', originCountry: 'MISIR', mag: 'B', qty: 50, fob: 5 },
];

test('birim değerler adet ağırlıklı, oranlar aynı satır kümesinde Σpay/Σpayda olarak hesaplanır', () => {
  const total = analysis.summarize(rows);
  assert.equal(total.qty, 550);
  assert.equal(total.orders, 5);
  // FOB: (100×4 + 300×2 + 100×6 + 50×5) / 550; adet 0 satır ağırlık almaz.
  assert.ok(Math.abs(total.fob - 1850 / 550) < 1e-9);
  // Landed/FOB yalnız landed'ı olan satırlar: (440+720+600)/(400+600+600)
  assert.ok(Math.abs(total.landedToFob - 1760 / 1600) < 1e-9);
  assert.ok(Math.abs(total.postFob - 160 / 500) < 1e-9);
  // Öngörü sapması: Σq(actual−forecast)/Σq·forecast = 40 / (400+720)
  assert.ok(Math.abs(total.forecastGap - 40 / 1120) < 1e-9);
  assert.ok(Math.abs(total.landedCoverage - 500 / 550) < 1e-9);
});

test('ithal / yerli ayrımı üretici ülkeden yapılır; Türkiye yazımları yerli sayılır', () => {
  assert.equal(analysis.segmentOf({ originCountry: 'TÜRKİYE' }), 'domestic');
  assert.equal(analysis.segmentOf({ originCountry: 'Turkiye' }), 'domestic');
  assert.equal(analysis.segmentOf({ originCountry: 'BANGLADEŞ' }), 'import');
  assert.equal(analysis.segmentOf({ originCountry: '' }), 'unknown');
  const result = analysis.analyze(rows, { groupBy: 'mag', segment: 'import' });
  assert.deepEqual(result.groups.map(group => group.key).sort(), ['A', 'B']);
  assert.equal(result.total.qty, 450);
});

test('aykırı sınırı Tukey (Q3 + 1,5×IQR) ile seçili kapsamdan üretilir; küçük örnekte üretilmez', () => {
  assert.equal(analysis.outlierBounds(rows), null);
  const many = Array.from({ length: 12 }, (_, i) => ({ order: String(i), originCountry: 'BD', qty: 10, fob: 4, landedActual: 4.4 + (i % 3) * 0.01 }));
  many.push({ order: 'X', originCountry: 'BD', qty: 10, fob: 4, landedActual: 8 });
  const result = analysis.analyze(many, { groupBy: 'order', outliersOnly: true });
  assert.ok(result.bounds && result.bounds.upper < 2);
  assert.equal(result.outlierCount, 1);
  assert.deepEqual(result.groups.map(group => group.key), ['X']);
});

/* ---------- Route ---------- */
function harness(modelRows) {
  const handlers = {};
  const app = { get: (url, ...fns) => { handlers[`GET ${url}`] = fns; }, put: (url, ...fns) => { handlers[`PUT ${url}`] = fns; }, post: (url, ...fns) => { handlers[`POST ${url}`] = fns; } };
  const prefs = new Map();
  const calls = [];
  const audits = [];
  const userAccess = { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: (...args) => audits.push(args) };
  const modelQuery = {
    discoverSchema: async () => ({ columns: liveSchema().filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column', dataType: 'WChar' })), measures: liveSchema().filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })) }),
    runModelRows: async input => { calls.push(input); if (modelRows instanceof Error) throw modelRows; return { rows: modelRows }; },
  };
  const userPreferences = { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postfob-'));
  require('../server/routes/postfob-routes')(app, {
    express: { json: () => (req, res, next) => next() }, userAccess, modelQuery, userPreferences,
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    store: createIntakeStore({ root }),
  });
  async function call(key, req) {
    const fns = handlers[key];
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const request = { currentUser: { id: 'u1' }, body: {}, ...req };
    let i = 0;
    const next = async () => { const fn = fns[i++]; if (fn) await fn(request, res, next); };
    await next();
    return res;
  }
  return { call, calls, audits };
}

test('rapor route\'u sezonsuz isteği reddeder, sorguyu çalıştırır ve sonucu önbellekten tekrar verir', async () => {
  const h = harness([{ order: '1', season: 'S6', qty: '10', fob: '4', landedActual: '4,4' }]);
  const missing = await h.call('POST /api/postfob/report', { body: { view: { filterValues: {} } } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.code, 'POSTFOB_SEASON_REQUIRED');
  const first = await h.call('POST /api/postfob/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.fromCache, false);
  assert.equal(first.body.rows[0].landedActual, 4.4);
  assert.equal(h.calls[0].server, 'F5_S41');
  assert.equal(h.calls[0].catalog, 'FiyatMaliyetKontrolRapor');
  assert.equal(h.audits[0][1], 'POSTFOB_REPORT_FETCH');
  const second = await h.call('POST /api/postfob/report', { body: {} });
  assert.equal(second.body.fromCache, true);
  assert.equal(h.calls.length, 1);
  const state = await h.call('GET /api/postfob/state', {});
  assert.equal(state.body.snapshot.rows.length, 1);
  assert.deepEqual(state.body.view.filterValues, { season: ['S6'] });
});

test('kaynak kesintisinde son snapshot çevrimdışı olarak döner; snapshot yoksa güvenli hata', async () => {
  const outage = Object.assign(new Error('boom \\\\server'), { code: 'MODEL_QUERY_FAILED' });
  const empty = harness(outage);
  const failed = await empty.call('POST /api/postfob/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.code, 'POSTFOB_SOURCE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(failed.body), /boom|server/);
});
