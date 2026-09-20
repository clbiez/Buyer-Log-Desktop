'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8');

test('v10.65 Overview Collection Summary durum etiketlerini seçili dilde gösterir', () => {
  const labelStart = APP.indexOf('function overviewCollectionSummaryFilterLabel(');
  const labelEnd = APP.indexOf('\nfunction ', labelStart + 1);
  const label = APP.slice(labelStart, labelEnd);
  const filterStart = APP.indexOf('function overviewCollectionSummaryRenderFilter(');
  const filterEnd = APP.indexOf('\nfunction ', filterStart + 1);
  const filter = APP.slice(filterStart, filterEnd);
  const renderStart = APP.indexOf('function renderOverviewCollectionSummary(');
  const renderEnd = APP.indexOf('\nfunction ', renderStart + 1);
  const render = APP.slice(renderStart, renderEnd);

  assert.match(label, /return kind==='statuses'\?L\(selected\[0\]\):selected\[0\];/);
  assert.match(filter, /const displayValue=kind==='statuses'\?L\(value\):value;/);
  assert.match(filter, /<span>\$\{escapeHtml\(displayValue\)\}<\/span>/);
  assert.match(render, /index===statusIndex\?`<button[^>]*>\$\{escapeHtml\(L\(value\)\)\}<\/button>`:escapeHtml\(value\)/);
});
