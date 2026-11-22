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
  // Satış ülkesi kaynak pivotta yalnız sayfa filtresi: varsayılan sorgu düzeyine girmez.
  assert.doesNotMatch(built.query, /'SatisUlke'\[Satış Ülkesi\]/);
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

test('görünüm v2 normalize edilir: v1 groupBy satır eksenine taşınır, bilinmeyen alan/kapsam düşer', () => {
  const legacy = report.normalizeView({ groupBy: 'mag', segment: 'x', filterValues: { season: ['S6'], bad: ['1'] }, sort: { key: 'fob', dir: 1 } });
  assert.deepEqual(legacy.rows, [{ key: 'mag' }]);
  assert.equal(legacy.segment, 'all');
  assert.deepEqual(legacy.filterValues, { season: ['S6'] });
  assert.deepEqual(legacy.display.sort, { key: 'fob', dir: 1 });
  assert.equal(legacy.values.length, report.DEFAULT_VALUES.length);
  const odd = report.normalizeView({ rows: ['drop table', { key: 'x_forged', source: 'DROP' }], values: [{ source: '[Urun].[UrunAd]' }] });
  assert.deepEqual(odd.rows, [{ key: 'originCountry' }], 'geçersiz satır alanları düşer, varsayılan kalır');
  assert.deepEqual(odd.values.map(ref => ref.key), report.DEFAULT_VALUES, 'ölçü olmayan kaynak değer olamaz');
  const extra = report.normalizeView({ rows: [{ key: 'forged', source: '[Urun].[OptionTanim]', label: 'Opsiyon' }], values: [{ source: '[Measures].[Stok Tutma Maliyeti]', agg: 'wavg' }] });
  assert.equal(extra.rows[0].key, report.extraKey('[Urun].[OptionTanim]'), 'anahtar istemciden değil kaynaktan türetilir');
  assert.equal(extra.values[0].agg, 'WAVG');
});

