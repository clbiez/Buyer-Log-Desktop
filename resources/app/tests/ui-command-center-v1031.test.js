'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const APP = read('public/app-main.js');
const CSS = read('public/app.css');
const INDEX = read('public/index.html');

test('v10.31 ortak durum bileşeni güvenli, erişilebilir ve eylem desteklidir', () => {
  const UI = require('../public/ui-primitives.js');
  const html = UI.stateView({
    kind: 'error',
    title: '<script>alert(1)</script>',
    detail: 'Tekrar deneyin',
    actionLabel: 'Yenile',
  });
  assert.match(html, /class="uiState uiState--error"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /data-ui-state-action/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(INDEX, /ui-primitives\.js\?v=__BL_ASSET_VERSION__&rev=[A-Za-z0-9._-]+/);
});

test('v10.31 Overview yükleme, uyarı ve boş durumlarını ortak bileşenle üretir', () => {
  assert.match(INDEX, /class="uiState uiState--loading"/);
  assert.match(APP, /window\.BLUI\?\.renderState/);
  assert.match(APP, /kind:'warning'/);
  assert.match(APP, /kind:'empty'/);
  assert.match(INDEX, /id="topRefreshBtn"/);
});

test('v10.70 kullanıcı istemediği komuta merkezi Overview yüzeyini üretmez', () => {
  assert.doesNotMatch(INDEX, /id="ovCommandCenter"/);
  assert.doesNotMatch(APP, /function renderOverviewCommandCenter\(/);
  assert.doesNotMatch(APP, /renderOverviewCommandCenter\(/);
});

test('v10.70 komuta merkezi kaldırılırken Overview veri çizimi diğer modülleri korur', () => {
  assert.match(APP, /renderOverviewPriorityReminder\(cpRows\)/);
  assert.match(APP, /renderOverviewCollectionSummary\(\)/);
  assert.doesNotMatch(APP, /const empty=document\.getElementById\('ovEmpty'\),content=document\.getElementById\('ovContent'\),notesReminder=document\.getElementById\('ovPriorityReminder'\),commandCenter=document\.getElementById\('ovCommandCenter'\)/);
});

test('v10.70 komuta merkezi kaldırılırken kullanılmayan stiller de bırakılmaz', () => {
  assert.doesNotMatch(CSS, /\.ovCommand(?:Center|Header|Layout|Focus|Kpi|Actions|Primary|Health)/);
  assert.match(CSS, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(CSS, /\.uiState:focus-within/);
});
