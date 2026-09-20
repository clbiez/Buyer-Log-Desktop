'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

test('v10.56 ortak dil katmanı işaretlenmiş aria adlarını seçili dile çevirir', () => {
  const staticI18n = APP.slice(APP.indexOf('function applyStaticI18n()'), APP.indexOf('// vfBar/sourcebar'));
  assert.match(staticI18n, /document\.querySelectorAll\('\[data-i18n-aria-label-tr\]'\)\.forEach/);
  assert.match(staticI18n, /el\.setAttribute\('aria-label',next\)/);
});

test('v10.56 ana tablo aramaları ortak aria dil sözleşmesini bildirir', () => {
  for (const [id, english] of [
    ['cpSearch', 'Search CP Tracker'],
    ['ordersSearch', 'Search Orders'],
    ['kolSearch', 'Search Collection'],
    ['ocSearch', 'Search Costing Sheets'],
  ]) {
    const input = INDEX.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] || '';
    assert.match(input, new RegExp(`data-i18n-aria-label-en="${english}"`));
  }
});
