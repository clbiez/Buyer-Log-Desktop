'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('sayfa Horizon şeritleri yoktur; veri filtresi ve boşluk rezervasyonu korunmadan kaldırılır', () => {
  const html = read('public/index.html');
  const experience = read('public/experience.css');
  const app = read('public/app-main.js');
  for (const id of [
    'intakeHorizonBadge', 'cpHorizonBadge', 'ordersHorizonBadge',
    'priceAnalysisHorizonBadge', 'lflHorizonBadge', 'backlogHorizonBadge',
  ]) {
    assert.doesNotMatch(html, new RegExp('id="' + id + '"'), id + ' sayfa DOM\'undan kaldırılmalı');
  }
  assert.doesNotMatch(html, /class="horizonBadge"/, 'sayfada herhangi bir Horizon şeridi kalmamalı');
  assert.doesNotMatch(experience, /#(?:cp|orders)HorizonBadge/,
    'CP/Orders KPI yerleşiminde kaldırılmış rozete boşluk ayrılmamalı');

  const start = app.indexOf('function renderHorizonBadges(){');
  assert.ok(start >= 0, 'mevcut güvenli render kancası korunmalı');
  const renderer = app.slice(start, app.indexOf('\nfunction sourceFilterNoticeText', start));
  assert.match(renderer, /document\.getElementById\(HORIZON_BADGE_IDS\[target\]\)/);
  assert.match(renderer, /if\(!el\)return;/, 'eksik DOM hedeflerinde renderer güvenle atlamalı');
  assert.match(read('server/lib/model-scopes.js'), /normalizeScopes/,
    'veri kapsamı hesaplama motoru korunmalı');
  assert.match(read('public/data-management-filter.js'), /horizon/i,
    'Horizon filtre ayarları Veri Yönetimi modülünde kalmalı');
});
