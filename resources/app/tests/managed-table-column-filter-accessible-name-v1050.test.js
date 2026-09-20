'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.50 CP ve Orders sütun filtreleri, filtre eylemini ve sütun adını birlikte bildirir', () => {
  const renderStart = APP.indexOf('function renderFullTable(');
  const renderEnd = APP.indexOf('function renderColumns(', renderStart);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(render, /const filterLabel=appLang==='en'\?`Filter: \$\{columnLabel\}`:`Filtrele: \$\{columnLabel\}`;/);
  assert.match(render, /class="thFilterBtn\$\{active\}"[^>]*aria-label="\$\{escapeHtml\(filterLabel\)\}"/);
  assert.match(render, /const checkFilterLabel=appLang==='en'\?'Filter by checked rows':'İşaretlenenlere göre filtrele';/);
  assert.match(render, /class="thFilterBtn chkFilterBtn\$\{checkFilterActive\?' filterActive':''\}"[^>]*aria-label="\$\{escapeHtml\(checkFilterLabel\)\}"/);
});
