'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(PUBLIC, name), 'utf8');
const APP = read('app-main.js');
const INDEX = read('index.html');
const OC = read('open-costing.js');
const PA = read('price-supplier-analysis.js');
const USER_UI = read('user-access-ui.js');
const EXPERIENCE = read('experience.css');

test('CP ve Siparişler boş tablo ipucu: kaynak yoksa Veri Yönetimi, filtre elediyse temizleme', () => {
  assert.match(APP, /function renderTableEmptyHint\(tableKey,visibleCount,totalCount\)/);
  assert.match(APP, /renderTableEmptyHint\('cp',rows\.length,totalRowCount\);/);
  assert.match(APP, /renderTableEmptyHint\('orders',rows\.length,totalRowCount\);/);
  assert.match(APP, /nav\.tabs button\[data-tab="source"\]/);
  assert.match(APP, /getElementById\('navClearFilters'\)\?\.click\(\)/);
  assert.match(EXPERIENCE, /\.tableEmptyHint\{position:sticky;left:0;/);
});

test('Nakliye PLM SYNC dinleyicisi sekme geçişlerinde çoğalmaz', () => {
  const start = APP.indexOf('function restoreSharedTableActions(){');
  const end = APP.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(APP.slice(start, end), /shipPlmSyncBtn'\)\?\.addEventListener/);
  assert.equal(APP.match(/getElementById\('shipPlmSyncBtn'\)\?\.addEventListener\('click'/g).length, 1);
});

test('Nakliye boşken satır işlemleri şeridi gizlenir ve CP Tracker yönlendirmesi çizilir', () => {
  assert.match(APP, /classList\.toggle\('isShipEmpty',isEmpty\)/);
  assert.match(APP, /renderShipEmptyState\(empty,!shipRows\.length\);/);
  assert.match(APP, /nav\.tabs button\[data-tab="cp"\]/);
  assert.match(EXPERIENCE, /#view-shipping\.isShipEmpty #shipSecondaryToolbar\{display:none;\}/);
});

test('Ön Maliyet seçim yokken çalışma alanı boş kalmaz', () => {
  assert.match(INDEX, /<div class="ocWorkspaceEmpty" id="ocWorkspaceEmpty"><\/div>/);
  assert.match(OC, /function renderWorkspaceEmpty\(show\)/);
  assert.match(OC, /else renderWorkspaceEmpty\(!current\);/);
  assert.match(OC, /\$\('ocNewBtn'\)\?\.click\(\)/);
});

test('Fiyat & Üretici Analizi boş durumu ortak uiState bileşenini kullanır', () => {
  assert.match(PA, /stateBox\(\{kind:'empty',icon:'chart-histogram',title:t\('noData'\)/);
  assert.match(PA, /window\.BLUI\?\.stateView/);
});

test('Kullanıcı menüsü metin simgesi değil ortak SVG ikon seti kullanır', () => {
  assert.doesNotMatch(USER_UI, /data-(?:user-admin|plm-user-login|update-test|backup-settings|reset-my-view|switch-user)>[⚙✉↻↑⇩↺⇄]/);
  assert.match(USER_UI, /data-switch-user><svg class="ic" aria-hidden="true"><use href="#i-user"\/><\/svg>/);
});

test('OAB ve INTAKE başlıkları Genel Bakış kart başlık yapısını paylaşır', () => {
  assert.match(INDEX, /class="cardTitle ovSectionTitle"><svg class="ic" aria-hidden="true"><use href="#i-chart-histogram"\/><\/svg><span data-i18n-tr="OAB"/);
  assert.match(INDEX, /class="cardTitle ovSectionTitle"><svg class="ic" aria-hidden="true"><use href="#i-database-import"\/><\/svg><span data-i18n-tr="INTAKE"/);
});
