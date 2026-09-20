'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.63 Koleksiyon ortak alan ve kural geri bildirimleri İngilizce karşılık taşır', () => {
  const dictionaryStart = APP.indexOf('const TR_EN_DICT = {');
  const dictionaryEnd = APP.indexOf('\n};', dictionaryStart);
  const dictionary = APP.slice(dictionaryStart, dictionaryEnd);

  for (const [tr, en] of [
    ['Yaz veya seç…', 'Type or choose…'],
    ['Otomatik hesaplanır', 'Calculated automatically'],
    ['Fiyat yok', 'No price'],
    ['Eşleşen CP fiyat kuralı bulunamadı', 'No matching CP pricing rule found'],
  ]) {
    assert.match(dictionary, new RegExp(`'${tr}':'${en}'`));
  }
});

test('v10.63 ortak hücre şablonu seçim yer tutucusunu sözlükten alır', () => {
  const cellStart = APP.indexOf('function cellHtml(');
  const cellEnd = APP.indexOf('\nfunction ', cellStart + 1);
  const cell = APP.slice(cellStart, cellEnd);

  assert.match(cell, /placeholder="\$\{disabled\?'':L\('Yaz veya seç…'\)\}"/);
  assert.doesNotMatch(cell, /placeholder="\$\{disabled\?'': 'Yaz veya seç…'\}"/);
});
