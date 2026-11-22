'use strict';
// Widget'lardaki uzun açılır listelere arama (ortak BLDataPicker) ve OAB toplam
// satırı alt detay hücresi hover kontrastı — kaynak sözleşmesi. Uçtan uca
// davranış: scripts/pivot-field-search-screenshot.js ve
// scripts/oab-filter-search-hover-screenshot.js (gerçek Buyer Log, demo veri).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const PICKER = read('public/data-management-picker.js');
const INDEX = read('public/index.html');
const UI_CSS = read('public/ui-components.css');
const OAB = read('public/oab.js');

const PRIMITIVES = read('public/ui-primitives.js');

test('Ortak seçici lazy kalır; başlangıçta yalnız küçük yakalayıcı çalışır', () => {
  // Seçici başlangıçta yüklenmez (performans sözleşmesi: yalnız kayıt kabuğu).
  assert.doesNotMatch(INDEX, /<script src="data-management-picker\.js/);
  assert.match(INDEX, /<script src="ui-primitives\.js\?v=__BL_ASSET_VERSION__&rev=2"><\/script>/);
  assert.match(PRIMITIVES, /BLPerf\?\._loadScript\?\.\('data-management-picker\.js\?rev=2'\)/);
  assert.match(read('public/perf-runtime.js'), /'data-management-picker\.js\?rev=2'/);
  assert.match(PICKER, /if \(window\.BLDataPicker\) return;/);
  // Yerleşim CSS'i eager ui-components.css'te (Veri Yönetimi dışındaki kullanım için).
  assert.match(UI_CSS, /\.dmfPicker \{\s*position: fixed;/);
  assert.doesNotMatch(read('public/data-management.css'), /\.dmfPicker \{/);
});

test('Widget ayar pencereleri ve Genel Bakış widget\'larındaki uzun <select> aranabilir seçiciyle açılır', () => {
  assert.match(PRIMITIVES, /const LONG_SELECT_SCOPE='\.oabSettingsModal, #ovDashboardGrid, \[data-overview-widget\]';/);
  assert.match(PRIMITIVES, /const LONG_SELECT_MIN_OPTIONS=10;/);
  assert.match(PRIMITIVES, /select\.multiple\|\|select\.disabled/);
  assert.match(PRIMITIVES, /closest\('\[data-bl-native-select\]'\)/);
  assert.match(PRIMITIVES, /event\.preventDefault\(\); \/\/ yerel açılır listeyi engelle/);
  // Seçim <select>'e yazılır ve modüllerin change/input dinleyicileri çalışır.
  assert.match(PICKER, /select\.value = value;\s*select\.dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\);\s*select\.dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\);/);
  // Optgroup sırası korunur (Hazır alanlar → Küp alanları).
  assert.match(PICKER, /keepOrder: true/);
  assert.match(PICKER, /if \(grouped && !options\.keepOrder\)/);
  assert.match(PICKER, /window\.BLDataPicker = \{ open, close, openForSelect, isOpenFor \};/);
  // Kendi araması olan saat dilimi listesi yerel kalır.
  assert.match(read('public/overview-launchpad.js'), /<select data-clock-select data-bl-native-select/);
});

test('Escape yalnız seçiciyi kapatır (capture), altta açık pencereye ulaşmaz', () => {
  assert.match(PICKER, /document\.addEventListener\('keydown', escape, true\);/);
  assert.match(PICKER, /const escape = event => \{\s*if \(event\.key !== 'Escape'\) return;\s*event\.preventDefault\(\); event\.stopPropagation\(\);/);
});

test('OAB "Filtre ekle" listesi arama kutusuyla süzülür (TR/EN)', () => {
  const addPopover = OAB.slice(OAB.indexOf('function oabOpenLocalFilterFieldPopover'), OAB.indexOf('function oabOpenMultiPopover'));
  assert.match(addPopover, /class="oabMultiSearch oabLocalFilterAddSearch"/);
  assert.match(addPopover, /oabT\('Alan ara…', 'Search fields…'\)/);
  assert.match(addPopover, /oabT\('Sonuç yok', 'No results'\)/);
  assert.match(addPopover, /visibleChoices\(\)\[0\]\?\.click\(\)/);
  // Arama kutusunun işlediği ↓, popover dinleyicisinde ikinci kez ilerlemez.
  assert.match(addPopover, /if \(event\.defaultPrevented \|\| \(event\.key !== 'ArrowDown' && event\.key !== 'ArrowUp'\)\) return;/);
  assert.match(read('public/app.css'), /\.oabLocalFilterAddPopover \[hidden\]\{display:none !important;\}/);
});

test('Toplam satırlarında alt detay hücresi hover\'ı satırın zemin/metin çiftini korur', () => {
  const scope = ':is(#oabTable,#oabCubeTable,#postFobTable,#trydAdvantageTable) tbody';
  const esc = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  assert.match(UI_CSS, new RegExp(esc(`${scope} tr.oabPivotGrandTotalRow td.oabPivotDrillCell:hover {`) + '[^}]*color:var\\(--ui-surface\\)'));
  assert.match(UI_CSS, new RegExp(esc(`${scope} tr:is(.oabPivotGroupRow,.oabPivotSubtotalRow) td.oabPivotDrillCell:hover {`) + '[^}]*color:var\\(--ui-text\\)'));
  // Genel hücre kuralından sonra gelir (aynı özgüllükte sıra kazanır; :is(#id) zaten daha özgül).
  assert.ok(UI_CSS.indexOf('tr.oabPivotGrandTotalRow td.oabPivotDrillCell:hover') > UI_CSS.indexOf('#oabTable tbody td.oabPivotDrillCell:hover'));
});
