'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const INDEX = read('public/index.html');
const APP = read('public/app-main.js');
const CSS = read('public/collection-spreadsheet.css');

test('v10.39 Collection zero-result state explains filtered versus truly empty data', () => {
  assert.match(INDEX, /id="kolEmptyState"[^>]*hidden/);
  assert.match(APP, /function kolHasActiveTableFilters\(\)/);
  assert.match(APP, /function renderKolEmptyState\(rows\)/);
  assert.match(APP, /Bu filtrelerle eşleşen model yok/);
  assert.match(APP, /Koleksiyon henüz model içermiyor/);
  assert.match(APP, /renderKolEmptyState\(rows\)/);
});

test('v10.39 Collection zero-result state uses the shared primitive and only offers a real recovery action', () => {
  const render = APP.slice(APP.indexOf('function renderKolEmptyState('), APP.indexOf('function renderKol(){'));
  assert.match(render, /window\.BLUI\?\.renderState/);
  assert.match(render, /clearTableFilters\('koleksiyon'\)/);
  assert.match(render, /actionLabel/);
  assert.match(render, /aria-live/);
  assert.doesNotMatch(render, /location\.reload|fetch\(/);
});

test('v10.39 Collection empty state is contained in the table surface and stays usable on narrow screens', () => {
  assert.match(INDEX, /class="tablewrap"[^>]*>[\s\S]*id="kolTable"[\s\S]*id="kolEmptyState"/);
  assert.match(CSS, /\.kolEmptyState\{/);
  assert.match(CSS, /\.kolEmptyState\[hidden\]/);
  assert.match(CSS, /@media\(max-width:620px\)/);
});
