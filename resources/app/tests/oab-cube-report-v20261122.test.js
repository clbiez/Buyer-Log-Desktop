'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../server/lib/oab-cube-report');
const parity = require('../server/lib/oab-cube-parity');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const FRESHNESS_COLUMNS = [{ table: 'GuncellemeTarihi', name: 'GuncellemeTarih' }, { table: 'DummyUrun', name: 'etl_time' }];
const liveSchema = ({ dropMeasures = ['markupYi'], extraColumns = [] } = {}) => intakeReport.allowedSchema({
  columns: [
    ...report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
    ...FRESHNESS_COLUMNS.map(item => ({ ...item, kind: 'column', dataType: 'Date' })),
    { table: 'Urun', name: 'FİT', kind: 'column', dataType: 'WChar' },
    { table: 'Data', name: 'Hedef PSF', kind: 'column', dataType: 'WChar' },
    ...extraColumns,
  ],
  measures: report.MEASURES.filter(item => !dropMeasures.includes(item.key)).map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
});

test('bağlantı: OAB_Cube kataloğu ayarlarda varsa o, yoksa INTAKE sunucusu, o da yoksa kaynak Excel sunucusu', () => {
  const none = report.resolveConnection([]);
  assert.deepEqual([none.server, none.catalog, none.source], ['lcwtabular_s20', 'OAB_Cube', 'default']);
  const viaIntake = report.resolveConnection([{ id: 'i', role: 'intake', server: 'lcwtabular_s21', catalog: 'WSSI_Intake_Raporu4' }]);
  assert.deepEqual([viaIntake.server, viaIntake.catalog, viaIntake.source], ['lcwtabular_s21', 'OAB_Cube', 'intake-server']);
  const custom = report.resolveConnection([{ id: 'i', role: 'intake', server: 'lcwtabular_s21', catalog: 'WSSI_Intake_Raporu4' }, { id: 'c', role: 'custom', server: 'lcwtabular_s22', catalog: 'OAB_Cube' }]);
  assert.deepEqual([custom.server, custom.catalog, custom.source], ['lcwtabular_s22', 'OAB_Cube', 'settings']);
});

test('sorgu sezon seçilmeden üretilmez (bütün küp taranmaz)', () => {
  assert.throws(() => report.buildQuery({ liveFields: liveSchema(), filterValues: {} }), error => error.code === 'OAB_CUBE_SEASON_REQUIRED');
});

