'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');

test('üst uygulama barı viewport scrollunda görünür kalır', () => {
  assert.match(CSS, /body\{[^}]*overflow-x:clip/);
  assert.doesNotMatch(CSS, /body\{[^}]*overflow-x:hidden/);
  assert.match(CSS, /\.appTop\{position:sticky;top:0;z-index:(?:[3-9]\d\d|\d{4,});[^}]*height:var\(--topbar-h\)/);
});
