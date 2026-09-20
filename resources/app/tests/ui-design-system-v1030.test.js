'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = read('public/app.css');
const DESIGN = read('public/design.css');
const INDEX = read('public/index.html');

function sourceBetween(name, endMarker) {
  const start = APP.indexOf(`function ${name}`);
  const end = APP.indexOf(endMarker, start + 1);
  assert.notEqual(start, -1, `${name} bulunamadı`);
  assert.notEqual(end, -1, `${name} bitişi bulunamadı`);
  return APP.slice(start, end);
}

test('v10.30 başlangıç veri yüklemesi kaldırılmış Horizon bağlantı durumuna başvurmaz', () => {
  /* v7.81 — Rozetin altındaki data-horizon-action işleyicisi kaldırıldı,
     bitiş işareti onunla birlikte gitti. Seçici (pickerButton) de kalktı:
     başlık artık salt okunur. KORUNAN KARAR aynı: başlangıç yüklemesi
     kaldırılmış "linked" bağlantı durumuna başvurmamalı. */
  const source = sourceBetween('renderHorizonBadges', '\nfunction sourceFilterNoticeText');
  assert.doesNotMatch(source, /\blinked\b/, 'kaldırılmış linked durumu başlangıç yüklemesini kırmamalı');
  assert.match(source, /horizonSummaryChip/, 'başlık filtre özetini çizmeli');
});

test('v10.30 sayfa manifesti Veri Yönetimi başlığını ve geçerli konumu birlikte günceller', () => {
  assert.match(APP, /source:\{tr:'Veri Yönetimi',en:'Data Management',group:'system'\}/);
  assert.match(APP, /toggleAttribute\('aria-current',b\.dataset\.tab===tab\)/);
  assert.match(INDEX, /source:\{tr:'Veri Yönetimi',en:'Data Management'/);
});

test('v10.30 sol ray modülleri görev temelli ve çevrilebilir gruplar altında sunar', () => {
  const labels = [...INDEX.matchAll(/class="railGroupLabel"[^>]*data-i18n-en="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Home', 'Plan &amp; Execute', 'Commercial', 'Operations', 'System']);
  assert.match(CSS, /nav\.tabs>\.railGroupLabel\{display:block/);
  assert.match(CSS, /html\[data-rail="min"\] nav\.tabs>\.railGroupLabel\{display:none/);
});

test('v10.30 Interface Size dört adlandırılmış preset ile ilk boyamada ve etkileşimde uygulanır', () => {
  assert.match(INDEX, /dataset\.uiScale=/);
  assert.match(INDEX, /Arayüz: Standard/);
  assert.match(APP, /const UI_SCALE_PRESETS=\[/);
  for (const preset of ['standard', 'large', 'xl', 'compact']) assert.match(APP, new RegExp(`key:'${preset}'`));
  assert.match(APP, /document\.documentElement\.dataset\.uiScale=preset\.key/);
  assert.match(APP, /Arayüz boyutu:/);
  for (const preset of ['compact', 'standard', 'large', 'xl']) {
    assert.match(CSS, new RegExp(`html\\[data-ui-scale="${preset}"\\]`));
  }
});

test('v10.30 ölçek yalnız fontu değil ortak kabuk, kontrol ve tablo geometrisini değiştirir', () => {
  for (const token of ['--ui-scale', '--ctl-h', '--table-row-h', '--table-head-pad-y', '--rail-item-h', '--icon-btn-size', '--topbar-h']) {
    assert.match(CSS, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(CSS, /nav\.tabs button\{[^}]*height:var\(--rail-item-h\)/);
  assert.match(CSS, /\.appTop\{[^}]*height:var\(--topbar-h\)/);
  assert.match(DESIGN, /\.appTop\{height:var\(--topbar-h\);?\}/);
  assert.match(CSS, /\.iconbtn\{[^}]*width:var\(--icon-btn-size\);height:var\(--icon-btn-size\)/);
  assert.match(CSS, /thead th\{[^}]*padding:var\(--table-head-pad-y\) 10px/);
  assert.match(CSS, /tbody td\{[^}]*padding:var\(--table-cell-pad-y\) 10px/);
  assert.match(DESIGN, /nav\.tabs button\{height:var\(--rail-item-h\)/);
});