test('çoklu Sezon × MAG × Buyer grup tek DAX sorgusunda TREATAS filtresi olarak gider; Urun tablosu sorguya girmez', () => {
  const built = report.buildQuery({ liveFields: liveSchema(), filterValues: { season: ['S6', 'W6', 'S6', ''], mag: ['CU4C', 'CU5A'], buyerGroup: ['Erkek Triko', 'Kadın Triko'] } });
  assert.match(built.query, /^EVALUATE\nTOPN\(20000,\n  SUMMARIZECOLUMNS\(/);
  assert.equal((built.query.match(/SUMMARIZECOLUMNS/g) || []).length, 1);
  assert.match(built.query, /TREATAS\(\{ "S6", "W6" \}, 'Sezon'\[SezonKod\]\)/);
  assert.match(built.query, /TREATAS\(\{ "CU4C", "CU5A" \}, 'DummyUrun'\[MerchAltGrupKod\]\)/);
  assert.match(built.query, /TREATAS\(\{ "Erkek Triko", "Kadın Triko" \}, 'DummyUrun'\[BuyerGrupTanim\]\)/);
  assert.match(built.query, /'DummyUrun'\[ModelKod\]/);
  assert.match(built.query, /'DummyUrun'\[RenkKod\]/);
  assert.match(built.query, /"approved", \[Onaylı Sipariş Miktarı\]/);
  assert.match(built.query, /"wssi", \[WSSI Sipariş Miktarı\]/);
  // İlişkisi doğrulanmamış tablo çapraz çarpım üretebilir: sorguya girmez.
  assert.doesNotMatch(built.query, /'Urun'/);
  // Pivotta olmayan isteğe bağlı boyut gruplanmaz.
  assert.doesNotMatch(built.query, /'Data'\[Tedarik Sepeti\]/);
  // Görünümde olmayan isteğe bağlı ölçü eksikse uyarı üretmez ve sorguya girmez.
  assert.deepEqual(built.missing, []);
  assert.doesNotMatch(built.query, /Markup|Landed Fiyat|Depo Giren/);
  assert.deepEqual(built.filterValues.season, ['S6', 'W6']);
  assert.equal(built.headerMap["'DummyUrun'[ModelKod]"], 'modelCode');
  assert.equal(built.headerMap['[approved]'], 'approved');
});

test('isteğe bağlı boyut filtre olarak her zaman uygulanır, yalnız pivot ekseninde gruplanır', () => {
  const filtered = report.buildQuery({ liveFields: liveSchema(), view: { filterValues: { season: ['S6'], supplyBasket: ['Yurtdışı'] } } });
  assert.match(filtered.query, /TREATAS\(\{ "Yurtdışı" \}, 'Data'\[Tedarik Sepeti\]\)/);
  assert.equal(filtered.dimensions.includes('supplyBasket'), false);
  const grouped = report.buildQuery({ liveFields: liveSchema(), view: { rows: ['supplyBasket'], filterValues: { season: ['S6'] } } });
  assert.equal(grouped.dimensions.includes('supplyBasket'), true);
});

test('yalnız görünümdeki ve zorunlu ölçüler sorgulanır; görünümdeki eksik ölçü raporlanır', () => {
  const built = report.buildQuery({ liveFields: liveSchema(), view: { values: ['landedPrice', 'markupYi'], filterValues: { season: ['S6'] } } });
  assert.deepEqual(built.measures.sort(), ['approved', 'landedPrice', 'plan', 'wssi']);
  assert.deepEqual(built.missing, ['markupYi']);
});

test('şema tipi gelmeyen kod/ad filtresi addan tarih sanılmaz (MerchMarkaYasGrupKod)', () => {
  const built = report.buildQuery({ filterValues: { season: ['S6'], brandAgeGroup: ['LCW KIDS'] } });
  assert.match(built.query, /TREATAS\(\{ "LCW KIDS" \}, 'DummyUrun'\[MerchMarkaYasGrupKod\]\)/);
  const typed = report.resolveFilterField([], { key: 'brandAgeGroup' });
  assert.equal(typed.dataType, 'WChar');
  // Şemanın verdiği tip önce gelir.
  const live = intakeReport.allowedSchema({ columns: [{ table: 'DummyUrun', name: 'MerchMarkaYasGrupKod', kind: 'column', dataType: '20' }], measures: [] });
  assert.notEqual(report.resolveFilterField(live, { key: 'brandAgeGroup' }).dataType, 'WChar');
});

test('zorunlu ölçü (onaylı/WSSI/plan) veya model/renk alanı yoksa açık şema hatası verilir', () => {
  assert.throws(() => report.buildQuery({ liveFields: liveSchema({ dropMeasures: ['approved'] }), filterValues: { season: ['S6'] } }), error => error.code === 'OAB_CUBE_SCHEMA_MISMATCH' && /approved/.test(error.message));
});

test('kod alanları asla sayıya çevrilmez; yalnız ölçüler sayıdır (ondalık virgül dahil)', () => {
  const built = report.buildQuery({ liveFields: liveSchema(), filterValues: { season: ['S6'] } });
  const [row] = report.normalizeRows([{ season: 'S6', mag: '0012', modelCode: '3E8', colourCode: '1E5', approved: '1.250', wssi: '12,5', plan: 7 }], built);
  assert.equal(row.modelCode, '3E8');
  assert.equal(row.colourCode, '1E5');
  assert.equal(row.mag, '0012');
  assert.equal(typeof row.modelCode, 'string');
  assert.equal(row.wssi, 12.5);
  assert.equal(row.plan, 7);
  assert.equal(row.unapproved, null);
});

test('görünüm: sezon filtresi her zaman kalır, yalnız kanıtlı tablodan küp boyutu eklenebilir, ölçü özetlemesi korunur', () => {
  const view = report.normalizeView({
    filters: ['mag'],
    rows: ['buyerGroup', { source: '[Urun].[FİT]', label: 'Fit' }, { source: '[Data].[Hedef PSF]', label: 'Hedef PSF' }],
    values: [{ key: 'approved' }, { key: 'plannedStores' }, { key: 'landedPrice', agg: 'MAX' }, { source: '[Measures].[PO Adet Ydisi]', label: 'PO YD', agg: 'sum' }, { source: '[Measures].[WSSI Sipariş Miktarı]' }],
  });
  assert.equal(view.filters[0].key, 'season');
  assert.deepEqual(view.rows.map(ref => ref.key).slice(0, 1), ['buyerGroup']);
  assert.equal(view.rows.some(ref => /Urun/.test(ref.source || '')), false);
  assert.equal(view.rows.some(ref => ref.source === '[Data].[Hedef PSF]'), true);
  assert.deepEqual(view.values.find(ref => ref.key === 'approved'), { key: 'approved', agg: 'SUM' });
  assert.equal(view.values.find(ref => ref.key === 'plannedStores').agg, 'MAX');
  assert.equal(view.values.find(ref => ref.key === 'landedPrice').agg, 'MAX');
  const extra = view.values.find(ref => ref.source === '[Measures].[PO Adet Ydisi]');
  assert.match(extra.key, /^x_[0-9a-f]{16}$/);
  assert.equal(extra.agg, 'SUM');
  // Hazır ölçünün kaynak adı gönderilirse kendi anahtarına iner (çift sütun olmaz).
  assert.equal(view.values.filter(ref => ref.key === 'wssi').length, 1);
  assert.equal(report.isProvenTable('[Urun].[FİT]'), false);
  assert.equal(report.isProvenTable('[DummyUrun].[RenkAd]'), true);
});

test('küp alan havuzu yalnız kanıtlı tablo boyutlarını ve bütün ölçüleri verir', () => {
  const meta = report.metadata(liveSchema());
  assert.equal(meta.dimensions.some(field => field.table === 'Urun'), false);
  assert.equal(meta.dimensions.some(field => field.source === '[Data].[Hedef PSF]'), true);
  assert.equal(meta.measures.some(field => field.baseKey === 'approved'), true);
});

test('veri tarihi GuncellemeTarih (yoksa etl_time) en büyük değeridir; şemada yoksa sorgu üretilmez', () => {
  const plan = report.freshnessQuery(liveSchema());
  assert.match(plan.query, /^EVALUATE ROW\("dataDate", MAX\('GuncellemeTarihi'\[GuncellemeTarih\]\), "etlTime", MAX\('DummyUrun'\[etl_time\]\)\)$/);
  assert.deepEqual(report.normalizeFreshness([{ '[dataDate]': '2026-11-21T03:10:00', etlTime: '2026-11-21T02:00:00' }]), { dataDate: '2026-11-21T03:10:00', dataDateSource: 'GuncellemeTarih', etlTime: '2026-11-21T02:00:00' });
  assert.equal(report.normalizeFreshness([{ etlTime: '2026-11-20' }]).dataDateSource, 'etl_time');
  const withoutDates = intakeReport.allowedSchema({ columns: [{ table: 'DummyUrun', name: 'ModelKod', kind: 'column' }], measures: [] });
  assert.equal(report.freshnessQuery(withoutDates), null);
});

/* ---------- Route ---------- */
function harness(modelRows, { freshness = [{ dataDate: '2026-11-21T03:10:00' }], connections = [] } = {}) {
  const handlers = {};
  const app = {};
  ['get', 'put', 'post'].forEach(method => { app[method] = (url, ...fns) => { handlers[`${method.toUpperCase()} ${url}`] = fns; }; });
  const calls = [], prefs = new Map(), audits = [];
  const userAccess = { requireAnyArea: area => Object.assign((req, res, next) => next(), { area }), requireCapability: cap => Object.assign((req, res, next) => next(), { cap }), appendAudit: (...args) => audits.push(args) };
  const schema = liveSchema();
  const modelQuery = {
    discoverSchema: async () => ({ columns: schema.filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column', dataType: f.dataType })), measures: schema.filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })) }),
    runModelRows: async input => {
      calls.push(input);
      if (/^EVALUATE ROW/.test(input.query)) { if (freshness instanceof Error) throw freshness; return { rows: freshness }; }
      if (modelRows instanceof Error) throw modelRows;
      return { rows: modelRows };
    },
  };
  const userPreferences = { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } };
  require('../server/routes/oab-cube-routes')(app, {
    express: { json: () => (req, res, next) => next() }, userAccess, modelQuery, userPreferences,
    loadModelConnections: () => ({ items: connections }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    store: createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'oab-cube-')) }),
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
  return { call, calls, audits, prefs, handlers };
}

test('route yetkisi FOB Sonrası Maliyet ile aynı: Genel Bakış alanı + OAB.VIEW', () => {
  const h = harness([]);
  for (const key of ['GET /api/oab-cube/state', 'PUT /api/oab-cube/view', 'GET /api/oab-cube/metadata', 'POST /api/oab-cube/distinct', 'POST /api/oab-cube/report']) {
    assert.equal(h.handlers[key][0].area, 'overview', key);
    assert.equal(h.handlers[key][1].cap, 'OAB.VIEW', key);
  }
});

test('rapor: sezonsuz istek reddedilir; sorgu + veri tarihi çalışır; önbellek kullanıcıya özeldir', async () => {
  const h = harness([{ season: 'S6', modelCode: '3E8', colourCode: 'CVL', approved: '10', wssi: '4', plan: '12' }]);
  const missing = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: {} } } });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.body.code, 'OAB_CUBE_SEASON_REQUIRED');
  const first = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.fromCache, false);
  assert.equal(first.body.rows[0].modelCode, '3E8');
  assert.equal(first.body.rows[0].approved, 10);
  assert.equal(first.body.dataDate, '2026-11-21T03:10:00');
  assert.equal(h.calls[0].server, 'lcwtabular_s20');
  assert.equal(h.calls[0].catalog, 'OAB_Cube');
  assert.equal(h.calls.length, 2);
  assert.equal(h.audits[0][1], 'OAB_CUBE_REPORT_FETCH');
  const again = await h.call('POST /api/oab-cube/report', { body: {} });
  assert.equal(again.body.fromCache, true);
  assert.equal(again.body.dataDate, '2026-11-21T03:10:00');
  assert.equal(h.calls.length, 2);
  // Başka kullanıcı aynı filtrelerle önbellekten değil kendi yetkisiyle sorgular.
  const other = await h.call('POST /api/oab-cube/report', { currentUser: { id: 'u2' }, body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(other.body.fromCache, false);
  assert.equal(h.calls.length, 4);
  const state = await h.call('GET /api/oab-cube/state', {});
  assert.equal(state.body.snapshot.rows.length, 1);
  assert.equal(state.body.snapshot.dataDate, '2026-11-21T03:10:00');
  assert.deepEqual(state.body.view.filterValues, { season: ['S6'] });
  assert.equal(state.body.catalog.passOnlyFields.length, 5);
  // Gösterilen verinin sorgu düzeyi istemciye döner (görünümle uyuşmazlık uyarısı için).
  assert.deepEqual(state.body.snapshot.measures.sort(), ['approved', 'plan', 'poQty', 'unapproved', 'wssi']);
  assert.ok(state.body.snapshot.dimensions.includes('modelCode'));
  // Görünüm mevcut lcw.oab. tercih öneki altında saklanır (senkron listesi değişmez).
  assert.equal([...h.prefs.get('u1')].some(([key]) => key === 'lcw.oab.cube.view.v1'), true);
});

