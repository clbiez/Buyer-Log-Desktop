'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const APP_CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

test('v10.40 Orders ve Collection filtre temizleme eylemini bağlam çubuğuna bırakır', () => {
  const toolbar = APP.slice(APP.indexOf('function syncTableToolbarActions('), APP.indexOf('function syncActivePageTitle'));
  assert.match(toolbar, /const contextualClear=document\.getElementById\('navClearFilters'\)/);
  assert.match(toolbar, /contextualClear\.hidden=tab==='orders'\|\|tab==='koleksiyon'/);
  assert.match(INDEX, /data-active-filter-clear="koleksiyon"/);
  assert.match(INDEX, /data-active-filter-clear="orders"/);
});

test('v10.40 hidden genel araç çubuğu eylemi, navActionBtn görünürlük kuralını ezmelidir', () => {
  assert.match(APP_CSS, /\.navActionBtn\[hidden\]\{display:none!important;\}/);
});

test('v10.40 filtre yokken bağlamsal temizleme eylemi görünürlük kuralını ezmemelidir', () => {
  assert.match(APP_CSS, /\.activeFilterClear\[hidden\]\{display:none!important;\}/);
});

test('v10.40 global clear handler remains available for pages that do not have the contextual filter bar', () => {
  const toolbar = APP.slice(APP.indexOf('function syncTableToolbarActions('), APP.indexOf('function syncActivePageTitle'));
  assert.match(toolbar, /tab==='cp'/);
  assert.doesNotMatch(toolbar, /contextualClear\.hidden=true/);
  assert.match(APP, /document\.getElementById\('navClearFilters'\)\.addEventListener\('click'/);
});
