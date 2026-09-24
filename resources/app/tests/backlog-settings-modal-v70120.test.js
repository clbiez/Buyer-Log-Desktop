'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'public', 'backlog-settings.js'), 'utf8');

test('Backlog eski açık filtre kartını göstermiyor ve Ayarlar Excel seçeneklerinin solunda', () => {
  assert.ok(!index.includes('<div class="panel backlogFilterCard">'), 'eski görünür Backlog filtre kartı kaldırılmalı');
  assert.ok(index.includes('id="backlogSettingsCompat"'), 'mevcut motor DOM kimlikleri görünmez uyumluluk alanında korunmalı');
  const settingsAt = index.indexOf('id="backlogSettingsBtn"');
  const excelAt = index.indexOf('id="backlogExcelOptionsBtn"');
  assert.ok(settingsAt > 0 && excelAt > settingsAt, 'Ayarlar butonu Excel Seçenekleri butonunun hemen solunda olmalı');
  assert.ok(index.includes('backlog-settings.js?v=__BL_ASSET_VERSION__'), 'Backlog ayar modalı yüklenmeli');
});

test('Backlog ayarları OAB modal primitive ve bölüm yapısını kullanıyor', () => {
  for (const marker of [
    "modal.className = 'autoModalOverlay'",
    "card.className = 'autoModal oabSettingsModal backlogSettingsModal'",
    "section.className = 'oabSettingsSection'",
    "head.className = 'oabSettingsSectionHead'",
    "list.className = 'oabPivotConfigList backlogSettingsConfigList'",
    "'Ön Filtreler'", "'Pivot Satırları'", "'Hiyerarşi Sırası'",
  ]) assert.ok(ui.includes(marker), `Backlog OAB-style settings marker missing: ${marker}`);
});

test('Backlog ayar modalı mevcut rapor motorunu tek source-of-truth olarak kullanır', () => {
  for (const id of [
    'backlogFrom', 'backlogTo', 'backlogInStoreFrom', 'backlogInStoreTo',
    'backlogAntrepoFrom', 'backlogAntrepoTo', 'backlogDimPicker', 'backlogDimOrder',
    'backlogDateLevelWrap', 'backlogRangeLabel', 'backlogApplyBtn',
  ]) assert.ok(ui.includes(id), `existing Backlog control missing from modal bridge: ${id}`);
  assert.ok(ui.includes("document.querySelector('[data-backlog-dim-add]')"), 'OAB-style Alan ekle existing custom-dimension actionına bağlanmalı');
  assert.ok(ui.includes("el('backlogApplyBtn')?.click()"), 'Uygula mevcut Backlog fetch/apply akışını çalıştırmalı');
});

test('Backlog legacy ayar yüzeyi görünmezdir ve modal responsive kalır', () => {
  assert.ok(css.includes('.backlogSettingsCompat{display:none!important;}'));
  assert.ok(css.includes('.autoModal.backlogSettingsModal{width:min(760px,calc(100vw - 24px));}'));
  assert.ok(css.includes('.backlogSettingsPrefilters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));'));
  assert.ok(css.includes('@media(max-width:760px)'));
});
