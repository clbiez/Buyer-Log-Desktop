'use strict';

/* TR/YD Landed Avantaj: "+ Filtre ekle", kalemle pivot düzenleme (satır ekseni,
   değer listesi), görünüm normalize/doğrulama ve v1 → v2 tercih migrasyonu. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../public/tryd-advantage-engine');
const report = require('../server/lib/postfob-report');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const close = (actual, expected, message) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${message || ''} beklenen ${expected}, gelen ${actual}`);
const PREF = 'lcw.postfob.tryd.v1';

/* İki sezon, iki MAG, iki buyer grup; modeller farklı hacimde → grup oranı
   ortalamadan belirgin biçimde ayrılır. */
const rows = [];
const push = (model, attrs, origin, qty, fob, landed) => rows.push({ order: String(rows.length + 1), model, colour: 'A', productName: `URUN ${model}`, classification: 'TRİKO', ...attrs, originCountry: origin, qty, fob, landedActual: landed });
const A = { season: 'S6', buyerGroup: 'KIDS', mag: 'M1' }, B = { season: 'S6', buyerGroup: 'MEN', mag: 'M2' }, C = { season: 'W6', buyerGroup: 'KIDS', mag: 'M2' };
push('X1', A, 'TÜRKİYE', 100, 6, 6.1); push('X1', A, 'BANGLADEŞ', 1000, 3, 3.6);
push('X2', B, 'TÜRKİYE', 100, 8, 8.2); push('X2', B, 'ÇİN', 50, 6, 7.5);
push('X3', C, 'TÜRKİYE', 100, 5, 5.1); push('X3', C, 'PAKİSTAN', 400, 3.5, 4.0);
push('X4', A, 'TÜRKİYE', 100, 7, 7.1); push('X4', A, 'BANGLADEŞ', 300, 4, 4.9);

function walk(nodes, visit) { nodes.forEach(node => { visit(node); if (node.children) walk(node.children, visit); }); }
function modelsUnder(node) { return node.kind === 'model' ? [node] : node.children.flatMap(modelsUnder); }

test('görünüm v2 varsayılanı: satırlar Buyer grup › Klasman › MAG (Model her zaman yaprak), bütün değerler, dört filtre', () => {
  const view = engine.normalizePrefs(null);
  assert.equal(view.version, 2);
  assert.deepEqual(view.rows, [{ key: 'buyerGroup' }, { key: 'classification' }, { key: 'mag' }]);
  assert.deepEqual(view.values.map(ref => ref.key), ['trFob', 'ydFob', 'ydLanded', 'advantage', 'target', 'gap', 'fobAdvantage', 'trQty', 'ydQty', 'coverage', 'status']);
  assert.ok(view.values.every(ref => Object.keys(ref).join() === 'key'), 'değer referansı {key} nesnesidir (ileride hesaplanan değer eklenebilir)');
  assert.deepEqual(view.filters.map(ref => ref.key), ['season', 'mag', 'buyerGroup', 'classification']);
  assert.deepEqual(engine.DEFAULT_ROWS, ['buyerGroup', 'classification', 'mag']);
  assert.ok(!engine.ROW_FIELDS.includes('model'), 'model satır seçeneği değil, sabit yapraktır');
  for (const key of ['buyerGroup', 'classification', 'mag', 'season', 'productName']) assert.ok(engine.ROW_FIELDS.includes(key), key);
});

test('migrasyon: v1 tercihi (filtre, hedef, kaynak, katlama, sıralama) kaybolmadan v2 yapısına taşınır; normalize idempotent', () => {
  const v1 = { version: 1, filterValues: { season: ['S6'], mag: ['M1', 'M2'] }, target: 0.3, landedSource: 'forecast', belowTargetOnly: true, collapsedGroups: ['["KIDS"]', '["KIDS","TRİKO"]'], sort: { key: 'advantage', dir: -1 } };
  const v2 = engine.normalizePrefs(v1);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.filterValues, v1.filterValues);
  assert.equal(v2.target, 0.3);
  assert.equal(v2.landedSource, 'forecast');
  assert.equal(v2.belowTargetOnly, true);
  assert.deepEqual(v2.collapsedGroups, v1.collapsedGroups, 'varsayılan satır düzeni aynı kaldığı için grup anahtarları geçerli kalır');
  assert.deepEqual(v2.sort, { key: 'advantage', dir: -1 });
  assert.deepEqual(v2.rows.map(ref => ref.key), engine.DEFAULT_ROWS);
  assert.equal(v2.values.length, engine.VALUE_KEYS.length);
  assert.deepEqual(engine.normalizePrefs(v2), v2);
  assert.deepEqual(engine.normalizePrefs(JSON.parse(JSON.stringify(v2))), v2);
});

