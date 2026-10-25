'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.47 Collection View & Permissions disclosure keeps an explicit translated accessible name', () => {
  const renderStart = APP.indexOf('function renderKolScopeFilters()');
  const renderEnd = APP.indexOf("root.querySelectorAll('[data-owner-id]')", renderStart);
  const render = APP.slice(renderStart, renderEnd);

  const summary=render.match(/<summary\b[^>]*>/)?.[0];
  assert.ok(summary,'native disclosure summary exists');
  assert.match(summary, /aria-label="\$\{t\('workspacePermissions'\)\}"/);
  assert.match(summary, /title="\$\{t\('workspacePermissions'\)\}"/);
  assert.match(render, /<span class="kolScopeWorkspaceLabel">\$\{t\('workspacePermissions'\)\}<\/span>/);
  assert.match(APP, /workspacePermissions:\{tr:'Görünüm ve Yetkiler',en:'View & Permissions'\}/);
});
