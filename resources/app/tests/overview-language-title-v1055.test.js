'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const DASH = fs.readFileSync(path.join(__dirname, '..', 'public', 'overview-collection-dashboard.js'), 'utf8');
const buttonById = id => INDEX.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] || '';

test('v7.0.94 Collection Summary filtre başlığı iki dilde çift tıklama ipucu taşır; eski Edit yoktur', () => {
  const label = INDEX.match(/<span[^>]*id="ovCollectionSummaryScopeLabel"[^>]*>/)?.[0] || '';
  assert.match(label, /data-i18n-title-tr="Filtre sütununu değiştirmek için çift tıkla"/);
  assert.match(label, /data-i18n-title-en="Double-click to change the filter column"/);
  assert.doesNotMatch(INDEX,/ovCollectionSummarySettingsBtn/);
  assert.match(DASH,/scopeLabel\.ondblclick/);
});

test('v10.55 Overview düzen denetimleri ilk çizimde de seçili dile uyar', () => {
  // Ana ekran widget'larında daraltma yoktur; eski daraltma düğmeleri kaldırıldı.
  assert.doesNotMatch(INDEX, /id="oabCollapseBtn"|id="intakeCollapseBtn"/);
  const edit = buttonById('ovLayoutEditBtn');
  assert.match(edit, /data-i18n-title-tr="Ana ekranı düzenle/);
  assert.match(edit, /data-i18n-title-en="Edit home screen/);
  assert.match(buttonById('ovHomeCompactBtn'), /data-i18n-title-en="Align widgets up and close gaps"/);
});

test('v10.55 Overview ilk yükleme durumu seçili dilde anlaşılır', () => {
  const loading = INDEX.match(/<div id="ovEmpty"[\s\S]*?<div class="ovDashboardToolbar/)?.[0] || '';
  assert.match(loading, /<b data-i18n-tr="Veriler ekranlara yükleniyor\." data-i18n-en="Loading data into the screens\.">/);
  assert.match(loading, /<span data-i18n-tr="Aktif filtre kapsamı ve veri hacmine göre bekleme süresi uzayabilir\." data-i18n-en="The wait may increase with the active filter scope and data volume\.">/);
});

test('v10.55 tema döngüsünün erişilebilir adı araç ipucuyla aynı dili kullanır', () => {
  const syncTheme = APP.match(/function syncThemeButtonTitle\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(syncTheme, /btn\.setAttribute\('title',title\)/);
  assert.match(syncTheme, /btn\.setAttribute\('aria-label',title\)/);
});

test('v10.55 menü daraltma denetimi araç ipucu ve erişilebilir ad için belge dilini kullanır', () => {
  const syncRail = INDEX.match(/function syncRailIcon\(\)\{[\s\S]*?collapseBtn\?\.addEventListener/)?.[0] || '';
  assert.match(syncRail, /const title=document\.documentElement\.lang==='en'\s*\?/);
  assert.match(syncRail, /collapseBtn\.title=title/);
  assert.match(syncRail, /collapseBtn\.setAttribute\('aria-label',title\)/);
});
