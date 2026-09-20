'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const INDEX = fs.readFileSync('public/index.html', 'utf8');
const APP = fs.readFileSync('public/app-main.js', 'utf8');
const CSS = fs.readFileSync('public/app.css', 'utf8');
const GRID = fs.readFileSync('public/grid-clipboard.js', 'utf8');
const KOL = fs.readFileSync('public/collection-spreadsheet.js', 'utf8');

test('v10.34 Orders ve Collection görünür tablo bağlamında Odak/Tümü presetlerini sunar', () => {
  assert.match(INDEX, /id="ordersTableViewActions"[^>]*role="group"[\s\S]*?data-table-view-preset="focus"[^>]*data-table-key="orders"[\s\S]*?data-table-view-preset="all"/);
  assert.match(INDEX, /id="kolTableViewActions"[^>]*role="group"[\s\S]*?data-table-view-preset="focus"[^>]*data-table-key="koleksiyon"[\s\S]*?data-table-view-preset="all"/);
  assert.match(INDEX, /id="ordersTableViewStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(INDEX, /id="kolTableViewStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('v10.34 mevcut tek Sütunlar bileşeni aktif çalışma alanının görünür bağlamına taşınır', () => {
  assert.match(APP, /appendSharedTableActions\('ordersTableViewActions',\['navColsBtn'\]\)/);
  assert.match(APP, /appendSharedTableActions\('kolTableViewActions',\['navColsBtn'\]\)/);
  assert.doesNotMatch(APP, /appendSharedTableActions\('ordersMoreMenu',\[[^\]]*'navColsBtn'/);
  assert.doesNotMatch(APP, /appendSharedTableActions\('kolMoreMenu',\[[^\]]*'navColsBtn'/);
  assert.match(INDEX, /id="navColsBtn"[^>]*aria-haspopup="true"[^>]*aria-expanded="false"/);
});

test('v10.34 presetler mevcut sütun yöneticilerini kullanır ve kullanıcı düzenini kalıcılaştırır', () => {
  assert.match(APP, /const TABLE_VIEW_PRESETS\s*=\s*Object\.freeze/);
  assert.match(APP, /function applyTableViewPreset\(tableKey,preset\)/);
  assert.match(APP, /colmgr\[tableKey\]\.hidden\s*=\s*new Set/);
  assert.match(APP, /kolHiddenCols\s*=\s*new Set/);
  assert.match(APP, /saveAutoTableColumnState\(\)/);
  assert.match(APP, /saveKolColState\(\)/);
  assert.match(APP, /info\.rerender\(\)/);
});

test('v10.34 görünüm bağlamı özel durumu, görünür sütun sayısını ve klavye ipucunu açıklar', () => {
  assert.match(APP, /function tableViewPresetState\(tableKey\)/);
  assert.match(APP, /function renderTableViewContext\(tableKey\)/);
  assert.match(APP, /Arrow keys move cells|Ok tuşları hücrelerde ilerler/);
  assert.match(APP, /aria-pressed/);
  assert.match(CSS, /\.tableViewActions\{/);
  assert.match(CSS, /\.tableViewPreset:focus-visible/);
  assert.doesNotMatch(CSS.match(/\/\* v10\.34[\s\S]*?(?=\/\* =====================|$)/)?.[0] || '', /#[0-9a-f]{3,8}/i);
});

test('v10.34 ortak CP/Orders grid aktif hücreyi ARIA ile izler', () => {
  assert.match(GRID, /aria-rowcount/);
  assert.match(GRID, /aria-colcount/);
  assert.match(GRID, /aria-multiselectable/);
  assert.match(GRID, /aria-activedescendant/);
  assert.match(GRID, /role','columnheader/);
  assert.match(APP, /label:\(\)=>appLang==='en'/);
});

test('v10.34 Collection spreadsheet aynı aktif hücre ve grid sözleşmesini uygular', () => {
  assert.match(KOL, /aria-rowcount/);
  assert.match(KOL, /aria-colcount/);
  assert.match(KOL, /aria-multiselectable/);
  assert.match(KOL, /aria-activedescendant/);
  assert.match(KOL, /role','columnheader/);
});
