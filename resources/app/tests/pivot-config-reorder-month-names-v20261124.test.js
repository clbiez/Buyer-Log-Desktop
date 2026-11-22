'use strict';
/* OAB (Küp) Plan başlangıç ayı görünümü + pivot alanı ayarlarında ortak
   sürükle-bırak sözleşmesi. Gerçek tarayıcı sürüklemesi:
   scripts/pivot-config-drag-acceptance.js (Playwright, demo veri). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const dateDimension = require('../public/date-dimension.js');
const reorder = require('../public/pivot-config-reorder.js');
const cubeReport = require('../server/lib/oab-cube-report');

test('monthNumberName: 1–12 ay adına çevrilir, diğer değerler olduğu gibi kalır', () => {
  const name = dateDimension.monthNumberName;
  assert.equal(typeof name, 'function');
  assert.equal(name('1', 'tr'), 'Ocak');
  assert.equal(name(1, 'en'), 'January');
  assert.equal(name('01', 'tr'), 'Ocak');
  assert.equal(name(' 12 ', 'tr'), 'Aralık');
  assert.equal(name('12', 'en'), 'December');
  assert.equal(name('2', 'tr'), 'Şubat');
  assert.equal(name('9.0', 'en'), 'September');
  for (const raw of ['0', '13', '-1', '1.5', 'Ocak', 'abc', '202601', '3E8']) assert.equal(name(raw, 'tr'), raw, raw);
  assert.equal(name('', 'tr'), '');
  assert.equal(name(null, 'tr'), '');
  assert.equal(name(undefined, 'en'), '');
});

test('OAB (Küp) kataloğu Plan başlangıç ayını ay numarası görünümüyle işaretler; ham değer korunur', () => {
  const dim = cubeReport.catalog().dimensions.find(item => item.key === 'planStartMonth');
  assert.equal(dim.display, 'monthNumber');
  assert.equal(dim.code, false);
  // Yalnız bu alan işaretli: başka boyut ay adına çevrilmez.
  assert.deepEqual(cubeReport.catalog().dimensions.filter(item => item.display === 'monthNumber').map(item => item.key), ['planStartMonth']);
  // Dönüşüm yalnız görüntüdedir: sorgu/filtre normalizasyonu ham 1–12 değerini taşır.
  const view = cubeReport.normalizeView({ ...cubeReport.catalog().defaults, filters: [{ key: 'season' }, { key: 'planStartMonth' }], filterValues: { season: ['S6'], planStartMonth: ['1', '12'] } });
  assert.deepEqual(view.filterValues.planStartMonth, ['1', '12']);
});

test('oab-cube.js ay adını görüntüde yazar; sıralama, filtre ve Excel ham değeri bozmaz', () => {
  const src = pub('oab-cube.js');
  assert.match(src, /monthNumberName/);
  assert.match(src, /const dimText = \(key, value\) =>[^\n]*monthText\(key, value\)/);
  // Yaprak hücre, grup, filtre çubuğu, alt detay bağlamı ve Excel aynı görüntü yolunu kullanır.
  assert.match(src, /return `<td>\$\{esc\(value == null \|\| value === '' \? text\('\(boş\)', '\(blank\)'\) : dimText\(ref\.key, value\)\)\}<\/td>`;/);
  assert.match(src, /out\[refLabel\(ref\)\] = isMulti\(ref\.key, raw\)[^\n]*: dimText\(ref\.key, raw\);/);
  assert.match(src, /baseDim\(key\) \? dimText\(key, clean\(row\[key\]\)\)/);
  // Alt detay sütunu görüntü biçimi alır, satırdaki ham değer değişmez.
  assert.match(src, /isMonthNumber\(key\) \? \{ format: value => dimText\(key, clean\(value\)\) \}/);
  // Filtre seçicisi: checkbox değeri hamdır, etiket ay adıdır, liste ay sırasıyla.
  assert.match(src, /<input type="checkbox" value="\$\{esc\(value\)\}"/);
  assert.match(src, /isMonthNumber\(key\) \? values\.slice\(\)\.sort\(compareText\)/);
  // Pivot sıralaması ham değerle (numeric) yapılır: 1→12, alfabetik değil.
  assert.match(src, /const compareText = \(a, b\) => String\(a\)\.localeCompare\(String\(b\), 'tr', \{ numeric: true/);
});

test('pivot-config-reorder: bırakma konumu satır ortasına göre', () => {
  assert.equal(typeof reorder.bind, 'function');
  assert.equal(reorder.placement({ top: 100, height: 40 }, 110), 'before');
  assert.equal(reorder.placement({ top: 100, height: 40 }, 121), 'after');
});

const WIDGETS = [
  ['OAB (PASS)', 'oab.js'],
  ['INTAKE', 'intake.js'],
  ['FOB Sonrası', 'postfob.js'],
  ['TR/YD', 'tryd-advantage.js'],
  ['OAB (Küp)', 'oab-cube.js'],
];
for (const [name, file] of WIDGETS) {
  test(`${name}: pivot ayarları sürükle-bırakı ortak modülle bağlanır`, () => {
    const src = pub(file);
    assert.match(src, /BLPivotConfigReorder\?\.bind\(modal, \{ onReorder:/, 'ortak bind çağrısı');
    assert.doesNotMatch(src, /modal\.addEventListener\('dragstart'/, 'widget kendi drag motorunu taşımaz');
    assert.match(src, /class="oabConfigDrag"/, 'tutamak işaretlemesi');
    assert.match(src, /config-move="-1"/, 'klavye/erişilebilir yukarı-aşağı düğmeleri korunur');
  });
}

test('app-main: beş widget ortak sürükle-bırak modülünü tembel yükler', () => {
  const src = pub('app-main.js');
  assert.equal((src.match(/loader\('pivot-config-reorder\.js\?rev=20261124'\)/g) || []).length, 1, 'tek yardımcı');
  for (const module of ['oab', 'intake', 'postfob', 'trydAdvantage', 'oabCube']) {
    assert.match(src, new RegExp(`OVERVIEW_MODULE_LOAD_START',\\{module:'${module}',mode:'after-ui'\\}\\);\\n  ensurePivotConfigReorder\\(\\);`), module);
  }
  assert.doesNotMatch(pub('index.html'), /pivot-config-reorder\.js/, 'açılışta eager yüklenmez');
});

test('pivot-config-reorder: tutamaktan başlar, aynı listede kalır, reduced-motion güvenli', () => {
  const src = pub('pivot-config-reorder.js');
  assert.match(src, /closest\('\.oabConfigDrag'\)/);
  assert.match(src, /target\.parentElement !== dragged\.parentElement/);
  assert.match(src, /event\.preventDefault\(\)/);
  assert.match(src, /isDragging/);
  assert.doesNotMatch(src, /\.animate\(|requestAnimationFrame/, 'kendi animasyon motoru yok');
});
