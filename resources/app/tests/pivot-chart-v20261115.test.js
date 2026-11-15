'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/pivot-chart.js');

const sum = rows => rows.reduce((total, row) => total + row.v, 0);
const records = [
  { season: 'S7', month: 'Ocak', v: 10 }, { season: 'S7', month: 'Şubat', v: 20 },
  { season: 'W7', month: 'Temmuz', v: 5 }, { season: 'S7', month: 'Ocak', v: 1 },
  { season: 'W7', month: 'Ocak', v: -4 },
];

test('ilk satır alanı kategori, ikinci satır alanı seri olur; değerler kaynak ölçüyle hesaplanır', () => {
  const model = C.buildModel({ records, categoryOf: r => r.season, seriesOf: r => r.month, measure: sum, compareCategory: (a, b) => a.localeCompare(b) });
  assert.deepEqual(model.categories.map(c => c.label), ['S7', 'W7']);
  const ocak = model.series.find(s => s.key === 'Ocak');
  assert.deepEqual(ocak.values, [11, -4]);
  assert.deepEqual(model.series.find(s => s.key === 'Temmuz').values, [null, 5]);
  assert.deepEqual(model.totals, [31, 1]);
});

test('seri sınırı aşılınca kalanlar "Diğer" serisinde kaynak ölçüyle toplanır', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ c: 'A', s: `s${i}`, v: i + 1 }));
  const model = C.buildModel({ records: many, categoryOf: r => r.c, seriesOf: r => r.s, measure: sum, otherLabel: 'Diğer' });
  assert.equal(model.series.length, C.SERIES_LIMIT);
  const other = model.series.at(-1);
  assert.equal(other.other, true);
  assert.equal(other.values[0], 1 + 2 + 3 + 4 + 5);
  assert.equal(model.totalSeries, 12);
});

test('sütun alanı varsa seriler sütun değerleridir; tek alan varsa tek seri', () => {
  const byCol = C.buildModel({ records, categoryOf: r => r.season, columnSeries: [{ key: 'a' }, { key: 'b' }], measure: (rows, key) => key === 'a' ? rows.length : sum(rows) });
  assert.deepEqual(byCol.series.map(s => s.key).sort(), ['a', 'b']);
  const single = C.buildModel({ records, categoryOf: r => r.season, measure: sum, singleLabel: 'Bütçe' });
  assert.equal(single.series.length, 1);
  assert.equal(single.series[0].name, 'Bütçe');
});

test('negatif değerler sıfırın altına ölçeklenir ve SVG Backlog sınıflarıyla çizilir', () => {
  const model = C.buildModel({ records, categoryOf: r => r.season, seriesOf: r => r.month, measure: sum });
  const scale = C.scaleFor(model, 'stacked', new Set());
  assert.ok(scale.min < 0 && scale.max >= 31);
  for (const type of ['stacked', 'grouped', 'line']) {
    const html = C.svg(model, { type, format: String });
    assert.match(html, /class="backlogChartSvg pivotChartSvg"/);
    assert.match(html, /backlogChartGrid/);
    assert.match(html, /data-pivot-chart-cat="0"/);
    assert.doesNotMatch(html, /NaN|undefined/);
  }
  assert.match(C.svg(model, { type: 'stacked', format: String }), /class="backlogChartColumnTotal">31</);
  const hidden = C.svg(model, { type: 'stacked', hidden: new Set(['Ocak']), format: String });
  assert.doesNotMatch(hidden, /data-pivot-chart-series="Ocak"/);
  assert.match(C.legendHtml(model, new Set(['Ocak'])), /is-muted" data-pivot-chart-legend="Ocak"/);
});

test('lejant pivot sırasını izler (compareSeries), en büyük seriler yine korunur', () => {
  const order = ['Ocak', 'Şubat', 'Temmuz'];
  const model = C.buildModel({ records, categoryOf: r => r.season, seriesOf: r => r.month, measure: sum, compareSeries: (a, b) => order.indexOf(a) - order.indexOf(b) });
  assert.deepEqual(model.series.map(s => s.key), ['Ocak', 'Şubat', 'Temmuz']);
  assert.doesNotMatch(C.legendHtml(model, new Set()), /aria-pressed/);
});

test('Overview: tablo açıkken grafik modeli hesaplanmaz; kaynaklar pivot modelini verir', () => {
  const fs = require('node:fs'), path = require('node:path');
  const ov = fs.readFileSync(path.join(__dirname, '..', 'public', 'overview-premium.js'), 'utf8');
  assert.match(ov, /const chart=\(!prefs\.table&&input\.buildChart\(field\)\)/);
  const intake = fs.readFileSync(path.join(__dirname, '..', 'public', 'intake.js'), 'utf8');
  const oab = fs.readFileSync(path.join(__dirname, '..', 'public', 'oab.js'), 'utf8');
  assert.match(intake, /measure:sourceRows=>intakeAggregateRows\(sourceRows,descriptor\.field\)/);
  assert.match(oab, /measure:\(subset,seriesKey\)=>oabChartMeasure\(/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.indexOf('pivot-chart.js') < html.indexOf('overview-premium.js'));
});

test('"Diğer" serisinin üyeliği korunur; detay yalnız o dilimin kayıtlarını verir', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ c: 'A', s: `s${i}`, v: i + 1 }));
  const model = C.buildModel({ records: many, categoryOf: r => r.c, seriesOf: r => r.s, measure: sum });
  const other = model.series.find(s => s.other);
  const rows = C.recordsFor(model.categories[0], other, r => r.s);
  assert.equal(sum(rows), 1 + 2 + 3 + 4 + 5);
  const top = model.series[0];
  assert.deepEqual(C.recordsFor(model.categories[0], top, r => r.s).map(r => r.s), [top.key]);
});

test('boş değerli seri/sütun gerçek bir kova olarak korunur', () => {
  const rows = [{ c: 'A', s: '', v: 100 }, { c: 'A', s: 'x', v: 5 }];
  const model = C.buildModel({ records: rows, categoryOf: r => r.c, seriesOf: r => r.s, measure: sum, blankLabel: '(boş)' });
  const blank = model.series.find(s => s.key === '');
  assert.equal(blank.name, '(boş)');
  assert.deepEqual(C.recordsFor(model.categories[0], blank, r => r.s).map(r => r.v), [100]);
  const byCol = C.buildModel({ records: rows, categoryOf: r => r.c, columnSeries: [{ key: '' }, { key: 'x' }], measure: (subset, key) => sum(subset.filter(r => r.s === key)), blankLabel: '(boş)' });
  assert.deepEqual(byCol.series.map(s => s.key).sort(), ['', 'x']);
});
