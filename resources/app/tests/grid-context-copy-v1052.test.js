'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GRID = fs.readFileSync(path.join(ROOT, 'public', 'grid-clipboard.js'), 'utf8');
const COLLECTION = fs.readFileSync(path.join(ROOT, 'public', 'collection-spreadsheet.js'), 'utf8');
const ROW_MENU = fs.readFileSync(path.join(ROOT, 'public', 'row-context-menu.js'), 'utf8');

test('shared managed grid context menu preserves an existing range before opening', () => {
  assert.match(GRID, /function prepareContextMenu\(tableId,cell\)/,
    'CP/Orders sağ tık öncesi range koruma API\'si yok');
  assert.equal(typeof require('../public/grid-clipboard').prepareContextMenu,'function',
    'range koruma API\'si dışarı açılmıyor');
  assert.match(GRID, /if\(!cellInRange\)/,
    'sağ tıklanan hücre range içindeyse seçim korunmuyor');
});

test('Collection context menu does not collapse an in-range cell selection', () => {
  assert.match(COLLECTION, /function prepareCellContext\(td\)/,
    'Collection sağ tık seçim koruma yardımcı fonksiyonu yok');
  const start = COLLECTION.indexOf('function cellContext(');
  const end = COLLECTION.indexOf('\n  function bind(', start);
  const block = COLLECTION.slice(start, end);
  assert.match(block, /prepareCellContext\(td\)/);
  assert.doesNotMatch(block, /event\.preventDefault\(\);event\.stopImmediatePropagation\(\);setActive\(td/,
    'Collection sağ tık her zaman setActive ile anchor/focus\'u sıfırlıyor');
  assert.match(block, /Copy with headers.*Copy|Başlıklarla kopyala.*Kopyala/s,
    'Collection menüsü Copy ve Copy with Headers seçeneklerini taşımıyor');
});

test('CP and Orders expose common copy options on every grid cell without removing row tools', () => {
  assert.match(ROW_MENU, /function managedClipboardEntries\(config, table, cell\)/,
    'CP/Orders için ortak clipboard menü öğeleri yok');
  assert.match(ROW_MENU, /Copy with headers/);
  assert.match(ROW_MENU, /Copy without headers|Kopyala/);
  assert.match(ROW_MENU, /openManagedGridCopyMenu\(config, table, cell, event\)/,
    'model/order-code dışındaki CP/Orders hücreleri copy menüsüne bağlanmıyor');
  assert.match(ROW_MENU, /managedClipboardEntries\(config, table, cell\)/,
    'mevcut model/order-code menülerine copy seçenekleri eklenmiyor');
  assert.match(ROW_MENU, /if \(config\.module === 'cp' \|\| config\.module === 'orders'\)/);
});

test('context copy options are repeated-safe and use the registered copy service', () => {
  assert.match(ROW_MENU, /prepareContextMenu\?\.\(table\.id, cell\)/,
    'her sağ tıkta stale DOM index yerine ortak seçim yaşam döngüsü kullanılmıyor');
  assert.match(ROW_MENU, /BLGridClipboard\?\.copyActive/,
    'CP/Orders context copy ortak registered exporter yolunu kullanmıyor');
  assert.match(ROW_MENU, /includeHeaders: true/);
  assert.match(ROW_MENU, /includeHeaders: false/);
});
