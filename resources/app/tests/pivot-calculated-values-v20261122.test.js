'use strict';

/* Pivot hesaplanan değerleri — ortak modül, motor, sunucu doğrulaması ve
   dört widget'ın (OAB PASS, OAB Küp, INTAKE, FOB Sonrası) kaynak sözleşmesi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const Engine = require('../public/formula-engine.js');
const PCV = require('../public/pivot-calculated-values.js');

const def = (id, formula, extra = {}) => ({ id, label: id, formula, mode: 'aggregate', format: 'auto', decimals: '', refs: {}, ...extra });

test('motor: numeric seçeneği 8 haneli adet toplamlarını tarih sanmaz', () => {
  const program = Engine.compile('[a] - [b]');
  // Varsayılan davranış (CP tarih sütunları) değişmez: YYYYMMDD farkı gün farkıdır.
  assert.equal(program.evaluate({ a: 20251215, b: 20250101 }).value, 348);
  assert.equal(program.evaluate({ a: 20251215, b: 20250101 }, { numeric: true }).value, 1114);
});

test('normalizeList: sınırlar, mod, biçim ve yalnız bilinen başvurular', () => {
  const many = Array.from({ length: 25 }, (_, index) => def(`d${index}`, '[wssi]'));
  assert.equal(PCV.normalizeList(many).length, PCV.LIMITS.max);
  assert.equal(PCV.LIMITS.max, 20);
  assert.equal(PCV.normalizeList([def('long', 'x'.repeat(2001))]).length, 0);
  assert.equal(PCV.normalizeList([def('ok', 'x'.repeat(2000))]).length, 1);
  const [label] = PCV.normalizeList([{ ...def('l', '[a]'), label: 'L'.repeat(300) }]);
  assert.equal(label.label.length, 120);
  assert.equal(PCV.normalizeList([def('bad id!', '[a]')]).length, 0, 'id biçimi denetlenir');
  assert.equal(PCV.normalizeList([def('m', '[a]', { mode: 'sql' })]).length, 0, 'mod yalnız aggregate|row');
  assert.equal(PCV.normalizeList([def('r', '[a]', { mode: 'row' })], { allowRow: false }).length, 0, 'satır modu kapalı widget toplam moduna sessizce çevirmez');
  assert.equal(PCV.normalizeList([def('dup', '[a]'), def('dup', '[b]')]).length, 1);
  const [cleaned] = PCV.normalizeList([def('c', '[wssi] / [approved]', {
    format: 'date', decimals: '9',
    refs: { wssi: 'WSSI', approved: 'Onaylı', 'calc:other': 'X', hacked: 'Y', 'calc:c': 'self' },
  }), def('other', '1')], { aggregateKeys: ['wssi', 'approved'] });
  assert.deepEqual(cleaned.refs, { wssi: 'WSSI', approved: 'Onaylı', 'calc:other': 'X' });
  assert.equal(cleaned.format, 'auto');
  assert.equal(cleaned.decimals, '');
  // Satır modu başvuruları satır alanlarıyla, toplam modu değer alanlarıyla denetlenir.
  const [row] = PCV.normalizeList([def('r', '[wssi]', { mode: 'row', refs: { wssi: 'WSSI', poQty: 'PO' } })], { aggregateKeys: ['poQty'], rowKeys: ['wssi'] });
  assert.deepEqual(row.refs, { wssi: 'WSSI' });
});

test('toplamlar üzerinden: oran toplamların oranıdır, satır oranlarının ortalaması değil', () => {
  const evaluator = PCV.createEvaluator([def('ratio', '[approved] / [wssi]')]);
  const rows = [{ wssi: 100, approved: 50 }, { wssi: 300, approved: 30 }];
  const totals = { wssi: 400, approved: 80 };
  const result = evaluator.compute(totals, rows);
  assert.equal(result.values['calc:ratio'], 0.2);
  assert.notEqual(result.values['calc:ratio'], (0.5 + 0.1) / 2);
});

test('satır bazında, sonra topla: koşullu adet her kaynak satırda hesaplanır', () => {
  const evaluator = PCV.createEvaluator([def('notOrdered', 'IF([wssi] = 0, [approved], 0)', { mode: 'row' })]);
  const rows = [{ wssi: 0, approved: 10 }, { wssi: 5, approved: 7 }, { wssi: 0, approved: 3 }];
  assert.equal(evaluator.compute({}, rows).values['calc:notOrdered'], 13);
  // Aynı formül toplamlar üzerinden çalışsaydı WSSI toplamı 5 olduğundan 0 verirdi.
  const aggregate = PCV.createEvaluator([def('agg', 'IF([wssi] = 0, [approved], 0)')]);
  assert.equal(aggregate.compute({ wssi: 5, approved: 20 }, rows).values['calc:agg'], 0);
});

test('hatalar sessiz değildir: sıfıra bölme, eksik alan, geçersiz formül, döngü → "—" ve sebep', () => {
  const evaluator = PCV.createEvaluator([
    def('div', '[approved] / [wssi]'),
    def('missing', '[approved] / [plan]', { refs: { plan: 'Plan sipariş' } }),
    def('broken', '[approved] / '),
    def('a', '[calc:b] + 1'), def('b', '[calc:a] + 1'),
    def('chain', '[calc:div] * 100'),
  ]);
  const metrics = evaluator.apply({ wssi: 0, approved: 5 }, []);
  for (const key of ['calc:div', 'calc:missing', 'calc:broken', 'calc:a', 'calc:b', 'calc:chain']) assert.equal(metrics[key], null, key);
  assert.equal(PCV.errorOf(metrics, 'calc:div').tr, 'Sıfıra bölme');
  assert.match(PCV.errorOf(metrics, 'calc:missing').tr, /Plan sipariş/);
  assert.match(PCV.errorOf(metrics, 'calc:broken').en, /Invalid formula/);
  assert.match(PCV.errorOf(metrics, 'calc:a').en, /Circular/);
  assert.equal(PCV.errorOf(metrics, 'calc:chain').tr, 'Sıfıra bölme', 'bağımlılığın asıl sebebi taşınır');
  // Hatalar sayılabilir alan değildir: toplam/sıralama döngüleri onları görmez.
  assert.ok(!Object.keys(metrics).includes('__calcErrors'));
  const cell = PCV.cell(metrics, def('div', ''));
  assert.equal(cell.text, '—');
  assert.equal(cell.error, true);
  assert.equal(PCV.exportValue(metrics, def('div', '')), null, 'Excel hücresine yanlış sayı yazılmaz');
});

test('satır modunda hata bir satırda bile olsa toplam gösterilmez', () => {
  const evaluator = PCV.createEvaluator([def('unit', '[approved] / [wssi]', { mode: 'row' })]);
  const result = evaluator.compute({}, [{ wssi: 2, approved: 4 }, { wssi: 0, approved: 1 }]);
  assert.equal(result.values['calc:unit'], null);
  assert.match(result.errors['calc:unit'].en, /1 source row/);
});

test('hesaplanan değer başka bir hesaplanan değere başvurabilir; satır modu toplam modunu kullanamaz', () => {
  const evaluator = PCV.createEvaluator([def('share', '[calc:diff] / [wssi]'), def('diff', '[wssi] - [approved]')]);
  assert.equal(evaluator.compute({ wssi: 200, approved: 150 }, []).values['calc:share'], 0.25);
  const defs = [def('agg', '[wssi]'), def('row', '[calc:agg] * 2', { mode: 'row' })];
  assert.match(PCV.graphError(defs).en, /per row/);
  assert.match(PCV.graphError([def('x', '[calc:y]'), def('y', '[calc:x]')]).tr, /döngüsel/);
  assert.equal(PCV.graphError([def('x', '[calc:y]'), def('y', '[wssi]')]), null);
});

test('kod/metin alanı sayıya çevrilmez; sonuç metinse "—"', () => {
  const evaluator = PCV.createEvaluator([def('code', '[modelCode] * 1', { mode: 'row' }), def('text', 'TEXT([wssi])')], { isTextKey: key => key === 'modelCode' });
  const result = evaluator.compute({ wssi: 3 }, [{ modelCode: '3E8' }]);
  assert.equal(result.values['calc:code'], null);
  assert.match(result.errors['calc:code'].tr, /Kod\/metin/);
  assert.equal(result.values['calc:text'], null);
});

test('tanım yoksa değerlendirici yoktur (sıcak yol değişmez); satır modu kaynak alanları ayrıca raporlanır', () => {
  assert.equal(PCV.createEvaluator([]), null);
  assert.equal(PCV.createEvaluator(null), null);
  assert.deepEqual(PCV.requiredRowKeys([def('a', '[poQty] - [calc:b]', { mode: 'row' }), def('b', '[wssi]', { mode: 'row' }), def('c', '[plan]')]).sort(), ['poQty', 'wssi']);
});

/* ---------------- sunucu görünüm normalizasyonu ---------------- */

