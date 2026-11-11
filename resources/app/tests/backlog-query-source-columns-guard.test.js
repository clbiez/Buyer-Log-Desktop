'use strict';
// Regression (2026-11-11): #963 sonrası Backlog satır sorgusu parametreleri
// (backlogExportQueryParams → backlogSelectedSourceIds) tembel yüklenen
// BLBacklogColumns modülünü koşulsuz çağırıyordu. Excel ayarları açılmadan
// modül yüklenmediği için sorgu hata veriyor; Genel Bakış ve teslimat analizi
// "Backlog yüklendiğinde…" durumunda kalıyordu. Sorgu bu modüle/formül motoruna
// bağlı olarak asla çökmemeli.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunamadı`);
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`${name} kapanmadı`);
}

function sandbox(window, settings) {
  const selected = ['field:1', 'custom:asas:A', 'custom:antrepo:B', 'formula:F'];
  const catalog = new Map(['field:1', 'custom:asas:A', 'custom:antrepo:B', 'custom:asas:C', 'formula:F'].map(id => [id, { id }]));
  const ctx = vm.createContext({
    window,
    backlogExcelColumns: () => selected.slice(),
    backlogExcelColumnSettings: () => settings,
    backlogExcelColumnCatalog: () => catalog,
  });
  vm.runInContext(extractFunction(read('public/app-main.js'), 'backlogSelectedSourceIds'), ctx);
  return () => vm.runInContext('backlogSelectedSourceIds()', ctx);
}

test('BLBacklogColumns yüklenmeden Backlog sorgusu çökmez', () => {
  const run = sandbox({}, {});
  assert.deepEqual([...run()], ['custom:asas:A', 'custom:antrepo:B']);
});

test('formül motoru yokken veya formül bozukken seçili kaynaklara düşer', () => {
  const columns = require('../public/backlog-excel-columns');
  const settings = { 'formula:F': { formula: '[custom:asas:C] + 1' } };
  assert.deepEqual([...sandbox({ BLBacklogColumns: columns }, settings)()], ['custom:asas:A', 'custom:antrepo:B']);
  const broken = { 'formula:F': { formula: '[missing:column] +' } };
  const engine = require('../public/formula-engine');
  assert.deepEqual([...sandbox({ BLBacklogColumns: columns, BLFormulaEngine: engine }, broken)()], ['custom:asas:A', 'custom:antrepo:B']);
});

test('modül ve motor hazırken formül bağımlılıkları sorguya eklenir', () => {
  const columns = require('../public/backlog-excel-columns');
  const engine = require('../public/formula-engine');
  const settings = { 'formula:F': { formula: '[custom:asas:C] + 1' } };
  const ids = [...sandbox({ BLBacklogColumns: columns, BLFormulaEngine: engine }, settings)()];
  assert.ok(ids.includes('custom:asas:C'), JSON.stringify(ids));
});

test('Backlog sorgu modülü Genel Bakış ile birlikte statik yüklenir', () => {
  const html = read('public/index.html');
  const columns = html.indexOf('<script src="backlog-excel-columns.js');
  const overview = html.indexOf('<script src="backlog-overview.js');
  assert.ok(columns >= 0 && columns < overview, 'backlog-excel-columns.js, backlog-overview.js öncesinde yüklenmeli');
});
