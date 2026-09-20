'use strict';

/* OAB (Pivot + Raw Data) ve INTAKE tablolarında Excel benzeri sütun genişliği.
   Sözleşme: minimum genişliği ALT HÜCRE içeriği belirler (başlık DEĞİL), uzun
   başlık daraltılınca satır kırar, taşma sayfayı değil tablo kabını kaydırır ve
   kullanıcı genişlikleri rerender/filter/refresh sonrası korunur. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
const MODULE_JS = read('table-column-resize.js');
const OAB_JS = read('oab.js');
const INTAKE_JS = read('intake.js');
const APP_CSS = read('app.css');
const INDEX = read('index.html');

test('ortak resize modülü index.html ile yüklenir ve ikinci bir framework açılmaz', () => {
  assert.match(INDEX, /<script src="table-column-resize\.js\?v=/);
  assert.match(MODULE_JS, /global\.BLTableColumnResize\s*=/);
  // OAB ve INTAKE aynı modülü çağırır; kendi resize uygulamalarını yazmazlar.
  assert.match(OAB_JS, /BLTableColumnResize\?\.apply/);
  assert.match(INTAKE_JS, /BLTableColumnResize\?\.apply/);
  assert.doesNotMatch(OAB_JS, /addEventListener\('mousedown'[^)]*col-resize/);
});

test('minimum genişlik veri tipine göre belirlenir, başlık metni hesaba girmez', () => {
  const minBlock = MODULE_JS.slice(MODULE_JS.indexOf('function minPxOf'), MODULE_JS.indexOf('function defaultPxOf'));
  assert.match(minBlock, /TYPE_MIN\[typeOf\(col\)\]/);
  // Başlık ölçümü YALNIZ varsayılan genişlikte kullanılabilir, minimumda asla.
  assert.doesNotMatch(minBlock, /headerTextPx/);
  assert.match(MODULE_JS, /var TYPE_MIN = \{ num: \d+, pct: \d+, date: \d+, code: \d+, text: \d+ \};/);
});

test('sürükleme ve çift tıklama sıralama/filtre/yeniden adlandırmayı tetiklemez', () => {
  assert.match(MODULE_JS, /grip\.addEventListener\('click', function \(e\) \{ e\.preventDefault\(\); e\.stopPropagation\(\); \}\);/);
  assert.match(MODULE_JS, /grip\.addEventListener\('dblclick'[\s\S]{0,120}stopPropagation/);
  assert.match(MODULE_JS, /grip\.addEventListener\('mousedown'[\s\S]{0,160}stopPropagation/);
});

test('drag sırasında genişlik canlı gösterilir', () => {
  assert.match(MODULE_JS, /function showBadge\(/);
  assert.match(MODULE_JS, /showBadge\(next, ev\.clientX, ev\.clientY\)/);
  assert.match(APP_CSS, /\.blColResizeBadge\{[^}]*position:fixed/);
});

test('uzun başlık sarılır, başlık yüksekliği sabit değildir', () => {
  assert.match(APP_CSS, /\.blResizableTable thead th[^{]*\{[^}]*white-space:normal/);
  assert.match(APP_CSS, /\.blResizableTable thead th[^{]*\{[^}]*height:auto/);
  assert.match(APP_CSS, /\.blResizableTable thead th \.thLabel\{[^}]*white-space:normal/);
  assert.match(APP_CSS, /\.blResizableTable\{table-layout:fixed;\}/);
});

test('taşma sayfada değil tablo kabında oluşur', () => {
  assert.match(APP_CSS, /\.oabTableWrap\{[^}]*overflow:auto[^}]*max-width:100%/);
  assert.match(APP_CSS, /\.intakeTableWrap\{[^}]*overflow:auto[^}]*max-width:100%/);
  // Sabit min-width'ler sütun genişliklerini ezmemeli.
  assert.match(APP_CSS, /\.oabTableWrap \.miniTable\.blResizableTable,\.intakeTableWrap \.miniTable\.blResizableTable\{min-width:0;\}/);
  // Sığmadığında önce kullanıcının dokunmadığı sütunlar kısılır, kullanıcı genişliği korunur.
  assert.match(MODULE_JS, /var flexible = list\.filter\(function \(item\) \{ return !item\.fixed; \}\);/);
});

test('OAB Pivot ve Raw Data ayrı kalıcılık kapsamlarında saklanır', () => {
  assert.match(OAB_JS, /oabAttachColumnResize\(table, 'oab\.pivot'/);
  assert.match(OAB_JS, /oabAttachColumnResize\(table, 'oab\.raw'/);
  assert.match(MODULE_JS, /'lcw\.tableColWidth\.' \+ name \+ '\.v1'/);
});

test('INTAKE genişlikleri mevcut viewConfig.display.widths sözleşmesinde kalır', () => {
  assert.match(INTAKE_JS, /store: widthStore/);
  assert.match(INTAKE_JS, /target\.widths\[id\] = Math\.round\(px\)/);
  assert.match(INTAKE_JS, /function persistWidths\(/);
  // Genişlik kaydı sessizdir: saveView() gibi durum mesajı basıp tabloyu yeniden çizmez.
  const persist = INTAKE_JS.slice(INTAKE_JS.indexOf('function persistWidths'), INTAKE_JS.indexOf('const widthStore'));
  assert.doesNotMatch(persist, /setStatus|render\(\)/);
  // Genişlik artık th inline style'ı ile değil colgroup ile verilir.
  assert.doesNotMatch(INTAKE_JS, /data-intake-sort="\$\{esc\(field\.id\)\}"[^`]*style="width:/);
});
