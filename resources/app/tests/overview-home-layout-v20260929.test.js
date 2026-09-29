'use strict';

/* Genel Bakış ana ekranı (Android modeli): saf yerleşim motoru ve DOM
   denetleyicisinin sözleşmesi. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../public/overview-layout.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const HOME = fs.readFileSync(path.join(ROOT, 'public', 'overview-home.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'overview-home.css'), 'utf8');
const STORAGE = fs.readFileSync(path.join(ROOT, 'public', 'user-storage.js'), 'utf8');

const noOverlap = items => {
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    assert.equal(L.overlaps(items[i], items[j]), false, `${items[i].key} ↔ ${items[j].key}`);
  }
};
const item = (state, key) => L.locate(state, key)?.item;

test('varsayılan ana ekran: iki sayfa, her widget tek kez, çakışmasız ve ızgara içinde', () => {
  const state = L.defaults();
  assert.equal(state.version, 2);
  assert.equal(state.pages.length, 2);
  const keys = state.pages.flatMap(page => page.items.map(i => i.key));
  assert.deepEqual([...keys].sort(), [...L.widgets].sort());
  state.pages.forEach(page => {
    noOverlap(page.items);
    page.items.forEach(i => { assert.ok(i.x >= 0 && i.x + i.w <= L.COLS); const s = L.spec(i.key); assert.ok(i.w >= s.minW && i.h >= s.minH); });
  });
  assert.deepEqual(L.normalize(null), state);
});

test('normalize bilinmeyen widget\'ı atar, boyutu sözleşmeye kıstırır, bozuk çakışmayı çözer', () => {
  const state = L.normalize({ version: 2, known: L.widgets, pages: [{ items: [
    { key: 'unknown', x: 0, y: 0, w: 4, h: 4 },
    { key: 'oab', x: 10, y: 0, w: 1, h: 99 },
    { key: 'notes', x: 0, y: 0, w: 4, h: 4 },
    { key: 'notes', x: 5, y: 5, w: 4, h: 4 },
  ] }] });
  const oab = item(state, 'oab');
  assert.equal(oab.w, L.spec('oab').minW);
  assert.equal(oab.h, L.spec('oab').maxH);
  assert.ok(oab.x + oab.w <= L.COLS);
  assert.equal(state.pages[0].items.filter(i => i.key === 'notes').length, 1);
  noOverlap(state.pages[0].items);
  assert.equal(L.locate(state, 'unknown'), null);
});

test('kaldırılan widget gizli kalır; sonradan eklenen yeni widget ilk sayfaya kendiliğinden gelir', () => {
  let state = L.removeWidget(L.defaults(), 'notes');
  state = L.normalize(JSON.parse(JSON.stringify(state)));
  assert.equal(L.locate(state, 'notes'), null);
  assert.ok(L.hiddenWidgets(state).includes('notes'));
  const older = L.normalize({ version: 2, known: L.widgets.filter(k => k !== 'breakdown'), pages: [{ items: [{ key: 'oab', x: 0, y: 0, w: 12, h: 8 }] }] });
  assert.equal(L.locate(older, 'breakdown').page, 0);
  noOverlap(older.pages[0].items);
});

test('taşıma: komşu widget önce aynı satırda yana kayarak yer açar, yer yoksa aşağı itilir', () => {
  const base = L.normalize({ version: 2, known: L.widgets, pages: [{ items: [
    { key: 'productionFocus', x: 0, y: 0, w: 8, h: 6 },
    { key: 'notes', x: 8, y: 0, w: 4, h: 6 },
    { key: 'oab', x: 0, y: 6, w: 12, h: 8 },
  ] }] });
  const swapped = L.moveWidget(base, 'notes', 0, 0);
  assert.deepEqual(item(swapped, 'notes'), { key: 'notes', x: 0, y: 0, w: 4, h: 6 });
  assert.equal(item(swapped, 'productionFocus').x, 4);
  assert.equal(item(swapped, 'productionFocus').y, 0);
  const pushed = L.moveWidget(base, 'oab', 0, 0);
  assert.equal(item(pushed, 'oab').y, 0);
  assert.ok(item(pushed, 'productionFocus').y >= 8);
  noOverlap(pushed.pages[0].items);
});

test('boyutlandırma min/max sözleşmesine uyar ve çakışanları iter', () => {
  const base = L.defaults();
  const tiny = L.resizeWidget(base, 'breakdown', { w: 1, h: 1 });
  assert.equal(item(tiny, 'breakdown').w, L.spec('breakdown').minW);
  assert.equal(item(tiny, 'breakdown').h, L.spec('breakdown').minH);
  const wide = L.resizeWidget(base, 'breakdown', { w: 12 });
  assert.equal(item(wide, 'breakdown').w, 12);
  noOverlap(wide.pages[wide.page].items);
});

test('ilk uygun yer, boşluk kapatma ve boyut sınıfı', () => {
  assert.deepEqual(L.firstFit([{ key: 'a', x: 0, y: 0, w: 6, h: 3 }], 6, 3), { x: 6, y: 0 });
  assert.deepEqual(L.firstFit([{ key: 'a', x: 0, y: 0, w: 12, h: 3 }], 4, 2), { x: 0, y: 3 });
  const compacted = L.compact([{ key: 'a', x: 0, y: 4, w: 6, h: 2 }, { key: 'b', x: 6, y: 9, w: 6, h: 2 }]);
  assert.deepEqual(compacted.map(i => i.y), [0, 0]);
  assert.deepEqual(L.sizeClass({ w: 3, h: 2 }), { w: 's', h: 's' });
  assert.deepEqual(L.sizeClass({ w: 12, h: 9 }), { w: 'xl', h: 'xl' });
});

test('sayfalar: widget başka sayfaya gönderilir, dolu sayfa silinmez, boş sayfa silinir, en fazla MAX_PAGES', () => {
  let state = L.defaults();
  state = L.sendToPage(state, 'notes', 1);
  assert.equal(L.locate(state, 'notes').page, 1);
  noOverlap(state.pages[1].items);
  assert.equal(L.removePage(state, 1).pages.length, 2, 'dolu sayfa silinmez');
  state = L.addPage(state);
  assert.equal(state.pages.length, 3);
  assert.equal(state.page, 2);
  assert.equal(L.removePage(state, 2).pages.length, 2);
  for (let i = 0; i < 10; i++) state = L.addPage(state);
  assert.equal(state.pages.length, L.MAX_PAGES);
  assert.equal(L.pageName(L.renamePage(state, 0, 'Sabah').pages[0], 0, 'tr'), 'Sabah');
  assert.equal(L.pageName({ name: null }, 3, 'en'), 'Page 4');
});

test('v1 kaydı tek sayfaya akış sırası ve genişlik/yükseklikle taşınır', () => {
  const state = L.normalize({ order: ['oab', 'notes', 'collectionSummary', 'launchpad', 'globalFlowMap', 'intake', 'overviewContent'], hidden: ['intake'], widths: { notes: 'half', collectionSummary: 'half' }, heights: { oab: 600 } });
  assert.equal(state.pages.length, 1);
  const items = state.pages[0].items;
  noOverlap(items);
  assert.equal(items[0].key, 'oab');
  assert.equal(item(state, 'oab').h, Math.round((600 + 16) / (64 + 16)));
  assert.equal(item(state, 'notes').w, 6);
  assert.equal(item(state, 'collectionSummary').x, 6, 'yarım genişlikler yan yana dizilir');
  assert.equal(L.locate(state, 'intake'), null, 'v1 gizli modül gizli kalır');
});

test('ana ekran DOM kancaları ve denetleyici sözleşmesi', () => {
  for (const id of ['ovDashboardGrid', 'ovHomePager', 'ovHomeDots', 'ovLayoutEditBtn', 'ovLayoutEditPanel', 'ovHomeAddWidgetBtn', 'ovHomeCompactBtn', 'ovHomeAddPageBtn', 'ovHomeRemovePageBtn', 'ovLayoutResetBtn', 'ovLayoutDoneBtn']) {
    assert.match(INDEX, new RegExp(`id="${id}"`), id);
  }
  for (const key of L.widgets) assert.match(INDEX, new RegExp(`data-overview-widget="${key}"`), key);
  assert.match(INDEX, /overview-home\.js/);
  assert.match(INDEX, /overview-home\.css/);
  assert.match(HOME, /STORAGE_KEY='buyerlog\.overview\.layout\.v2'/);
  assert.match(HOME, /LEGACY_KEY='buyerlog\.overview\.layout\.v1'/);
  assert.match(STORAGE, /'buyerlog\.overview\.layout\.'/, 'yerleşim kullanıcı-kapsamlı saklanır');
  assert.match(HOME, /LONG_PRESS_MS=\d+/);
  assert.match(HOME, /EDGE_DWELL_MS=\d+/);
  assert.match(HOME, /ovHomeDropRemove/);
  assert.match(HOME, /data-home-resize/);
  assert.match(HOME, /event\.shiftKey\)commit\(L\.resizeWidget/);
  assert.match(HOME, /event\.key==='Delete'/);
  assert.match(HOME, /openDrawer/);
  // İçerik düzenleme sırasında etkileşimsizdir; kalkan ayrı ızgara öğesidir.
  assert.match(CSS, /\.ovHome\.isEditing>\[data-overview-widget\]\{pointer-events:none;\}/);
});

test('widget\'lar boyutlarına uyar: boyut kapsayıcısı, kaydırılan gövde ve dar pencere düzeni', () => {
  assert.match(CSS, /\.ovHome>\[data-overview-widget\]\{[^}]*container:ovw \/ size/);
  assert.match(CSS, /grid-template-rows:repeat\(var\(--ov-rows\),var\(--ov-row\)\)/);
  assert.match(CSS, /@container ovw \(max-width:860px\)\{\.ovLaunchBody/);
  assert.match(CSS, /\.ovHome>#globalFlowMapWidget \.globalFlowCanvasWrap\{height:100%/);
  assert.match(CSS, /\.ovHome>#oabSection \.oabTableWrap/);
  assert.match(CSS, /@media\(max-width:900px\)\{\s*\.ovHome\{grid-template-columns:minmax\(0,1fr\)/);
  // Dünya saati kartları kaldırılan radar stil sayfasından buraya taşındı.
  assert.match(CSS, /\.ovClockCard\{/);
});
