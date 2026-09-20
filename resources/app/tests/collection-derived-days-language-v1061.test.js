'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.61 Koleksiyon türetilen gün hücresi seçili dili kullanır', () => {
  const renderStart = APP.indexOf('function renderKol()');
  const renderEnd = APP.indexOf('\nfunction ', renderStart + 1);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(render, /const exToRetailTitle=appLang==='en'\?'Calculated automatically \(Retail − Ex-Factory\)':'Otomatik hesaplanır \(Retail − Ex-Factory\)'/);
  assert.match(render, /const exToRetailDisplay=days===''\?'—':days\+\(appLang==='en'\?' d\.':' g\.'\);/);
  assert.match(render, /title="\$\{escapeHtml\(exToRetailTitle\)\}"[^>]*>\$\{exToRetailDisplay\}</);
  assert.doesNotMatch(render, /title="Otomatik hesaplanır \(Retail − Ex-Factory\)"/);
});
