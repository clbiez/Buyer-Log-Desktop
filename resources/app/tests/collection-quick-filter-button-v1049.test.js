'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const CSS = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
const GROUPS = fs.readFileSync(path.join(__dirname, '..', 'public', 'kpi-groups.js'), 'utf8');
const DESIGN = require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );

test('v10.49 Collection quick filters are keyboard-operable toggle buttons with a clear state', () => {
  const renderStart = APP.indexOf('function renderKolQuickFilters()');
  const renderEnd = APP.indexOf('// ================= LFL TRIAL KOPRUSU =================', renderStart);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(render, /<button type="button" class="kpi tone-\$\{tone\}\$\{active\?' active':''\}"\$\{statusStyle\}[^>]*aria-pressed="\$\{active\?'true':'false'\}"[^>]*data-kolq-key=/);
  assert.doesNotMatch(render, /<div class="kpi tone-blue\$\{active\?' active':''\}" data-kolq-key=/);
  assert.match(CSS, /\.kpi:is\(button\)\{[^}]*font:inherit[^}]*color:inherit/);
  assert.match(GROUPS, /const trigger=document\.createElement\('button'\);/);
  assert.match(GROUPS, /trigger\.setAttribute\('aria-expanded','false'\)/);
  assert.match(GROUPS, /trigger\.setAttribute\('aria-controls',menuId\)/);
  assert.match(GROUPS, /function setKpiGroupOpen\(group,open\)/);
  assert.match(DESIGN, /\.kpiGroup\.open>\.kpiGroupMenu\{display:flex;\}/);
});


test('Collection quick-filter settings button is the first item in the strip', () => {
  const renderStart = APP.indexOf('function renderKolQuickFilters()');
  const renderEnd = APP.indexOf('// ================= PRICING PREFLIGHT =================', renderStart);
  const render = APP.slice(renderStart, renderEnd);
  const settingsAt = render.indexOf('id="kolQuickFiltersEdit"');
  const groupsAt = render.indexOf('loadKolQuickDims().forEach');
  assert.ok(settingsAt > -1 && groupsAt > -1 && settingsAt < groupsAt,
    'Collection ayar düğmesi hızlı filtre gruplarından önce oluşturulmalı');
  assert.doesNotMatch(render, /html \+= `<button[^>]+id="kolQuickFiltersEdit"/,
    'ayar düğmesi şeridin sonuna eklenmemeli');
  assert.match(CSS, /\.kpiGroupEdit\{[^}]*order:-1000[^}]*margin:0 4px 0 0/,
    'ortak CSS tüm hızlı filtre ayar düğmelerini solda tutmalı');
});

test('Collection quick filter colors follow CP selection and the collection status catalog', () => {
  const renderStart=APP.indexOf('function renderKolQuickFilters()');
  const renderEnd=APP.indexOf('// ================= PRICING PREFLIGHT =================',renderStart);
  const render=APP.slice(renderStart,renderEnd);
  assert.match(render, /const tone=dim\.key==='inStoreMonth'\?'blue':'gray'/);
  assert.match(render, /const statusSnapshot=quickDims\.some\(dim=>dim\.key==='durum'\)\?kolStatusRenderSnapshot\(\):null/);
  assert.match(render, /const statusStyle=dim\.key==='durum'\?/);
  assert.match(render, /statusSnapshot\.color\(val\)/);
  assert.match(CSS, /#kolQuickFilters \.kpi\[data-kolq-key="durum"\]:not\(\.active\) \.n\{color:var\(--kol-quick-status,var\(--ui-text-secondary\)\)!important;\}/);
  assert.match(CSS, /\.kpi\.active::after\{content:'✓';\}/);
});
