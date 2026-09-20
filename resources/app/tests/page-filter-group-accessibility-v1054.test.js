'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const GROUPS = fs.readFileSync(path.join(ROOT, 'public', 'kpi-groups.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v10.54 CP ve Siparişler Sayfa Filtreleri başlığı klavyeyle açılıp kapanabilen bir düğmedir', () => {
  assert.match(GROUPS, /document\.createElement\('button'\)/);
  assert.match(GROUPS, /s\.setAttribute\('aria-expanded','false'\)/);
  assert.match(GROUPS, /head\.setAttribute\('aria-controls',menu\.id\)/);
  assert.match(GROUPS, /lbl\.setAttribute\('aria-expanded',String\(willOpen\)\)/);
  assert.match(GROUPS, /querySelector\(':scope > \.tbGroupHead'\)\?\.setAttribute\('aria-expanded','false'\)/);
  assert.match(CSS, /\.pageTitleFilters \.fltGroup>\.tbGroupHead\{[^}]*border:0[^}]*background:transparent[^}]*font:inherit/);
});
