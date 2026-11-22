'use strict';
/* Açılır filtre panelleri pencerenin altına taşmamalı: liste ve Uygula
   düğmesi her zaman görünür kalır (Genel Bakış · TR/YD Landed Avantaj vb.). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const placement = require('../public/floating-placement.js');

const viewport = { width: 1900, height: 1150 };
const rectAt = (top, left = 1040, height = 28, width = 260) => ({ top, bottom: top + height, left, right: left + width, width, height });

test('alta sığmayan panel tetikleyicinin üstüne açılır (ekran görüntüsündeki senaryo)', () => {
  const anchor = rectAt(960);
  const result = placement.compute({ anchor, size: { width: 300, height: 420 }, viewport });
  assert.equal(result.side, 'above');
  assert.equal(result.maxHeight, null);
  assert.equal(result.top + 420 + placement.GAP, anchor.top);
  assert.ok(result.top >= placement.MARGIN);
});

test('altta yer varsa alta açılır ve yükseklik sınırlanmaz', () => {
  const anchor = rectAt(200);
  const result = placement.compute({ anchor, size: { width: 300, height: 420 }, viewport });
  assert.equal(result.side, 'below');
  assert.equal(result.top, anchor.bottom + placement.GAP);
  assert.equal(result.maxHeight, null);
});

test('iki tarafta da sığmayan panel geniş tarafa sınırlanır, pencere dışına taşmaz', () => {
  const small = { width: 1200, height: 600 };
  const anchor = rectAt(250);
  const result = placement.compute({ anchor, size: { width: 300, height: 900 }, viewport: small });
  assert.equal(result.side, 'below');
  assert.ok(result.maxHeight > 0);
  assert.ok(result.top + result.maxHeight <= small.height - placement.MARGIN);
});

test('hiçbir tarafta kullanılabilir alan yoksa panel pencere içinde kalır', () => {
  const tiny = { width: 800, height: 320 };
  const anchor = { top: 140, bottom: 170, left: 10, right: 60, width: 50, height: 30 };
  const result = placement.compute({ anchor, size: { width: 300, height: 500 }, viewport: tiny });
  assert.equal(result.side, 'overlap');
  assert.ok(result.top >= placement.MARGIN);
  assert.ok(result.top + result.maxHeight <= tiny.height - placement.MARGIN);
});

test('açık panel arama ile küçülünce taraf değiştirmez; yatayda pencere içinde kalır', () => {
  const anchor = rectAt(600, 1800);
  const result = placement.compute({ anchor, size: { width: 300, height: 120 }, viewport, prefer: 'above' });
  assert.equal(result.side, 'above');
  assert.equal(result.left, viewport.width - placement.MARGIN - 300);
});

function harness() {
  const observers = [];
  const listeners = {};
  const panel = {
    isConnected: true, style: {}, dataset: {}, offsetWidth: 300, naturalHeight: 60,
    get offsetHeight() { return this.naturalHeight; }
  };
  const anchor = { isConnected: true, getBoundingClientRect: () => rectAt(960) };
  const root = {
    innerWidth: viewport.width, innerHeight: viewport.height,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(entry => entry !== fn); },
    ResizeObserver: class { constructor(fn) { this.fn = fn; this.active = true; observers.push(this); } observe() {} disconnect() { this.active = false; } }
  };
  const sandbox = { window: root, WeakMap };
  vm.runInNewContext(read('floating-placement.js'), sandbox);
  return { api: root.BLFloatingPlacement, panel, anchor, observers, listeners };
}

test('değerler yüklenip panel büyüyünce yeniden konumlanır (kök neden: ilk ölçüm "Yükleniyor…" yüksekliğiydi)', () => {
  const { api, panel, anchor, observers, listeners } = harness();
  api.place(panel, anchor);
  assert.equal(panel.dataset.placement, 'below');
  assert.equal(panel.style.top, `${960 + 28 + placement.GAP}px`);
  panel.naturalHeight = 420;
  observers[0].fn();
  assert.equal(panel.dataset.placement, 'above');
  assert.equal(parseFloat(panel.style.top) + 420 + placement.GAP, 960);
  panel.isConnected = false;
  observers[0].fn();
  assert.equal(observers[0].active, false, 'kapanan panelin gözlemcisi bırakılır');
  assert.equal((listeners.resize || []).length, 0, 'resize dinleyicisi sızmaz');
});

test('filtre popover ve sütun filtre panelleri ortak yerleştiriciyi kullanır', () => {
  assert.match(read('index.html'), /<script src="floating-placement\.js\?v=__BL_ASSET_VERSION__"><\/script>/);
  for (const file of ['intake.js', 'oab-cube.js', 'postfob.js', 'tryd-advantage.js', 'quotations.js', 'oab.js']) {
    assert.match(read(file), /BLFloatingPlacement\?\.place\(/, file);
  }
  for (const file of ['intake.js', 'oab-cube.js', 'postfob.js', 'tryd-advantage.js']) {
    assert.doesNotMatch(read(file), /popover\.style\.top\s*=/, `${file}: popover elle konumlanmamalı`);
  }
  const appMain = read('app-main.js');
  const kolPanels = appMain.match(/panel\.className = 'colFilterPanel kolColFilterPanel';[\s\S]{0,400}?BLFloatingPlacement\?\.place\(panel, anchorEl/g) || [];
  assert.equal(kolPanels.length, 2, 'Koleksiyon sütun filtre panelleri');
  const css = read('app.css');
  assert.match(css, /\.intakeFilterPopover\{[^}]*display:flex;flex-direction:column;[^}]*\}/);
  assert.match(css, /\.intakeFilterPopover>\.intakeFilterValues\{flex:0 1 auto;min-height:72px;\}/);
});
