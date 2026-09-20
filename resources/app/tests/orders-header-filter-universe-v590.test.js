'use strict';

// v5.90 — Siparişler ekranındaki sütun başlığı filtreleri tablodaki değerleri
// eksik listeliyordu.
//
// Kök neden: rowsForFilterUniverse('orders', …) için AYRI bir dal yoktu.
// 'orders' ne `tableKey==='cp'` eşitliğine ne de GENERIC_TABLE_SOURCES'a
// giriyordu, dolayısıyla `rows` tanımsız kalıyor ve en alttaki yedek yol
// `state.cp.rows`'a düşüyordu. Yani Siparişler'in filtre seçenekleri CP'nin
// satırlarından üretiliyordu: Siparişler tablosunda gerçekten bulunan bazı
// değerler listede hiç görünmüyor, CP'de olup Siparişler'de olmayanlar ise
// gereksiz yere görünüyordu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function bodyOf(name) {
  const start = APP.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} bulunmalı`);
  const open = APP.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < APP.length; i++) {
    if (APP[i] === '{') depth++;
    else if (APP[i] === '}' && --depth === 0) return APP.slice(open + 1, i);
  }
  throw new Error(`${name} ayrıştırılamadı`);
}

// rowsForFilterUniverse'ü gerçek bağımlılıklarını taklit ederek çalıştırır.
function runUniverse({ tableKey, excludeKey, cpRows = [], ordersRows = [], colFilters = {}, filteredThrows = false, genericSources = {} }) {
  const seen = {};
  const fn = new Function(
    'state', 'filteredCP', 'filteredOrders', 'GENERIC_TABLE_SOURCES', 'passesColFilters', 'tableKey', 'excludeKey',
    `return (function rowsForFilterUniverse(tableKey, excludeKey){${bodyOf('rowsForFilterUniverse')}})(tableKey, excludeKey);`
  );
  const state = { colFilters: { cp: colFilters.cp || {}, orders: colFilters.orders || {} }, cp: { rows: cpRows }, orders: { rows: ordersRows } };
  const rows = fn(
    state,
    () => { seen.cp = true; if (filteredThrows) throw new Error('boom'); return cpRows.filter(row => !state.colFilters.cp[excludeKey]); },
    () => { seen.orders = true; if (filteredThrows) throw new Error('boom'); return ordersRows.filter(row => !state.colFilters.orders[excludeKey]); },
    genericSources,
    () => true,
    tableKey, excludeKey
  );
  return { rows, seen, state };
}

const CP_ROWS = [{ id: 'cp1', STATUS: 'Üretimde' }, { id: 'cp2', STATUS: 'Depoda' }];
const ORDER_ROWS = [{ id: 'o1', STATUS: 'Yolda' }, { id: 'o2', STATUS: 'Depoda' }, { id: 'o3', STATUS: 'İptal' }];

test('v5.90 Siparişler filtre evreni Siparişler satırlarından geliyor', () => {
  const { rows, seen } = runUniverse({ tableKey: 'orders', excludeKey: 'STATUS', cpRows: CP_ROWS, ordersRows: ORDER_ROWS });
  assert.equal(seen.orders, true, 'filteredOrders çağrılmalı');
  assert.ok(!seen.cp, 'CP satırlarına hiç dokunulmamalı');
  assert.deepEqual(rows.map(row => row.id), ['o1', 'o2', 'o3']);
  // Asıl belirti: Siparişler'e özgü değerler listede olmalıydı.
  assert.ok(rows.some(row => row.STATUS === 'Yolda'));
  assert.ok(rows.some(row => row.STATUS === 'İptal'));
});

test('v5.90 çapraz filtre hesaplanamazsa DOĞRU tablonun tüm satırlarına düşülür', () => {
  // Yanlış tablonun satırlarına düşmek, eksik seçenek listesinden daha kötüdür.
  const { rows, seen } = runUniverse({ tableKey: 'orders', excludeKey: 'STATUS', cpRows: CP_ROWS, ordersRows: ORDER_ROWS, filteredThrows: true });
  assert.equal(seen.orders, true);
  assert.deepEqual(rows.map(row => row.id), ['o1', 'o2', 'o3'], 'CP satırları değil, Siparişler satırları');
});

test('v5.90 CP davranışı değişmedi', () => {
  const { rows, seen } = runUniverse({ tableKey: 'cp', excludeKey: 'STATUS', cpRows: CP_ROWS, ordersRows: ORDER_ROWS });
  assert.equal(seen.cp, true);
  assert.ok(!seen.orders);
  assert.deepEqual(rows.map(row => row.id), ['cp1', 'cp2']);
});

test('v5.90 sütunun kendi filtresi liste üretilirken geçici olarak kaldırılıyor', () => {
  // Kaldırılmazsa liste kendi seçimiyle daralır ve kullanıcı seçimini
  // genişletemez — filtre tek yönlü kilitlenirdi.
  const colFilters = { orders: { STATUS: { values: new Set(['Depoda']) }, Buyer: { values: new Set(['X']) } } };
  const { rows, state } = runUniverse({ tableKey: 'orders', excludeKey: 'STATUS', ordersRows: ORDER_ROWS, colFilters });
  assert.equal(rows.length, 3, 'kendi filtresi listeyi daraltmamalı');
  // İşi bitince geri konmalı; kalıcı silinirse kullanıcının filtresi kaybolurdu.
  assert.ok(state.colFilters.orders.STATUS, 'filtre geri yerine konmalı');
  assert.ok(state.colFilters.orders.Buyer, 'diğer filtrelere dokunulmamalı');
});

test('v5.90 hata durumunda bile sütunun kendi filtresi geri konuyor', () => {
  const colFilters = { orders: { STATUS: { values: new Set(['Depoda']) } } };
  const { state } = runUniverse({ tableKey: 'orders', excludeKey: 'STATUS', ordersRows: ORDER_ROWS, colFilters, filteredThrows: true });
  assert.ok(state.colFilters.orders.STATUS);
});

test('v5.90 kayıtlı tablolar (LFL vb.) kendi kaynaklarından beslenmeye devam ediyor', () => {
  const generic = { lfl: () => [{ id: 'l1' }] };
  const { rows, seen } = runUniverse({ tableKey: 'lfl', excludeKey: 'X', cpRows: CP_ROWS, ordersRows: ORDER_ROWS, genericSources: generic });
  assert.deepEqual(rows.map(row => row.id), ['l1']);
  assert.ok(!seen.cp && !seen.orders);
});

test('v5.90 kaynak kodda orders dalı gerçekten var', () => {
  const block = bodyOf('rowsForFilterUniverse');
  assert.match(block, /else if\(tableKey==='orders'\) rows = filteredOrders\(\);/);
  assert.match(block, /else if\(tableKey==='orders'\) rows = state\.orders \? state\.orders\.rows : \[\];/);
});
