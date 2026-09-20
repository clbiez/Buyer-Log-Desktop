'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'kpi-groups.js'), 'utf8');

test('hızlı filtre menüsü grup dışına tıklanınca otomatik kapanır', () => {
  const start = source.indexOf("document.addEventListener('click',e=>{");
  assert.notEqual(start, -1, 'KPI click delegasyonu bulunmalı');
  const block = source.slice(start, start + 900);

  assert.match(block, /if\(!trigger\)\{[\s\S]*?if\(!e\.target\.closest\('\.kpiGroup'\)\) closeKpiGroups\(\);[\s\S]*?return;/,
    'grup dışındaki tıklama açık hızlı filtreleri kapatmalı');
});

test('hızlı filtre menüsü kendi paneline tıklanınca gereksiz yere kapanmaz', () => {
  const start = source.indexOf("document.addEventListener('click',e=>{");
  const block = source.slice(start, start + 900);

  assert.match(block, /e\.target\.closest\('\.kpiGroup'\)/,
    'panel içi etkileşim aynı grup içinde kabul edilmeli');
  assert.match(block, /closeKpiGroups\(grp\); setKpiGroupOpen\(grp,open\);/,
    'başka hızlı filtre başlığı açılırken önceki grup kapanmalı');
});
