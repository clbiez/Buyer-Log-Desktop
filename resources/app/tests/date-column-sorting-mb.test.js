'use strict';
// MB (In-Store / Model Budget) ve diğer tarih sütunlarının eskiden→yeniye /
// yeniden→eskiye sıralaması. Kök neden: Türkçe küçültme "In-Store" → "ın-store"
// yapıyor, ASCII filtresi "ı"yı silip tarih alias'ını kaçırıyordu; sütun metin
// sayılıp Date'in "Sat Dec 26…" metniyle (gün adına göre) sıralanıyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const registry = require('../public/column-schema.js');

const dates = [new Date(2026, 11, 26), new Date(2027, 2, 13), new Date(2027, 1, 16), new Date(2027, 4, 3), new Date(2027, 2, 3)];
const chronological = dates.slice().sort((a, b) => a - b).map(d => d.getTime());

test('CP/Orders MB column (In-Store (Model Budget)) resolves as a date and sorts chronologically', () => {
  const column = { k: 'In-Store (Model Budget)', label: 'In-Store', type: 'instoreEdit' };
  const schema = registry.resolveColumnSchema(column, dates.map(d => ({ [column.k]: d })));
  assert.equal(schema.dataType, 'date');
  assert.equal(schema.sortType, 'date');
  const asc = dates.slice().sort((a, b) => schema.sortValue(a) - schema.sortValue(b)).map(d => d.getTime());
  assert.deepEqual(asc, chronological);
  const desc = dates.slice().sort((a, b) => schema.sortValue(b) - schema.sortValue(a)).map(d => d.getTime());
  assert.deepEqual(desc, chronological.slice().reverse());
});

test('alias lookup is independent of Turkish dotless-i lowercasing', () => {
  for (const field of ['INSTORE', 'In-Store', 'IN-STORE (MODEL BUDGET)']) {
    assert.equal(registry.resolveColumnSchema({ k: field, type: 'ro' }, []).dataType, 'date', field);
  }
});

test('date schema parses day-first dates exactly like the visible dd.mm.yy display', () => {
  const schema = registry.resolveColumnSchema({ k: 'inStore', label: 'In Store', date: true }, []);
  const iso = schema.sortValue('2026-03-15');
  for (const value of ['15.03.2026', '15/03/2026', '15-03-2026', '15.03.26']) {
    assert.equal(schema.sortValue(value), iso, value);
  }
  assert.equal(schema.format('15.03.2026'), '15.03.26');
  assert.equal(schema.sortValue('31.02.2026'), null);
  assert.ok(schema.sortValue('01.04.2026') > schema.sortValue('15.03.2026'));
});

test('date sort comparators do not fall back to text order for Date values or empties', () => {
  const app = read('public/app-main.js');
  const kol = app.slice(app.indexOf('function kolCompareRowsForActiveSort('), app.indexOf('function kolGroupMembersIndex('));
  // Koleksiyon: tarih sütunu ekrandaki fmtDate ile aynı coerceDateLoose ile, şema yolundan önce.
  assert.ok(kol.indexOf('if(col?.date)') >= 0 && kol.indexOf('if(col?.date)') < kol.indexOf("schema.sortType==='date'"));
  const sortRows = app.slice(app.indexOf('function sortRows('), app.indexOf('function renderTableEmptyHint('));
  assert.match(sortRows, /if\(\(sx==null\)!==\(sy==null\)\) return sx==null\?1:-1;/);

  // LFL tabloları Date nesnesi taşır: zaman damgasıyla karşılaştırılmalı.
  const lfl = read('public/lfl.js');
  const start = lfl.indexOf('  function compareTableValues(');
  const body = lfl.slice(start, lfl.indexOf('  const LEGACY_MANUFACTURER_VOLUME_CLASS', start));
  const dateObjectSrc = lfl.match(/const dateObject=value=>\{[^\n]*\};/)[0];
  const ctx = { Date, BLBusinessRules: { compareChronologicalValues: (a, b) => String(a).localeCompare(String(b)) }, num: Number };
  vm.runInNewContext(`${dateObjectSrc}\n${body}\nthis.compareTableValues=compareTableValues;`, ctx);
  const values = [...dates, null];
  const asc = values.slice().sort((a, b) => ctx.compareTableValues(a, b, 'date'));
  assert.deepEqual(asc.slice(0, -1).map(d => d.getTime()), chronological);
  assert.equal(asc.at(-1), null);
  assert.ok(ctx.compareTableValues('2026-03-15', '2026-04-01', 'date') < 0);
});
