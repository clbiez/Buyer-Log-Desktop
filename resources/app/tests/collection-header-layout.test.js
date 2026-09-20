'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

test('Collection izin kontrolü üst başlıkta, tablo akışının dışında durur', () => {
  const appTop = HTML.slice(HTML.indexOf('<header class="appTop">'), HTML.indexOf('</header>', HTML.indexOf('<header class="appTop">')));
  const collection = HTML.slice(HTML.indexOf('<section id="view-koleksiyon">'), HTML.indexOf('</section>', HTML.indexOf('<section id="view-koleksiyon">')));
  assert.match(appTop, /<h1 id="pageTitle"[\s\S]*<div class="kolScopeBar" id="kolScopeBar"/);
  assert.doesNotMatch(collection, /id="kolScopeBar"/);
});

test('Görünüm ve Yetkiler çubuğu yalnız Collection ekranında görünür', () => {
  assert.match(CSS, /body:not\(\[data-active-tab="koleksiyon"\]\) #kolScopeBar\{display:none!important;\}/);
});

test('Collection açıldığında Görünüm ve Yetkiler popoverı otomatik açılmaz', () => {
  assert.doesNotMatch(UI, /<details class="kolScopeDim kolScopeWorkspace hasSelection" open>/);
});

test('Collection üst başlığı tek satırda kalır ve izin popoverı akışı bozmaz', () => {
  assert.match(CSS, /body\[data-active-tab="koleksiyon"\] \.appTop\{[^}]*overflow:visible/);
  assert.match(CSS, /body\[data-active-tab="koleksiyon"\] \.appTop>#kolScopeBar\{[^}]*margin-right:auto/);
  assert.match(CSS, /body\[data-active-tab="koleksiyon"\] \.appTop>#kolScopeBar \.kolScopePanel\{[^}]*position:absolute/);
});

test('Collection izin popoverı dışarı tıklanınca kapanır', () => {
  assert.match(UI, /kolScopeOutsideClickBound/);
  assert.match(UI, /!event\.target\.closest\('#kolScopeBar'\)[\s\S]*details\.open=false/);
});
