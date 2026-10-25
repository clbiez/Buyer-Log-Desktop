'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'public');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'experience.css'), 'utf8');

test('CP, Orders and Collection table summaries keep an inset from the panel edge', () => {
  // Shared layout prevents the model / option / order count from touching the panel border.
  assert.match(
    css,
    /:is\(#view-cp,#view-orders,#view-koleksiyon\)\s+\.workspaceContextBar\s*\{[^}]*padding-inline:\s*clamp\(var\(--ui-space-4\),1\.5vw,var\(--ui-space-5\)\)/s,
  );
  for (const [view, meta] of [
    ['cp', 'cpWorkspaceMeta'],
    ['orders', 'ordersWorkspaceMeta'],
    ['koleksiyon', 'kolWorkspaceMeta'],
  ]) {
    const section = index.slice(index.indexOf('<section id="view-' + view + '"'));
    assert.match(section, new RegExp('class="workspaceContextBar"[\\s\\S]*?id="' + meta + '"'));
  }
});

test('The responsive summary inset uses existing design-system spacing tokens', () => {
  const tokens = fs.readFileSync(path.join(root, 'ui-tokens.css'), 'utf8');
  assert.match(tokens, /--ui-space-4:\s*16px/);
  assert.match(tokens, /--ui-space-5:\s*24px/);
});
