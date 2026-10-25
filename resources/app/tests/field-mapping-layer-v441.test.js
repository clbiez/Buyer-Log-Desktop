'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = (fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8'));
const css = require('./helpers/manifest-css')();

test('v4.41 modal içinden açılan ortak seçim panelini modal katmanına taşır', () => {
  assert.ok(
    html.includes("opts.anchorEl?.closest?.('.warnOverlay,[aria-modal=\"true\"]')"),
    'ortak panel modal bağlamını anchor üzerinden algılamalı'
  );
  assert.ok(
    html.includes("panel.classList.add('colFilterPanelModal')"),
    'modal içindeki panel yüksek katman sınıfını almalı'
  );
});

test('v4.41 Field Mapping ortak seçim panelini kullanmaya devam eder', () => {
  /* v7.81: alan eşlemesi eski bağlantı modalından Veri Yönetimi'ne taşındı.
     Korunan kural aynı — düzenleyici KENDİ seçicisini üretmez, ortak olanı
     kullanır (§9). Ortak seçici artık BLDataPicker. */
  const mapping = fs.readFileSync(path.join(root, 'public', 'data-management-mapping.js'), 'utf8');
  assert.ok(mapping.includes('class="dmmColumn" data-pick='), 'Field Mapping seçim düğmesi bulunmalı');
  assert.ok(mapping.includes('window.BLDataPicker?.open?.('), 'Field Mapping ortak seçiciyi açmalı');
  assert.ok(!/function\s+\w*[Pp]icker/.test(mapping), 'düzenleyici kendi seçicisini yazmamalı');
});

test('v4.41 modal seçim paneli ortak modal bandının önündedir', () => {
  const panel = require('./helpers/manifest-css').rules(/\.colFilterPanel\.colFilterPanelModal/);
  assert.match(panel, /z-index:var\(--ui-z-modal-menu\)/);
  const token = name => Number(css.match(new RegExp('--ui-z-'+name+':\\s*(\\d+)'))[1]);
  assert.ok(token('modal-menu') > token('modal'), 'modal seçici parent overlay üzerinde kalmalı');
});
