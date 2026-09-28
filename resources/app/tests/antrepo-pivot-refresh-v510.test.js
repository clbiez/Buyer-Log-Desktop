'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');
const PS1 = fs.readFileSync(path.join(ROOT, 'server', 'lib', 'RefreshExcel.ps1'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, `${start} bulunmalı`);
  const b = source.indexOf(end, a + start.length);
  assert.ok(b > a, `${end} bulunmalı`);
  return source.slice(a, b);
}

test('v5.10 Excel Antrepo refreshes workbook before parsing and fails closed on refresh error', () => {
  const loadAntrepo = between(SERVER, 'async function loadAntrepoFromExcel', '// Ana Refresh veri kaynağı');
  assert.match(loadAntrepo, /refreshBeforeRead === true[\s\S]*refreshAntrepoExcelBeforeRead\(found\.antrepo\)[\s\S]*runExcelTask\('parseAntrepoFile'/);
  const loadModels = between(SERVER, 'async function loadFromModels', '// "Yenile" sonrası');
  assert.match(loadModels, /loadAntrepoFromExcel\(id, matchRule, \{[\s\S]{0,260}?refreshBeforeRead: true/);
  assert.match(SERVER, /Güncel pivot verisi doğrulanmadan dosya okunmadı/);
});

test('v5.10 uploaded Antrepo workbook is refreshed in Excel before application data is parsed', () => {
  const upload = between(SERVER, "app.post('/api/antrepo-source/upload'", '// ---- OPD + sezon + Licensor + License bazlı Royalty');
  const refreshAt = upload.indexOf('await refreshAntrepoExcelBeforeRead');
  const parseAt = upload.indexOf("runExcelTask('parseAntrepoFile'");
  assert.ok(refreshAt >= 0 && parseAt > refreshAt, 'pivot refresh parse işleminden önce olmalı');
  assert.match(upload, /\.upload-\$\{process\.pid\}-\$\{Date\.now\(\)\}\.xlsx/);
});

test('Excel automation refreshes workbook once without repeating every PivotTable query', () => {
  assert.match(PS1, /\$workbook\.RefreshAll\(\)/);
  assert.match(PS1, /CalculateUntilAsyncQueriesDone/);
  assert.match(PS1, /\$sheet\.PivotTables\(\)/);
  assert.doesNotMatch(PS1, /\$pivot\.RefreshTable\(\)/);
  assert.match(PS1, /\$pivot\.RepeatAllLabels\(2\)/);
  assert.doesNotMatch(PS1, /\$workbook\.PivotCaches\(\)/);
  assert.doesNotMatch(PS1, /\$cache\.Refresh\(\)/);
  assert.doesNotMatch(PS1, /\$excel\.CalculateFullRebuild\(\)/);
  assert.match(PS1, /OpenMs=.*RefreshMs=.*LayoutMs=.*CalculateMs=.*SaveMs=.*TotalMs=/);
});

test('v5.10 latest refresh result notes are shown directly on Overview', () => {
  assert.match(INDEX, /id="ovRefreshResult"/);
  assert.match(APP, /function renderOverviewRefreshResult\(\)/);
  assert.match(APP, /lastRefreshResult/);
  assert.match(APP, /data-refresh-result-detail/);
  assert.match(APP, /Değişiklik geçmişi otomatik modal açmaz/);
  assert.match(CSS, /\.ovRefreshResult/);
});

test('v5.10 refresh result is persisted in model snapshot and returned by api data', () => {
  assert.match(SERVER, /lastRefreshResult: snapshot\.lastRefreshResult \|\| null/);
  assert.match(SERVER, /lastRefreshResult: runtime\.lastRefreshResult \|\| null/);
  assert.match(SERVER, /staged\.lastRefreshResult = \{/);
  assert.match(SERVER, /saveRuntimeModelSnapshot\(id, next\)/);
  assert.match(SERVER, /publishRefreshedRuntime\(id, staged\)/);
  assert.match(SERVER, /lastRefreshResult: active\.lastRefreshResult \|\| null/);
});
