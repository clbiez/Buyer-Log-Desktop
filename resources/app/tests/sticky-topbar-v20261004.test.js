'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('üst uygulama barı viewport scrollunda görünür kalır', () => {
  assert.match(CSS, /body\{[^}]*overflow-x:clip/);
  assert.doesNotMatch(CSS, /body\{[^}]*overflow-x:hidden/);
  assert.match(CSS,/\.appTop\{position:sticky;top:0;[^}]*height:var\(--ui-topbar-height\)/); assert.match(CSS,/\.appTop\{[^}]*z-index:var\(--ui-z-chrome\)/);
});
