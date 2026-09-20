'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DESIGN = fs.readFileSync(path.join(ROOT, 'public', 'design.css'), 'utf8');

test('v10.67 hızlı filtre seçenekleri okunabilir metin ölçeğini kullanır', () => {
  const block = DESIGN.match(/\/\* v10\.67[\s\S]*?(?=\/\* =====================|$)/)?.[0] || '';
  assert.match(block, /\.kpiGroupMenu>\.kpi \.l\{[^}]*font-size:var\(--fs-sm\)/,
    'açılır menü etiketleri normal metin ölçeğinin altında kalmamalı');
  assert.match(block, /\.kpiGroupMenu>\.kpi \.l\{[^}]*line-height:1\.3/,
    'uzun seçenekler okunabilir satır yüksekliği taşımalı');
});

test('v10.67 hızlı filtre satırları standart kontrol yüksekliğinde tıklanabilir kalır', () => {
  const block = DESIGN.match(/\/\* v10\.67[\s\S]*?(?=\/\* =====================|$)/)?.[0] || '';
  assert.match(block, /\.kpiGroupMenu>\.kpi\{[^}]*min-height:var\(--control-sm\)/,
    'menü satırları dar bir metin şeridine dönüşmemeli');
  assert.match(block, /\.kpiGroupMenu>\.kpi\{[^}]*padding:5px 10px/,
    'menü satırlarında yeterli tıklama boşluğu olmalı');
});
