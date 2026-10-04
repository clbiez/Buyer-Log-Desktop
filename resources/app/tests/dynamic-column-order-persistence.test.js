'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const FORMULA = fs.readFileSync(path.join(ROOT, 'public', 'formula-columns.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  assert.fail(`${name} kapanmıyor`);
}

function orderApi(validKeys) {
  const COLS_BY_TABLE = { cp: validKeys.map(k => ({ k })) };
  return new Function('COLS_BY_TABLE', `
    ${extractFunction(APP, 'normalizedColumnOrder')}
    ${extractFunction(APP, 'mergeDeferredColumnOrder')}
    return { normalizedColumnOrder, mergeDeferredColumnOrder };
  `)(COLS_BY_TABLE);
}

test('geç yüklenen dinamik sütun ilk açılış saveinde kaybolmaz ve yüklenince eski yerine döner', () => {
  const saved = ['A', '__CPX_db', 'B', '__f_calc', 'note_risk', 'C'];
  const early = orderApi(['A', 'B', 'C']);
  const liveBaseOnly = early.normalizedColumnOrder('cp', saved);
  assert.deepEqual(liveBaseOnly, ['A', 'B', 'C']);

  const retained = early.mergeDeferredColumnOrder(saved, liveBaseOnly, ['A', 'B', 'C']);
  assert.deepEqual(retained, saved, 'henüz yüklenmemiş sütun kimlikleri kalıcı kayıtta korunmalı');

  const late = orderApi(['A', '__CPX_db', 'B', '__f_calc', 'note_risk', 'C']);
  assert.deepEqual(late.normalizedColumnOrder('cp', retained), saved, 'şema tamamlanınca kullanıcı sırası aynen geri gelmeli');
});

test('kullanıcı base sütunları dinamikler yüklenmeden yeniden sıralarsa iki niyet de korunur', () => {
  const saved = ['A', '__CPX_db', 'B', '__f_calc', 'C'];
  const api = orderApi(['A', 'B', 'C']);
  assert.deepEqual(
    api.mergeDeferredColumnOrder(saved, ['C', 'A', 'B'], ['A', 'B', 'C']),
    ['C', 'A', '__CPX_db', 'B', '__f_calc'],
  );
});

test('CP/Orders ve generic tablolar geç yüklenen state restore yolunu ortak kullanır', () => {
  const cp = extractFunction(APP, 'syncCpModelColumns');
  const orders = extractFunction(APP, 'syncOrdersColumnsFromCp');
  const generic = extractFunction(APP, 'registerGenericTable');
  assert.match(cp, /persistedBefore=new Set\(savedColumnOrderKeys\('cp'\)\)/);
  assert.match(cp, /restoreLateManagedColumnState\('cp'\)/);
  assert.match(orders, /restoreLateManagedColumnState\('orders'\)/);
  assert.match(generic, /else restoreLateManagedColumnState\(tableKey\)/);
  assert.match(APP, /window\.BLColumnState=\{persistedOrder:savedColumnOrderKeys,restoreLate:restoreLateManagedColumnState,forget:forgetPersistedColumnKeys,forgetTable:forgetPersistedTableColumnState\}/);
  assert.match(APP, /window\.saveAutoTableColumnState=saveAutoTableColumnState/);
});

test('Calculated Column geç yüklenince persisted anahtarı yeni sütun saymaz', () => {
  const sync = extractFunction(FORMULA, 'syncColumns');
  assert.match(sync, /persistedBefore = new Set\(window\.BLColumnState/);
  assert.match(sync, /window\.BLColumnState\.restoreLate\(tableKey\)/);
  assert.match(sync, /const isNew = !knownBefore\.has\(col\.k\) && !persistedBefore\.has\(col\.k\)/);
  assert.match(sync, /const groupChanged = Boolean\(placed\)/);
});

test('sunucudan yeni tercih geldiyse sütun state aynı açılışta tekrar yüklenir', () => {
  const reload = extractFunction(APP, 'reloadPersistedTableColumnStateAfterHydration');
  assert.match(reload, /autoTableColumnStateSnapshot=null;/);
  assert.match(reload, /loadAutoTableColumnState\(\)/);
  assert.match(reload, /loadKolColState\(\{preserveCustom:true\}\)/);
  const at = APP.indexOf('const sync=await authHydrationPromise;');
  assert.ok(at > 0, 'auth hydration bekleme noktası bulunmalı');
  const block = APP.slice(at, at + 900);
  assert.match(block, /if\(sync&&sync\.applied\)\{ reloadPersistedTableColumnStateAfterHydration\(\); \}/);
});

test('silinen dinamik sütunun hayalet sıra, gizlilik ve genişlik kaydı temizlenir', () => {
  assert.match(extractFunction(APP, 'removeCpModelColumn'), /forgetPersistedColumnKeys\('cp',\[def\.header\]\).*forgetPersistedColumnKeys\('orders',\[def\.header\]\)/s);
  assert.match(extractFunction(APP, 'saveCpNoteColumnDefs'), /forgetPersistedColumnKeys\('cp',removed\).*forgetPersistedColumnKeys\('orders',removed\)/s);
  assert.match(extractFunction(FORMULA, 'remove'), /BLColumnState\.forget\(tableKey, \[key\]\)/);
  assert.match(extractFunction(APP, 'resetViewToSystemDefault'), /forgetPersistedTableColumnState\(page\)/);
});
