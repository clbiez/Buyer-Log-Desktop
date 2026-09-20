const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function overviewRenderer() {
  const start = APP.indexOf('function renderOverviewNow()');
  const end = APP.indexOf('\nfunction ', start + 1);
  assert.ok(start >= 0 && end > start, 'Overview renderer sınırları bulunmalı');
  return APP.slice(start, end);
}

test('Overview: Quick CP Filters kartı kaldırılmış olmalı', () => {
  assert.doesNotMatch(INDEX, /data-i18n-tr="Hızlı CP Filtreleri"/);
  assert.doesNotMatch(INDEX, /id="kpiCP"/);
});

test('Overview: kaldırılan Quick CP Filters DOM elemanlarını render etmeye çalışmamalı', () => {
  const renderer = overviewRenderer();
  assert.doesNotMatch(renderer, /getElementById\(['"]kpiCP['"]\)/);
  assert.doesNotMatch(renderer, /qfgFinish\(['"]overview['"]/);
  assert.match(renderer, /fillMiniTable\(['"]tblCountry['"]/);
  assert.match(renderer, /fillMiniTable\(['"]tblLicense['"]/);
});

test('CP ekranı: hızlı filtre şeridi korunmalı', () => {
  assert.match(APP, /getElementById\(['"]cpKpi['"]\)/);
  assert.match(APP, /qfgFinish\(['"]cp['"],['"]cpKpi['"]/);
});
