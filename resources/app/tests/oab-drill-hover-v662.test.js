// NOT (v7.00): sürüm etiketi iddiaları belirli bir sürüm numarasını değil,
// önbellek etiketinin VARLIĞINI çivilemelidir; her sürüm yükseltmesinde
// kırılmasınlar diye kalıp \d+\.\d+ olarak gevşetildi.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('OAB drill-down images use the shared large hover preview above the modal overlay', () => {
  assert.match(APP, /function bindDetailModelThumb\(img\)[\s\S]*BLImageRuntime\.scheduleHover\(img,event\)/);
  assert.match(APP, /z-index:54990/);
  assert.match(APP, /BLDetailImages=\{[\s\S]*bindThumbs:bindDetailModelThumbs/);
  assert.match(OAB, /oabDrillModelThumb detailModelThumb/);
  assert.match(OAB, /global\.BLDetailImages\.bindThumbs\(table\)/);
});

test('changed OAB/app-main assets are cache-busted', () => {
  assert.match(INDEX, /app-main\.js\?v=__BL_ASSET_VERSION__/);
  // oab.js artık eager değil, lazy-loader ile yükleniyor; cache-bust sorgusu
  // da onunla birlikte app-main.js'teki yükleme çağrısına taşındı.
  assert.match(APP, /loader\('oab\.js\?rev=\d+'\)/);
});
