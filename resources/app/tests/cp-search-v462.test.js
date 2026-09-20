'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

function cpSearchKeysFromSource() {
  const match = html.match(/const CP_SEARCH_KEYS=\[([^\]]+)\];/);
  assert.ok(match, 'CP_SEARCH_KEYS tanımı bulunmalı');
  return Function(`return [${match[1]}];`)();
}

test('v4.68 CP genel araması PLM ID, üretici ve kod alanlarını kapsar', () => {
  const keys = cpSearchKeysFromSource();
  for (const key of ['PLM ID', 'Manufacturer', 'Sub-Manufacturer', 'Special Code', 'Colour Code']) {
    assert.ok(keys.includes(key), `${key} CP aramasına dahil olmalı`);
  }
});

test('v4.68 CP araması başlık varyasyonlarını ve mevcut alanları korur', () => {
  const keys = cpSearchKeysFromSource();
  for (const key of ['Sub Manufacturer', 'Color Code', 'Model Name', 'License', 'Order Code', 'Colour']) {
    assert.ok(keys.includes(key), `${key} arama kapsamından çıkmamalı`);
  }
  assert.match(
    html,
    /id="cpSearch" placeholder="[^"]*PLM ID[^"]*alt üretici[^"]*özel kod[^"]*renk kodu[^"]*"/,
    'arama kutusu açıklaması yeni kapsamı belirtmeli',
  );
});

test('v4.68 CP arama filtresi tüm tanımlı alanları tek metinde tarar', () => {
  assert.match(html, /for\(let i=0;i<CP_SEARCH_KEYS\.length;i\+\+\)/);
  assert.match(html, /hay\+=norm\(r\[CP_SEARCH_KEYS\[i\]\]\)\.toLowerCase\(\)/);
  assert.match(html, /if\(!tableSearchMatches\(hay,ctx\.q,\{plainMode:'contains'\}\)\) return false/);
});
