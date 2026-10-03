'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

test('dar/yatay kısa pencerede sol ray etiketleri ve modüller üst üste binmez', () => {
  assert.match(CSS, /nav\.tabs\{[^}]*overflow-y:auto;[^}]*overflow-x:hidden;[^}]*overscroll-behavior:contain;/);
  assert.match(CSS, /nav\.tabs>\.railGroupLabel\{[^}]*flex:0 0 auto;/);
  assert.match(CSS, /nav\.tabs button\{[^}]*min-height:var\(--rail-item-h\);[^}]*flex:0 0 var\(--rail-item-h\);/);
});
