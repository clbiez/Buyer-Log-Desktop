'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('dar/yatay kısa pencerede sol ray etiketleri ve modüller üst üste binmez', () => {
  assert.match(CSS, /nav\.tabs\{[^}]*overflow-y:auto;[^}]*overflow-x:hidden;[^}]*overscroll-behavior:contain;/);
  assert.match(CSS, /nav\.tabs>\.railGroupLabel\{[^}]*flex:0 0 auto;/);
  assert.match(CSS, /nav\.tabs button\{[^}]*min-height:var\(--ui-rail-item-height\);[^}]*flex:0 0 var\(--ui-rail-item-height\);/);
});