test('dağıtık değer sorgusu metin alanında CONTAINSSTRING kullanır, tırnak kaçar', () => {
  const field = report.resolveFilterField(liveSchema(), { key: 'mag' });
  const plan = report.distinctQuery(field, { search: 'CU"4', limit: 99999 });
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

/* ---------- Veri Yönetimi bağlantısı ve ufuk (v2026-11-22) ---------- */
test('postfob rolü INTAKE gibi ayrı veritabanı kaynağıdır: varsayılan kayıt, kapsam, profil', () => {
  const db = require('../server/db');
  const modelScopes = require('../server/lib/model-scopes');
  const sourceProfiles = require('../server/lib/data-domain/source-profiles');
  const modelFields = require('../server/lib/model-fields');
  const items = db.normalizeModelConnections([]);
  const item = items.find(entry => entry.role === 'postfob');
  assert.ok(item, 'varsayılan postfob bağlantısı eklenir');
  assert.equal(item.server, 'F5_S41');
  assert.equal(item.catalog, 'FiyatMaliyetKontrolRapor');
  assert.deepEqual(item.scopes[0].targets, ['postfob']);
  assert.ok(items.some(entry => entry.role === 'intake'), 'INTAKE varsayılanı korunur');
  assert.deepEqual(modelScopes.allowedTargets('postfob'), ['postfob']);
  assert.equal(sourceProfiles.fromLegacyRole('postfob').id, 'postfob-cost');
  assert.deepEqual(sourceProfiles.validate({ roleTargets: modelScopes.ROLE_TARGETS, fieldsForRole: modelFields.fieldsForRole, scopeTargets: modelScopes.SCOPE_TARGETS }), { ok: true, problems: [] });
  // Kullanıcının kaydettiği postfob kaydı korunur; ikinci varsayılan eklenmez.
  const saved = db.normalizeModelConnections([{ id: 'mine', name: 'Maliyet', role: 'postfob', server: 'lcwtabular_s41', catalog: 'FiyatMaliyetKontrolRapor' }]);
  assert.equal(saved.filter(entry => entry.role === 'postfob').length, 1);
  assert.equal(report.resolveConnection(saved).server, 'lcwtabular_s41');
  // Global "Tümünü yenile" hedeflerine girmez.
  assert.ok(!modelScopes.REFRESH_TARGETS.includes('postfob'));
});

test('Veri Yönetimi okuma modeli postfob kaynağını ve modülünü iki dilde listeler', () => {
  const readModel = require('../server/lib/data-domain/read-model');
  const db = require('../server/db');
  const items = db.normalizeModelConnections([]);
  const tr = readModel.build(items, { language: 'tr' });
  const en = readModel.build(items, { language: 'en' });
  const source = tr.sources.find(entry => entry.profileId === 'postfob-cost');
  assert.ok(source, 'kaynak listede');
  assert.equal(tr.modules.find(entry => entry.id === 'postfob').label, 'FOB Sonrası Maliyet');
  assert.equal(en.modules.find(entry => entry.id === 'postfob').label, 'Post-FOB Cost');
});

test('Veri Yönetimi ufku sorguya SUMMARIZECOLUMNS argümanı olarak girer ve sezon zorunluluğunu karşılar', () => {
  const horizon = { groups: [{ conditions: [{ field: 'SezonKod', table: 'Urun', name: 'SezonKod', op: 'in', values: ['S6', 'W6'] }] }] };
  const items = [{ id: 'mc_postfob_default', role: 'postfob', server: 'F5_S41', catalog: 'FiyatMaliyetKontrolRapor', scopes: [{ id: 's', enabled: true, targets: ['postfob'], horizon }] }];
  const resolved = report.resolveHorizon(items);
  assert.ok(resolved);
  const built = report.buildQuery({ liveFields: liveSchema(), filterValues: {}, horizon: resolved });
  assert.equal(built.horizonApplied, true);
  assert.match(built.query, /FILTER\(ALL\('Urun'\[SezonKod\]\)/);
  assert.match(built.query, /"S6"/);
  // Ufuk + widget filtresi VE ile birleşir.
  const both = report.buildQuery({ liveFields: liveSchema(), filterValues: { mag: ['CU4C'] }, horizon: resolved });
  assert.match(both.query, /FILTER\(ALL\('Urun'\[SezonKod\]\)[\s\S]*TREATAS\(\{ "CU4C" \}/);
  // Ufuk yoksa sezon yine zorunlu.
  assert.equal(report.resolveHorizon([{ role: 'postfob', server: 'x', catalog: 'FiyatMaliyetKontrolRapor', scopes: [{ targets: ['postfob'], horizon: {} }] }]), null);
  // Veri Yönetimi'nin normalize ettiği boş ufuk (boş sezon/grup listeleri) sınır sayılmaz.
  const db = require('../server/db');
  assert.equal(report.resolveHorizon(db.normalizeModelConnections([])), null);
});

test('Veri Yönetimi ekranı postfob ufkunu ayrı satır ve çekmece grubu olarak sunar; widget ufukla sezonsuz sorgular', () => {
  const dm = fs.readFileSync(path.join(__dirname, '../public/data-management.js'), 'utf8');
  assert.match(dm, /horizonRow\(\{ id: 'postfob', targets: \['postfob'\] \}\)/);
  assert.match(dm, /\{ id: 'postfob', targets: \['postfob'\] \}\];/);
  assert.match(dm, /postfob: \{\s*title: \{ tr: 'FOB Sonrası Maliyet', en: 'Post-FOB Cost' \}/);
  const ui = fs.readFileSync(path.join(__dirname, '../public/postfob.js'), 'utf8');
  assert.match(ui, /if \(!state\.horizon && !\(view\(\)\.filterValues\.season \|\| \[\]\)\.length\)/);
  const routes = fs.readFileSync(path.join(__dirname, '../server/routes/horizon-routes.js'), 'utf8');
  assert.equal((routes.match(/target === 'postfob' \? connections\.find\(item => item && item\.role === 'postfob'\)/g) || []).length, 2);
});

/* ---------- Pivot düzenleme, model alanları ve arama (v2026-11-22) ---------- */
function liveWithExtras() {
  return liveSchema().concat(intakeReport.allowedSchema({
    columns: [{ table: 'Urun', name: 'OptionTanim', kind: 'column', dataType: 'WChar' }, { table: 'Cari', name: 'Ad', kind: 'column', dataType: 'WChar' }],
    measures: [{ table: 'Measures', name: 'Stok Tutma Maliyeti', kind: 'measure' }],
  }));
}

test('modelden eklenen satır/sütun alanı gruplanır, filtre-yalnız alan gruplanmaz, eklenen ölçü sorguya girer', () => {
  const view = report.normalizeView({
    rows: [{ key: 'buyerGroup' }, { source: '[Urun].[OptionTanim]', label: 'Opsiyon' }],
    filters: [{ key: 'season' }, { source: '[Cari].[Ad]', label: 'Üretici' }],
    values: [{ key: 'qty' }, { source: '[Measures].[Stok Tutma Maliyeti]', agg: 'WAVG' }],
    filterValues: { season: ['S6'] },
  });
  const cari = view.filters[1].key;
  view.filterValues[cari] = ['DEMO TEDARİKÇİ'];
  const built = report.buildQuery({ liveFields: liveWithExtras(), view: report.normalizeView(view) });
  const option = report.extraKey('[Urun].[OptionTanim]');
  const stock = report.extraKey('[Measures].[Stok Tutma Maliyeti]');
  assert.ok(built.dimensions.includes(option));
  assert.ok(!built.dimensions.includes(cari), 'yalnız filtrede kullanılan alan sorgu düzeyini değiştirmez');
  assert.match(built.query, /'Urun'\[OptionTanim\]/);
  assert.match(built.query, /TREATAS\(\{ "DEMO TEDARİKÇİ" \}, 'Cari'\[Ad\]\)/);
  assert.match(built.query, new RegExp(`"${stock}", \\[Stok Tutma Maliyeti\\]`));
  assert.equal(built.headerMap["'Urun'[OptionTanim]"], option);
  // Canlı modelde olmayan eklenmiş alan sorguyu bozmaz, eksik olarak raporlanır.
  const ghost = report.normalizeView({ rows: [{ source: '[Urun].[Yok]' }], filterValues: { season: ['S6'] } });
  const ghostBuilt = report.buildQuery({ liveFields: liveSchema(), view: ghost });
  assert.ok(ghostBuilt.missing.includes(report.extraKey('[Urun].[Yok]')));
  assert.doesNotMatch(ghostBuilt.query, /\[Yok\]/);
});

test('pivot düzenleyici alan havuzu canlı modelden gelir; hazır alanlar baseKey ile işaretlenir', () => {
  const meta = report.metadata(liveWithExtras());
  assert.ok(meta.dimensions.some(field => field.source === '[Urun].[OptionTanim]' && !field.baseKey));
  assert.equal(meta.dimensions.find(field => field.name === 'SezonKod').baseKey, 'season');
  assert.ok(meta.measures.some(field => field.name === 'Stok Tutma Maliyeti'));
  // Dağıtık değer: eklenmiş alan yalnız kaynak adı anahtarla eşleşirse çözülür.
  const key = report.extraKey('[Cari].[Ad]');
  assert.ok(report.resolveFilterField(liveWithExtras(), { key, source: '[Cari].[Ad]' }));
  assert.equal(report.resolveFilterField(liveWithExtras(), { key: 'x_forged', source: '[Cari].[Ad]' }), null);
});

test('arama sipariş, model ve özel kodda VE ile çalışır; aykırı eşiği aramadan etkilenmez; eklenen ölçü özetlenir', () => {
  const data = Array.from({ length: 10 }, (_, i) => ({ order: String(1000 + i), model: `DM${i}`, specialCode: i === 3 ? 'LCW KIDS 77' : '', originCountry: 'BD', qty: 10 + i, fob: 4, landedActual: i === 9 ? 9 : 4.4, x_s: i }));
  const all = analysis.prepare(data, {});
  const found = analysis.prepare(data, { search: 'kids 1003' });
  assert.deepEqual(found.visible.map(row => row.order), ['1003']);
  assert.deepEqual(found.bounds, all.bounds);
  assert.equal(analysis.prepare(data, { search: 'kids 1004' }).visible.length, 0);
  const metrics = analysis.groupMetrics(data, all.bounds, [{ key: 'x_s', agg: 'SUM' }]);
  assert.equal(metrics.x_s, 45);
  assert.equal(metrics.outliers, 1);
  const weighted = analysis.groupMetrics(data.slice(0, 2), null, [{ key: 'x_s', agg: 'WAVG' }]);
  assert.ok(Math.abs(weighted.x_s - 11 / 21) < 1e-9);
});

test('rapor yanıtı arama için yüklü ASAS verisinden özel kod ve model adını ekler; önbelleğe yazmaz', async () => {
  const handlers = {};
  const app = { get: (url, ...fns) => { handlers[`GET ${url}`] = fns; }, put: () => {}, post: (url, ...fns) => { handlers[`POST ${url}`] = fns; } };
  const prefs = new Map();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'postfob-enrich-'));
  const store = createIntakeStore({ root });
  require('../server/routes/postfob-routes')(app, {
    express: { json: () => (req, res, next) => next() },
    userAccess: { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: () => {} },
    modelQuery: { discoverSchema: async () => ({ columns: [], measures: [] }), runModelRows: async () => ({ rows: [{ order: '1.235.868', qty: '10', fob: '4' }] }) },
    userPreferences: { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { prefs.set(id, Object.entries(patch)); return {}; } },
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    cacheForUser: () => ({ asasOrders: [{ 'Order Code': '1235868', 'Özel Kod 1': 'LCW KIDS', 'Model Name': 'DEMO TEE' }] }),
    store,
  });
  const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  const req = { currentUser: { id: 'u1' }, body: { view: { filterValues: { season: ['S6'] } } } };
  let i = 0; const fns = handlers['POST /api/postfob/report'];
  const next = async () => { const fn = fns[i++]; if (fn) await fn(req, res, next); };
  await next();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.rows[0].specialCode, 'LCW KIDS');
  assert.equal(res.body.rows[0].modelName, 'DEMO TEE');
  assert.equal(store.loadSnapshot('u1').rows[0].specialCode, undefined, 'zenginleştirme önbelleğe yazılmaz');
});

test('pivot satırları INTAKE/OAB sınıflarını kullanır; toplam satırlarının hover rengi okunur kalır', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/postfob.js'), 'utf8');
  for (const cls of ['oabPivotGrandTotalRow', 'oabPivotSubtotalRow', 'oabPivotGroupToggle', 'oabPivotSubtotalTag', 'oabSettingsModal', 'intakeFilterFieldPicker']) assert.ok(ui.includes(cls), cls);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  for (const id of ['postFobFieldsBtn', 'postFobSearch', 'postFobCollapseAllBtn', 'postFobExpandAllBtn', 'postFobResetBtn']) assert.match(html, new RegExp(`id="${id}"`));
  const css = fs.readFileSync(path.join(__dirname, '../public/ui-components.css'), 'utf8');
  assert.match(css, /\.miniTable tbody tr\.oabPivotGrandTotalRow:hover td \{background:[^}]*color:var\(--ui-surface\) !important/);
  assert.match(css, /\.miniTable tbody tr:is\(\.oabPivotGroupRow,\.oabPivotSubtotalRow\):hover td \{[^}]*color:var\(--ui-text\) !important/);
});

test('Corporate Integration Lab İncele: canlı şema okunur, eksik alan raporlanır, veri sorgusu atılmaz', async () => {
  const calls = [];
  const routes = require('../server/routes/postfob-routes')({ get: () => {}, put: () => {}, post: () => {} }, {
    express: { json: () => (req, res, next) => next() },
    userAccess: { requireAnyArea: () => () => {}, requireCapability: () => () => {}, appendAudit: () => {} },
    modelQuery: {
      discoverSchema: async input => { calls.push(['schema', input]); return { columns: liveSchema().filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column' })), measures: liveSchema().filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })), provider: 'ADOMD' }; },
      runModelRows: async () => { calls.push(['rows']); return { rows: [] }; },
    },
    userPreferences: { load: () => ({ entries: {} }), merge: () => ({}) },
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: () => 0 },
    store: createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'postfob-probe-')) }),
  });
  const probe = {};
  const rows = await routes.probe({ currentUser: { id: 'u1' } }, { server: 'F5_S41', catalog: 'FiyatMaliyetKontrolRapor' }, probe);
  assert.deepEqual(rows, []);
  assert.equal(probe.queryOk, true);
  assert.equal(probe.schema.provider, 'ADOMD');
  assert.deepEqual(probe.queryRuns[0].missing, ['tpMultiplier']);
  assert.deepEqual(calls.map(call => call[0]), ['schema'], 'İncele veri sorgusu atmaz');
  assert.equal(calls[0][1].server, 'F5_S41');
});

