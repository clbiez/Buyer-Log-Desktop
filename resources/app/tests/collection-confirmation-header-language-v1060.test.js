'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.60 Koleksiyon onay sütunlarının açıklaması aktif dilde kalır', () => {
  const renderStart = APP.indexOf('function renderKol()');
  const renderEnd = APP.indexOf('thead.querySelectorAll', renderStart);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(render, /const confirmedPriceFilterHint=appLang==='en'\?'Set with the approval check in the price cell':'Fiyat hücresindeki onay tikiyle belirlenir';/);
  assert.match(render, /d\.kind==='confirmedName'[\s\S]*?title="\$\{escapeHtml\(confirmedPriceFilterHint\)\}"/);
  assert.match(render, /d\.kind==='confirmedPrice'\) return `<th data-kcol="\$\{d\.k\}" title="\$\{escapeHtml\(confirmedPriceFilterHint\)\}"/);
  assert.doesNotMatch(render, /L\('Fiyat hücresindeki onay tikiyle belirlenir'\)/);
});