test('normalize: bilinmeyen/yasak alanlar düşer, Sezon filtresi her zaman vardır, düz model listesi (satır yok) korunur', () => {
  const view = engine.normalizePrefs({
    rows: ['season', { key: 'mag' }, { key: 'originCountry' }, { key: 'order' }, { key: 'model' }, { key: 'mag' }, { key: 'bogus' }],
    values: [{ key: 'gap' }, 'advantage', { key: 'nope' }, { key: 'gap' }],
    filters: [{ key: 'model' }, { key: 'originCountry' }, { key: 'order' }, { key: 'salesCountry' }],
    filterValues: { model: ['X1'], originCountry: ['TÜRKİYE'], order: ['1'], mag: ['M1'], salesCountry: ['TR'] },
    extra: 1,
  });
  assert.deepEqual(view.rows, [{ key: 'season' }, { key: 'mag' }]);
  assert.deepEqual(view.values, [{ key: 'gap' }, { key: 'advantage' }]);
  assert.deepEqual(view.filters.map(ref => ref.key), ['season', 'model', 'salesCountry']);
  assert.deepEqual(view.filterValues, { model: ['X1'], salesCountry: ['TR'] }, 'filtre alanı olmayan veya yasak anahtarın değeri saklanmaz');
  assert.equal(view.extra, undefined);
  assert.deepEqual(engine.normalizePrefs({ rows: [] }).rows, [], 'satır alanı seçilmezse düz model listesi');
  assert.deepEqual(engine.normalizePrefs({ values: [] }).values.length, engine.VALUE_KEYS.length, 'boş değer listesi varsayılana döner');
  assert.ok(!engine.FILTER_KEYS.includes('originCountry') && !engine.FILTER_KEYS.includes('order'));
  assert.deepEqual([...engine.BLOCKED_FILTER_KEYS].sort(), ['order', 'originCountry']);
});

test('doğrulama: bilinmeyen anahtar, bilinmeyen değer/satır alanı ve üretici ülke filtresi reddedilir; normalize görünüm geçer', () => {
  assert.deepEqual(engine.validatePrefs(engine.normalizePrefs(null)), []);
  assert.deepEqual(engine.validatePrefs({ filterValues: { season: ['S6'] } }), []);
  const codes = raw => engine.validatePrefs(raw).map(item => item.code);
  assert.deepEqual(codes({ filterValues: { originCountry: ['TÜRKİYE'] } }), ['blockedFilter']);
  assert.deepEqual(codes({ filters: [{ key: 'originCountry' }] }), ['blockedFilter']);
  assert.deepEqual(codes({ filters: [{ key: 'order' }] }), ['blockedFilter']);
  assert.deepEqual(codes({ values: [{ key: 'trFob' }, { key: 'calc_1' }] }), ['unknownValue']);
  assert.deepEqual(codes({ values: [{ key: 'trFob', agg: 'SUM' }] }), ['unknownRefField']);
  assert.deepEqual(codes({ rows: [{ key: 'originCountry' }] }), ['unknownRow']);
  assert.deepEqual(codes({ rows: [{ key: 'model' }] }), ['unknownRow']);
  assert.deepEqual(codes({ hack: true }), ['unknownKey']);
  assert.deepEqual(codes({ filterValues: { nope: ['1'] } }), ['unknownFilter']);
  assert.deepEqual(codes({ rows: 'mag' }), ['invalidShape']);
});

