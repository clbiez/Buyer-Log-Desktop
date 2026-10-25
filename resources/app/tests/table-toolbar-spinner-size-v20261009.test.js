'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('CP Orders Collection tool actions use a fixed-size static working marker without rotating the button', () => {
  const rule = CSS.match(/:is\(\.tbtn,\.navActionBtn\)\.isActionWorking::after\s*\{([^}]*)\}/);
  assert.ok(rule, 'working action indicator must be defined');
  const declarations = rule[1];
  assert.match(declarations, /\binset:auto\s*;/, 'spinner must not stretch with the menu action');
  assert.match(declarations, /\bwidth:14px\s*;/);
  assert.match(declarations, /\bheight:14px\s*;/);
  assert.match(declarations, /\bright:7px\s*;/, 'ring should remain inside the action button');
  assert.match(declarations, /\btop:50%\s*;/, 'ring should be vertically centered');
  assert.match(declarations, /\bbox-sizing:border-box\s*;/);
  require('./helpers/manifest-css').assertStaticMotion();
  assert.doesNotMatch(declarations, /\binset:\s*\d+px\s*;/);
});
