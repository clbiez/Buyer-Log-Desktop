'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.59 önbellek kaynak durumu seçili dilde metin ve saat biçimi kullanır', () => {
  const start = APP.indexOf('if(data.hasCachedData&&data.loadedAt){');
  const end = APP.indexOf('// Yenileme sonucu artık ana Overview ekranında', start);
  const source = APP.slice(start, end);

  assert.match(source, /toLocaleString\(appLang==='en'\?'en-GB':'tr-TR'\)/);
  assert.match(source, /const cacheStatus=appLang==='en'\?`Loaded from cache: CP \$\{\(data\.cp\|\|\[\]\)\.length\} orders, Orders \$\{ordersText\}, Order summary \$\{summaryCount\} rows\. \(\$\{t\}\)`:`Önbellekten yüklendi: CP \$\{\(data\.cp\|\|\[\]\)\.length\} sipariş, Siparişler \$\{ordersText\}, Sipariş özeti \$\{summaryCount\} satır\. \(\$\{t\}\)`;/);
  assert.match(source, /const sourceStatus=appLang==='en'[\s\S]*?`Last loaded: \$\{t\}/);
  assert.match(source, /setServerStatus\(sourceStatus\);/);
  assert.match(source, /updSourceHint\(cacheStatus\);/);
});
