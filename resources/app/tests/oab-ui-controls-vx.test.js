'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OAB_JS = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const APP_CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function loadOabJs() {
  const elements = {};
  function makeEl(id) {
    if (elements[id]) return elements[id];
    const listeners = {};
    const el = {
      id,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      dataset: {}, style: {},
      addEventListener(event, fn) { listeners[event] = listeners[event] || []; listeners[event].push(fn); },
      set innerHTML(value) { this._html = value; }, get innerHTML() { return this._html || ''; },
      querySelectorAll() { return []; }, querySelector() { return null; },
      appendChild() {}, insertAdjacentHTML() {},
      set hidden(value) { this._hidden = value; }, get hidden() { return this._hidden; },
    };
    elements[id] = el;
    return el;
  }
  const fakeDocument = {
    readyState: 'loading',
    getElementById: id => makeEl(id),
    querySelectorAll: () => [],
    addEventListener() {},
  };
  const fakeFetch = async () => ({ ok: true, json: async () => ({}) });
  const runner = new Function('window', 'document', 'fetch', 'showToast', 'appLang', 'globalThis', `${OAB_JS}\nreturn window;`);
  const window = runner({ BLTableSearch: { parseTerms: () => [], matches: () => true } }, fakeDocument, fakeFetch, () => {}, 'tr', {});
  return window;
}

test('OAB local filter field list supports adding and removing fields without duplicates', () => {
  const utils = loadOabJs().OABDataUtils;
  assert.deepEqual(
    utils.updateLocalFilterFields(['Klasman Tanımı', 'Line Tanımı'], 'add', 'Fit', ['Fit', 'Line Tanımı', 'Klasman Tanımı']),
    ['Klasman Tanımı', 'Line Tanımı', 'Fit'],
  );
  assert.deepEqual(
    utils.updateLocalFilterFields(['Klasman Tanımı', 'Line Tanımı'], 'add', 'Line Tanımı', ['Fit', 'Line Tanımı', 'Klasman Tanımı']),
    ['Klasman Tanımı', 'Line Tanımı'],
  );
  assert.deepEqual(
    utils.updateLocalFilterFields(['Klasman Tanımı', 'Line Tanımı'], 'remove', 'Klasman Tanımı', ['Fit', 'Line Tanımı', 'Klasman Tanımı']),
    ['Line Tanımı'],
  );
});

test('OAB local filter candidates come from the current report fields', () => {
  const utils = loadOabJs().OABDataUtils;
  assert.deepEqual(
    utils.availableLocalFilterFields(['Kaynak Alan', 'Kaynak Alan', '', null, 'Başka Alan']),
    ['Kaynak Alan', 'Başka Alan'],
  );
  assert.match(OAB_JS, /function oabAvailableLocalFilterFields/);
  assert.doesNotMatch(OAB_JS, /const OAB_LOCAL_FILTER_FIELDS = \[/);
});

test('OAB local filter bar exposes add/remove controls and uses the shared multi-select trigger', () => {
  const bar = OAB_JS.slice(OAB_JS.indexOf('function oabRenderLocalFilterBar'), OAB_JS.indexOf('function oabLocalFilterLabelText'));
  assert.match(bar, /data-oab-local-filter-add/);
  assert.match(bar, /data-oab-local-filter-remove/);
  assert.match(bar, /oabMultiTrigger/);
  assert.match(bar, /oabLocalFilterFields\(/);
  assert.match(bar, /data-oab-local-filter-add aria-haspopup="menu"\$\{usable\.length \? '' : ' disabled'\}/);
  const addPopover = OAB_JS.slice(OAB_JS.indexOf('function oabOpenLocalFilterFieldPopover'), OAB_JS.indexOf('function oabOpenMultiPopover'));
  assert.match(addPopover, /distinctValues\(field\)\.length > 0/);
  assert.match(addPopover, /oabLocalFilterAddEmpty/);
});

test('OAB view/export actions sit beside Cancel and collapse precedes expand', () => {
  const top = INDEX.slice(INDEX.indexOf('<div class="oabFilterBar">'), INDEX.indexOf('<!-- Maliyet', INDEX.indexOf('<div class="oabFilterBar">')));
  assert.ok(top.indexOf('id="oabCancelBtn"') < top.indexOf('data-oab-view="pivot"'));
  assert.ok(top.indexOf('data-oab-view="pivot"') < top.indexOf('id="oabExcelExportBtn"'));
  assert.ok(top.indexOf('id="oabCollapseAllBtn"') < top.indexOf('id="oabExpandAllBtn"'));
  assert.doesNotMatch(top, /data-i18n-tr="Season"/);
  assert.doesNotMatch(top, /data-i18n-tr="MAG"/);
  assert.doesNotMatch(top, /data-i18n-tr="Buyer Group"/);
  assert.match(top, /id="oabSeasonTrigger"[^>]*aria-label="Season"/);
  assert.match(top, /id="oabMagTrigger"[^>]*aria-label="MAG"/);
  assert.match(top, /id="oabBuyerGroupTrigger"[^>]*aria-label="Buyer Group"/);
});

test('OAB başlığı korunur, KPI satırı ve satır metası gösterilmez', () => {
  const header = INDEX.slice(INDEX.indexOf('<div class="oabHeader">'), INDEX.indexOf('<div class="oabAuthBar"'));
  assert.match(header, /data-i18n-tr="OAB"/);
  assert.doesNotMatch(header, /id="oabKpiRow"/);
  assert.doesNotMatch(INDEX, /class="oabViewMeta"/);
  assert.doesNotMatch(INDEX, /id="oabRowCount"/);
  assert.doesNotMatch(OAB_JS, /oabRenderRowCount\(\);/);
});

test('OAB table follows its content without a manual resize or nested scroll area', () => {
  assert.doesNotMatch(INDEX, /id="oabTableResizeHandle"/);
  assert.doesNotMatch(INDEX, /class="oabTableViewport"/);
  assert.doesNotMatch(OAB_JS, /function oabBindTableResize/);
  assert.doesNotMatch(OAB_JS, /OAB_TABLE_HEIGHT_PREF_KEY/);
  assert.doesNotMatch(OAB_JS, /oabTableHeightBounds|oabSetTableHeight/);
  assert.match(APP_CSS, /\.oabTableWrap\{[^}]*height:auto/);
  assert.match(APP_CSS, /\.oabTableWrap\{[^}]*max-height:none/);
  // v7.81 — korunan regression DİKEY davranıştır: manuel yükseklik tutamağı ve
  // ayrı bir dikey kaydırma alanı yok, yükseklik içeriğe göre. YATAY taşma ise
  // artık sayfayı değil tablo kabını kaydırır (çok sütunlu OAB tablosu).
  assert.match(APP_CSS, /\.oabTableWrap\{[^}]*overflow:auto[^}]*max-width:100%/);
  assert.match(APP_CSS, /#oabTable tbody tr\{[^}]*content-visibility:visible/);
  assert.doesNotMatch(APP_CSS, /row-resize/);
});

test('OAB top actions stay vertically aligned with the filter controls', () => {
  assert.match(APP_CSS, /\.oabViewTabs\.oabTopActions\{[^}]*margin:0/);
});