test('OAB (Küp): tanımlar görünümde doğrulanır; satır modu ölçüsü sorgulanır, toplam modu sorguya girmez', () => {
  const report = require('../server/lib/oab-cube-report');
  const view = report.normalizeView({
    filterValues: { season: ['S6'] },
    calculated: [
      def('ratio', '[approved] / [wssi]', { refs: { approved: 'Onaylı', wssi: 'WSSI', bogus: 'x' } }),
      def('rowPo', 'IF([wssi] = 0, [poQty], 0)', { mode: 'row', refs: { wssi: 'WSSI', poQty: 'PO' } }),
      def('fake', '[x]', { mode: 'evil' }),
    ],
  });
  assert.deepEqual(view.calculated.map(item => item.id), ['ratio', 'rowPo']);
  assert.deepEqual(view.calculated[0].refs, { approved: 'Onaylı', wssi: 'WSSI' });
  const withPo = report.buildQuery({ view: { ...view, values: [{ key: 'wssi' }, { key: 'approved' }] } });
  assert.ok(withPo.measures.includes('poQty'), 'satır modu formülündeki ölçü sorgulanır');
  const aggregateOnly = report.buildQuery({ view: { ...view, values: [{ key: 'wssi' }, { key: 'approved' }], calculated: [view.calculated[0]] } });
  const plain = report.buildQuery({ view: { ...view, values: [{ key: 'wssi' }, { key: 'approved' }], calculated: [] } });
  assert.deepEqual(aggregateOnly.measures, plain.measures, 'toplam modu hesaplanan değer sorguyu değiştirmez');
  assert.equal(aggregateOnly.query, plain.query);
});