test('oranlar her eksen düzeninde tutarlardan: genel toplam aynı, her grup kendi modellerinin tutar toplamından', () => {
  const result = engine.analyze(rows, { target: 0.36 });
  assert.equal(result.models.length, 4);
  const x1 = result.models.find(model => model.model === 'X1');
  assert.equal(x1.season, 'S6');
  assert.equal(x1.productName, 'URUN X1');
  const layouts = [['buyerGroup', 'classification', 'mag'], ['season', 'mag'], ['mag', 'buyerGroup'], ['productName'], []];
  for (const levels of layouts) {
    const tree = engine.buildTree(result.visible, { target: 0.36, levels });
    const leaves = tree.flatMap(modelsUnder);
    assert.equal(leaves.length, 4, `${levels.join('›') || 'düz'}: her model bir kez yaprak`);
    assert.ok(leaves.every(node => node.kind === 'model'));
    if (!levels.length) { assert.ok(tree.every(node => node.kind === 'model')); continue; }
    let groups = 0;
    walk(tree, node => {
      if (node.kind !== 'group') return;
      groups += 1;
      assert.equal(node.field, levels[node.level]);
      const members = modelsUnder(node);
      const landed = members.reduce((sum, m) => sum + m.amounts.landedAmount, 0);
      const fobTr = members.reduce((sum, m) => sum + m.amounts.fobTrAmount, 0);
      const fobYd = members.reduce((sum, m) => sum + m.amounts.fobYdAmount, 0);
      close(node.advantage, 1 - landed / fobTr, `${levels.join('›')} ${node.pathKey} avantaj`);
      close(node.fobAdvantage, 1 - fobYd / fobTr, `${levels.join('›')} ${node.pathKey} FOB avantajı`);
      close(node.gap, node.advantage - 0.36);
      assert.equal(JSON.parse(node.pathKey).length, node.level + 1);
    });
    assert.ok(groups > 0);
  }
  // Sezon › MAG: S6 grubunda X1, X2, X4; oran ortalama değil tutardan.
  const bySeason = engine.buildTree(result.visible, { target: 0.36, levels: ['season', 'mag'] });
  const s6 = bySeason.find(node => node.label === 'S6');
  const s6Models = result.models.filter(model => model.season === 'S6');
  const mean = s6Models.reduce((sum, m) => sum + m.advantage, 0) / s6Models.length;
  assert.ok(Math.abs(s6.advantage - mean) > 1e-3, 'grup oranı model oranlarının ortalaması olmamalı');
  close(result.total.advantage, 1 - result.models.reduce((s, m) => s + m.amounts.landedAmount, 0) / result.models.reduce((s, m) => s + m.amounts.fobTrAmount, 0));
});

test('arama ürün adı ve sezonda da çalışır', () => {
  assert.deepEqual(engine.analyze(rows, { search: 'urun x3' }).visible.map(model => model.model), ['X3']);
  assert.deepEqual(engine.analyze(rows, { search: 'w6' }).visible.map(model => model.model), ['X3']);
});

/* ---------- Uçlar ---------- */
const liveSchema = () => intakeReport.allowedSchema({
  columns: report.DIMENSIONS.map(item => { const p = intakeReport.sourceParts(item.source); return { table: p.table, name: p.name, kind: 'column', dataType: 'WChar' }; }),
  measures: report.MEASURES.map(item => ({ table: 'Measures', name: intakeReport.sourceParts(item.source).name, kind: 'measure' })),
});
function harness(modelRows) {
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
  const store = createIntakeStore({ root: fs.mkdtempSync(path.join(os.tmpdir(), 'tryd-pivot-')) });
  require('../server/routes/postfob-routes')(app, {
    express: { json: () => (req, res, next) => next() }, userAccess, modelQuery, userPreferences,
    loadModelConnections: () => ({ items: [] }), BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) }, store,
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
  const stored = (id = 'u1') => { const entry = new Map(prefs.get(id) || []).get(PREF); return entry ? JSON.parse(entry.value) : null; };
  return { call, calls, prefs, stored };
}
const sample = [
  { order: '1', model: 'M1', season: 'S6', originCountry: 'TÜRKİYE', qty: '100', fob: '5' },
  { order: '2', model: 'M1', season: 'S6', originCountry: 'BANGLADEŞ', qty: '1000', fob: '3', landedActual: '3,5' },
];

test('uç: state eklenebilir filtre alanlarını verir; üretici ülke ve sipariş listede yok', async () => {
  const h = harness(sample);
  const state = await h.call('GET /api/postfob/tryd/state', {});
  const keys = state.body.filters.map(item => item.key);
  for (const key of ['season', 'mag', 'buyerGroup', 'classification', 'model', 'productName', 'colour', 'salesCountry']) assert.ok(keys.includes(key), key);
  assert.ok(!keys.includes('originCountry') && !keys.includes('order'));
  assert.ok(state.body.filters.every(item => item.tr && item.en));
  assert.equal(state.body.filters.find(item => item.key === 'season').required, true);
  assert.equal(state.body.view.version, 2);
});

