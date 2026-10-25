'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DESIGN = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('v10.67 hızlı filtre seçenekleri okunabilir metin ölçeğini kullanır', () => {
  const block = require('./helpers/manifest-css').rules(/kpiGroupMenu/);
  assert.match(block, /\.kpiGroupMenu>\.kpi \.l\{[^}]*font-size:var\(--ui-font-sm\)/,
    'açılır menü etiketleri normal metin ölçeğinin altında kalmamalı');
  assert.match(block, /\.kpiGroupMenu>\.kpi \.l\{[^}]*line-height:1\.3/,
    'uzun seçenekler okunabilir satır yüksekliği taşımalı');
});

test('v10.67 hızlı filtre satırları standart kontrol yüksekliğinde tıklanabilir kalır', () => {
  const block = require('./helpers/manifest-css').rules(/kpiGroupMenu/);
  assert.match(block, /\.kpiGroupMenu>\.kpi\{[^}]*min-height:var\(--ui-control-height\)/,
    'menü satırları dar bir metin şeridine dönüşmemeli');
  assert.match(block, /\.kpiGroupMenu>\.kpi\{[^}]*padding:5px 10px/,
    'menü satırlarında yeterli tıklama boşluğu olmalı');
});
