'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'public', file), 'utf8');

const css = read('ui-components.css');
const overview = read('overview-premium.js');
const intake = read('intake.js');
const oab = read('oab.js');
const html = read('index.html');
const classic = css.slice(css.indexOf('Buyer Log 7.0.294 surface and spreadsheet restoration'));

test('classic controls, widgets and table headings retain shared token borders', () => {
  assert.ok(classic.length > 1800, 'Shared Manifest restoration block must exist');
  assert.match(classic, /\.ovHome > \[data-overview-widget\]/);
  assert.match(classic, /:is\(\.panel,\.cardBox,\.modalCard/);
  assert.match(classic, /:is\(\.navActionBtn,\.tbtn,\.iconbtn/);
  assert.match(classic, /thead tr\.groupRow th/);
  assert.match(classic, /thead tr\.colRow th\.groupBoundary/);
  assert.match(classic, /\.miniTable thead th/);
  assert.match(classic, /border-right:1px solid var\(--ui-row-divider\)/);
  assert.match(classic, /border-inline-start:1px solid var\(--ui-group-divider\)/);
  assert.match(classic, /border:1px solid var\(--ui-group-divider\)/);
});

test('row checkboxes and selection/edited state stay visible without replacing JS selection', () => {
  assert.match(classic, /input\[type="checkbox"\]/);
  assert.match(classic, /accent-color:var\(--ui-accent\)/);
  assert.match(classic, /:has\(input\[type="checkbox"\]:checked\) td/);
  assert.match(classic, /rowDirty td:first-child/);
  assert.match(classic, /inset 3px 0 0 var\(--ui-accent\)/);
  assert.match(classic, /inset 3px 0 0 var\(--ui-warning\)/);
});

test('profile control and Buyer Log brand mark use exactly the same corner geometry', () => {
  assert.match(classic, /\.rail \.brandMark--image/);
  assert.match(classic, /#currentUserBtn/);
  assert.match(classic, /border-radius:var\(--ui-radius\)/);
  assert.match(html, /id="currentUserBtn"/);
});

test('OAB and INTAKE show native pivot tables by default but still offer chart toggle', () => {
  assert.match(overview, /metricPrefs\.get\(id\)\|\|\{field:input\.fields\[0\]\.key,table:true\}/);
  assert.match(overview, /prefs\.table=!prefs\.table/);
  assert.match(overview, /classList\.toggle\('ovMetricTableOpen',prefs\.table\)/);
  assert.match(oab, /view: 'pivot'/);
  assert.match(html, /class="navActionBtn active" data-oab-view="pivot"/);
});

test('INTAKE renders an initial empty state and recovers when its state request fails', () => {
  assert.match(intake, /bind\(\);\s*render\(\);[^]*?void loadState\(\)/);
  const state = intake.slice(intake.indexOf('async function loadState()'), intake.indexOf('async function loadMetadata()'));
  assert.match(state, /render\(\);\s*syncOverviewFilters\(\)/);
  assert.match(state, /IntersectionObserver/);
  assert.match(state, /void refresh\(false\)/);
  assert.match(state, /catch \(error\)\s*\{[^]*?render\(\); \/\/ Do not leave/);
  assert.match(intake, /body\.hidden = false/);
});
