'use strict';
// Regression (2026-11-11): Backlog ve CP/Orders satır üretimi önem etiketi
// ayarlarını (katalog + Line/Sezon kuralları) HER SATIR için yeniden normalize
// ediyordu. Özel sipariş kuralları/etiketleri arttıkça Backlog veri analizi
// satır × kural ölçeğinde yavaşladı. Aynı ayar nesnesi bir kez normalize edilmeli;
// sonuç (etiket/kaynak) birebir aynı kalmalı.
const test = require('node:test');
const assert = require('node:assert/strict');
const parse = require('../server/lib/parse');

function countingSettings(raw) {
  // normalizeSettings tek çalışmada `tags` alanını iki kez okur (dizi kontrolü + değer).
  let reads = 0;
  const out = {};
  Object.defineProperty(out, 'tags', { enumerable: true, get() { reads += 1; return raw.tags; } });
  out.rules = raw.rules;
  return { settings: out, reads: () => reads / 2 };
}

const RAW = {
  tags: [{ id: 'bts', label: 'BTS' }, { id: 'bayram', label: 'Bayram' }],
  rules: [{ tagId: 'bayram', lines: ['LINE-1'], seasons: ['S1'] }, { tagId: 'bts', lines: ['LINE-2'] }],
};

test('önem ayarları satır başına değil ayar nesnesi başına bir kez normalize edilir', () => {
  const probe = countingSettings(RAW);
  const ov = { importancemap: { 5: 'regular', 6: 'bts' }, importanceSettings: probe.settings };
  const orders = Array.from({ length: 500 }, (_, i) => ({ ocode: i, model: 'M' + i, ccode: '01', line: 'LINE-' + (i % 3), season: 'S' + (i % 2) }));
  const results = orders.map(order => parse.resolveOrderImportance(order, ov));
  assert.ok(probe.reads() <= 1, `normalizeSettings ${probe.reads()} kez çalıştı`);
  assert.deepEqual(results[1], { id: 'bayram', label: 'Bayram', source: 'rule', special: true, ruleId: 'rule-1' });
  assert.deepEqual(results[2], { id: 'bts', label: 'BTS', source: 'rule', special: true, ruleId: 'rule-2' });
  assert.equal(results[0].source, 'default');
  assert.equal(results[5].source, 'manual');
  assert.equal(results[5].id, 'regular');
  assert.equal(results[6].id, 'bts');

  const row = { 'Order Code': 7, 'Model Name': 'M7', 'C.Code': '01', Line: 'LINE-1', Season: 'S1' };
  parse.applyImportanceToRow(row, ov);
  assert.equal(row.Importance, 'Bayram');
  assert.ok(probe.reads() <= 1, `applyImportanceToRow yeniden normalize etti (${probe.reads()})`);
});

test('ayar nesnesi değişince yeni ayar kullanılır (bayat önbellek yok)', () => {
  const ov = { importanceSettings: { tags: RAW.tags, rules: [{ tagId: 'bts', lines: ['L'] }] } };
  assert.equal(parse.resolveOrderImportance({ ocode: 1, line: 'L' }, ov).id, 'bts');
  ov.importanceSettings = { tags: RAW.tags, rules: [{ tagId: 'bayram', lines: ['L'] }] };
  assert.equal(parse.resolveOrderImportance({ ocode: 1, line: 'L' }, ov).id, 'bayram');
  assert.equal(parse.resolveOrderImportance({ ocode: 1, line: 'L' }, {}).id, 'regular');
  assert.equal(parse.resolveOrderImportance({ ocode: 1, line: 'L' }, null).id, 'regular');
});