test('veri tarihi okunamazsa rapor yine döner; tarih boş kalır', async () => {
  const h = harness([{ season: 'S6', modelCode: 'M1', colourCode: 'C1', approved: '1' }], { freshness: Object.assign(new Error('x'), { code: 'MODEL_QUERY_FAILED' }) });
  const res = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dataDate, '');
  assert.equal(res.body.rows.length, 1);
});

test('kaynak kesintisinde son snapshot çevrimdışı döner; snapshot yoksa iç ayrıntı sızdırmayan güvenli hata', async () => {
  const outage = Object.assign(new Error('boom \\\\server'), { code: 'MODEL_QUERY_FAILED' });
  const empty = harness(outage);
  const failed = await empty.call('POST /api/oab-cube/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.code, 'OAB_CUBE_SOURCE_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(failed.body), /boom|server/);
});

/* ---------- PASS ↔ küp parity ---------- */
const PASS_ROWS = [
  { Sezon: 'S6', 'Merch Alt Grup': 'CU4C', 'Buyer Grup Tanımı': 'Erkek Triko', 'Option Adı': 'KK.BDY,GARFIELD-1-YD', 'Renk Kodu': '3E8', 'Onaylı Sipariş Miktarı': '2.908', 'WSSI Sipariş Miktarı': 100, 'Plan Sipariş Miktarı': 50 },
  { Sezon: 'S6', 'Merch Alt Grup': 'CU4C', 'Buyer Grup Tanımı': 'Erkek Triko', 'Option Adı': 'KK.BDY,GARFIELD-1-YD', 'Renk Kodu': '3E8', 'Onaylı Sipariş Miktarı': 92, 'WSSI Sipariş Miktarı': '', 'Plan Sipariş Miktarı': 0 },
  { Sezon: 'S6', 'Merch Alt Grup': 'CU4C', 'Buyer Grup Tanımı': 'Erkek Triko', 'Option Adı': 'PNT,BARRY-YD', 'Renk Kodu': '300', 'Onaylı Sipariş Miktarı': 10, 'WSSI Sipariş Miktarı': 10, 'Plan Sipariş Miktarı': 10 },
  { Sezon: 'S6', 'Merch Alt Grup': 'CU5A', 'Buyer Grup Tanımı': 'Kadın Triko', 'Option Adı': 'OUT,OF-SCOPE', 'Renk Kodu': 'X1', 'Onaylı Sipariş Miktarı': 999 },
  { Sezon: 'S6', 'Merch Alt Grup': 'CU4C', 'Buyer Grup Tanımı': 'Erkek Triko', 'Option Adı': 'ONLY,PASS', 'Renk Kodu': 'P1', 'Onaylı Sipariş Miktarı': 5 },
];
const CUBE_ROWS = [
  { season: 'S6', mag: 'CU4C', buyerGroup: 'Erkek Triko', modelName: 'GARFIELD-1-YD', colourCode: '3E8', approved: 3000, wssi: 100, plan: 50 },
  { season: 'S6', mag: 'CU4C', buyerGroup: 'Erkek Triko', modelName: 'BARRY-YD', colourCode: '3E2', approved: 10, wssi: 10, plan: 10 },
  { season: 'S6', mag: 'CU4C', buyerGroup: 'Erkek Triko', modelName: 'BARRY-YD', colourCode: '300', approved: 12, wssi: 10, plan: null },
];

