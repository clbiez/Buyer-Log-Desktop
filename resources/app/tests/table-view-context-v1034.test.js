'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const INDEX = fs.readFileSync('public/index.html', 'utf8');
const APP = fs.readFileSync('public/app-main.js', 'utf8');
const CSS = fs.readFileSync('public/app.css', 'utf8');
const GRID = fs.readFileSync('public/grid-clipboard.js', 'utf8');
const KOL = fs.readFileSync('public/collection-spreadsheet.js', 'utf8');

test('Orders ve Collection görünür tablo bağlamında Odak/Tümü presetlerini sade biçimde sunar', () => {
  assert.match(INDEX, /id="ordersTableViewActions"[^>]*role="group"[\s\S]*?data-table-view-preset="focus"[^>]*data-table-key="orders"[\s\S]*?data-table-view-preset="all"/);
  assert.match(INDEX, /id="kolTableViewActions"[^>]*role="group"[\s\S]*?data-table-view-preset="focus"[^>]*data-table-key="koleksiyon"[\s\S]*?data-table-view-preset="all"/);
  assert.doesNotMatch(INDEX, /id="ordersTableViewStatus"|id="kolTableViewStatus"/);
  assert.doesNotMatch(INDEX, /Sipariş karar alanı|Order decision workspace|Düzenlenebilir model alanı|Editable model workspace/);
});

test('v10.34 mevcut tek Sütunlar bileşeni aktif çalışma alanının görünür bağlamına taşınır', () => {
  // v7.0.229 — Orders ve Koleksiyon'da Sütunlar düğmesi yerine Alanlar çekmecesi.
  assert.doesNotMatch(APP, /appendSharedTableActions\('ordersTableViewActions',\['navColsBtn'\]\)/);
  assert.doesNotMatch(APP, /appendSharedTableActions\('kolTableViewActions',\['navColsBtn'\]\)/);
  assert.match(INDEX, /data-table-fields="orders"/);
  assert.match(INDEX, /data-table-fields="koleksiyon"/);
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

test('görünüm bağlamı açıklama metni üretmeden preset durumunu erişilebilir biçimde günceller', () => {
  assert.match(APP, /function tableViewPresetState\(tableKey\)/);
  assert.match(APP, /function renderTableViewContext\(tableKey\)/);
  const render = APP.slice(APP.indexOf('function renderTableViewContext('), APP.indexOf('function applyTableViewPreset('));
  assert.doesNotMatch(render, /Arrow keys move cells|Ok tuşları hücrelerde ilerler|TableViewStatus|columns':'sütun/);
  assert.match(render, /aria-pressed/);
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
