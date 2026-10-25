'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = require('./helpers/manifest-css')();
const index = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

test('v10.66 aktif Collection filtre çipi ikonunu sabit ölçekte tutar', () => {
  const block = require('./helpers/manifest-css').rules(/activeFilterToken/);
  assert.match(block, /\.activeFilterToken \.ic\{[^}]*width:14px;height:14px/);
  assert.doesNotMatch(block, /var\(--icon-sm\)/);
  assert.match(index, /app\.css\?v=__BL_ASSET_VERSION__&rev=[A-Za-z0-9._-]+/);
});
