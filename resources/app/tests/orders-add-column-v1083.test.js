'use strict';

/* v10.83 — ORDERS: ADD COLUMN PARITY.
 *
 * Orders'ın sütun şeması zaten CP_COLS'un kopyasıydı (ORDERS_COLS,
 * syncOrdersColumnsFromCp): DB-bağlı özel sütunlar otomatik miras kalıyordu,
 * ama Orders'ta bunu EKLEYECEK bir giriş noktası yoktu (buton yalnız
 * tableKey==='cp' için basılıyordu). Bu paket ikinci bir sütun sistemi
 * KURMADAN — mevcut openCpModelColumnModal/CP_MODEL_COLUMN_DEFS/
 * syncCpModelColumns zincirini Orders'tan da tetikleyerek — giriş noktasını
 * ekler.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const APP = read('public/app-main.js');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

test('renderColPanel: Add Column düğmesi artık Orders için de basılıyor', () => {
  const fn = extractFunction(APP, 'renderColPanel');
  assert.match(fn, /\(tableKey==='cp'\|\|tableKey==='orders'\)\?`<button type="button" class="colPanelAdd" id="cpAddModelColumnBtn">/);
  // İkinci bir sütun sistemi kurulmadı: aynı openCpModelColumnModal çağrısı.
  assert.match(fn, /panelEl\.querySelector\('#cpAddModelColumnBtn'\)\?\.addEventListener\('click',\(\)=>openCpModelColumnModal\(null,refreshCpPanel\)\);/);
});

test('renderColPanel: DB-bağlı özel sütunlar Orders panelinde de düzenle/kaldır alır', () => {
  const fn = extractFunction(APP, 'renderColPanel');
  assert.match(fn, /\(tableKey==='cp'\|\|tableKey==='orders'\)&&c\.modelCustom\) return/);
});

test('⋯ More Actions menüsü: Orders artık Add Column eylemini alıyor', () => {
  const fn = extractFunction(APP, 'appendColumnActions');
  assert.match(fn, /if\(tableKey==='cp'\|\|tableKey==='orders'\)\{/);
  assert.match(fn, /add\('add','i-columns-3',addColLabel,\(\)=>openCpModelColumnModal\(null,rerender\)\);/);
  // Menü zaten Orders için kuruluyordu (appendColumnActions('ordersMoreMenu','orders')),
  // yalnız içeride hiçbir şey basmıyordu.
  assert.match(APP, /appendColumnActions\('ordersMoreMenu','orders'\);/);
});

test('sütun kaydı tek yoldan gider: ikinci bir Orders-özel sütun sistemi yok', () => {
  assert.ok(!APP.includes('function openOrdersModelColumnModal'), 'ayrı bir Orders modeli kurulmamalı');
  assert.ok(!/ORDERS_MODEL_COLUMN_DEFS/.test(APP), 'ayrı bir Orders sütun deposu kurulmamalı');
  // Kaldırma uyarısı artık paylaşıldığını söylüyor (yalnız Orders'tan
  // kaldırılmıyor sanılmasın — sütun CP_COLS/ORDERS_COLS ortak).
  assert.ok(APP.includes('from the CP/Orders table?'), 'kaldırma uyarısı paylaşılan tabloları söylemeli');
});

test('syncOrdersColumnsFromCp: DB-bağlı özel sütunlar (modelCustom) filtrelenmiyor, yalnız formulaCustom düşüyor', () => {
  const fn = extractFunction(APP, 'syncOrdersColumnsFromCp');
  assert.match(fn, /CP_COLS\.filter\(c=>!c\.formulaCustom\)/);
  assert.ok(!fn.includes('modelCustom'), 'modelCustom filtrelenmemeli — Orders bu sütunu miras almalı');
});

test('ORDERS_COLS, sistem sütununu (durum) kaybetmeden CP_COLS kopyası olarak kuruluyor', () => {
  assert.match(APP, /const ORDERS_COLS = \[ORDERS_STATUS_COL, \.\.\.CP_COLS\.map\(c=>\(\{\.\.\.c\}\)\)\];/);
  const fn = extractFunction(APP, 'syncOrdersColumnsFromCp');
  assert.match(fn, /const rebuilt=\[ORDERS_STATUS_COL,\.\.\.CP_COLS\.filter/);
});
