'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('Focus ve Extended çift tıklaması ortak sütun seçici düzenleyicisini açar', () => {
  assert.match(APP, /const TABLE_VIEW_EDITABLE_PRESETS = Object\.freeze\(\['focus','extended'\]\);/,
    'Focus ve Extended aynı editable preset sözleşmesinde olmalı');
  assert.match(APP, /function openTableViewFocusEditor\(tableKey,preset='focus'\)/,
    'ortak preset editörü korunmalı');
  assert.match(APP, /document\.addEventListener\('dblclick',event=>\{[\s\S]*?TABLE_VIEW_EDITABLE_PRESETS\.includes\(button\.dataset\.tableViewPreset\)[\s\S]*?openTableViewFocusEditor\(button\.dataset\.tableKey,button\.dataset\.tableViewPreset\)/,
    'çift tıklama yalnız editable presetleri ortak editöre yönlendirmeli');
  assert.match(APP, /id='_tableViewFocusModal'/);
  assert.match(APP, /data-table-view-focus-key/);
});

test('Focus ve Extended seçimi kullanıcı başına kalıcı saklanır ve tekrar açılışta okunur', () => {
  assert.match(APP, /const TABLE_VIEW_FOCUS_KEY = 'lcw\.tableViewFocus\.v1';/);
  assert.match(APP, /function tableViewSavedPresetKeys\(tableKey,preset\)/);
  assert.match(APP, /page\[preset\]=valid;stored\[tableKey\]=page/,
    'preset seçimi tablo + preset anahtarıyla saklanmalı');
  assert.match(APP, /BLStorage\.setItem\(TABLE_VIEW_FOCUS_KEY,JSON\.stringify\(stored\)\)/);
  assert.match(APP, /const fallback=preset==='focus'\?tableViewFocusKeys\(tableKey\):preset==='extended'\?tableViewDefaultExtendedKeys\(tableKey\):\[\]/,
    'Focus ve Extended kendi fallback setlerini kullanmalı');
});

test('preset düzenleyicisi boş seçimle görünümü bozmaz ve Uygula seçili preseti yeniler', () => {
  assert.match(APP, /if\(!keys\.length\)\{showToast\([\s\S]*?return;\}/,
    'en az bir görünür sütun korunmalı');
  assert.match(APP, /saveTableViewPreset\(tableKey,preset,keys\)/);
  assert.match(APP, /applyTableViewPreset\(tableKey,preset\)/);
});

test('CP, Collection ve Orders Focus/Extended düğmeleri aynı erişilebilir sözleşmeyi kullanır', () => {
  for (const tableKey of ['cp', 'orders', 'koleksiyon']) {
    assert.match(HTML, new RegExp(`data-table-view-preset="focus" data-table-key="${tableKey}" aria-pressed="false"`));
    assert.match(HTML, new RegExp(`data-table-view-preset="extended" data-table-key="${tableKey}" aria-pressed="false"`));
  }
  assert.match(CSS, /\.quickFilterEditorCard\{/,
    'preset sütun seçici mevcut seçim modalı bileşenini yeniden kullanmalı');
});
