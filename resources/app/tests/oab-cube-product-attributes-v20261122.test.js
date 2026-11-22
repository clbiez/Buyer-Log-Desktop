'use strict';

/* OAB (Küp) ürün özellikleri: FİT, Silüet, Kumaş-malzeme tipi.
 *
 * Alanlar küpün Urun tablosundadır; Urun'un ölçülerle ilişkisi doğrulanmadığı
 * için ANA sorguya girmez (PROVEN_TABLES kuralı korunur). Ayrı, ölçüsüz bir
 * "ürün özellikleri" sorgusu ana sonuçtaki ModelKod listesiyle (TREATAS)
 * çalışır; sonuç sunucuda ModelKod + RenkKod anahtarıyla ana satırlara eklenir.
 * Ölçüler yalnız ana sorgudan gelir: satır sayısı ve adetler değişmez.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const report = require('../server/lib/oab-cube-report');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

const URUN_COLUMNS = ['ModelKod', 'RenkKod', 'FİT', 'SİLÜET', 'KUMAŞ-MALZEME TİPİ', 'MerchAltGrupKod', 'BuyerGrupTanim', 'UrunKey'];
function liveSchema({ urun = URUN_COLUMNS } = {}) {
  return intakeReport.allowedSchema({
    columns: [
      ...report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
      ...urun.map(name => ({ table: 'Urun', name, kind: 'column', dataType: 'WChar' })),
    ],
    measures: report.MEASURES.map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
  });
}
const S6 = { season: ['S6'] };

/* ---------- Katalog ve görünüm ---------- */
test('katalog: FİT, Silüet ve Kumaş-malzeme tipi yerel metin boyutu olarak iki dilde listelenir', () => {
  assert.deepEqual(report.PRODUCT_ATTRIBUTES.map(item => [item.key, item.source]), [
    ['fit', '[Urun].[FİT]'],
    ['silhouette', '[Urun].[SİLÜET]'],
    ['fabricType', '[Urun].[KUMAŞ-MALZEME TİPİ]'],
  ]);
  const catalog = report.catalog();
  for (const key of ['fit', 'silhouette', 'fabricType']) {
    const dim = catalog.dimensions.find(item => item.key === key);
    assert.ok(dim, key);
    assert.equal(dim.attribute, true);
    assert.equal(dim.filter, true);
    assert.equal(dim.code, false);
    assert.ok(dim.tr && dim.en, key);
  }
  assert.equal(catalog.dimensions.find(item => item.key === 'fit').en, 'Fit');
  assert.equal(catalog.dimensions.find(item => item.key === 'silhouette').en, 'Silhouette');
  // Ana sorgunun boyut listesine (DIMENSIONS) girmez.
  assert.equal(report.DIMENSIONS.some(item => /^\[Urun\]/.test(item.source)), false);
  // PASS-only listesinde FİT/Silüet yoktur (artık küpten okunur).
  assert.equal(catalog.passOnlyFields.some(item => /FİT|Fit|Silüet|Silhouette|Kumaş/i.test(`${item.tr} ${item.en}`)), false);
  assert.deepEqual(report.PROVEN_TABLES, ['Data', 'DummyUrun', 'Sezon']);
});

test('görünüm: ürün özellikleri satır/sütun/filtre ve alt detayda kullanılabilir; [Urun] kaynağı hazır anahtara iner, diğer Urun alanları yine reddedilir', () => {
  const view = report.normalizeView({
    rows: ['classGroup', 'fit'],
    columns: [{ source: '[Urun].[SİLÜET]', label: 'Silüet' }],
    filters: ['season', { source: '[Urun].[KUMAŞ-MALZEME TİPİ]' }, { source: '[Urun].[UrunKey]' }],
    filterValues: { season: ['S6'], fabricType: ['Örme', ''] },
    detailAttributes: ['fabricType', 'bogus', 'fit', 'fit'],
  });
  assert.deepEqual(view.rows.map(ref => ref.key), ['classGroup', 'fit']);
  assert.deepEqual(view.columns, [{ key: 'silhouette' }]);
  assert.deepEqual(view.filters.map(ref => ref.key), ['season', 'fabricType']);
  assert.equal(view.filters.some(ref => /Urun/.test(ref.source || '')), false);
  assert.deepEqual(view.filterValues, { season: ['S6'], fabricType: ['Örme'] });
  assert.deepEqual(view.detailAttributes, ['fit', 'fabricType']);
  assert.deepEqual(report.normalizeView(null).detailAttributes, []);
});

