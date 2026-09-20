'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.64 fiyat kuralı yardım metni seçili dili eksiksiz kullanır', () => {
  const dictionaryStart = APP.indexOf('const TR_EN_DICT = {');
  const dictionaryEnd = APP.indexOf('\n};', dictionaryStart);
  const dictionary = APP.slice(dictionaryStart, dictionaryEnd);
  const seasonStart = APP.indexOf('function pricingRuleSeasonLabel(');
  const seasonEnd = APP.indexOf('\nfunction ', seasonStart + 1);
  const season = APP.slice(seasonStart, seasonEnd);

  assert.match(dictionary, /'License Royalty hesabından':'From the License Royalty calculation'/);
  assert.match(dictionary, /'Tüm Sezonlar':'All seasons'/);
  assert.match(season, /return seasons\.length\?seasons\.join\(', '\):L\('Tüm Sezonlar'\);/);
});
