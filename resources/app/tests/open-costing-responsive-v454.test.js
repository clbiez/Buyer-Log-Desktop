'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'open-costing.css'), 'utf8');
const JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'open-costing.js'), 'utf8');
const HTML = (fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'public', 'app-main.js'), 'utf8'));

test('v4.54 Open Costing uses the available page width instead of a fixed two-thirds width', () => {
  assert.match(CSS, /#view-opencosting \.ocToolbar,[\s\S]*?#view-opencosting \.ocShell\{[\s\S]*?width:100%;[\s\S]*?max-width:1600px;/);
  assert.doesNotMatch(CSS, /66\.6667%/, 'legacy two-thirds width must be removed');
});

test('v4.54 cost tables keep a readable minimum width and scroll only inside their wrapper', () => {
  assert.match(CSS, /#view-opencosting \.ocTableWrap\{[\s\S]*?overflow-x:auto;/);
  assert.match(CSS, /#view-opencosting \.ocCostTable\{[\s\S]*?min-width:990px;/);
  assert.match(CSS, /overscroll-behavior-inline:contain/);
  assert.match(CSS, /scrollbar-gutter:stable/);
});

test('v4.54 costing columns use stable semantic classes instead of shrinking percentages', () => {
  for (const name of ['ocColItem', 'ocColDetails', 'ocColUnit', 'ocColQty', 'ocColUnitPrice', 'ocColCurrency', 'ocColWaste', 'ocColTotal', 'ocColDelete']) {
    assert.ok(JS.includes(`class="${name}"`), `${name} must exist in generated colgroup`);
    assert.ok(CSS.includes(`.${name}{width:`), `${name} must have a CSS width`);
  }
  assert.doesNotMatch(JS, /<col style="width:16%">/, 'legacy percentage colgroup must be removed');
});

test('v4.54 progressively stacks summary, sidebar and metadata before controls overlap', () => {
  assert.match(CSS, /@container open-costing-view \(max-width:1500px\)[\s\S]*?\.ocContentGrid\{grid-template-columns:minmax\(0,1fr\);/);
  assert.match(CSS, /@container open-costing-view \(max-width:1080px\)[\s\S]*?\.ocShell\{grid-template-columns:minmax\(0,1fr\);/);
  assert.match(CSS, /@container open-costing-view \(max-width:820px\)[\s\S]*?\.ocMetaGrid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
  assert.match(CSS, /@container open-costing-view \(max-width:560px\)[\s\S]*?\.ocMetaGrid\{grid-template-columns:minmax\(0,1fr\);/);
});

test('v4.54 section headings and totals can reflow without painting over each other', () => {
  assert.match(CSS, /\.ocCostSection>summary>span:first-of-type\{[\s\S]*?flex-wrap:wrap;/);
  assert.match(CSS, /\.ocSectionTotal\{[\s\S]*?white-space:nowrap;[\s\S]*?text-overflow:ellipsis;/);
  assert.match(CSS, /\.ocCostSectionName,[\s\S]*?\.ocCostSectionHint\{[\s\S]*?overflow-wrap:anywhere;/);
});

test('v4.54 Open Costing stylesheet is cache-busted from the main page', () => {
  // v5.00: ana sürüm sabit yazılmıştı; testin amacı sürümün SABİT OLMASI değil,
  // stil dosyasının sürüm etiketiyle önbellek kırmasıdır.
  assert.match(HTML, /open-costing\.css\?v=__BL_ASSET_VERSION__/);
});
