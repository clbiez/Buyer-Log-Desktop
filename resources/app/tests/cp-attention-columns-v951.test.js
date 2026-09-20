'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');
const VIEW = read('public/cp-overview-assistant.js');
const CSS = read('public/cp-overview-assistant.css');

test('v9.51 Attention CP sütun kataloğunu kopyalamaz, canlı CP_COLS köprüsünü kullanır', () => {
  assert.match(APP, /window\.BLCpAttentionColumns\s*=\s*\{/);
  assert.match(APP, /catalog\(\)\{\s*return CP_COLS\.map/);
  assert.match(APP, /label:tableColumnLabel\('cp',c\)/);
  assert.match(APP, /return cellPlainText\(c,row,flags\)/);
  assert.match(VIEW, /window\.BLCpAttentionColumns/);
  assert.match(VIEW, /api && typeof api\.catalog === 'function' \? api\.catalog\(\) : \[\]/);
});

test('v9.51 Attention sütun seçimi kullanıcı tercihine kaydedilir ve varsayılan 8 sistem sütununu korur', () => {
  for (const id of ['sys:priority','sys:order','sys:style','sys:supplier','sys:age','sys:toLoad','sys:target','sys:reason']) {
    assert.ok(VIEW.includes(`'${id}'`), `${id} varsayılanda olmalı`);
  }
  assert.match(VIEW, /attentionColumns: ATTENTION_DEFAULT_COLUMNS\.slice\(\)/);
  assert.match(VIEW, /state\.attentionColumns = normalizeAttentionColumns\(raw\.attentionColumns\)/);
  assert.match(VIEW, /attentionColumns: state\.attentionColumns/);
  assert.match(VIEW, /state\.attentionColumns = selectedOrder\.slice\(\);\s*savePrefs\(\)/);
});

test('v9.51 Orders Requiring Attention tablosu seçili sütunlardan dinamik çizilir', () => {
  assert.match(VIEW, /const columns = attentionVisibleColumns\(\)/);
  assert.match(VIEW, /columns\.map\(column => attentionCellHtml\(item, column\)\)/);
  assert.match(VIEW, /data-cpa-attention-columns/);
  assert.match(VIEW, /attentionColumnsBtn\.onclick = openAttentionColumns/);
  assert.match(VIEW, /item && item\.sourceRow/);
});

test('v9.51 sütun penceresinde arama, ekle-çıkar, sıfırla ve drag sıralama vardır', () => {
  for (const hook of [
    'data-cpa-column-search', 'data-cpa-column-id', 'data-cpa-selected-remove',
    'data-cpa-columns-select-all', 'data-cpa-columns-clear-optional',
    'data-cpa-columns-reset', 'data-cpa-columns-apply',
  ]) assert.ok(VIEW.includes(hook), `${hook} eksik`);
  assert.match(VIEW, /draggable="true" data-cpa-selected-id/);
  assert.match(VIEW, /addEventListener\('dragstart'/);
  assert.match(VIEW, /addEventListener\('dragover'/);
  assert.match(VIEW, /addEventListener\('drop'/);
});

test('v9.51 Attention geniş tabloda yatay kaydırma ve sticky header kullanır', () => {
  assert.match(CSS, /\.cpaAttentionScroll\{[^}]*overflow:auto/);
  assert.match(CSS, /\.cpaAttentionTable\{[^}]*width:max-content[^}]*min-width:100%/);
  assert.match(CSS, /\.cpaAttentionTable th\{[^}]*position:sticky[^}]*top:0/);
});