test('her pivot hücresi çift tıkla OAB ile aynı ortak alt detay çekmecesini kaynak satırlarla açar', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/postfob.js'), 'utf8');
  assert.match(ui, /addEventListener\('dblclick'/);
  assert.match(ui, /window\.BLDetailDrawer\.open\(\{\s*storageKey: 'postfob\.pivot\.detail'/);
  assert.match(ui, /td\.classList\.add\('oabPivotDrillCell'\)/);
  // Grup, yaprak ve genel toplam satırı kendi kaynak satırlarını taşır.
  for (const kind of ["kind: 'leaf', dims: leaf, metrics: analysis.groupMetrics(list, bounds, extras), level: fromLevel, rows: list", "subtotal: showSubtotals, rows: group.rows, path: nextPath", "kind: 'grand', dims: grand, metrics: analysis.groupMetrics(prepared.visible, bounds, extras), level: 0, rows: prepared.visible"]) assert.ok(ui.includes(kind), kind);
  const css = fs.readFileSync(path.join(__dirname, '../public/app.css'), 'utf8');
  assert.match(css, /#postFobTable tbody td\.oabPivotDrillCell\{cursor:zoom-in;\}/);
});

test('önceden Özel Database olarak tanımlı FiyatMaliyetKontrolRapor bağlantısının sunucusu korunur', () => {
  const db = require('../server/db');
  const items = db.normalizeModelConnections([{ id: 'mine', name: 'Maliyet', role: 'custom', server: 'lcwtabular_s41', catalog: 'FiyatMaliyetKontrolRapor' }]);
  const postfob = items.find(entry => entry.role === 'postfob');
  assert.equal(postfob.server, 'lcwtabular_s41');
  assert.ok(items.some(entry => entry.id === 'mine' && entry.role === 'custom'), 'kullanıcının özel kaydı silinmez');
  assert.equal(report.resolveConnection(items).server, 'lcwtabular_s41');
});

test('model alanı filtreden satıra taşınınca sorgu düzeyi değişmiş sayılır', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/postfob.js'), 'utf8');
  assert.match(ui, /\[\.\.\.current\.rows, \.\.\.current\.columns\]\.filter\(ref => ref\.source\)[\s\S]{0,120}current\.filters\.filter\(ref => ref\.source\)/);
});

test('satış ülkesi yalnız pivot satır/sütununda gruplanır; filtre olarak her zaman TREATAS ile uygulanır', () => {
  const grouped = report.buildQuery({ liveFields: liveSchema(), view: { rows: ['salesCountry'], filterValues: { season: ['S6'] } } });
  assert.ok(grouped.dimensions.includes('salesCountry'));
  assert.match(grouped.query, /'SatisUlke'\[Satış Ülkesi\],/);
  const filtered = report.buildQuery({ liveFields: liveSchema(), view: { rows: ['mag'], filterValues: { season: ['S6'], salesCountry: ['TURKIYE'] } } });
  assert.ok(!filtered.dimensions.includes('salesCountry'));
  assert.match(filtered.query, /TREATAS\(\{ "TURKIYE" \}, 'SatisUlke'\[Satış Ülkesi\]\)/);
});

test('tek sorguya çevrilemeyen ufuk (çok tablolu VEYA grupları) kaynak kesintisi değil, ufuk hatasıdır', () => {
  const horizon = { groups: [
    { conditions: [{ field: 'SezonKod', table: 'Urun', name: 'SezonKod', op: 'in', values: ['S6'] }] },
    { conditions: [{ field: 'Satış Ülkesi', table: 'SatisUlke', name: 'Satış Ülkesi', op: 'in', values: ['TURKIYE'] }] },
  ] };
  assert.throws(() => report.buildQuery({ liveFields: liveSchema(), view: { filterValues: {} }, horizon }), error => error.code === 'POSTFOB_HORIZON_INVALID' && error.statusCode === 400);
});

test('4xx doğrulama hatası kendi mesajıyla döner; yalnız kaynak hatası "ulaşılamıyor" olur', async () => {
  const handlers = {};
  const app = { get: () => {}, put: () => {}, post: (url, ...fns) => { handlers[url] = fns; } };
  let failWith = null;
  require('../server/routes/postfob-routes')(app, {
    express: { json: () => (req, res, next) => next() },
    userAccess: { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: () => {} },
    modelQuery: { discoverSchema: async () => { if (failWith) throw failWith; return { columns: [], measures: [] }; }, runModelRows: async () => ({ rows: [] }) },
    userPreferences: { load: () => ({ entries: {} }), merge: () => ({}) },
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: () => 0 },
    store: createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'postfob-fail-')) }),
  });
  const call = async () => {
    const res = { statusCode: 200, body: null, set() { return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    const req = { currentUser: { id: 'u1' }, body: { view: { filterValues: { season: ['S6'] } } } };
    let i = 0; const fns = handlers['/api/postfob/report'];
    const next = async () => { const fn = fns[i++]; if (fn) await fn(req, res, next); };
    await next(); return res;
  };
  failWith = Object.assign(new Error('"Sezon" alanı Int64 tipinde'), { code: 'INTAKE_FILTER_VALUE_TYPE', statusCode: 400 });
  const invalid = await call();
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /Int64/);
  failWith = Object.assign(new Error('timeout'), { code: 'MODEL_QUERY_TIMEOUT', statusCode: 504 });
  const outage = await call();
  assert.equal(outage.body.code, 'POSTFOB_SOURCE_UNAVAILABLE');
});

