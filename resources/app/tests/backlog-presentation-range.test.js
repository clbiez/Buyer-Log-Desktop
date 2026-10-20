'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Report = require('../public/backlog-presentation-report.js');
const V3 = require('../public/backlog-v3-report.js');

const items = [
  { lineId:'a', orderCode:'A', qty:10, stage:'PRODUCTION', inStore:'2026-12-31', retail:'2027-01-31', exFactory:'2026-12-01' },
  { lineId:'b', orderCode:'B', qty:20, stage:'IN_TRANSIT', inStore:'2027-01-03', retail:'2027-02-01', exFactory:'2026-12-31' },
  { lineId:'c', orderCode:'C', qty:30, stage:'IN_WAREHOUSE', inStore:'2027-01-04', retail:'2027-03-01', exFactory:'2027-01-01' },
  { lineId:'d', orderCode:'D', qty:40, stage:'SHORTAGE', inStore:'', retail:'', exFactory:'' },
];

test('MB haftaları Pazartesi–Pazar sınırlarıyla yıl geçişini kapsar', () => {
  const domain = Report.timeDomain(items, 'inStore', 'week');
  assert.equal(domain.count, 2);
  assert.equal(domain.missing, 1);
  assert.deepEqual(Report.timeBounds(domain, 0, 0), { start:'2026-12-28', end:'2027-01-03' });
  const selected = Report.filterTimeRange(items, { field:'inStore', ...Report.timeBounds(domain, 0, 0) });
  assert.deepEqual(selected.map(it => it.lineId), ['a', 'b']);
});

test('Retail ay seçimi takvim aylarını ve boş ayları korur', () => {
  const domain = Report.timeDomain(items, 'retail', 'month');
  assert.equal(domain.count, 3);
  assert.deepEqual(Report.timeBounds(domain, 1, 1), { start:'2027-02-01', end:'2027-02-28' });
  assert.deepEqual(Report.filterTimeRange(items, { field:'retail', ...Report.timeBounds(domain, 1, 1) }).map(it => it.lineId), ['b']);
  const leap = Report.timeDomain([{retail:'2028-02-29'}], 'retail', 'month');
  assert.equal(Report.timeBounds(leap, 0, 0).end, '2028-02-29');
  const gap = Report.timeDomain([items[0], items[2]], 'retail', 'month');
  assert.deepEqual(Report.filterTimeRange([items[0], items[2]], { field:'retail', ...Report.timeBounds(gap, 1, 1) }), []);
});

test('Ex-Factory gün aralığı iki sınırı da dahil eder; tümü eksik tarihleri korur', () => {
  const domain = Report.timeDomain(items, 'exFactory', 'date');
  assert.equal(domain.count, 32);
  assert.deepEqual(Report.timeBounds(domain, 30, 31), { start:'2026-12-31', end:'2027-01-01' });
  const selected = Report.filterTimeRange(items, { field:'exFactory', start:'2026-12-31', end:'2027-01-01' });
  assert.equal(V3.summarize(selected).qty, 50);
  assert.equal(Report.filterTimeRange(items, {all:true}).length, 4);
  assert.equal(items.length, 4, 'kaynak satırlar değişmez');
});

test('Boş, tek tarihli ve bozuk tarihli veri güvenlidir; tutamaklar sınırda kalır', () => {
  const domain = Report.timeDomain([{inStore:''}, {inStore:'2026-02-30'}, {inStore:'2026-02-28'}], 'inStore', 'date');
  assert.equal(domain.count, 1);
  assert.equal(domain.missing, 2);
  assert.deepEqual(Report.timeBounds(domain, -2, 10), {start:'2026-02-28', end:'2026-02-28'});
  const empty = Report.timeDomain([], 'retail', 'week');
  assert.equal(empty.count, 0);
  assert.equal(Report.timeBounds(empty, 0, 0), null);
  assert.equal(Report.filterTimeRange(items, {field:'inStore', start:'2027-01-10', end:'2027-01-20'}).length, 0);
  assert.equal(Report.filterTimeRange(items, {field:'inStore', start:'2027-01-20', end:'2027-01-10'}).length, 0);
});

test('Filtrelenen raporun özeti, aşamaları ve dışa aktarılan kapsamı aynı seçimi taşır', () => {
  const selected = Report.filterTimeRange(items, {field:'inStore', start:'2026-12-28', end:'2027-01-03'});
  for (const lang of ['tr', 'en']) {
    const html = Report.build(selected, {lang, scope:'MB · 28.12.2026 – 03.01.2027'});
    assert.match(html, /data-count="30"/);
    assert.match(html, /MB · 28.12.2026 – 03.01.2027/);
    assert.doesNotMatch(html, /data-count="100"/);
  }
});