test('parity: aynı kapsam ve model+renk anahtarında adet farkı raporlanır; önek atılır, kod sayıya çevrilmez', () => {
  const result = parity.compare({ passRows: PASS_ROWS, cubeRows: CUBE_ROWS, scope: { seasons: ['S6'], mags: ['CU4C'], buyerGroups: ['Erkek Triko'] }, measures: ['approved', 'wssi', 'plan'] });
  assert.equal(result.ok, false);
  assert.equal(result.summary.passInScope, 4);
  assert.equal(result.summary.cubeInScope, 3);
  // GARFIELD 3E8: PASS 2908 + 92 = 3000 (Türkçe binlik) → eşit; WSSI boş satır 0 sayılmaz.
  assert.equal(result.summary.equalKeys, 1);
  // "300" ile "3E2" aynı sayı değildir: kod alanı metin karşılaştırılır.
  assert.equal(result.cubeOnly.some(item => item.colour === '3E2'), true);
  const barry = result.mismatches.find(item => item.model === 'BARRY-YD' && item.colour === '300');
  assert.deepEqual(barry.diffs.approved, { pass: 10, cube: 12, diff: 2 });
  // Bir tarafta hiç değer yoksa uydurma sıfırla fark hesaplanmaz.
  assert.deepEqual(barry.diffs.plan, { pass: 10, cube: null, diff: null });
  assert.equal(barry.diffs.wssi, undefined);
  assert.deepEqual(result.passOnly.map(item => item.model), ['PASS']);
  assert.equal(result.totals.approved.pass, 3015);
  assert.equal(result.totals.approved.cube, 3022);
  assert.equal(result.totals.approved.diff, 7);
});

