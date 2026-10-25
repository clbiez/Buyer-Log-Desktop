'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicDir = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(publicDir, 'app.css'), 'utf8');

test('CP Tracker summary is inset using the design-system spacing token', () => {
  const cpSection = html.match(/<section id="view-cp"[\s\S]*?(?=<section id="view-orders")/);
  assert.ok(cpSection, 'CP Tracker section should exist');
  assert.match(
    cpSection[0],
    /<div class="workspaceContextBar"[^>]*>\s*<span class="workspaceContextMeta" id="cpWorkspaceMeta">/,
    'The model/option/order summary should remain in the CP workspace bar',
  );
  assert.match(
    css,
    /#view-cp \.workspaceContextBar\{padding-inline:var\(--ui-space-5\);\}/,
    'The CP summary must have a consistent left and right inset',
  );
  assert.match(
    css,
    /\.workspaceContextBar\{[^}]*padding:var\(--ui-space-2\) var\(--ui-space-3\);\}/,
    'The shared context-bar spacing must remain intact for other pages',
  );
});