test('FOB Sonrası: tanımlar görünümde doğrulanır; sorgu değişmez', () => {
  const report = require('../server/lib/postfob-report');
  const view = report.normalizeView({ filterValues: { season: ['S6'] }, calculated: [def('gap', '[landedActual] - [fob]', { refs: { landedActual: 'Landed', fob: 'FOB', nope: 'n' } }), def('rowCost', '[qty] * [fob]', { mode: 'row', refs: { qty: 'Adet', fob: 'FOB' } })] });
  assert.deepEqual(view.calculated.map(item => item.id), ['gap', 'rowCost']);
  assert.deepEqual(view.calculated[0].refs, { landedActual: 'Landed', fob: 'FOB' });
  const a = report.buildQuery({ view });
  const b = report.buildQuery({ view: { ...view, calculated: [] } });
  assert.equal(a.query, b.query);
});

test('INTAKE: tanım display içinde kişisel kalır, satır modu düşer, sorgu imzası değişmez', () => {
  const intake = require('../server/lib/intake-report');
  const base = intake.reconcileViewConfig(null, []);
  const measure = base.query.measures[0];
  const config = intake.reconcileViewConfig({
    ...base,
    display: { ...base.display, calculated: [def('share', `[${measure.id}] * 2`, { refs: { [measure.id]: 'M', other: 'x' } }), def('row', `[${measure.id}]`, { mode: 'row' })] },
  }, []);
  assert.deepEqual(config.display.calculated.map(item => item.id), ['share']);
  assert.deepEqual(config.display.calculated[0].refs, { [measure.id]: 'M' });
  assert.deepEqual(config.query, base.query);
});