test('uç: üretici ülke filtresi ve bilinmeyen alanlar açıkça reddedilir; tercih değişmez', async () => {
  const h = harness(sample);
  await h.call('PUT /api/postfob/tryd/view', { body: { view: { target: 0.3 } } });
  const before = h.stored();
  const origin = await h.call('PUT /api/postfob/tryd/view', { body: { view: { filterValues: { originCountry: ['TÜRKİYE'] } } } });
  assert.equal(origin.statusCode, 400);
  assert.equal(origin.body.code, 'POSTFOB_TRYD_FILTER_BLOCKED');
  const originReport = await h.call('POST /api/postfob/tryd/report', { body: { view: { filters: [{ key: 'season' }, { key: 'originCountry' }], filterValues: { season: ['S6'] } } } });
  assert.equal(originReport.statusCode, 400);
  assert.equal(originReport.body.code, 'POSTFOB_TRYD_FILTER_BLOCKED');
  const unknown = await h.call('PUT /api/postfob/tryd/view', { body: { view: { values: [{ key: 'bogus' }] } } });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.body.code, 'POSTFOB_TRYD_VIEW_INVALID');
  const extra = await h.call('PUT /api/postfob/tryd/view', { body: { view: { lastQuery: { measures: ['x'] } } } });
  assert.equal(extra.statusCode, 400, 'istemci son sorgu şeklini yazamaz');
  assert.deepEqual(h.stored(), before);
  assert.equal(h.calls.length, 0);
});

