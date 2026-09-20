'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function searchInput(id) {
  const match = INDEX.match(new RegExp(`<input[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(match, `${id} search input should exist`);
  return match[0];
}

test('v10.46 Collection search names its table in both interface languages', () => {
  const input = searchInput('kolSearch');
  assert.match(input, /aria-label="Koleksiyonda ara"/);
  assert.match(input, /data-i18n-aria-label-tr="Koleksiyonda ara"/);
  assert.match(input, /data-i18n-aria-label-en="Search Collection"/);
});

test('v10.46 Costing Sheets search has a translated accessible name', () => {
  const input = searchInput('ocSearch');
  assert.match(input, /aria-label="Maliyet Çalışmalarında ara"/);
  assert.match(input, /data-i18n-aria-label-tr="Maliyet Çalışmalarında ara"/);
  assert.match(input, /data-i18n-aria-label-en="Search Costing Sheets"/);
});
