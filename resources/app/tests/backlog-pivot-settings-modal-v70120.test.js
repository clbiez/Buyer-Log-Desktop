'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('Backlog eski sayfa-üstü filtre/gruplama kartını göstermez', () => {
  const section = INDEX.slice(INDEX.indexOf('<section id="view-backlog">'), INDEX.indexOf('<section id="view-automations">'));
  assert.doesNotMatch(section, /backlogFilterCard|id="backlogApplyBtn"|id="backlogGroupToggle"|id="backlogGroupPanel"/);
  assert.match(section, /id="backlogFilterState" hidden aria-hidden="true"/);
});

test('Backlog Pivot ayarları düğmesi Excel seçeneklerinin hemen solundadır', () => {
  const section = INDEX.slice(INDEX.indexOf('<section id="view-backlog">'), INDEX.indexOf('<section id="view-automations">'));
  const pivot = section.indexOf('id="backlogPivotSettingsBtn"');
  const excel = section.indexOf('id="backlogExcelOptionsBtn"');
  assert.ok(pivot >= 0 && excel > pivot, 'Pivot ayarları Excel seçeneklerinin solunda olmalı');
  assert.ok(excel - pivot < 900, 'iki düğme aynı toolbar grubunda yan yana olmalı');
});

test('Backlog ayarları OAB modal dilini satır, sütun, değer ve ön filtre bölümleriyle kullanır', () => {
  assert.match(APP, /function openBacklogPivotSettings\(\)/);
  assert.match(APP, /autoModal oabSettingsModal backlogPivotSettingsModal/);
  assert.match(APP, /Pivot Satırları|Pivot Rows/);
  assert.match(APP, /Pivot Sütunları|Pivot Columns/);
  assert.match(APP, /Pivot Değerleri|Pivot Values/);
  assert.match(APP, /Rapor Ön Filtreleri|Report Pre-Filters/);
  assert.match(APP, /Boyut Filtreleri|Dimension Filters/);
  assert.match(APP, /data-backlog-settings-save/);
  assert.match(APP, /data-backlog-settings-reset/);
  assert.match(APP, /openValueFilterPanel\(/);
  assert.match(CSS, /\.backlogPivotSettingsModal/);
  assert.match(CSS, /\.backlogSettingsDateGrid/);
});

test('Vazgeç draft state kullanır; Kaydet kanonik Backlog stateini tek seferde uygular', () => {
  assert.match(APP, /const draft=backlogSettingsDraft\(\)/);
  assert.match(APP, /backlogGroupBy=\[\.\.\.draft\.rows\]/);
  assert.match(APP, /backlogColBy=\[\.\.\.draft\.columns\]/);
  assert.match(APP, /backlogExpanded\.clear\(\);saveBacklogAutoState\(\);close\(\);fetchCurrentBacklog\(\)/);
});
