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

test('v10.45 Orders table search has a translated accessible name beyond its placeholder', () => {
  const input = searchInput('ordersSearch');
  assert.match(input, /aria-label="Siparişlerde ara"/);
  assert.match(input, /data-i18n-aria-label-tr="Siparişlerde ara"/);
  assert.match(input, /data-i18n-aria-label-en="Search Orders"/);
});

test('v10.45 CP Tracker table search has the matching translated accessible name', () => {
  const input = searchInput('cpSearch');
  assert.match(input, /aria-label="CP Tracker'da ara"/);
  assert.match(input, /data-i18n-aria-label-tr="CP Tracker'da ara"/);
  assert.match(input, /data-i18n-aria-label-en="Search CP Tracker"/);
});
