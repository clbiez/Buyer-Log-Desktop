'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const styles = fs.readFileSync(path.join(publicDir, 'ui-components.css'), 'utf8');
const tokens = fs.readFileSync(path.join(publicDir, 'ui-tokens.css'), 'utf8');
const start = styles.indexOf('/* Theme-aware selection controls for the leading column of tables. */');
const selectionCss = start >= 0 ? styles.slice(start) : '';

test('Leading-column selection boxes share one square, theme-token-based appearance', () => {
  assert.ok(selectionCss, 'shared component rules missing');
  assert.match(selectionCss, /table :is\(th:first-child,td:first-child\) input\[type="checkbox"\]/);
  assert.match(selectionCss, /\.lcCheck input\[type="checkbox"\]/);
  for (const key of ['--ui-check-idle', '--ui-surface', '--ui-header-bg', '--ui-accent', '--ui-on-accent', '--ui-radius']) {
    assert.ok(selectionCss.includes('var(' + key + ')'), 'missing theme token ' + key);
  }
  assert.match(selectionCss, /border-radius:var\(--ui-radius\)!important/);
  assert.doesNotMatch(selectionCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'no fixed palette values in shared control');
});

test('Leading-column selection box supports unchecked, checked, partial, focused and disabled states', () => {
  assert.match(selectionCss, /:not\(:checked\):not\(:indeterminate\)::before/);
  assert.match(selectionCss, /:is\(:checked,:indeterminate\)/);
  assert.match(selectionCss, /:indeterminate::after/);
  assert.match(selectionCss, /:focus-visible/);
  assert.match(selectionCss, /outline:2px solid var\(--ui-accent\)/);
  assert.match(selectionCss, /:disabled/);
  assert.match(selectionCss, /cursor:default/);
});

test('Light, grey and dark themes supply the needed selector state colors', () => {
  for (const selector of [':root{', ':root[data-theme="grey"]{', ':root[data-theme="dark"]{']) {
    const at = tokens.indexOf(selector);
    assert.notEqual(at, -1, 'missing theme ' + selector);
  }
  for (const key of ['--ui-check-idle:', '--ui-header-bg:', '--ui-accent:', '--ui-on-accent:']) {
    assert.ok(tokens.includes(key), 'missing canonical token ' + key);
  }
});
