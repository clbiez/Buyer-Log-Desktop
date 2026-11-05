'use strict';

// Ortak sütun dondurma motoru (public/table-freeze.js) — üretilen stil sözleşmesi
// ve app-main entegrasyonu. Gerçek tarayıcı doğrulaması:
//   node scripts/table-freeze-ui-acceptance.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const ENGINE = read('public/table-freeze.js');
const APP = read('public/app-main.js');

function engine() {
  const window = { CSS: { escape: value => String(value) }, requestAnimationFrame: fn => fn() };
  vm.runInNewContext(ENGINE, { window, document: {} });
  return window.BLTableFreeze;
}

test('her donmuş sütun cumulative ofsetle başlık, gövde ve alt bilgide sabitlenir', () => {
  const css = engine()._buildCss({ id: 'cpTable' }, [0, 46, 166.5]);
  for (const [index, left] of [[1, '0px'], [2, '46px'], [3, '166.5px']]) {
    assert.ok(css.includes(`#cpTable[data-bl-freeze]>thead>tr.colRow>th:nth-child(${index}){position:sticky!important;left:${left}!important;z-index:var(--ui-z-sticky-column)!important}`));
    assert.ok(css.includes(`#cpTable[data-bl-freeze]>tbody>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(${index}){position:sticky!important;left:${left}!important;z-index:var(--ui-z-frozen-cell)!important}`));
    assert.ok(css.includes(`#cpTable[data-bl-freeze]>tfoot>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(${index}){position:sticky!important;left:${left}!important;`));
  }
  assert.doesNotMatch(css, /nth-child\(4\)\{position/, 'yalnız istenen sütunlar donar');
});

test('katman sırası: kayan gövde < donmuş gövde < kayan başlık < donmuş başlık', () => {
  const css = engine()._buildCss({ id: 'kolTable' }, [0, 72]);
  assert.ok(css.includes('#kolTable[data-bl-freeze]>thead>tr>th{z-index:var(--ui-z-sticky)!important}'),
    'kimlik seçicili `#kolTable thead tr.colRow th{z-index:1}` donmuş başlığın üstüne çıkamaz');
  assert.ok(css.includes('#kolTable[data-bl-freeze]>tfoot>tr{z-index:var(--ui-z-sticky)!important}'));
  assert.ok(css.includes('#kolTable[data-bl-freeze]>thead>tr.groupRow>th.frzL{position:sticky!important;z-index:var(--ui-z-sticky-column)!important}'));
  const tokens = read('public/ui-tokens.css');
  assert.match(tokens, /--ui-z-frozen-cell:20;--ui-z-sticky:30;--ui-z-sticky-column:31;/);
});

test('donmuş zemin opaktır ama seçim/üzerine gelme zeminini ezmez', () => {
  const css = engine()._buildCss({ id: 'ordersTable' }, [0, 40, 90]);
  assert.ok(css.includes(':where(#ordersTable[data-bl-freeze]>tbody>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(-n+3)){background-color:var(--ui-surface)}'));
  assert.ok(css.includes(':where(#ordersTable[data-bl-freeze]>tfoot>tr:not(:has(>[colspan]:not([colspan="1"])))>:nth-child(-n+3)){background-color:var(--ui-surface-soft)}'));
  assert.doesNotMatch(css, /background-color:[^}]*!important/, 'zemin !important olursa seçim görünmez');
  assert.match(css, /:nth-child\(3\),#ordersTable\[data-bl-freeze\]>thead>tr\.colRow>th:nth-child\(3\)\)\{box-shadow:inset -2px 0 0 var\(--ui-group-divider\)\}/,
    'donmuş alanın kenarı genişliği değiştirmeyen iç çizgidir');
});

test('ofsetler gerçek başlık genişliğinden ölçülür ve ResizeObserver ile canlı tutulur', () => {
  assert.match(ENGINE, /return cell\.getBoundingClientRect\(\)\.width;/);
  assert.match(ENGINE, /rec\.observer = new global\.ResizeObserver\(function \(\) \{ schedule\(table\); \}\)/);
  assert.match(ENGINE, /\{ box: 'border-box' \}/);
  // Gizli sekmede ölçü 0'dır: eski ofsetler bozulmaz, görünür olunca yeniden yazılır.
  assert.match(ENGINE, /if \(!widths\.every\(function \(w\) \{ return Number\.isFinite\(w\) && w > 0; \}\)\) return;/);
});

test('donmuş alan tabloyu kaplarsa dondurma askıya alınır, tercih korunur', () => {
  assert.match(ENGINE, /rec\.suspended = Boolean\(available && acc > available - MIN_SCROLL_VIEW\);/);
  assert.match(ENGINE, /table\.setAttribute\('data-bl-freeze-suspended', ''\);/);
  assert.match(APP, /if\(result&&result\.suspended\)\{\s*setFreeze\(pick\.tableKey,previous\);/);
  assert.match(APP, /tooWide:en\?'The frozen area would cover the visible table\. Pick fewer or narrower columns\.':'Dondurulan alan görünür tabloyu kaplıyor\. Daha az veya daha dar sütun seç\.'/);
});

test('app-main satır satır dondurma işi yapmaz; tek giriş noktası BLTableFreeze', () => {
  for (const legacy of ['freezeColumnWidths', 'freezeLayoutFor', 'applyFreezeToRow', 'applyFreezePlanToRow', 'freezeMoveLaser', 'freezeColumnAtX', 'freezeHighlight'])
    assert.doesNotMatch(APP, new RegExp('\\b' + legacy + '\\('), legacy);
  assert.doesNotMatch(APP, /freezePlan/);
  assert.match(APP, /function setupVirtualizedBody\(tbody, table, rows, buildRow, colCount\)\{/);
  assert.match(APP, /clearFreeze\(tableId,tableKey\)\{freezeCancel\(\);setFreeze\(tableKey,0\);applyFreeze\(tableId,tableKey,true\);/);
});

test('seçim kipi sıralama/sürükleme/filtreyi yutar ve Esc ile kapanır', () => {
  for (const type of ['pointerdown', 'mousedown', 'dragstart', 'click', 'keydown'])
    assert.ok(ENGINE.includes(`document.addEventListener('${type}', `), type);
  assert.match(ENGINE, /if \(pick && event\.key === 'Escape'\) \{ event\.preventDefault\(\); cancelPick\(\); \}/);
  assert.match(ENGINE, /cell\.classList\.toggle\('freezePreview', index != null && i <= index\);/);
});
