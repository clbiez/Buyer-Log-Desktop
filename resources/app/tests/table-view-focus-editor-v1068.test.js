'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const USER_STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');

test('Focus ve Extended çift tıklaması ortak sütun seçici düzenleyicisini açar', () => {
  assert.match(APP, /const TABLE_VIEW_EDITABLE_PRESETS = Object\.freeze\(\['focus','extended'\]\);/,
    'Focus ve Extended aynı editable preset sözleşmesinde olmalı');
  // v7.0.229 — ortak editör Alanlar çekmecesidir: üç görünüm tek ekranda tiklenir.
  assert.match(APP, /document\.addEventListener\('dblclick',event=>\{[\s\S]*?TABLE_VIEW_EDITABLE_PRESETS\.includes\(button\.dataset\.tableViewPreset\)[\s\S]*?openTableFieldsMenu\(drawerButton\)/,
    'çift tıklama yalnız editable presetleri Alanlar çekmecesine yönlendirmeli');
  assert.match(APP, /data-table-fields-preset="\$\{preset\}"/);
  assert.doesNotMatch(APP, /function openTableViewFocusEditor\(/);
});

test('Focus ve Extended seçimi kullanıcı başına kalıcı saklanır ve tekrar açılışta okunur', () => {
  assert.match(APP, /const TABLE_VIEW_FOCUS_KEY = 'lcw\.tableViewFocus\.v1';/);
  assert.match(APP, /function tableViewSavedPresetKeys\(tableKey,preset\)/);
  assert.match(APP, /else page\[preset\]=valid;\s*stored\[tableKey\]=page/,
    'preset seçimi tablo + preset anahtarıyla saklanmalı');
  assert.match(APP, /BLStorage\.setItem\(TABLE_VIEW_FOCUS_KEY,JSON\.stringify\(stored\)\)/);
  assert.match(APP, /const fallback=preset==='focus'\?tableViewFocusKeys\(tableKey\):preset==='extended'\?tableViewDefaultExtendedKeys\(tableKey\):\[\]/,
    'Focus ve Extended kendi fallback setlerini kullanmalı');
});

test('Focus ve Extended presetleri kullanıcıya özel saklanır ve oturumlar arasında senkronize edilir', () => {
  assert.match(USER_STORAGE, /'lcw\.tableViewFocus\.'/,
    'preset anahtarı BLStorage kullanıcı kapsamına girmeli');
  const syncedStart = USER_STORAGE.indexOf('var SYNCED=[');
  const syncedEnd = USER_STORAGE.indexOf('];', syncedStart);
  assert.ok(syncedStart >= 0 && syncedEnd > syncedStart, 'SYNCED listesi bulunmalı');
  assert.match(USER_STORAGE.slice(syncedStart, syncedEnd), /'lcw\.tableViewFocus\.'/,
    'preset anahtarı kullanıcı tercihleri sunucu senkronuna girmeli');
  assert.match(USER_STORAGE, /tableViewPresetLegacyKey='lcw\.tableViewFocus\.v1'/,
    'eski global Focus\/Extended kaydı kişisel alana migrate edilmeli');
  assert.match(USER_STORAGE, /native\.getItem\(tableViewPresetPersonalKey\)==null[\s\S]*?native\.setItem\(tableViewPresetPersonalKey,tableViewPresetLegacyValue\)/,
    'migration mevcut kişisel ayarı ezmeden eski global değeri taşımalı');
});

test('preset düzenleyicisi boş seçimle görünümü bozmaz ve Uygula seçili preseti yeniler', () => {
  // v7.0.229 — Alanlar çekmecesindeki tikler aynı sözleşmeyi uygular.
  const fn = APP.slice(APP.indexOf('function tableFieldsSetPresetKeys('), APP.indexOf('function tableFieldsCheckbox('));
  assert.match(fn, /if\(!current\.size\)\{showToast\([\s\S]*?return false;\}/,
    'en az bir görünür sütun korunmalı');
  assert.match(fn, /saveTableViewPreset\(tableKey,preset,ordered\)/);
  assert.match(fn, /if\(base===preset\)applyTableViewPreset\(tableKey,preset\)/);
});

test('CP, Collection ve Orders Focus/Extended düğmeleri aynı erişilebilir sözleşmeyi kullanır', () => {
  for (const tableKey of ['cp', 'orders', 'koleksiyon']) {
    assert.match(HTML, new RegExp(`data-table-view-preset="focus" data-table-key="${tableKey}" aria-pressed="false"`));
    assert.match(HTML, new RegExp(`data-table-view-preset="extended" data-table-key="${tableKey}" aria-pressed="false"`));
  }
  assert.match(CSS, /\.quickFilterEditorCard\{/,
    'preset sütun seçici mevcut seçim modalı bileşenini yeniden kullanmalı');
});
