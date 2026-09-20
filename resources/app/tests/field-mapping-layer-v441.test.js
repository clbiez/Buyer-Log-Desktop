'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = (fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8'));
const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');

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

test('v4.41 modal seçim paneli blur ve yüksek z-index kullanan katmanların önündedir', () => {
  const match = css.match(/\.colFilterPanel\.colFilterPanelModal\{z-index:(\d+)!important;\}/);
  assert.ok(match, 'modal paneli için açık bir z-index kuralı bulunmalı');
  assert.ok(Number(match[1]) > 54010, 'modal seçim paneli mevcut modal ve overlay katmanlarından yüksek olmalı');
});
