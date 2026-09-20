'use strict';

// v5.80 — Navlun hesabında çoklu satır + landed çarpanı + varsayılan koli
// ölçüsü, ayrıca genel açılır pencere davranışı (ESC kademesi, kaydırma
// zincirlenmesi) ve Kopyala için CTRL+C kısayolu.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const freight = require('../public/freight-calc');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

const BASE = { kgPerPiece: 0.132, qtyPerCarton: 132, cartonL: 58, cartonH: 38, cartonW: 40 };

test('v5.80 varsayılan koli ölçüsü 58 × 38 × 30', () => {
  assert.deepEqual({ ...freight.DEFAULT_CARTON }, { cartonL: 58, cartonH: 38, cartonW: 30 });
  assert.deepEqual(freight.defaultSettings().carton, { cartonL: 58, cartonH: 38, cartonW: 30 });
  // Bozuk/eksik ölçü varsayılana döner; sıfır ya da negatif kenar kabul edilmez.
  const settings = freight.normalizeSettings({ carton: { cartonL: 0, cartonH: '45', cartonW: -3 } });
  assert.deepEqual(settings.carton, { cartonL: 58, cartonH: 45, cartonW: 30 });
});

test('v5.80 landed çarpanı varsayılan olarak 1, yani kaynak Excel’i değiştirmez', () => {
  const settings = freight.defaultSettings();
  assert.equal(settings.landedMultiplier, 1);
  const out = freight.calculate({ ...BASE, qtyTotal: 5747, stylePrice: 1.65 }, settings);
  // v5.77 referansı korunmalı: çarpan 1 iken Landed = FOB + birim navlun.
  assert.ok(Math.abs(out.results[0].landed - 2.3901776927092397) < 1e-9);
});

test('v5.80 landed çarpanı yalnız FOB’a uygulanır, navluna değil', () => {
  const settings = freight.normalizeSettings({ ...freight.defaultSettings(), landedMultiplier: 1.11 });
  const input = { ...BASE, qtyTotal: 5747, stylePrice: 1.65 };
  const plain = freight.calculate(input, freight.defaultSettings()).results[0];
  const scaled = freight.calculate(input, settings).results[0];
  // Navlun kısmı aynı kalmalı; yalnız mal bedeli çarpılmalı.
  assert.ok(Math.abs(scaled.perPiece - plain.perPiece) < 1e-12);
  assert.ok(Math.abs(scaled.landed - ((1.65 * 1.11) + plain.perPiece)) < 1e-9);
  assert.equal(freight.normalizeSettings({ landedMultiplier: 0 }).landedMultiplier, 1);
});

test('v5.80 çoklu hesap her satırı kendi adedi ve fiyatıyla ayrı çalıştırır', () => {
  const many = freight.calculateMany([
    { key: 'a', label: 'A', input: { ...BASE, qtyTotal: 5747, stylePrice: 1.65 } },
    { key: 'b', label: 'B', input: { ...BASE, qtyTotal: 2000, stylePrice: 2.00 } },
  ], freight.defaultSettings());

  assert.equal(many.rows.length, 2);
  // Koli sayısı satır başına ayrı yuvarlanır: 5747/132→44, 2000/132→16.
  assert.equal(many.rows[0].result.cartonCount, 44);
  assert.equal(many.rows[1].result.cartonCount, 16);
  // Landed'lar farklı, yani tek toplu hesap yapılmıyor.
  assert.notEqual(many.rows[0].result.results[0].landed, many.rows[1].result.results[0].landed);
  assert.equal(many.completeRows, 2);
  assert.equal(many.incompleteRows, 0);
});

test('v5.80 çoklu toplamlar adede göre ağırlıklı, düz ortalama değil', () => {
  const many = freight.calculateMany([
    { key: 'a', input: { ...BASE, qtyTotal: 5747, stylePrice: 1.65 } },
    { key: 'b', input: { ...BASE, qtyTotal: 2000, stylePrice: 2.00 } },
  ], freight.defaultSettings());
  const air = many.totals[0];
  const rowA = many.rows[0].result.results[0], rowB = many.rows[1].result.results[0];

  assert.equal(air.qtyTotal, 7747);
  assert.ok(Math.abs(air.total - (rowA.total + rowB.total)) < 1e-9);
  assert.ok(Math.abs(air.perPiece - ((rowA.total + rowB.total) / 7747)) < 1e-9);
  const flatAverage = (rowA.perPiece + rowB.perPiece) / 2;
  assert.ok(Math.abs(air.perPiece - flatAverage) > 1e-6, 'ağırlıklı ortalama düz ortalamadan farklı olmalı');
});

