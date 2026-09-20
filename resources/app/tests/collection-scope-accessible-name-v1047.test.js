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

  assert.match(render, /<summary aria-label="\$\{t\('workspacePermissions'\)\}">\$\{t\('workspacePermissions'\)\}/);
  assert.match(APP, /workspacePermissions:\{tr:'Görünüm ve Yetkiler',en:'View & Permissions'\}/);
});