test('parity: 0 ile boş fark sayılmaz ama ayrı raporlanır; anahtarsız satırlar toplamlardan düşmez', () => {
  const result = parity.compare({
    passRows: [{ Sezon: 'S6', 'Option Adı': 'A,M1', 'Renk Kodu': 'C1', 'Onaylı Sipariş Miktarı': 5, 'PO Miktarı': '0' }, { Sezon: 'S6', 'Option Adı': '', 'Renk Kodu': 'C9', 'Onaylı Sipariş Miktarı': 7 }],
    cubeRows: [{ season: 'S6', modelName: 'M1', colourCode: 'C1', approved: 5, poQty: null }],
    measures: ['approved', 'poQty'],
  });
  assert.equal(result.summary.zeroVsBlank, 1);
  assert.equal(result.mismatches.length, 0);
  assert.equal(result.summary.passKeyless, 1);
  assert.equal(result.totals.approved.pass, 12);
  assert.equal(result.totals.approved.diff, -7);
  assert.deepEqual(result.keylessTotals.pass, { approved: 7 });
  assert.equal(result.ok, false, 'eşleştirilemeyen adet varken ok olmaz');
});

test('parity: tolerans ve kapsam dışı satırlar; tamamen eşleşen kümede ok=true', () => {
  const same = parity.compare({ passRows: PASS_ROWS.slice(0, 2), cubeRows: CUBE_ROWS.slice(0, 1), scope: { seasons: ['s6'] }, measures: ['approved'] });
  assert.equal(same.ok, true);
  assert.equal(same.summary.matchedKeys, 1);
  const tolerant = parity.compare({ passRows: [PASS_ROWS[2]], cubeRows: [CUBE_ROWS[2]], measures: ['approved'], tolerance: 2 });
  assert.equal(tolerant.ok, true);
  assert.equal(parity.modelKey('kk.bdy, Garfield-1-YD'), 'GARFIELD-1-YD');
  assert.equal(parity.quantity('2.908'), 2908);
  assert.equal(parity.quantity('12,5'), 12.5);
  assert.equal(parity.quantity(''), null);
});

