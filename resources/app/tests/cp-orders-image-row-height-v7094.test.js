'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, 'Baslangic bulunamadi: ' + start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, 'Bitis bulunamadi: ' + end);
  return source.slice(from, to);
}

function imageSizeApi() {
  const start = APP.indexOf('const TABLE_IMAGE_SIZE_CONFIG');
  const end = APP.indexOf('let cpImageSize', start);
  assert.ok(start >= 0 && end > start);
  return new Function(APP.slice(start, end) + '; return {tableImageSizeDimensions};')();
}

test('CP ve Orders satir yuksekligi ayni gorsel boyutu geometrisini izler', () => {
  const { tableImageSizeDimensions } = imageSizeApi();
  for (const key of ['cp', 'orders']) {
    assert.equal(tableImageSizeDimensions(key, 42).row, 34);
    assert.equal(tableImageSizeDimensions(key, 66).row, 46);
    assert.equal(tableImageSizeDimensions(key, 198).row, 126);
  }
});

test('Picture slider CP/Orders satir yuksekligini ayni frame icinde uygular', () => {
  const setSize = block(APP, 'function setTableImageSize(', 'let _tableImageSizePopover');
  assert.match(setSize, /const dims=tableImageSizeDimensions\(tableKey,next\)/);
  assert.match(setSize, /applyTableImageSizeDom\(tableKey\)/);
  assert.match(setSize, /syncVirtualizedTableRowHeight\(tableKey,dims\.row\)/);
  assert.match(setSize, /scheduleTableImageSizeDom\(tableKey\)/);
});

test('virtualized CP ve Orders kendi satir yuksekligi degiskenini kullanir', () => {
  const seed = block(APP, 'function seedVirtualRowHeight(', 'function setupVirtualizedBody');
  assert.match(seed, /table\.id==='ordersTable'\?'orders':'cp'/);
  assert.match(seed, /const property=`--cp-row-h-\$\{tableKey\}`/);
  assert.match(seed, /getComputedStyle\(table\)\.getPropertyValue\(property\)/);

  const sync = block(APP, 'function syncVirtualizedTableRowHeight(', 'function setTableImageSize(');
  assert.match(sync, /virtualState\.rowHeight=next/);
  assert.match(sync, /virtualState\.renderedStart=-1/);
  assert.match(sync, /virtualState\.renderedEnd=-1/);
  assert.match(sync, /virtualState\.paint/);
});

test('her CP/Orders renderi kayitli Picture olcusunu yeni DOM satirlarina yeniden uygular', () => {
  const render = block(APP, 'function renderFullTable(', 'window.BLTableFramework=');
  assert.match(render, /if\(tableKey==='cp'\|\|tableKey==='orders'\)applyTableImageSizeDom\(tableKey\)/);
});

test('content-visibility CP ve Orders icin tabloya ozel satir yuksekligini korur', () => {
  assert.match(CSS, /#cpTable tbody tr\{content-visibility:auto;contain-intrinsic-size:auto var\(--cp-row-h-cp,var\(--cp-row-h,46px\)\);\}/);
  assert.match(CSS, /#ordersTable tbody tr\{content-visibility:auto;contain-intrinsic-size:auto var\(--cp-row-h-orders,var\(--cp-row-h,46px\)\);\}/);
});

test('CP lojistik ozetleri Picture slider satir yuksekligini buyutemez', () => {
  assert.match(CSS, /#cpTable tbody td\.cpLogisticStatusTd,[\s\S]*?white-space:nowrap!important;[\s\S]*?overflow:hidden!important;/);
  assert.match(CSS, /#cpTable tbody \.cpLogisticSummaryStack,[\s\S]*?max-height:calc\(var\(--cp-row-h-cp,var\(--cp-row-h,46px\)\) - 6px\);[\s\S]*?overflow:hidden;/);
  assert.match(CSS, /#cpTable tbody \.cpLogisticSummaryStack,[\s\S]*?flex-direction:row;[\s\S]*?flex-wrap:nowrap;/);
  assert.match(CSS, /#cpTable tbody \.cpLogisticPrimaryDate,[\s\S]*?display:inline;[\s\S]*?margin-top:0;/);
});