test('uç: düzenlenen pivot normalize edilerek saklanır ve geri okunur', async () => {
  const h = harness(sample);
  const saved = await h.call('PUT /api/postfob/tryd/view', { body: { view: { rows: [{ key: 'season' }, { key: 'mag' }], values: [{ key: 'advantage' }, { key: 'gap' }, { key: 'ydQty' }], filters: [{ key: 'season' }, { key: 'model' }], filterValues: { season: ['S6'], model: ['M1'] } } } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.view.rows, [{ key: 'season' }, { key: 'mag' }]);
  assert.deepEqual(saved.body.view.values, [{ key: 'advantage' }, { key: 'gap' }, { key: 'ydQty' }]);
  const state = await h.call('GET /api/postfob/tryd/state', {});
  assert.deepEqual(state.body.view, saved.body.view);
  assert.equal(h.stored().version, 2);
});

test('uç: eklenen Model filtresi sorguya girer; yeniden açılışta aynı sorgunun kaydı bulunur ve filtresiz kayıtla karışmaz', async () => {
  const h = harness(sample);
  const unfiltered = await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  assert.equal(unfiltered.body.fromCache, false);
  const filtered = await h.call('POST /api/postfob/tryd/report', { body: { view: { filters: [{ key: 'season' }, { key: 'model' }], filterValues: { season: ['S6'], model: ['M1'] } } } });
  assert.equal(filtered.statusCode, 200);
  assert.equal(filtered.body.fromCache, false, 'Model filtresi farklı sorgudur; filtresiz önbellek dönmez');
  assert.equal(h.calls.length, 2);
  assert.match(h.calls[1].query, /TREATAS\(\{ "M1" \}, 'Urun'\[Modelkod\]\)/);
  assert.deepEqual(filtered.body.filterValues, { season: ['S6'], model: ['M1'] });
  const state = await h.call('GET /api/postfob/tryd/state', {});
  assert.ok(state.body.data, 'son sorgunun kaydı Model filtresiyle yeniden bulunur');
  assert.deepEqual(state.body.data.filterValues, { season: ['S6'], model: ['M1'] });
  assert.deepEqual(h.stored().lastQuery.filterValues, { season: ['S6'], model: ['M1'] });
});

test('uç: satış ülkesi filtresi sorgu düzeyini değiştirmez; FOB Sonrası ile aynı önbelleği paylaşır', async () => {
  const h = harness(sample);
  await h.call('POST /api/postfob/report', { body: { view: { filterValues: { season: ['S6'], salesCountry: ['TR'] } } } });
  const tryd = await h.call('POST /api/postfob/tryd/report', { body: { view: { filters: [{ key: 'season' }, { key: 'salesCountry' }], filterValues: { season: ['S6'], salesCountry: ['TR'] } } } });
  assert.equal(tryd.body.fromCache, true);
  assert.equal(h.calls.length, 1);
  assert.doesNotMatch(h.calls[0].query.split('TREATAS')[0], /Satış Ülkesi/);
});

test('uç: kayıtlı v1 tercihi okunurken v2\'ye taşınır; son sorgu kaydı kaybolmaz', async () => {
  const h = harness(sample);
  await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  const current = h.stored();
  // Eski sürümün yazdığı kayıt: v1 alanları + lastQuery, eksen/değer yok.
  const v1 = { version: 1, filterValues: { season: ['S6'] }, target: 0.4, landedSource: 'actual', belowTargetOnly: false, collapsedGroups: ['["KIDS"]'], sort: { key: 'gap', dir: 1 }, lastQuery: current.lastQuery };
  h.prefs.set('u1', [[PREF, { value: JSON.stringify(v1) }]]);
  const state = await h.call('GET /api/postfob/tryd/state', {});
  assert.equal(state.body.view.version, 2);
  assert.equal(state.body.view.target, 0.4);
  assert.deepEqual(state.body.view.collapsedGroups, ['["KIDS"]']);
  assert.deepEqual(state.body.view.sort, { key: 'gap', dir: 1 });
  assert.deepEqual(state.body.view.rows.map(ref => ref.key), engine.DEFAULT_ROWS);
  assert.ok(state.body.data && state.body.data.rows.length === 2, 'v1 kaydının son sorgusu hâlâ bulunur');
  // İlk yazımda kayıt v2 olur; son sorgu korunur.
  await h.call('PUT /api/postfob/tryd/view', { body: { view: { belowTargetOnly: true } } });
  assert.equal(h.stored().version, 2);
  assert.deepEqual(h.stored().lastQuery, current.lastQuery);
});

/* ---------- İstemci kaynak sözleşmesi ---------- */
const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('istemci: + Filtre ekle, kalemle pivot penceresi, Varsayılana dön; ortak sınıf ve yerleştirici', () => {
  const widget = read('tryd-advantage.js');
  assert.match(widget, /class="navActionBtn intakeFilterAdd" data-tryd-add-filter>\+ \$\{esc\(text\('Filtre ekle', 'Add filter'\)\)\}/);
  assert.match(widget, /function openFilterFieldPicker\(/);
  assert.match(widget, /intakeFilterPopover intakeFilterFieldPicker/);
  assert.equal((widget.match(/BLFloatingPlacement\?\.place\(/g) || []).length >= 1, true);
  assert.match(widget, /const axisRowHtml = /);
  assert.match(widget, /function valueRowHtml\(/);
  assert.match(widget, /autoModal oabSettingsModal intakeFieldsModal/);
  assert.match(widget, /data-tryd-settings-reset>\$\{esc\(text\('Pivot Varsayılanına Dön', 'Reset Pivot'\)\)\}/);
  assert.match(widget, /byId\('trydAdvantageFieldsBtn'\)\?\.addEventListener\('click'/);
  assert.match(widget, /engine\.BLOCKED_FILTER_KEYS/, 'üretici ülke filtresi istemcide de seçilemez');
  // Excel ve tablo aynı eksen/değer seçimini izler.
  assert.match(widget, /const axisKeys = \(\) => /);
  assert.match(widget, /const selectedValues = \(\) => /);
  const excel = widget.slice(widget.indexOf('async function exportExcel'), widget.indexOf('function paintExportButton'));
  assert.match(excel, /axisKeys\(\)/);
  assert.match(excel, /selectedValues\(\)/);
  assert.match(excel, /levels: groupLevels\(\)/);
  assert.doesNotMatch(widget, /const DIMS = \[/, 'sabit satır hiyerarşisi kalmadı');
  const html = read('index.html');
  const block = html.slice(html.indexOf('<div id="trydAdvantageSection"'), html.indexOf('id="trydAdvantageTable"'));
  assert.match(block, /id="trydAdvantageFieldsBtn"[^>]*data-i18n-title-tr="[^"]+" data-i18n-title-en="[^"]+"/);
  assert.match(block, /id="trydAdvantageFieldsBtn"[^>]*><svg class="ic" aria-hidden="true"><use href="#i-pencil"\/><\/svg><\/button>/);
});
