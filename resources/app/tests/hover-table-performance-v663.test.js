'use strict';
// NOT (v7.00): sürüm etiketi iddiaları belirli bir sürüm numarasını değil,
// önbellek etiketinin VARLIĞINI çivilemelidir; her sürüm yükseltmesinde
// kırılmasınlar diye kalıp \d+\.\d+ olarak gevşetildi.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const appMain = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function blockBetween(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Başlangıç bulunamadı: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Bitiş bulunamadı: ${end}`);
  return source.slice(from, to);
}

test('v6.63 ortak görsel popup hareketi kare bazlı ve transform destekli', () => {
  const position = blockBetween(appMain, 'function kolPositionPopup', 'function kolHideImgPopup');
  assert.match(position, /requestAnimationFrame/);
  assert.match(appMain, /translate3d\(/);
  assert.doesNotMatch(position, /offsetWidth|offsetHeight|getBoundingClientRect/);
  assert.match(appMain, /will-change:transform;contain:layout paint style/);
});

test('v6.63 görsel aksiyon metni native title yerine aria-label kullanır', () => {
  const cpCell = blockBetween(appMain, 'function cpImageCellHtml', 'function cpImageRowById');
  const collectionRow = blockBetween(appMain, 'const collectionImageTitle=', "tbody.innerHTML=''");
  assert.match(cpCell, /aria-label=/);
  assert.doesNotMatch(cpCell, /class="cpThumb kolThumb" title=/);
  assert.match(collectionRow, /aria-label=/);
  assert.doesNotMatch(collectionRow, /class="kolThumb[^`]*" title=/);
  assert.match(appMain, /target\.removeAttribute\('title'\)/);
});

test('v6.63 yoğun tablolar ekran dışı satır çizimini erteler', () => {
  for (const selector of ['#kolTable tbody tr', '#backlogTreeTable tbody tr', '#shipTable tbody tr', '#lflGroupTable tbody tr', '.backlogDetailTable tbody tr', '.quotationTable tbody tr']) {
    assert.ok(appCss.includes(selector), `${selector} optimizasyon listesinde olmalı`);
  }
  assert.match(appCss, /content-visibility:auto/);
  assert.match(appCss, /\.blForceFullRender tbody tr\{content-visibility:visible!important/);
});

test('v6.63 DOM Excel export tam çizimi try/finally ile geri bırakır', () => {
  const exportBlock = blockBetween(appMain, 'async function exportStyledDomTable', 'async function exportCpTableWithLightTheme');
  assert.match(exportBlock, /beginFullTableLayout\(table\)/);
  assert.match(exportBlock, /finally\s*\{\s*releaseFullLayout\(\)/);
});

test('v6.63 performans düzeltmeleri canonical runtime sürümünde korunur', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.match(index, />Version __BL_DISPLAY_VERSION__</);
  assert.match(index, /app-main\.js\?v=__BL_ASSET_VERSION__/);
  assert.match(index, /app\.css\?v=__BL_ASSET_VERSION__/);
  assert.doesNotMatch(index, />Version \d+\.\d+</);
});
