'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.css'), 'utf8');
const GROUPS = fs.readFileSync(path.join(__dirname, '..', 'public', 'kpi-groups.js'), 'utf8');
const DESIGN = fs.readFileSync(path.join(__dirname, '..', 'public', 'design.css'), 'utf8');

test('v10.49 Collection quick filters are keyboard-operable toggle buttons with a clear state', () => {
  const renderStart = APP.indexOf('function renderKolQuickFilters()');
  const renderEnd = APP.indexOf('// ================= LFL TRIAL KOPRUSU =================', renderStart);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(render, /<button type="button" class="kpi tone-blue\$\{active\?' active':''\}"[^>]*aria-pressed="\$\{active\?'true':'false'\}"[^>]*data-kolq-key=/);
  assert.doesNotMatch(render, /<div class="kpi tone-blue\$\{active\?' active':''\}" data-kolq-key=/);
  assert.match(CSS, /\.kpi:is\(button\)\{[^}]*font:inherit[^}]*color:inherit/);
  assert.match(GROUPS, /const trigger=document\.createElement\('button'\);/);
  assert.match(GROUPS, /trigger\.setAttribute\('aria-expanded','false'\)/);
  assert.match(GROUPS, /trigger\.setAttribute\('aria-controls',menuId\)/);
  assert.match(GROUPS, /function setKpiGroupOpen\(group,open\)/);
  assert.match(DESIGN, /\.kpiGroup\.open>\.kpiGroupMenu\{display:flex;\}/);
});