/* ---------- İstemci ve ortak dosya sözleşmesi ---------- */
test('widget OAB/INTAKE başlık yapısıyla Ticari sayfasına eklenir; PASS OAB widget yerinde kalır', () => {
  const html = read('public/index.html');
  assert.match(html, /<div id="oabCubeSection" data-overview-widget="oabCube" class="cardBox intakeSection oabCubeSection">\s*<div class="oabHeader intakeHeader">/);
  assert.match(html, /data-i18n-tr="OAB \(Küp\)" data-i18n-en="OAB \(Cube\)"/);
  assert.match(html, /id="oabSection"/);
  const layout = require('../public/overview-layout');
  assert.equal(layout.REGISTRY.oabCube.tr, 'OAB (Küp)');
  assert.equal(layout.REGISTRY.oabCube.en, 'OAB (Cube)');
  assert.equal(layout.REGISTRY.oabCube.group, 'commercial');
  const commercial = layout.defaults().pages.find(page => page.name && page.name.en === 'Commercial');
  assert.equal(commercial.items.some(item => item.key === 'oabCube'), true);
  assert.equal(commercial.items.some(item => item.key === 'oab'), true);
});

test('istemci: pivot toplamları OABPivotEngine ile, görünür olunca yüklenir, PASS uç noktası çağırmaz', () => {
  const js = read('public/oab-cube.js');
  assert.match(js, /window\.OABPivotEngine/);
  assert.match(js, /verifyTotal\(rows, ref\.key, ref\.agg \|\| 'SUM'\)/);
  assert.match(js, /new IntersectionObserver/);
  assert.match(js, /\/api\/oab-cube\/report/);
  assert.doesNotMatch(js, /\/api\/oab\/|pass\.prod/);
  assert.match(js, /Veri tarihi', 'Data date'/);
  assert.match(js, /passOnlyFields/);
  assert.match(js, /BLDetailDrawer\.open/);
  assert.match(js, /function staleReason\(\)/);
  // Excel özeti veriyi üreten filtrelerle; değer araması küpe gider (ilk 1.000 ile sınırlı değil).
  assert.match(js, /const dataFilters = state\.dataFilterValues \|\| view\(\)\.filterValues/);
  assert.match(js, /search: needle, limit: 1000/);
  assert.match(js, /seq === requestSeq/);
  assert.match(js, /hasValue\(ref\.key\) \? pivot\.verifyTotal/);
  assert.match(js, /book_append_sheet/);
  const main = read('public/app-main.js');
  assert.match(main, /function ensureOverviewOabCubeModule\(\)/);
  assert.match(main, /Promise\.resolve\(ensureOverviewOabModule\(\)\)\s*\.then\(\(\)=>loader\('oab-cube\.js\?rev=\d+'\)\)/);
  assert.match(main, /if\(tab==='overview'\)void ensureOverviewOabCubeModule\(\);/);
  const home = read('public/overview-home.js');
  assert.match(home, /size\.item\.key==='oabCube'/);
  assert.match(home, /#oabCubeSection > \*/);
});
