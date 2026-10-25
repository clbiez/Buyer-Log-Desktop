'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')();
const DESIGN = require('./helpers/manifest-css')();
const INTAKE = fs.readFileSync(path.join(ROOT, 'public', 'intake.js'), 'utf8');

test('refresh scope feedback uses normal notifications without the yellow global strip', () => {
  const start = APP.indexOf('function setReadOnlyMode(on, targets)');
  const end = APP.indexOf('function readOnlyGuard(area)', start);
  assert.ok(start >= 0 && end > start);
  const block = APP.slice(start, end);
  assert.match(block, /showToast\(appLang==='en'/);
  assert.match(block, /removeAttribute\('data-readonly-label'\)/);
  assert.doesNotMatch(DESIGN, /body\.bl-readonly::before/);
});

test('INTAKE filter controls live behind the filter icon next to Refresh', () => {
  assert.match(INDEX, /<symbol id="i-filter"[\s\S]*?<\/symbol>/);
  const headerStart = INDEX.indexOf('<div class="intakeHeaderActions">');
  const headerEnd = INDEX.indexOf('</div>', headerStart);
  const header = INDEX.slice(headerStart, headerEnd);
  const refreshPos = header.indexOf('id="intakeRefreshBtn"');
  const filterPos = header.indexOf('id="intakeFiltersBtn"');
  assert.ok(refreshPos >= 0 && filterPos > refreshPos, 'filter icon must be immediately after INTAKE Refresh');
  assert.match(header.slice(filterPos, filterPos + 700), /<use href="#i-filter"\/>/);

  const panelPos = INDEX.indexOf('id="intakeFilterPanel"');
  const barPos = INDEX.indexOf('id="intakeFilterBar"', panelPos);
  assert.ok(panelPos >= 0 && barPos > panelPos, 'INTAKE filter bar must be inside the filter panel');
  assert.match(INTAKE, /function setFilterPanelOpen\(open\)/);
  assert.match(INTAKE, /byId\('intakeFiltersBtn'\)\?\.addEventListener\('click'/);
  assert.match(INTAKE, /setFilterPanelOpen\(false\)/);
  assert.match(CSS, /\.intakeFilterPanel\{/);
  assert.match(CSS, /\.intakeFiltersBtn\.hasActiveFilters/);
});
