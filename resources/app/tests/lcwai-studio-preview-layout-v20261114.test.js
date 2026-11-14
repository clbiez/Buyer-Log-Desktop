'use strict';
// PowerPoint düzenleyici "Sunumu şekillendir": gerçek Buyer Log stil yığınında
// (app.css + design.css) önizleme görünür kalmalı; panel sınırı sürüklenebilir,
// birincil eylem alt barda sabit, oluşturulan dosya belirgin bantta.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pub = path.join(__dirname, '..', 'public');
const read = name => fs.readFileSync(path.join(pub, name), 'utf8');
const editor = read('lcwai-output-editor.js');
const assistantCss = read('lcwai-assistant.css');
const appCss = read('app.css');
const designCss = read('design.css');
const components = read('ui-components.css');

test('matrix preview pages are not <section> (app.css hides sections without an explicit display)', () => {
  assert.match(appCss, /section\{display:none;\}/, 'precondition: global section rule still exists');
  assert.doesNotMatch(editor, /<section class="lcwaiMatrixPage"/);
  assert.match(editor, /<div class="lcwaiMatrixPage" data-matrix-page=/);
});

test('slide card boxes stay absolutely positioned despite design.css .cardBox{position:relative}', () => {
  assert.match(designCss, /\.cardBox[^{]*\{position:relative;\}/, 'precondition: design.css rule still exists');
  assert.match(editor, /is-card cardBox/);
  assert.match(assistantCss, /\.lcwaiLayBox\.cardBox\{position:absolute\}/);
});

test('panel/preview divider is a keyboard-accessible separator with a remembered width', () => {
  assert.match(editor, /class="lcwaiLaySplit" role="separator" tabindex="0" aria-orientation="vertical"/);
  assert.match(editor, /ArrowLeft: -2, ArrowRight: 2/);
  assert.match(editor, /try \{ \(window\.BLStorage \|\| window\.localStorage\)\.setItem\(SPLIT_KEY/);
  assert.match(assistantCss, /grid-template-columns:minmax\(320px,var\(--lcwai-lay-split,44%\)\) 14px minmax\(320px,1fr\)/);
});

test('"Preview and create" lives in the fixed footer and the created file shows a prominent band', () => {
  const layout = editor.slice(editor.indexOf('function renderStudioLayout'), editor.indexOf('function renderStudioReview'));
  assert.doesNotMatch(layout, /data-ed-mode="review"/, 'button no longer at the bottom of the scrolling panel');
  const foot = editor.slice(editor.indexOf('function renderFoot'), editor.indexOf('async function renderFile') > 0 ? editor.indexOf('async function renderFile') : undefined);
  assert.match(foot, /isStudio\(\) && ed\.mode === 'layout'[^;]*data-ed-mode="review"/);
  assert.match(foot, /class="lcwaiEdResult" role="status"/);
  assert.match(foot, /lcwaiBtn is-primary" data-ed-open/);
  assert.match(foot, /BLMotionPlus\?\.play\('card'/);
  assert.match(components, /\.lcwaiEdFoot\.has-result\{background:var\(--ui-success-bg\)/);
});

test('matrix rows are compact and idle marks use soft tokens', () => {
  assert.match(assistantCss, /\.lcwaiMatrixHead\+\.lcwaiMatrixField,\.lcwaiMatrixField\+\.lcwaiMatrixField\{margin-top:-8px\}/);
  assert.match(components, /\.corporateConnectionDots i \{width:7px;height:7px;background:var\(--ui-row-divider\)/);
  assert.match(components, /\.corporateConnection::before \{content:"";width:7px;height:7px;flex:none;background:var\(--ui-row-divider\)/);
});