test('INTAKE Excel: hesaplanan değerler ayrı bir DEĞER sayfası olarak yazılır, canlı pivot korunur', () => {
  const XLSX = require('xlsx');
  const intake = require('../server/lib/intake-report');
  const excel = require('../server/lib/intake-excel');
  const fields = intake.defaultFields ? intake.defaultFields() : [];
  const viewConfig = intake.reconcileViewConfig(null, fields);
  const plan = excel.prepare({ fields, viewConfig, horizon: null });
  const calculated = excel.normalizeCalculatedSheet({ headers: ['Klasman', 'Oran'], rows: [['A', 0.25], ['Genel Toplam', 0.5], ['x'.repeat(5000), 'not-a-number']], numeric: [1] });
  const buffer = excel.createWorkbook({ connection: { server: 's', catalog: 'c' }, plan, rows: [], language: 'tr', calculatedSheet: calculated });
  const book = XLSX.read(buffer, { type: 'buffer' });
  assert.ok(book.SheetNames.includes('Hesaplanan değerler'));
  const sheet = XLSX.utils.sheet_to_json(book.Sheets['Hesaplanan değerler'], { header: 1 });
  assert.deepEqual(sheet[0], ['Klasman', 'Oran']);
  assert.equal(sheet[1][1], 0.25);
  assert.equal(sheet[3][0].length, 200, 'metin hücresi kırpılır');
  assert.equal(sheet[3][1], undefined, 'sayı olmayan değer hücresi boş kalır');
  assert.equal(book.SheetNames[0], 'INTAKE Pivot', 'canlı pivot ilk sayfa olarak kalır');
  assert.equal(excel.normalizeCalculatedSheet({ headers: [], rows: [] }), null);
});

/* ---------------- kaynak sözleşmesi ---------------- */