test('görünüm kaydı: ertelenen kayıtların sözü askıda kalmaz; sorgu sırasında yapılan değişiklik ezilmez', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/postfob.js'), 'utf8');
  assert.match(ui, /saveWaiters\.push\(resolve\)/);
  assert.match(ui, /function flushSaveWaiters\(value\)/);
  assert.match(ui, /if \(payload\.view && revision === state\.viewRevision\) state\.view = payload\.view;/);
  assert.match(ui, /finally \{ pendingSaves\.forEach\(resolve => resolve\(null\)\)/);
});

test('Veri Yönetimi: FOB satırı ufuksuz "filtre gerekli" uyarısı göstermez, sezonun widget’ta seçildiğini söyler', () => {
  const dm = fs.readFileSync(path.join(__dirname, '../public/data-management.js'), 'utf8');
  assert.match(dm, /const widgetBounded = group\.id === 'postfob';\s*const needsFilter = unbounded && !widgetBounded;/);
  assert.match(dm, /Ufuk yoksa widget’ta sezon seçilir', 'Without a horizon, a season is selected in the widget'/);
});

test('pivot Excel dışa aktarımı ekrandaki düzeni, kaynak satırları ve filtre özetini yazar', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../public/postfob.js'), 'utf8');
  assert.match(ui, /async function exportExcel\(\)/);
  assert.match(ui, /book_append_sheet\(book, X\.utils\.json_to_sheet\(pivot\), 'Pivot'\)/);
  assert.match(ui, /ensureLibrary\('xlsx'\)/);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(html, /id="postFobExcelExportBtn" disabled/);
});
