'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.48 Collection column filter buttons announce both the filter action and their column', () => {
  const renderStart = APP.indexOf('function renderKol()');
  const renderEnd = APP.indexOf('thead.querySelectorAll', renderStart);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(render, /const filterLabel=appLang==='en'\?`Filter: \$\{d\.label\}`:`Filtrele: \$\{d\.label\}`;/);
  assert.match(render, /class="thFilterBtn kolThFilterBtn\$\{active\}"[^>]*title="\$\{escapeHtml\(filterLabel\)\}"[^>]*aria-label="\$\{escapeHtml\(filterLabel\)\}"/);
  assert.match(render, /class="thFilterBtn kolSyntheticFilterBtn\$\{active\}"[^>]*aria-label="\$\{escapeHtml\(appLang==='en'\?`Filter: \$\{d\.label\}`:`Filtrele: \$\{d\.label\}`\)\}"/);
  assert.match(render, /class="thFilterBtn kolChkFilterBtn\$\{kolCheckActive\?' filterActive':''\}"[^>]*aria-label="\$\{escapeHtml\(appLang==='en'\?'Filter by checked rows':'İşaretlenenlere göre filtrele'\)\}"/);
});