test('editör: CP "Hesaplanan sütun" penceresi adapter ile açılır; paralel formül arayüzü yok', () => {
  const fc = read('public/formula-columns.js');
  assert.match(fc, /pivot: \{ tr: 'Pivot', en: 'Pivot' \}/);
  for (const hook of ['adapter?.isNew', 'adapter?.modes', 'adapter?.formats', 'adapter?.evaluateOptions', 'adapter?.rowLabel', 'adapter.extraPanel', 'adapter.copy']) assert.ok(fc.includes(hook), hook);
  const module = read('public/pivot-calculated-values.js');
  assert.match(module, /fc\.open\('pivot'/);
  assert.match(module, /evaluateOptions: \{ numeric: true \}/);
  assert.doesNotMatch(module, /\beval\(|new Function/);
});

test('dört widget aynı ortak modülü kullanır; kalem penceresinde ƒx düğmesi ve TR/EN metin var', () => {
  for (const file of ['public/oab.js', 'public/oab-cube.js', 'public/intake.js', 'public/postfob.js']) {
    const source = read(file);
    assert.match(source, /BLPivotCalculatedValues/, file);
    assert.match(source, /mountSection\(/, `${file} — ayar penceresinde hesaplanan değer bölümü`);
    assert.match(source, /createEvaluator\(/, `${file} — pivot satırında hesap`);
  }
  const module = read('public/pivot-calculated-values.js');
  assert.match(module, /Hesaplanan değer ekle', 'Add calculated value'/);
  assert.match(module, /Toplamlar üzerinden', 'On totals'/);
  assert.match(module, /Satır bazında, sonra topla', 'Per row, then sum'/);
  // INTAKE satırları sorgu düzeyinde toplanmış gelir: satır modu kapalıdır.
  assert.match(read('public/intake.js'), /allowRow: false/);
  // OAB PASS pivot ayarı ortaktır (OAB.MANAGE); hesaplanan değerler kişisel depodadır.
  assert.match(read('public/oab.js'), /lcw\.oab\.pivotCalculated\.v1/);
});

test('yükleme: ortak modül widget betiklerinden önce, yalnız widget yüklenirken gelir', () => {
  const main = read('public/app-main.js');
  for (const name of ['oab.js', 'intake.js', 'postfob.js', 'oab-cube.js']) {
    const pattern = new RegExp(`pivot-calculated-values\\.js[^\\n]*\\n?[^\\n]*${name.replace('.', '\\.')}`);
    assert.match(main, pattern, name);
  }
  assert.doesNotMatch(read('public/index.html'), /pivot-calculated-values/, 'açılış kritik yoluna girmez');
});

/* ---------------- PR #1161 inceleme bulguları ---------------- */

test('motor: numeric bağlamda karşılaştırma da tarih zorlamaz; varsayılan (CP/Backlog) davranış aynı kalır', () => {
  const less = Engine.compile('IF([a] < [b], 1, 0)');
  const equal = Engine.compile('[a] = [b]');
  // 20250231 geçersiz tarih (31 Şubat → 3 Mart'a kayar); sayı olarak 20250302'den küçüktür.
  assert.equal(less.evaluate({ a: 20250231, b: 20250302 }, { numeric: true }).value, 1);
  assert.equal(less.evaluate({ a: 20250231, b: 20250302 }).value, 0, 'varsayılan: YYYYMMDD tarih olarak karşılaştırılır (eski davranış)');
  // Varsayılan modda tarih metni ile YYYYMMDD sayısı aynı gün sayılır; numeric modda sayı ≠ metin.
  assert.equal(equal.evaluate({ a: 20250301, b: '2025-03-01' }).value, true);
  assert.equal(equal.evaluate({ a: 20250301, b: '2025-03-01' }, { numeric: true }).value, false);
  // Sıradan sayılar her iki modda aynı.
  for (const options of [{}, { numeric: true }]) {
    assert.equal(less.evaluate({ a: 10, b: 12 }, options).value, 1);
    assert.equal(equal.evaluate({ a: 5, b: 5 }, options).value, true);
  }
  // Pivot değerlendiricisi karşılaştırmada da numeric çalışır.
  const evaluator = PCV.createEvaluator([def('cmp', 'IF([approved] < [wssi], 1, 0)')]);
  assert.equal(evaluator.compute({ approved: 20250231, wssi: 20250302 }, []).values['calc:cmp'], 1);
});

test('INTAKE Excel: rota gövde sınırı normalize edilen sayfa boyutuyla tutarlı; istemci yükü boyutla sınırlı', () => {
  const server = read('server/server.js');
  const route = server.split('\n').find(line => line.includes("app.post('/api/intake/export'"));
  assert.match(route, /express\.json\(\{ limit: '8mb' \}\)/, '5.000 satırlık sayfa 512 KB ile 413 alırdı');
  const intakeUi = read('public/intake.js');
  assert.match(intakeUi, /INTAKE_CALC_SHEET_MAX_BYTES = 7 \* 1024 \* 1024/);
  const excel = require('../server/lib/intake-excel');
  const XLSX = require('xlsx');
  // Tipik 5.000 satır × 13 sütun yükü 512 KB'ı aşar, 8 MB'ın altında kalır.
  const rows = Array.from({ length: 5000 }, (_, i) => ['Detay', `DEMO KLASMAN GRUBU ${i}`, `DEMO KLASMAN ${i}`, `DEMO DÖNEM ${i % 12}`, ...Array.from({ length: 8 }, (_, j) => 123456.789 + j), 0.123456]);
  const bytes = Buffer.byteLength(JSON.stringify({ headers: [], rows }));
  assert.ok(bytes > 512 * 1024 && bytes < 7 * 1024 * 1024, String(bytes));
  // İstemci boyut sınırında kırptıysa sayfa bunu açıkça yazar (sessiz eksik veri yok).
  const sheet = excel.normalizeCalculatedSheet({ headers: ['A', 'B'], rows: [['x', 1]], numeric: [1], truncated: true, total: 9000 });
  assert.equal(sheet.truncated, true);
  const intake = require('../server/lib/intake-report');
  const fields = intake.defaultFields();
  const plan = excel.prepare({ fields, viewConfig: intake.reconcileViewConfig(null, fields), horizon: null });
  const book = XLSX.read(excel.createWorkbook({ connection: { server: 's', catalog: 'c' }, plan, rows: [], language: 'en', calculatedSheet: sheet }), { type: 'buffer' });
  const text = JSON.stringify(XLSX.utils.sheet_to_json(book.Sheets['Calculated values'], { header: 1 }));
  assert.match(text, /1 of 9,000 rows/);
});
