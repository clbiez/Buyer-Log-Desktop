'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const EXPERIENCE = fs.readFileSync(path.join(ROOT, 'public', 'experience.css'), 'utf8');

test('CP görünüm başlığı yalnız yararlı metrik ve görünüm denetimlerini sunar', () => {
  const cp = INDEX.slice(INDEX.indexOf('<section id=\"view-cp\"'), INDEX.indexOf('<section id=\"view-orders\"'));
  assert.match(cp, /class="workspaceContextBar" aria-label="CP workspace context"/);
  assert.match(cp, /id="cpWorkspaceMeta"/);
  assert.match(cp, /id="cpTableViewActions"/);
  assert.match(cp, /data-table-view-preset="focus" data-table-key="cp"/);
  assert.match(cp, /data-table-view-preset="all" data-table-key="cp"/);
  assert.doesNotMatch(cp, /workspaceContextIdentity|CP planlama çalışma alanı|CP planning workspace/);
  assert.doesNotMatch(cp, /id="cpTableViewStatus"/);
});

test('v10.69 CP, Orders ile aynı aktif tablo filtreleri alanını kullanır', () => {
  const cp = INDEX.slice(INDEX.indexOf('<section id=\"view-cp\"'), INDEX.indexOf('<section id=\"view-orders\"'));
  assert.match(cp, /class="activeFilterBar" id="cpActiveFilters" role="region"/);
  assert.match(cp, /id="cpActiveFilterTokens" aria-live="polite"/);
  assert.match(cp, /data-active-filter-clear="cp"/);
  assert.match(cp, /data-i18n-tr="TABLO FİLTRELERİ" data-i18n-en="TABLE FILTERS"/);
});

test('v10.69 CP çizimi ortak çalışma özeti ve aktif filtre bağlamını günceller', () => {
  const render = APP.slice(APP.indexOf('function renderCPNow()'), APP.indexOf('function renderOrdersNow()'));
  assert.match(render, /cpWorkspaceMeta/);
  assert.match(render, /renderTableViewContext\('cp'\)/);
  assert.match(render, /renderActiveFilterContext\('cp'\)/);
  assert.match(APP, /if\(tableKey!==\'cp\'&&tableKey!==\'orders\'&&tableKey!==\'koleksiyon\'\)return;/);
});

test('v10.69 CP Sütunlar eylemi de ortak görünüm başlığına taşınır', () => {
  const sync = APP.slice(APP.indexOf('function syncTableToolbarActions'), APP.indexOf('const APP_PAGE_META'));
  // v7.0.229 — Sütunlar düğmesi CP'de kaldırıldı; sütun yönetimi Alanlar çekmecesinde.
  assert.doesNotMatch(sync, /appendSharedTableActions\('cpTableViewActions',\['navColsBtn'\]\)/);
  assert.doesNotMatch(sync, /appendSharedTableActions\('cpMoreMenu',\['navColsBtn'/);
  assert.match(sync, /columnsWrap\.hidden=tab==='cp'\|\|tab==='orders'\|\|tab==='koleksiyon'/);
});


test('CP tablo özeti sol kenardan tasarım sistemi boşluğu kadar içeri alınır', () => {
  const cp = INDEX.slice(INDEX.indexOf('<section id=\"view-cp\"'), INDEX.indexOf('<section id=\"view-orders\"'));
  assert.match(cp, /class="workspaceContextMeta" id="cpWorkspaceMeta"/);
  assert.match(EXPERIENCE, /#view-cp \.workspaceContextMeta\{margin-inline-start:var\(--ui-space-3\);\}/);
});
