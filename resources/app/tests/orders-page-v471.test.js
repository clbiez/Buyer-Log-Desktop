'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const parse = require(path.join(ROOT, 'server', 'lib', 'parse.js'));
const scopes = require(path.join(ROOT, 'server', 'lib', 'model-scopes.js'));
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const SERVER = fs.readFileSync(path.join(ROOT, 'server', 'server.js'), 'utf8');

function asas(kalan, code) {
  return {
    'Sipariş Kod': code,
    'Model Adı': 'MODEL-'+code,
    'Renk Kod': 'C01',
    'Renk': 'BLACK',
    'Net Alım Sipariş Miktarı': 1000,
    'Kalan Alım Sipariş Miktarı': kalan,
    'FOB Fiyatı': 5,
    'Üretici': 'SUPPLIER',
    'Sezon': 'W6',
    'Buyer Grup (TR)': 'LİSANS',
    'Merch Alt Grup Kod': 'CU4E',
    'Siparişin Üretildiği Ülke': 'CIN',
    'Orijinal Exfactory Merch Tarih': '2026-01-01',
    'Retail Depo Tarih Yıl Ay Gün': '2026-06-01',
    'Model Bütçe Tarih Yıl Ay Gün': '2026-06-15',
  };
}
function overrides() {
  return {antrepoMatchConfig:parse.defaultAntrepoMatchConfig(),submap:{},delmap:{},suppfobmap:{},suppfobmetamap:{},notesmap:{},licensormap:{},imagemap:{},pricingRules:[],transitRules:[]};
}
function normalizeHorizon(value) {
  return JSON.parse(JSON.stringify(value || {table:'ASAS',groups:[]}));
}

test('v4.71 CP aktif siparişleri, Orders aktif ve pasif siparişleri listeler', () => {
  const ov = overrides();
  const orders = parse.parseASASRows([asas(100, '1001'), asas(0, '1002')], ov.antrepoMatchConfig).orders;
  const cpRows = parse.buildCPRowsFromASAS(orders, {}, ov);
  const allRows = parse.buildOrdersRowsFromASAS(orders, {}, ov);
  assert.equal(cpRows.length, 1);
  assert.equal(allRows.length, 2);
  assert.equal(allRows.find(row => row['Order Code'] === 1001)['Active/Inactive'], 'Active');
  const passive = allRows.find(row => row['Order Code'] === 1002);
  assert.equal(passive['Active/Inactive'], 'Inactive');
  assert.equal(passive.STATUS, 'Pasif');
  assert.ok(allRows.every(row=>!Object.hasOwn(row,'Priority')));
  assert.equal(passive._canEdit, undefined);
});

test('v4.71 Orders ufku eski CP kapsamından ayrı bir scope olarak üretilir', () => {
  const horizon = {table:'ASAS',groups:[{id:'g',conditions:[{field:'Sezon',op:'in',values:['W6']}]}]};
  const result = scopes.normalizeScopes([
    {id:'main',targets:['cp','backlog','lfl'],enabled:true,horizon},
  ], 'asas', horizon, normalizeHorizon);
  const orderScope = result.find(scope => scope.targets.includes('orders'));
  assert.ok(orderScope);
  // v20260928 — ASAS'ta Orders bağlı grupla (Backlog · LFL · Price & Supplier)
  // tek ufuk paylaşır; CP'den ayrı kalma kuralı korunur.
  assert.deepEqual(orderScope.targets, ['orders', 'backlog', 'lfl', 'priceanalysis']);
  assert.deepEqual(result.find(scope => scope.targets.includes('cp')).targets, ['cp']);
  assert.notEqual(orderScope.id, 'main');
  assert.deepEqual(orderScope.horizon, horizon);
  assert.ok(result.find(scope => scope.targets.includes('cp')));
});

test('v4.71 karışık Orders kapsamı otomatik olarak diğer hedeflerden ayrılır', () => {
  const horizon = {table:'IAS',groups:[{id:'g',conditions:[{field:'Sezon',op:'in',values:['W6']}]}]};
  const result = scopes.normalizeScopes([
    {id:'mixed',targets:['cp','orders','backlog'],enabled:true,horizon},
  ], 'antrepo', horizon, normalizeHorizon);
  assert.deepEqual(result.find(scope => scope.targets.includes('orders')).targets, ['orders']);
  assert.deepEqual(result.find(scope => scope.targets.includes('cp')).targets, ['cp','backlog']);
});

test('v4.71 Orders ekranı, hızlı aktif/pasif filtreleri ve bağımsız yenileme hedefi vardır', () => {
  assert.match(INDEX, /data-tab="orders"/);
  assert.match(INDEX, /id="view-orders"/);
  assert.match(INDEX, /id="ordersHorizonBadge"/);
  assert.match(INDEX, /data-order-active="Active"/);
  assert.match(INDEX, /data-order-active="Inactive"/);
  assert.match(INDEX, /function toggleOrdersActiveQuick/);
  assert.match(INDEX, /state\.ordersQuickActive\.clear\(\);clearColumnFilters\('orders',mirrored\)/);
  assert.match(INDEX, /const MODEL_ROLE_TARGETS=\{asas:\['cp','orders','backlog','lfl'\]/);
  // v20260930 — Orders yenilemesi bağlı grubunu (tek sorgu) yeniler; gruptan ayrı CP'yi çalıştırmaz.
  assert.match(INDEX, /options\.push\(\['linked',refreshTargetsLabel\(members\),members\.slice\(\)\]\)/);
  assert.match(INDEX, /DEFAULT_LINKED_REFRESH_TARGETS=Object\.freeze\(\['orders','backlog','lfl','priceanalysis'\]\)/);
  assert.match(SERVER, /orders: \{ rows: ordersRows \},\s*'order-summary': \{ rows: orderSummaryRows \}/);
});