test('v5.80 eksik satır toplamı sessizce küçültmez, ayrıca sayılır', () => {
  const many = freight.calculateMany([
    { key: 'a', input: { ...BASE, qtyTotal: 5747, stylePrice: 1.65 } },
    { key: 'b', input: { qtyTotal: 100 } },
  ], freight.defaultSettings());
  assert.equal(many.completeRows, 1);
  assert.equal(many.incompleteRows, 1);
  assert.equal(many.rows[1].result.complete, false);
  assert.equal(many.totals[0].rows, 1);
  assert.equal(many.totals[0].qtyTotal, 5747);
});

test('v5.80 çoklu seçim artık reddedilmiyor, hepsi pencereye taşınıyor', () => {
  const handler = APP.slice(APP.indexOf("document.getElementById('shipFreightBtn')"), APP.indexOf("document.getElementById('shipFreightBtn')") + 700);
  assert.doesNotMatch(handler, /Select a single row|Tek satır seç/);
  assert.match(handler, /openFreightModal\(shipRows\.filter/);
});

test('v5.80 koli ölçüleri tek satırda üç dar kutu olarak çiziliyor', () => {
  assert.match(APP, /const CARTON_KEYS = \['cartonL','cartonW','cartonH'\]/);
  // Üç ölçü ayrı geniş alan olarak DEĞİL, ortak alandan çıkarılıp tek satırda.
  assert.match(APP, /INPUT_FIELDS\.filter\(field=>!CARTON_KEYS\.includes\(field\.key\)\)/);
  assert.match(APP, /class="freightCartonRow"/);
  assert.match(CSS, /\.freightCartonRow\{display:flex/);
});

test('v5.80 ESC en üstteki pencereye iletilir, kademeli kapanır', () => {
  assert.match(APP, /function blTopOverlay\(\)/);
  // Yakalama evresi: modalların kendi dinleyicilerinden önce çalışmalı.
  assert.match(APP, /if\(event\.key!=='Escape' \|\| _blEscRelay\) return;[\s\S]*?\}, true\);/);
  // Odak zaten pencerenin içindeyse araya girilmez — iki kez kapanmasın.
  assert.match(APP, /if\(active && top\.contains\(active\) && active!==document\.body\) return;/);
  // Yalnız en üstteki kapanır: olay yayılımı durdurulur.
  assert.match(APP, /event\.preventDefault\(\); event\.stopPropagation\(\);/);
  // İşlem sürerken çıkılamayan perde listeye girmemeli.
  assert.doesNotMatch(APP.slice(APP.indexOf('const BL_OVERLAY_SELECTOR'), APP.indexOf('function blOverlayStack')), /appBlockingOverlay/);
});

test('v5.80 pencere üzerindeki tekerlek arkadaki sayfayı kaydırmaz', () => {
  assert.match(APP, /document\.addEventListener\('wheel'[\s\S]*?\{passive:false\}\)/);
  assert.match(APP, /function _blScrollableAncestor\(node, root, deltaY\)/);
  // Sınıra gelmiş bir kaydırma alanı "kaydırılabilir" sayılmamalı.
  assert.match(APP, /if\(!\(\(deltaY<0&&atTop\)\|\|\(deltaY>0&&atBottom\)\)\) return el;/);
  assert.match(CSS, /overscroll-behavior:contain/);
});

test('v5.80 CTRL+C etkin sayfanın Kopyala düğmesini çalıştırır', () => {
  const block = APP.slice(APP.indexOf('function blActiveCopyButton'), APP.indexOf("document.getElementById('navCopy').addEventListener"));
  assert.match(block, /tab==='koleksiyon' \? 'kolCopySelectedBtn' : 'navCopy'/);
  // Yazarken ya da metin seçiliyken tarayıcının kendi kopyalaması bozulmamalı.
  assert.match(block, /input,textarea,select,\[contenteditable="true"\]/);
  assert.match(block, /!selection\.isCollapsed\) return;/);
  // Açık pencere varken sayfa kopyalaması tetiklenmemeli.
  assert.match(block, /if\(blOverlayOpen\(\)\) return;/);
  // Devre dışı ya da görünmeyen düğme tıklanmamalı.
  assert.match(block, /node\.disabled \|\| !node\.offsetParent/);
});
