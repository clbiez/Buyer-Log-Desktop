'use strict';

/* TR/YD Landed Avantaj: ƒx hesaplanan değer (public/pivot-calculated-values.js).
   Yalnız "toplamlar üzerinden" mod; alanlar her düzeyde tutarlardan gelen
   değerlerdir. Eski tercih (calculated yok) aynen çalışır. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const engine = require('../public/tryd-advantage-engine');
const PCV = require('../public/pivot-calculated-values');
const report = require('../server/lib/postfob-report');
const intakeReport = require('../server/lib/intake-report');
const { createIntakeStore } = require('../server/lib/intake-store');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const PREF = 'lcw.postfob.tryd.v1';
const close = (actual, expected, message) => assert.ok(actual != null && Math.abs(actual - expected) < 1e-9, `${message || ''} beklenen ${expected}, gelen ${actual}`);
const def = (id, formula, extra = {}) => ({ id, label: id, formula, mode: 'aggregate', format: 'auto', decimals: '', refs: {}, ...extra });

const rows = [];
const push = (model, attrs, origin, qty, fob, landed) => rows.push({ order: String(rows.length + 1), model, colour: 'A', productName: `URUN ${model}`, classification: 'TRİKO', ...attrs, originCountry: origin, qty, fob, landedActual: landed });
const A = { season: 'S6', buyerGroup: 'KIDS', mag: 'M1' }, B = { season: 'S6', buyerGroup: 'MEN', mag: 'M2' };
push('X1', A, 'TÜRKİYE', 100, 6, 6.1); push('X1', A, 'BANGLADEŞ', 1000, 3, 3.6);
push('X2', B, 'TÜRKİYE', 100, 8, 8.2); push('X2', B, 'ÇİN', 50, 6, 7.5);
push('X4', A, 'TÜRKİYE', 100, 7, 7.1); push('X4', A, 'BANGLADEŞ', 300, 4, 4.9);
// Fas satırı kıyasa girmez; satır modu olsaydı toplama karışırdı.
push('X4', A, 'FAS', 999, 1, 1.2);

test('migrasyon: calculated olmayan eski tercih aynen normalize edilir ve doğrulanır', () => {
  const old = { version: 2, rows: [{ key: 'season' }], values: [{ key: 'advantage' }, { key: 'gap' }], filters: [{ key: 'season' }], filterValues: { season: ['S6'] }, target: 0.3, landedSource: 'actual', belowTargetOnly: false, collapsedGroups: [], sort: { key: 'gap', dir: -1 } };
  const view = engine.normalizePrefs(old);
  assert.ok(!('calculated' in view), 'tanım yoksa görünüm şekli değişmez');
  assert.deepEqual(view.values, old.values);
  assert.deepEqual(view.sort, { key: 'gap', dir: -1 });
  assert.deepEqual(engine.validatePrefs(old), []);
  assert.deepEqual(engine.validatePrefs(engine.normalizePrefs(null)), []);
});

test('tercih: hesaplanan değer normalize edilir; satır modu ve bilinmeyen alanlar reddedilir', () => {
  const calc = [def('share', '[landedAmount] / [fobTrAmount]', { refs: { landedAmount: 'LANDED TUTAR', fobTrAmount: 'FOB TR TUTAR', bogus: 'x' } })];
  const view = engine.normalizePrefs({ calculated: calc, sort: { key: 'calc:share', dir: -1 } });
  assert.deepEqual(view.calculated.map(item => item.id), ['share']);
  assert.deepEqual(view.calculated[0].refs, { landedAmount: 'LANDED TUTAR', fobTrAmount: 'FOB TR TUTAR' });
  assert.deepEqual(view.sort, { key: 'calc:share', dir: -1 }, 'tanımlı hesaplanan değere göre sıralama korunur');
  assert.equal(engine.normalizePrefs({ sort: { key: 'calc:share', dir: -1 } }).sort.key, 'label', 'tanımsız hesaplanan anahtar etikete döner');
  assert.equal(engine.normalizePrefs({ calculated: [def('r', '[ydQty]', { mode: 'row' })] }).calculated, undefined, 'satır modu TR/YD kıyas kuralını bozar; düşer');
  assert.ok(engine.CALC_FIELDS.includes('fobTrAmount') && !engine.CALC_FIELDS.includes('status'));
  const codes = raw => engine.validatePrefs(raw).map(item => item.code);
  assert.deepEqual(codes({ calculated: calc.map(item => ({ ...item, refs: { landedAmount: 'L' } })) }), []);
  assert.deepEqual(codes({ calculated: 'x' }), ['invalidShape']);
  assert.deepEqual(codes({ calculated: [{ ...def('a', '[ydQty]'), color: 'red' }] }), ['unknownCalcField']);
  assert.deepEqual(codes({ calculated: [def('a', '[ydQty]', { mode: 'row' })] }), ['calcRowMode']);
  assert.deepEqual(codes({ calculated: [def('a', '[ydQty]', { refs: { originCountry: 'x' } })] }), ['unknownCalcRef']);
  assert.deepEqual(codes({ calculated: [def('bad id!', '[ydQty]')] }), ['invalidCalculated']);
  assert.deepEqual(codes({ calculated: Array.from({ length: 21 }, (_, i) => def(`d${i}`, '[ydQty]')) }), ['tooManyCalculated']);
});

test('toplamlar üzerinden: model, grup ve genel toplamda tutarlardan hesaplanır', () => {
  const result = engine.analyze(rows, { target: 0.36 });
  const tree = engine.buildTree(result.visible, { target: 0.36, levels: ['buyerGroup'] });
  const evaluator = PCV.createEvaluator([def('ratio', '[landedAmount] / [fobTrAmount]'), def('gapCheck', '[advantage] - [target]'), def('trFobAmount', '[trFob] * [ydQty]')]);
  const nodes = [];
  const walk = list => list.forEach(node => { nodes.push(node); if (node.children) walk(node.children); });
  walk(tree);
  nodes.push({ kind: 'grand', ...result.total });
  for (const node of nodes) {
    const values = engine.calcFieldValues(node, 0.36);
    const out = evaluator.compute(values, []).values;
    close(out['calc:ratio'], node.amounts.landedAmount / node.amounts.fobTrAmount, `${node.kind} ${node.label || ''} oran`);
    close(out['calc:ratio'], 1 - node.advantage, 'avantaj ile tutarlı');
    close(out['calc:gapCheck'], node.gap, 'Avantaj − Hedef = Fark');
    close(out['calc:trFobAmount'], node.amounts.fobTrAmount, 'grupta TR FOB, YD adet ağırlıklı');
  }
  // Grup oranı model oranlarının ortalaması değildir.
  const kids = tree.find(node => node.label === 'KIDS');
  const mean = kids.children.reduce((sum, model) => sum + model.amounts.landedAmount / model.amounts.fobTrAmount, 0) / kids.children.length;
  assert.ok(Math.abs(evaluator.compute(engine.calcFieldValues(kids, 0.36), []).values['calc:ratio'] - mean) > 1e-3);
  // Fas satırı kıyasa girmediği için toplam YD adet yalnız kıyaslanan YD'dir.
  assert.equal(engine.calcFieldValues({ kind: 'grand', ...result.total }, 0.36).ydQtyAll, 1350);
});

test('sıralama: hesaplanan değere göre (grup ve model düzeyinde)', () => {
  const result = engine.analyze(rows, { target: 0.36 });
  const evaluator = PCV.createEvaluator([def('ratio', '[landedAmount] / [fobTrAmount]')]);
  const sortValue = (node, key) => evaluator.compute(engine.calcFieldValues(node, 0.36), []).values[key];
  const flat = engine.buildTree(result.visible, { target: 0.36, levels: [], sort: { key: 'calc:ratio', dir: -1 }, sortValue });
  const ratios = flat.map(node => node.amounts.landedAmount / node.amounts.fobTrAmount);
  assert.deepEqual(ratios, [...ratios].sort((a, b) => b - a));
  const asc = engine.buildTree(result.visible, { target: 0.36, levels: [], sort: { key: 'calc:ratio', dir: 1 }, sortValue });
  assert.deepEqual(asc.map(node => node.label), flat.map(node => node.label).reverse());
});

/* ---------- Uç ---------- */
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

