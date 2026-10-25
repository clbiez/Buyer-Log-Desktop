'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const CSS = require('./helpers/manifest-css')();

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `start marker missing: ${start}`);
  assert.notEqual(to, -1, `end marker missing: ${end}`);
  return source.slice(from, to);
}

test('v10.35 Orders ve Collection aktif tablo filtrelerini araç çubuğundan önce görünür kılar', () => {
  const orders = sliceBetween(INDEX, 'id="view-orders"', 'id="view-koleksiyon"');
  const collection = sliceBetween(INDEX, 'id="view-koleksiyon"', 'id="view-lfl"');
  assert.match(orders, /id="ordersActiveFilters"[^>]*role="region"[\s\S]*?id="ordersActiveFilterTokens"[^>]*aria-live="polite"/);
  assert.match(collection, /id="kolActiveFilters"[^>]*role="region"[\s\S]*?id="kolActiveFilterTokens"[^>]*aria-live="polite"/);
  assert.ok(orders.indexOf('id="ordersActiveFilters"') < orders.indexOf('id="ordersTableToolbar"'));
  assert.ok(collection.indexOf('id="kolActiveFilters"') < collection.indexOf('id="kolTableToolbar"'));
});

test('v10.35 ortak özet arama, sütun ve işaretleme filtrelerini tek sözleşmede toplar', () => {
  assert.match(APP, /function activeTableFilterTokens\(tableKey\)/);
  assert.match(APP, /function renderActiveFilterContext\(tableKey\)/);
  const block = sliceBetween(APP, 'function activeTableFilterTokens(tableKey)', 'function renderActiveFilterContext(tableKey)');
  assert.match(block, /tableKey==='koleksiyon'\?'kolSearch':`\$\{tableKey\}Search`/);
  assert.match(block, /state\.colFilters\[tableKey\]/);
  assert.match(block, /state\.checkFilter\[tableKey\]/);
  assert.match(block, /state\.ordersQuickActive/);
  assert.match(block, /kolColFilters/);
  assert.match(block, /kolCheckFilter/);
});

test('v10.35 filtre çipleri tek tek kaldırılabilir ve ilgili kalıcı durum güncellenir', () => {
  assert.match(APP, /function removeActiveFilterToken\(tableKey,kind,key\)/);
  assert.match(APP, /delete state\.colFilters\[tableKey\]\[key\]/);
  assert.match(APP, /delete kolColFilters\[key\]/);
  assert.match(APP, /saveKolColState\(\)/);
  assert.match(APP, /saveCoreAutoFilterState\(\)/);
  assert.match(APP, /data-filter-remove/);
  assert.match(APP, /aria-label=.*Remove filter|Filtreyi kaldır/);
});

test('v10.35 tablo filtrelerini temizleme sayfa kapsamını korur ve eski global eylemle aynı yolu kullanır', () => {
  const clearBlock = sliceBetween(APP, 'function clearTableFilters(tableKey', "document.getElementById('navClearFilters')");
  assert.match(clearBlock, /state\.colFilters\[tableKey\]\s*=\s*\{\}/);
  assert.match(clearBlock, /kolColFilters\s*=\s*\{\}/);
  assert.doesNotMatch(clearBlock, /ordersDimFilters\s*=\s*\{\}/);
  assert.doesNotMatch(clearBlock, /cpDimFilters\s*=\s*\{\}/);
  assert.match(APP, /document\.getElementById\('navClearFilters'\)\.addEventListener\('click',[\s\S]*?clearTableFilters\(info\.tableKey/);
  assert.match(INDEX, /data-active-filter-clear="orders"/);
  assert.match(INDEX, /data-active-filter-clear="koleksiyon"/);
});

test('v10.35 aktif filtre özeti her Orders ve Collection çiziminde güncellenir', () => {
  const ordersRender = sliceBetween(APP, 'function renderOrdersNow()', 'function markDirty');
  const collectionRender = sliceBetween(APP, 'function renderKol()', 'function kolSpreadsheetFormulaInfo');
  assert.match(ordersRender, /renderActiveFilterContext\('orders'\)/);
  assert.match(collectionRender, /renderActiveFilterContext\('koleksiyon'\)/);
});

test('v10.35 filtre bağlamı token tabanlı, odak görünür ve dar ekranda taşmadan sarılır', () => {
  const block = require('./helpers/manifest-css').rules(/activeFilter/);
  assert.match(block, /\.activeFilterBar\{/);
  require('./helpers/manifest-css').assertFocus();
  assert.match(CSS, /@media\s*\(max-width:900px\)/);
  assert.match(block, /flex-wrap:wrap/);
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}/i);
});
