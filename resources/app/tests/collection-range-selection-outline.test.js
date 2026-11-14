'use strict';
// Koleksiyon hücre aralığı seçimi CP/Orders ile aynı ortak çevre çizgisini kullanır:
// seçim tek dış dikdörtgen olarak çizilir ve aktif hücre 2px accent çerçevesini korur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const js = fs.readFileSync('public/collection-spreadsheet.js', 'utf8');
const ui = fs.readFileSync('public/ui-components.css', 'utf8');

function sideHelper() {
  const src = js.match(/function kolRangeSideClasses\(r,c,has\)\{[\s\S]*?return out;\}/);
  assert.ok(src, 'kolRangeSideClasses helper must exist');
  return new Function(src[0] + '\nreturn kolRangeSideClasses;')();
}

test('collection range cells get the shared grid range class and perimeter sides', () => {
  assert.match(js, /td\.classList\.add\('kolSpreadsheetRangeCell','blGridRangeCell',\.\.\.kolRangeSideClasses\(pos\.r,pos\.c,has\)\)/);
  assert.match(js, /td\.classList\.add\('kolSpreadsheetRangeCell','kolSpreadsheetRangeEdge','blGridRangeCell',\.\.\.kolRangeSideClasses\(coord\.r,coord\.c,has\)\)/);
  assert.match(js, /classList\?\.remove\('kolSpreadsheetActiveCell','kolSpreadsheetRangeCell','kolSpreadsheetRangeEdge',\.\.\.KOL_RANGE_SHARED_CLASSES\)/);
  assert.match(js, /KOL_RANGE_SHARED_CLASSES=\['blGridRangeCell','blGridRangeTop','blGridRangeRight','blGridRangeBottom','blGridRangeLeft'\]/);
});

test('rectangle and Ctrl multi-cell sides form one outer outline', () => {
  const sides = sideHelper();
  const b = { r1: 1, r2: 3, c1: 2, c2: 4 };
  const inRange = (r, c) => r >= b.r1 && r <= b.r2 && c >= b.c1 && c <= b.c2;
  assert.deepEqual(sides(1, 2, inRange), ['blGridRangeTop', 'blGridRangeLeft']);
  assert.deepEqual(sides(2, 3, inRange), [], 'interior cells have no border');
  assert.deepEqual(sides(3, 4, inRange), ['blGridRangeRight', 'blGridRangeBottom']);
  const one = (r, c) => r === 5 && c === 5;
  assert.deepEqual(sides(5, 5, one), ['blGridRangeTop', 'blGridRangeRight', 'blGridRangeBottom', 'blGridRangeLeft']);
  const multi = new Set(['0:0', '0:1', '2:0']);
  const has = (r, c) => multi.has(r + ':' + c);
  assert.deepEqual(sides(0, 0, has), ['blGridRangeTop', 'blGridRangeBottom', 'blGridRangeLeft']);
  assert.deepEqual(sides(2, 0, has), ['blGridRangeTop', 'blGridRangeRight', 'blGridRangeBottom', 'blGridRangeLeft']);
});

test('collection active cell keeps the 2px accent cursor like CP', () => {
  const rule = ui.match(/#kolTable tbody td\.kolSpreadsheetActiveCell \{([^}]*)\}/);
  assert.ok(rule, 'active-cell appearance adapter must exist');
  assert.doesNotMatch(rule[1], /outline:\s*0/, 'a more specific outline:0 hides the accent cursor');
  assert.match(ui, /#kolTable tbody \.kolSpreadsheetActiveCell\{outline:2px solid var\(--ui-accent\);outline-offset:-2px;\}/);
});