test('uç: hesaplanan değer kaydedilir ve geri okunur; geçersizi 400, tercih değişmez', async () => {
  const h = harness(sample);
  const calc = [def('share', '[landedAmount] / [fobTrAmount]', { refs: { landedAmount: 'L', fobTrAmount: 'F' } })];
  const saved = await h.call('PUT /api/postfob/tryd/view', { body: { view: { calculated: calc, sort: { key: 'calc:share', dir: -1 } } } });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body.view.calculated.map(item => item.formula), ['[landedAmount] / [fobTrAmount]']);
  assert.equal(saved.body.view.sort.key, 'calc:share');
  const state = await h.call('GET /api/postfob/tryd/state', {});
  assert.deepEqual(state.body.view.calculated, saved.body.view.calculated);
  const before = h.stored();
  for (const bad of [[{ ...calc[0], hack: 1 }], [{ ...calc[0], mode: 'row' }], [{ ...calc[0], refs: { order: 'x' } }]]) {
    const res = await h.call('PUT /api/postfob/tryd/view', { body: { view: { calculated: bad } } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, 'POSTFOB_TRYD_VIEW_INVALID');
  }
  assert.deepEqual(h.stored(), before);
  // Hesaplanan değer sorguya girmez: rapor isteği aynı sorguyu çalıştırır.
  await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] } } } });
  await h.call('POST /api/postfob/tryd/report', { body: { view: { filterValues: { season: ['S6'] }, calculated: [] }, forceRefresh: true } });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].query, h.calls[1].query);
});

test('istemci: ortak modül, kalem penceresi bölümü, satır modu kapalı; yükleme sırası', () => {
  const ui = read('public/tryd-advantage.js');
  for (const pattern of [/BLPivotCalculatedValues/, /mountSection\(/, /createEvaluator\(/, /allowRow: false/, /engine\.calcFieldValues\(/, /sortValue/]) assert.match(ui, pattern);
  const main = read('public/app-main.js');
  assert.match(main, /loader\('pivot-calculated-values\.js\?rev=\d+'\)\.catch\(\(\)=>null\)\.then\(\(\)=>loader\('tryd-advantage-engine\.js/);
});
