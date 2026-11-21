'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

require('../public/date-dimension.js');
require('../public/table-search-periods.js');
require('../public/table-search-row-groups.js');
const Chips = require('../public/table-search-chips.js');
const Suggest = require('../public/table-search-suggest.js');
const Feedback = require('../public/table-search-feedback.js');

test('"XXX, YYY" iki ayrı VEYA kipi, ";" VE grubu, hariç tutma en sonda', () => {
  const model = Chips.chips('XXX, YYY; MB=M3-M5; 14! SAD!', { english: false });
  assert.deepEqual(model.groups.map(group => group.map(chip => chip.label)), [['XXX', 'YYY'], ['MB · Mart–Mayıs']]);
  assert.deepEqual(model.groups[1].map(chip => chip.kind), ['field']);
  assert.deepEqual(model.excluded.map(chip => [chip.label, chip.kind]), [['14', 'exclude'], ['SAD', 'exclude']]);
  const html = Chips.html('XXX, YYY', { english: true, inputId: 'kolSearch' });
  assert.equal((html.match(/data-search-chip=/g) || []).length, 2);
  assert.match(html, /tableSearchChipJoin[^>]*>or</);
  assert.match(Chips.html('A; B', { english: false }), /tableSearchChipJoin[^>]*>ve</);
});

test('geçersiz ve bulunamayan terim kipte işaretlenir', () => {
  const model = Chips.chips('MB=M13, ABC, XYZ', { english: false, missing: new Set(['xyz']) });
  const [invalid, plain, missing] = model.groups[0];
  assert.equal(invalid.kind, 'invalid');
  assert.match(invalid.title, /1–12/);
  assert.equal(plain.missing, false);
  assert.equal(missing.missing, true);
  assert.match(Chips.html('MB=M13', { english: true }), /Invalid shortcut/);
});

test('kip kaldırma yalnız o terimi siler, anlamı korur', () => {
  assert.equal(Chips.remove('XXX, YYY', 0), 'YYY');
  assert.equal(Chips.remove('A, B; C', 2), 'A, B');
  assert.equal(Chips.remove('A; B, C', 0), 'B, C');
  assert.equal(Chips.remove('A; 14! SAD!', 1), 'A; SAD!');
  assert.equal(Chips.remove('(A; 1), (B; 2)', 0), '(B; 2)');
  assert.equal(Chips.remove('ONLY', 0), '');
  const rowGroups = Chips.chips('(A; 1), (B; 2)', { english: false });
  assert.deepEqual(rowGroups.groups[0].map(chip => chip.label), ['A + 1', 'B + 2']);
});

test('öneri: alan adı, sezon ve ay değerleri satır sayısıyla', () => {
  assert.deepEqual(Suggest.currentSegment('S7; MB=M', 9), { start: 4, end: 9, text: 'MB=M' });
  assert.deepEqual(Suggest.currentSegment('A, !EX', 6), { start: 4, end: 6, text: 'EX' });
  // Aramanın başındaki terim (ayraç yok) 0'dan başlar.
  assert.deepEqual(Suggest.currentSegment('MB=', 3), { start: 0, end: 3, text: 'MB=' });
  assert.deepEqual(Suggest.currentSegment('!SEZON=', 7), { start: 1, end: 7, text: 'SEZON=' });
  assert.deepEqual(Suggest.currentSegment('(A; MB=', 7), { start: 4, end: 7, text: 'MB=' });
  assert.deepEqual(Suggest.suggestions('ex', [], false).map(item => item.insert), ['EXF=']);
  assert.deepEqual(Suggest.suggestions('se', [], true).map(item => item.insert), ['SEASON=']);
  assert.deepEqual(Suggest.suggestions('m', [], false), [], 'tek harf öneri açmaz');
  const texts = ['a ~mbm03~ ~szs7~', 'b ~mbm03~ ~szs7~', 'c ~mbm05~ ~szw7~'];
  const months = Suggest.suggestions('MB=', texts, false);
  assert.deepEqual(months.map(item => [item.insert, item.detail]), [['MB=M3', 'Mart · 2 satır'], ['MB=M5', 'Mayıs · 1 satır']]);
  assert.deepEqual(Suggest.suggestions('sezon=s', texts, true).map(item => [item.insert, item.detail]), [['sezon=S7', '2 rows']]);
  assert.deepEqual(Suggest.suggestions('MB=M3-', texts, false), [], 'aralık yazılırken liste kapanır');
  assert.equal(Suggest.suggestions('MB=', [], false).length, 12, 'veri yoksa 12 ay listelenir');
});

test('geri bildirim geçersiz kısayolu "bulunamadı" saymaz, ayrı listeler', () => {
  const Search = {
    parseTerms: v => String(v).split(/,\s+/).map(t => ({ mode: 'contains', value: t.toLowerCase(), invalid: /=m13/i.test(t) || undefined })),
    matches: (h, terms) => terms.some(t => h.includes(t.value)),
  };
  assert.deepEqual(Feedback.findMissing('MB=M13, abc', ['x'], r => r, Search), ['abc']);
  assert.deepEqual(Feedback.findInvalid('MB=M13, abc, SEZON=').map(item => item.label), ['MB=M13', 'SEZON=']);
});

test('uygulama kipleri ve önerileri bağlar; CP jetonları ilk kısayola kadar hesaplanmaz', () => {
  assert.match(APP, /token\.kind==='search'&&chipsApi\)return chipsApi\.html/);
  assert.match(APP, /chipsApi\?\.bind\(group,group\.dataset\.searchInput\)/);
  const cp = APP.match(/function cpSearchHaystack\(r\)\{[^]*?\n\}/)[0];
  assert.match(cp, /globalThis\.BLTableSearchPeriods\?\.used/);
  // Merch takvimi değişince satır önbellekleri de geçersizleşir (CP ve Koleksiyon).
  const cpTokens = APP.match(/function cpSearchFieldTokens\(r\)\{[^]*?\n\}/)[0];
  assert.match(cpTokens, /cached\.revision===revision/);
  assert.match(cpTokens, /merchCalendarRevision/);
  const kol = APP.match(/function kolSearchHaystack\(row\)\{[^]*?\n\}/)[0];
  assert.match(kol, /merchCalendarRevision/);
  assert.match(APP, /window\.BLTableSearch\.fieldTokenTexts=inputId=>/);
  const order = ['table-search-periods.js', 'app-main.js', 'table-search-feedback.js', 'table-search-chips.js', 'table-search-suggest.js'].map(name => INDEX.indexOf(name));
  assert.ok(order.every((value, index) => value > 0 && (index === 0 || value > order[index - 1])), JSON.stringify(order));
});