test('kullanım: yalnız pivot satır/sütun/filtre veya alt detaydaki özellik sorgulanır; varsayılan görünümde hiçbiri', () => {
  assert.deepEqual(report.usedProductAttributes(report.normalizeView(null)), []);
  assert.deepEqual(report.usedProductAttributes(report.normalizeView({ rows: ['fit'] })), ['fit']);
  assert.deepEqual(report.usedProductAttributes(report.normalizeView({ columns: ['silhouette'] })), ['silhouette']);
  assert.deepEqual(report.usedProductAttributes(report.normalizeView({ filters: ['fabricType'] })), ['fabricType']);
  assert.deepEqual(report.usedProductAttributes(report.normalizeView({ detailAttributes: ['silhouette', 'fit'] })), ['fit', 'silhouette']);
});

test('ana sorgu değişmez: özellik ekseni ve özellik filtresi ana DAX\'a girmez, önbellek filtresine de girmez', () => {
  const base = report.buildQuery({ liveFields: liveSchema(), view: { rows: ['classGroup'], filterValues: S6 } });
  const withAttrs = report.buildQuery({ liveFields: liveSchema(), view: { rows: ['classGroup', 'fit'], columns: ['silhouette'], filters: ['season', 'fabricType'], filterValues: { season: ['S6'], fabricType: ['Örme'] }, detailAttributes: ['fit'] } });
  assert.equal(withAttrs.query, base.query);
  assert.doesNotMatch(withAttrs.query, /'Urun'|Urun\[/);
  assert.deepEqual(withAttrs.filterValues, { season: ['S6'] });
  assert.deepEqual(withAttrs.dimensions, base.dimensions);
  assert.deepEqual(withAttrs.measures, base.measures);
  assert.deepEqual(withAttrs.attributes, ['fit', 'silhouette', 'fabricType']);
  assert.deepEqual(base.attributes, []);
});

/* ---------- Ayrı özellik sorgusu ---------- */
const mainRows = n => Array.from({ length: n }, (_, i) => ({ modelCode: `M${String(i).padStart(5, '0')}`, colourCode: i % 2 ? 'C1' : '3E8', approved: 10, wssi: 1 }));

test('özellik sorgusu: ayrı SUMMARIZECOLUMNS, Urun ModelKod/RenkKod + istenen özellikler, ana sonuçtaki ModelKod listesiyle TREATAS; ölçü, MAG ve buyer grup yok', () => {
  const rows = [...mainRows(3), { modelCode: 'M00000', colourCode: 'C9' }, { modelCode: '', colourCode: 'C1' }];
  const plan = report.productAttributeQueries({ liveFields: liveSchema(), rows, attributes: ['fit', 'fabricType'] });
  assert.equal(plan.queries.length, 1);
  const { query, headerMap, maxRows } = plan.queries[0];
  assert.match(query, /^EVALUATE\nTOPN\(20000,\n  SUMMARIZECOLUMNS\(/);
  assert.equal((query.match(/SUMMARIZECOLUMNS/g) || []).length, 1);
  assert.match(query, /'Urun'\[ModelKod\],\n    'Urun'\[RenkKod\],\n    'Urun'\[FİT\],\n    'Urun'\[KUMAŞ-MALZEME TİPİ\],/);
  assert.match(query, /TREATAS\(\{ "M00000", "M00001", "M00002" \}, 'Urun'\[ModelKod\]\)/);
  assert.doesNotMatch(query, /SİLÜET/);
  assert.doesNotMatch(query, /Measures|\[WSSI|\[Onaylı|"approved"/);
  assert.doesNotMatch(query, /MerchAltGrupKod|BuyerGrupTanim|DummyUrun|Sezon/);
  assert.equal(maxRows, 20000);
  assert.equal(headerMap["'Urun'[ModelKod]"], 'modelCode');
  assert.equal(headerMap["'Urun'[RenkKod]"], 'colourCode');
  assert.equal(headerMap["'Urun'[FİT]"], 'fit');
  assert.equal(headerMap["'Urun'[KUMAŞ-MALZEME TİPİ]"], 'fabricType');
  assert.deepEqual(plan.modelCodes, ['M00000', 'M00001', 'M00002']);
  assert.deepEqual(plan.fetched, ['fit', 'fabricType']);
  assert.deepEqual(plan.missing, []);
  assert.match(plan.modelSetHash, /^[0-9a-f]{64}$/);
  // Boş istek: sorgu üretilmez.
  assert.deepEqual(report.productAttributeQueries({ liveFields: liveSchema(), rows, attributes: [] }).queries, []);
  assert.deepEqual(report.productAttributeQueries({ liveFields: liveSchema(), rows: [], attributes: ['fit'] }).queries, []);
});

test('özellik sorgusu: model listesi parça başına 1.000 literal ile bölünür; parçalar ayrık ve hepsi birlikte tam listedir', () => {
  assert.equal(report.PRODUCT_ATTRIBUTE_CHUNK, 1000);
  const plan = report.productAttributeQueries({ liveFields: liveSchema(), rows: mainRows(2500), attributes: ['fit'] });
  assert.equal(plan.queries.length, 3);
  assert.deepEqual(plan.queries.map(item => item.modelCodes.length), [1000, 1000, 500]);
  const all = plan.queries.flatMap(item => item.modelCodes);
  assert.equal(new Set(all).size, 2500);
  assert.deepEqual(all, plan.modelCodes);
  plan.queries.forEach(item => assert.equal((item.query.match(/"M\d{5}"/g) || []).length, item.modelCodes.length));
  // Ana sorgu en fazla 20.000 satırdır; 20 parça bütün model kümesini kapsar.
  assert.equal(report.PRODUCT_ATTRIBUTE_CHUNK * report.PRODUCT_ATTRIBUTE_MAX_CHUNKS >= report.OAB_CUBE_MAX_ROWS, true);
  // Model kümesinin özeti sıraya bağlı değildir, kümeye bağlıdır.
  const reversed = report.productAttributeQueries({ liveFields: liveSchema(), rows: mainRows(2500).reverse(), attributes: ['fit'] });
  assert.equal(reversed.modelSetHash, plan.modelSetHash);
  assert.notEqual(report.productAttributeQueries({ liveFields: liveSchema(), rows: mainRows(2499), attributes: ['fit'] }).modelSetHash, plan.modelSetHash);
});

test('şema: ModelKod/RenkKod veya istenen özelliklerin hiçbiri yoksa açık şema hatası; bir kısmı yoksa eksik listesi', () => {
  assert.throws(() => report.productAttributeQueries({ liveFields: liveSchema({ urun: ['FİT', 'SİLÜET'] }), rows: mainRows(2), attributes: ['fit'] }), error => error.code === 'OAB_CUBE_ATTRIBUTES_SCHEMA');
  assert.throws(() => report.productAttributeQueries({ liveFields: liveSchema({ urun: ['ModelKod', 'RenkKod'] }), rows: mainRows(2), attributes: ['fit'] }), error => error.code === 'OAB_CUBE_ATTRIBUTES_SCHEMA');
  const partial = report.productAttributeQueries({ liveFields: liveSchema({ urun: ['ModelKod', 'RenkKod', 'FİT'] }), rows: mainRows(2), attributes: ['fit', 'silhouette'] });
  assert.deepEqual(partial.fetched, ['fit']);
  assert.deepEqual(partial.missing, ['silhouette']);
  assert.doesNotMatch(partial.queries[0].query, /SİLÜET/);
});

/* ---------- Birleştirme ---------- */
test('birleştirme: ModelKod + RenkKod anahtarı; tek değer yazılır, birden çok değer "Çoklu" işaretiyle listelenir, eşleşmeyen boş kalır; adet ve satır sayısı değişmez', () => {
  const rows = [
    { modelCode: '3E8', colourCode: '1E5', classGroup: 'A', approved: 100, wssi: 40, plan: 7 },
    { modelCode: '3E8', colourCode: 'C2', classGroup: 'A', approved: 50, wssi: 0, plan: 3 },
    { modelCode: 'M2', colourCode: 'C1', classGroup: 'B', approved: 25, wssi: 25, plan: null },
    { modelCode: 'M3', colourCode: 'C1', classGroup: 'B', approved: 5, wssi: 5, plan: 1 },
  ];
  const attrRows = report.normalizeProductAttributeRows([
    { modelCode: '3E8', colourCode: '1E5', fit: 'Slim', silhouette: 'Düz' },
    // Aynı model + renk için yinelenen ve boş değerli satırlar çoğaltma yapmaz.
    { modelCode: '3E8', colourCode: '1E5', fit: 'Slim', silhouette: '' },
    { modelCode: '3E8', colourCode: 'C2', fit: 'Regular', silhouette: 'Düz' },
    { modelCode: '3E8', colourCode: 'C2', fit: 'Slim', silhouette: 'Düz' },
    { modelCode: '3E8', colourCode: 'C2', fit: 'Oversize', silhouette: 'Düz' },
    { modelCode: 'M2', colourCode: 'C7', fit: 'Slim', silhouette: 'A' },
    { modelCode: 3, colourCode: 'C1', fit: 'X' },
  ], ['fit', 'silhouette']);
  const sumOf = (list, key) => list.reduce((total, row) => total + (row[key] || 0), 0);
  const merged = report.mergeProductAttributes(rows, attrRows, ['fit', 'silhouette']);
  assert.equal(merged.rows.length, rows.length);
  for (const key of ['approved', 'wssi', 'plan']) assert.equal(sumOf(merged.rows, key), sumOf(rows, key), key);
  assert.deepEqual(merged.rows.map(row => row.plan), [7, 3, null, 1]);
  assert.equal(merged.rows[0].fit, 'Slim');
  assert.equal(merged.rows[0].silhouette, 'Düz');
  assert.equal(merged.rows[0].attrMulti, undefined);
  assert.equal(merged.rows[1].fit, report.PRODUCT_ATTRIBUTE_MULTI);
  assert.deepEqual(merged.rows[1].attrMulti, { fit: ['Oversize', 'Regular', 'Slim'] });
  assert.equal(merged.rows[1].silhouette, 'Düz');
  // Model eşleşir ama renk eşleşmez: boş; hiçbir değer seçilip yazılmaz.
  assert.equal(merged.rows[2].fit, '');
  assert.equal(merged.rows[3].fit, '');
  assert.equal(merged.matchedRows, 2);
  assert.equal(merged.multiRows, 1);
  // Kod alanları metin kalır; girdi satırları değiştirilmez.
  assert.equal(merged.rows[0].modelCode, '3E8');
  assert.equal(merged.rows[0].colourCode, '1E5');
  assert.equal(rows[0].fit, undefined);
  assert.equal(attrRows.find(row => row.fit === 'X').modelCode, '3');
});

test('adet değişmezliği: özellik satırları kaç kez yinelenirse yinelensin pivot girdisi aynı satır kümesidir', () => {
  const rows = mainRows(300).map((row, i) => ({ ...row, approved: 10 + i, wssi: i % 3 ? 4 : 0 }));
  const attr = [];
  rows.forEach((row, i) => { for (let k = 0; k < 1 + (i % 4); k++) attr.push({ modelCode: row.modelCode, colourCode: row.colourCode, fit: `F${(i + k) % 3}` }); });
  const merged = report.mergeProductAttributes(rows, report.normalizeProductAttributeRows(attr, ['fit']), ['fit']);
  assert.equal(merged.rows.length, rows.length);
  assert.equal(merged.rows.reduce((t, r) => t + r.approved, 0), rows.reduce((t, r) => t + r.approved, 0));
  assert.deepEqual(merged.rows.map(r => [r.modelCode, r.colourCode, r.approved, r.wssi]), rows.map(r => [r.modelCode, r.colourCode, r.approved, r.wssi]));
});

/* ---------- Route ---------- */
function harness({ attrRows = [], attrError = null, schemaUrun = URUN_COLUMNS, rows = null } = {}) {
  const handlers = {};
  const app = {};
  ['get', 'put', 'post'].forEach(method => { app[method] = (url, ...fns) => { handlers[`${method.toUpperCase()} ${url}`] = fns; }; });
  const calls = [], prefs = new Map(), audits = [];
  const schema = liveSchema({ urun: schemaUrun });
  const state = { rows: rows || [
    { season: 'S6', modelCode: '3E8', colourCode: '1E5', classGroup: 'A', approved: '100', wssi: '40', plan: '7' },
    { season: 'S6', modelCode: '3E8', colourCode: 'C2', classGroup: 'A', approved: '50', wssi: '0', plan: '3' },
    { season: 'S6', modelCode: 'M2', colourCode: 'C1', classGroup: 'B', approved: '25', wssi: '25', plan: '1' },
  ], attrRows, attrError };
  const modelQuery = {
    discoverSchema: async () => ({ columns: schema.filter(f => f.fieldType === 'dimension').map(f => ({ table: f.table, name: f.name, kind: 'column', dataType: f.dataType })), measures: schema.filter(f => f.fieldType === 'measure').map(f => ({ table: 'Measures', name: f.name, kind: 'measure' })) }),
    runModelRows: async input => {
      calls.push(input);
      if (/^EVALUATE ROW/.test(input.query)) return { rows: [{ dataDate: '2026-11-21T03:10:00' }] };
      if (/'Urun'/.test(input.query)) { if (state.attrError) throw state.attrError; return { rows: state.attrRows }; }
      return { rows: state.rows };
    },
  };
  const userPreferences = { load: id => ({ entries: Object.fromEntries(prefs.get(id) || []) }), merge: (id, patch) => { const m = new Map(prefs.get(id) || []); Object.entries(patch).forEach(([k, v]) => m.set(k, v)); prefs.set(id, [...m]); return { entries: Object.fromEntries(m) }; } };
  require('../server/routes/oab-cube-routes')(app, {
    express: { json: () => (req, res, next) => next() },
    userAccess: { requireAnyArea: () => (req, res, next) => next(), requireCapability: () => (req, res, next) => next(), appendAudit: (...args) => audits.push(args) },
    modelQuery, userPreferences,
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) },
    store: createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'oab-cube-attr-')) }),
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
  const attrCalls = () => calls.filter(item => /'Urun'/.test(item.query));
  const mainCalls = () => calls.filter(item => /SUMMARIZECOLUMNS/.test(item.query) && !/'Urun'/.test(item.query));
  return { call, calls, attrCalls, mainCalls, state, audits };
}
const ATTR_ROWS = [
  { "'Urun'[ModelKod]": '3E8', "'Urun'[RenkKod]": '1E5', "'Urun'[FİT]": 'Slim' },
  { "'Urun'[ModelKod]": '3E8', "'Urun'[RenkKod]": 'C2', "'Urun'[FİT]": 'Regular' },
  { "'Urun'[ModelKod]": '3E8', "'Urun'[RenkKod]": 'C2', "'Urun'[FİT]": 'Slim' },
].map(row => ({ modelCode: row["'Urun'[ModelKod]"], colourCode: row["'Urun'[RenkKod]"], fit: row["'Urun'[FİT]"] }));

test('route: özellik kullanılmıyorsa ek sorgu atılmaz; yanıt önceki sürümle aynı alanları taşır', async () => {
  const h = harness({ attrRows: ATTR_ROWS });
  const res = await h.call('POST /api/oab-cube/report', { body: { view: { filterValues: S6 } } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(h.attrCalls().length, 0);
  // Yalnız ana sorgu (bu şemada veri tarihi sütunu yok).
  assert.equal(h.calls.length, 1);
  assert.equal(h.mainCalls().length, 1);
  assert.equal(res.body.productAttributes, null);
  assert.equal(res.body.rows.some(row => 'fit' in row || 'attrMulti' in row), false);
  // Alt detay sütunu olarak seçilmemiş, filtre değeri olmayan özellik de yok.
  assert.match(read('server/routes/oab-cube-routes.js'), /report: 'oab-cube', version: 2/);
});

test('route: pivotta özellik varsa ayrı sorgu çalışır, satırlara eklenir; ana sorgu ve ana önbellek anahtarı değişmez', async () => {
  const h = harness({ attrRows: ATTR_ROWS });
  const plain = await h.call('POST /api/oab-cube/report', { body: { view: { rows: ['classGroup'], filterValues: S6 } } });
  assert.equal(plain.body.fromCache, false);
  const withFit = await h.call('POST /api/oab-cube/report', { body: { view: { rows: ['classGroup', 'fit'], filterValues: S6 } } });
  assert.equal(withFit.statusCode, 200, JSON.stringify(withFit.body));
  // Ana sonuç önbellekten gelir (anahtar özellikten bağımsız); yalnız özellik sorgusu atılır.
  assert.equal(withFit.body.fromCache, true);
  assert.equal(h.mainCalls().length, 1);
  assert.equal(h.attrCalls().length, 1);
  assert.match(h.attrCalls()[0].query, /TREATAS\(\{ "3E8", "M2" \}, 'Urun'\[ModelKod\]\)/);
  assert.equal(withFit.body.rows.length, 3);
  assert.deepEqual(withFit.body.rows.map(row => row.fit), ['Slim', report.PRODUCT_ATTRIBUTE_MULTI, '']);
  assert.deepEqual(withFit.body.rows[1].attrMulti, { fit: ['Regular', 'Slim'] });
  assert.deepEqual(withFit.body.rows.map(row => row.approved), plain.body.rows.map(row => row.approved));
  assert.ok(withFit.body.dimensions.includes('fit'));
  assert.equal(withFit.body.productAttributes.ok, true);
  assert.deepEqual(withFit.body.productAttributes.fetched, ['fit']);
  assert.equal(withFit.body.productAttributes.matchedRows, 2);
  assert.equal(withFit.body.productAttributes.multiRows, 1);
  assert.equal(withFit.body.productAttributes.chunks, 1);
  assert.equal(withFit.body.productAttributes.truncated, false);
  // Snapshot birleşik satırları ve özellik durumunu saklar (sayfa yenilenince aynı görünür).
  const state = await h.call('GET /api/oab-cube/state', {});
  assert.equal(state.body.snapshot.rows[1].fit, report.PRODUCT_ATTRIBUTE_MULTI);
  assert.equal(state.body.snapshot.productAttributes.ok, true);
});

test('route önbelleği: özellik sorgusu ayrı anahtarla saklanır; anahtar kullanıcı, model kümesi özeti ve bağlantıyı içerir; Yenile önbelleği atlar', async () => {
  const h = harness({ attrRows: ATTR_ROWS });
  const body = { view: { rows: ['classGroup'], filterValues: S6, detailAttributes: ['fit'] } };
  const first = await h.call('POST /api/oab-cube/report', { body });
  assert.equal(first.body.productAttributes.fromCache, false);
  assert.ok(first.body.rows.every(row => 'fit' in row));
  const again = await h.call('POST /api/oab-cube/report', { body });
  assert.equal(again.body.productAttributes.fromCache, true);
  assert.equal(h.attrCalls().length, 1);
  // Başka kullanıcı kendi yetkisiyle sorgular.
  await h.call('POST /api/oab-cube/report', { currentUser: { id: 'u2' }, body });
  assert.equal(h.attrCalls().length, 2);
  // Model kümesi değişince (yeni ana sonuç) özellik önbelleği isabet etmez.
  h.state.rows = [...h.state.rows, { season: 'S6', modelCode: 'M9', colourCode: 'C1', approved: '1', wssi: '1', plan: '1' }];
  const changed = await h.call('POST /api/oab-cube/report', { body: { ...body, forceRefresh: true } });
  assert.equal(changed.body.productAttributes.fromCache, false);
  assert.equal(h.attrCalls().length, 3);
  assert.match(h.attrCalls()[2].query, /"M9"/);
  // Aynı küme + Yenile (forceRefresh): özellik de küpten yeniden okunur.
  await h.call('POST /api/oab-cube/report', { body: { ...body, forceRefresh: true } });
  assert.equal(h.attrCalls().length, 4);
  const source = read('server/routes/oab-cube-routes.js');
  assert.match(source, /report: 'oab-cube-attributes'/);
  assert.match(source, /modelSet: plan\.modelSetHash/);
  assert.match(source, /user: String\(userId\)/);
});

test('route hata: özellik sorgusu düşerse veya alanlar canlı şemada yoksa widget çalışır, durum ok=false döner', async () => {
  const failing = harness({ attrError: Object.assign(new Error('DAX column not found \\\\srv'), { code: 'MODEL_QUERY_FAILED' }) });
  const res = await failing.call('POST /api/oab-cube/report', { body: { view: { rows: ['classGroup', 'fit'], filterValues: S6 } } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.rows.length, 3);
  assert.equal(res.body.productAttributes.ok, false);
  assert.equal(res.body.productAttributes.code, 'OAB_CUBE_ATTRIBUTES_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(res.body.productAttributes), /srv|DAX column/);
  assert.deepEqual(res.body.rows.map(row => row.fit), ['', '', '']);
  // Başarısız sonuç önbelleğe yazılmaz: kaynak düzelince sonraki istek yeniden dener.
  failing.state.attrError = null; failing.state.attrRows = ATTR_ROWS;
  const retry = await failing.call('POST /api/oab-cube/report', { body: { view: { rows: ['classGroup', 'fit'], filterValues: S6 } } });
  assert.equal(retry.body.productAttributes.ok, true);
  assert.equal(failing.attrCalls().length, 2);

  const noSchema = harness({ schemaUrun: ['UrunKey'] });
  const res2 = await noSchema.call('POST /api/oab-cube/report', { body: { view: { rows: ['classGroup', 'fit'], filterValues: S6 } } });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.productAttributes.ok, false);
  assert.equal(res2.body.productAttributes.code, 'OAB_CUBE_ATTRIBUTES_SCHEMA');
  assert.equal(noSchema.attrCalls().length, 0);
  assert.equal(res2.body.rows.length, 3);
});

test('route: özellik sorgusu parça sınırına ulaşırsa kesilme bildirilir', async () => {
  const many = Array.from({ length: 1500 }, (_, i) => ({ season: 'S6', modelCode: `M${i}`, colourCode: 'C1', approved: '1', wssi: '1', plan: '1' }));
  const h = harness({ rows: many, attrRows: Array.from({ length: 20000 }, (_, i) => ({ modelCode: `M${i % 1500}`, colourCode: 'C1', fit: `F${i % 7}` })) });
  const res = await h.call('POST /api/oab-cube/report', { body: { view: { rows: ['fit'], filterValues: S6 } } });
  assert.equal(h.attrCalls().length, 2);
  assert.equal(res.body.productAttributes.chunks, 2);
  assert.equal(res.body.productAttributes.truncated, true);
  assert.equal(res.body.rows.length, 1500);
});

/* ---------- İstemci sözleşmesi ---------- */
test('istemci: özellik yerel filtre, "Çoklu"/"Multiple" ipucu, uyarı, sorgu düzeyi ve Excel/alt detay sözleşmesi', () => {
  const js = read('public/oab-cube.js');
  // Çoklu değer iki dilde yazılır, ipucunda değerler listelenir.
  assert.match(js, /text\('Çoklu', 'Multiple'\)/);
  assert.match(js, /attrMulti/);
  // Özellik filtresi yerel uygulanır; küp değer araması (distinct) yapılmaz; veri filtresi imzasına girmez.
  assert.match(js, /function localFilterKeys\(\)/);
  // Özellik alınamadıysa veya şemada yoksa yerel filtre boş değerlere uygulanıp tabloyu boşaltmaz.
  assert.match(js, /function attributeAvailable\(key\)[\s\S]{0,200}info\.ok !== false && !\(info\.missing \|\| \[\]\)\.includes\(key\)/);
  assert.match(js, /const locals = activeLocalFilters\(\);/);
  assert.match(js, /if \(!isAttribute\(key\)\) void fetchValues\(''\);/);
  assert.match(js, /filterSignature\(mainFilterValues\(/);
  // Özellik pivot/filtre/alt detayda kullanılınca sorgu düzeyi değişir (yeniden çekilir).
  assert.match(js, /usedAttributes\(current\)/);
  // Alınamadı uyarısı iki dilde.
  assert.match(js, /Ürün özellikleri \(FİT, Silüet, Kumaş-malzeme tipi\) alınamadı/);
  assert.match(js, /Product attributes \(Fit, Silhouette, Fabric-material type\) could not be loaded/);
  // Alt detay ve Excel iç alanı (attrMulti) sütun yapmaz; özellik metin hücredir.
  assert.match(js, /const HIDDEN_ROW_KEYS = new Set\(\['attrMulti'\]\)/);
  // Ayarlar: alt detay ürün özellikleri seçimi.
  assert.match(js, /detailAttributes/);
  // Hesaplanan değer: özellikler metin boyutu (baseDim) ve ayrılmış ad listesinde (catalog.dimensions).
  assert.match(js, /isTextKey: key => Boolean\(baseDim\(key\)\)/);
  assert.match(js, /\.\.\.\[\.\.\.state\.catalog\.dimensions, \.\.\.state\.catalog\.measures\]\.flatMap\(item => \[item\.tr, item\.en\]\)/);
});
