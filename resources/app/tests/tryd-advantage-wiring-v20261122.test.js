'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'public', file), 'utf8');

test('TR/YD widget kaydı: Ticari grubunda, varsayılan Ticari sayfasında, TR/EN adıyla', () => {
  const layout = read('overview-layout.js');
  assert.match(layout, /trydAdvantage:\{icon:'coins',group:'commercial',tr:'TR\/YD Landed Avantaj',en:'TR\/YD Landed Advantage'/);
  assert.match(layout, /\{key:'trydAdvantage',x:0,y:22,w:12,h:9\}/);
  const home = read('overview-home.js');
  assert.match(home, /entry\.item\.key==='trydAdvantage'\)entry\.height=pivotContentHeight/);
  assert.match(home, /#trydAdvantageSection > \*'\)\.forEach\(el=>pivotResize\.observe\(el\)\)/);
});

test('TR/YD widget tembel yüklenir: betik Genel Bakış\'ta, sunucu isteği yalnız görünürken', () => {
  const main = read('app-main.js');
  assert.match(main, /if\(tab==='overview'\)void ensureOverviewTrydAdvantageModule\(\);/);
  assert.match(main, /loader\('tryd-advantage-engine\.js\?rev=\d+'\)\s*\.then\(\(\)=>loader\('tryd-advantage\.js\?rev=\d+'\)\)/);
  const widget = read('tryd-advantage.js');
  assert.match(widget, /new IntersectionObserver/);
  const boot = widget.slice(widget.indexOf('bind();\n  render();'), widget.indexOf('window.BLTrydAdvantage = '));
  assert.match(boot, /startWhenVisible\(\);/);
  assert.doesNotMatch(boot, /refresh\(/, 'açılışta canlı sorgu yok');
  assert.match(widget, /\/api\/postfob\/tryd\/state/);
  assert.doesNotMatch(widget, /\/api\/postfob\/report/, 'FOB Sonrası görünümünü değiştiren uç kullanılmaz');
});

test('TR/YD widget HTML: OAB/INTAKE başlık yapısı, TR/EN etiketleri ve Excel/filtre/katlama eylemleri', () => {
  const html = read('index.html');
  const start = html.indexOf('<div id="trydAdvantageSection"');
  assert.ok(start > 0);
  const block = html.slice(start, html.indexOf('id="trydAdvantageTable"', start));
  assert.match(block, /data-overview-widget="trydAdvantage"/);
  assert.match(block, /class="intakeHeader"/);
  for (const id of ['trydAdvantageRefreshBtn', 'trydAdvantageFiltersBtn', 'trydAdvantageCollapseAllBtn', 'trydAdvantageExpandAllBtn', 'trydAdvantageExcelExportBtn', 'trydAdvantageTarget', 'trydAdvantageLandedSource', 'trydAdvantageBelowOnly']) assert.match(block, new RegExp(`id="${id}"`));
  assert.match(block, /data-i18n-tr="TR\/YD Landed Avantaj" data-i18n-en="TR\/YD Landed Advantage"/);
  assert.match(block, /data-i18n-tr="Yalnız hedef altı" data-i18n-en="Below target only"/);
});
