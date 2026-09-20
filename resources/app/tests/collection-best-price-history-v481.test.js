'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));

test('v4.81 Collection Best Price cell opens Pricing History on double click', () => {
  assert.match(HTML, /class="kolBestCell kolBestValueCell kolBestHistoryCell/);
  assert.match(HTML, /data-kol-price-history-id="\$\{r\.id\}"/);
  assert.match(HTML, /querySelectorAll\('\.kolBestHistoryCell\[data-kol-price-history-id\]'\)/);
  assert.match(HTML, /window\.BL_QUOTATIONS\?\.openPriceHistory\(\[row\]\)/);
  assert.match(HTML, /Fiyat Geçmişini açmak için çift tıklayın/);
});
