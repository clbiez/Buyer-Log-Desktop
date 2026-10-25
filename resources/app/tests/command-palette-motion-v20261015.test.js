'use strict';

/* Tasarım önerisi A (2026-10-15): komut paleti, kompakt ray ve KPI hareketi.
   - Ctrl+K mevcut "CP Tracker'da ara" kısayoludur; palet onu bozmaz, Ctrl+Shift+K ile açılır.
   - v7.26'da başlıktaki arama kutusu kullanıcı talebiyle kaldırıldı; palet görünür kutu eklemez.
   - Dar rayda etiketler üzerine gelince içeriği itmeden açılır.
   - KPI sayaçları özgün metne döner ve azaltılmış harekete uyar. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const PALETTE = read('command-palette.js');
const INDEX = read('index.html');
const APP_CSS = read('app.css');
const MOTION = read('kpi-motion.js');

test('Palet Ctrl+Shift+K ile açılır ve mevcut Ctrl+K CP aramasını korur', () => {
  assert.match(PALETTE, /root\.addEventListener\('keydown',event=>\{\s*if\(!\(event\.ctrlKey\|\|event\.metaKey\)\|\|event\.altKey\|\|!event\.shiftKey\)return;/);
  assert.match(PALETTE, /event\.preventDefault\(\);event\.stopImmediatePropagation\(\);/);
  assert.match(PALETTE, /\},true\);/, 'yakalama aşaması, eski Shift-duyarsız işleyiciden önce çalışmalı');
  assert.match(INDEX, /if\(\(e\.ctrlKey\|\|e\.metaKey\)&&e\.key\.toLowerCase\(\)==='k'\)\{ e\.preventDefault\(\); goCpSearch\(\); \}/);
  assert.match(PALETTE, /L\("CP Tracker'da ara \(Ctrl\+K\)",'Search in CP Tracker \(Ctrl\+K\)'\)/);
});

test('Palet görünür arama kutusu eklemez, katman sistemine ve overlay listesine kayıtlıdır', () => {
  assert.doesNotMatch(INDEX, /class="gsearch"/);
  assert.match(PALETTE, /BLLayerSystem\?\.openDialog\)root\.BLLayerSystem\.openDialog\(overlay,\{onClose:close,initialFocus:input\}\)/);
  assert.match(read('app-main.js'), /'\.blCmdOverlay', '\.blpOverlay',\n\]\.join\(','\);/, 'yazınca-ara kısayolu palet açıkken tuşları çalmamalı');
  assert.match(INDEX, /<script src="command-palette\.js\?v=__BL_ASSET_VERSION__&rev=1"><\/script>/);
  assert.match(INDEX, /<link rel="stylesheet" href="command-palette\.css\?v=__BL_ASSET_VERSION__&rev=1">/);
});

test('Palet araması Türkçe karakterlerden bağımsız eşleşir ve önce baş eşleşmeyi gösterir', () => {
  const doc = { documentElement: { lang: 'tr' }, querySelectorAll: () => [], addEventListener() {}, getElementById: () => null };
  const sandbox = { window: null, globalThis: null, document: doc, console };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.addEventListener = () => {}; sandbox.setTimeout = () => 0;
  vm.runInNewContext(PALETTE, sandbox);
  const fns = PALETTE.slice(PALETTE.indexOf('const fold='), PALETTE.indexOf('let overlay='));
  const scoreSrc = PALETTE.slice(PALETTE.indexOf('function score'), PALETTE.indexOf('function render'));
  const api = vm.runInNewContext(`${fns}${scoreSrc};({fold,score})`, {});
  assert.equal(api.fold('Fiyat Geçmişi'), 'fiyat gecmisi');
  assert.ok(api.score({ label: 'Fiyat Geçmişi', keywords: '' }, api.fold('fiy')) > api.score({ label: 'Üretici fiyat', keywords: '' }, api.fold('fiy')));
  assert.equal(api.score({ label: 'Backlog', keywords: 'rapor' }, api.fold('ciz')), 0);
  assert.ok(typeof sandbox.BLCommandPalette.open === 'function');
});

test('Dar ray üzerine gelince tam genişlikte, içeriği itmeden açılır', () => {
  assert.match(APP_CSS, /html\[data-rail="min"\] \.rail:is\(:hover,:focus-within\)\{width:var\(--ui-rail-expanded-width\);/);
  const shared=require('./helpers/manifest-css')(['ui-tokens.css','app.css','design.css','experience.css','ui-components.css'] );
  require('./helpers/manifest-css').assertReset();
  assert.doesNotMatch(shared,/transition:width/);
  for (const [preset, width] of [['compact', '196px'], ['standard', '208px'], ['large', '224px'], ['xl', '240px']]) {
    assert.match(shared, new RegExp(`:root\\[data-ui-scale="${preset}"\\]\\{[^}]*--ui-rail-expanded-width:${width};`));
  }
  assert.match(shared, /:root\[data-ui-scale\]\[data-rail="min"\]\{--ui-rail-width:var\(--ui-rail-collapsed-width\);\}/, 'gövde boşluğu dar genişlikte kalır');
});

test('KPI sayacı özgün metne döner, yeniden çizimde durur ve azaltılmış harekete uyar', () => {
  assert.match(MOTION, /if\(t>=1\)\{el\.textContent=original;return;\}/);
  assert.match(MOTION, /if\(last!==null&&el\.textContent!==last\)return;/);
  assert.match(MOTION, /prefers-reduced-motion: reduce/);
  const parseSrc = MOTION.slice(MOTION.indexOf('function parse'), MOTION.indexOf('function animate'));
  const { parse, format } = vm.runInNewContext(`${parseSrc};({parse,format})`, {});
  for (const text of ['726.300', '%21,8', '$8,66', '515.200 adet', '1.250.600 adet', '12']) {
    const parsed = parse(text);
    assert.ok(parsed, text);
    assert.equal(format(parsed, parsed.value), text);
  }
  assert.equal(parse('0'), null);
  assert.equal(parse('—'), null);
});
