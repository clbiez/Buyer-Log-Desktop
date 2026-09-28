'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, 'public', name), 'utf8');
const JS = read('lfl.js');
const CSS = read('lfl.css');
const HTML = read('index.html');

test('LFL comparison ve manufacturer panellerinde yatay yükseklik ayırıcıları bulunur', () => {
  assert.match(HTML, /id="lflGroupHeightHandle"[^>]*aria-orientation="horizontal"/);
  assert.match(HTML, /id="lflManufacturerHeightHandle"[^>]*aria-orientation="horizontal"/);
  assert.match(HTML, /lflAnalysisResizableCard/);
});

test('LFL ana analiz tabloları render ve toolbar işlemlerinde sabit yükseklikte kalır', () => {
  assert.match(CSS, /\.lflAnalysisGrid \.lflTableWrap:not\(\.lflManualHeight\)\{[^}]*height:clamp\(220px,34vh,360px\)!important;[^}]*max-height:clamp\(220px,34vh,360px\)!important;[^}]*min-height:0;[^}]*overflow-y:auto;/s);
  assert.match(CSS, /\.lflAnalysisGrid>\.lflAnalysisResizableCard\{[^}]*align-self:start[^}]*height:auto/s);
});

test('LFL tablo yükseklikleri kullanıcı bazında kalıcıdır ve sıfırlanabilir', () => {
  assert.match(JS, /ANALYSIS_HEIGHTS_KEY='lcw\.lfl\.analysisHeights\.v1'/);
  assert.match(JS, /function initAnalysisHeightResizers\(\)/);
  assert.match(JS, /BLStorage\.setItem\(ANALYSIS_HEIGHTS_KEY,JSON\.stringify\(saved\)\)/);
  assert.match(JS, /event\.key==='Home'/);
  assert.match(JS, /handle\.addEventListener\('dblclick'/);
  assert.match(JS, /initAnalysisHeightResizers\(\);/);
});

test('LFL manuel yükseklik gerçek viewport yüksekliğidir', () => {
  assert.match(CSS, /\.lflAnalysisGrid \.lflTableWrap\.lflManualHeight\{[^}]*height:var\(--lfl-manual-height\)!important;[^}]*max-height:var\(--lfl-manual-height\)!important;[^}]*min-height:0;[^}]*overflow-y:auto;/s);
});

test('LFL geç layout kuralı analiz tablolarının sabit yüksekliğini ezmez', () => {
  const marker = '/* v3.98 — LFL layout consolidation.';
  const start = CSS.indexOf(marker);
  assert.notEqual(start, -1);
  const block = CSS.slice(start, CSS.indexOf('.lflDetailAccessPanel', start));
  assert.doesNotMatch(block, /height:auto;max-height:none/);
  assert.doesNotMatch(block, /overflow-y:visible/);
  assert.match(block, /overflow-x:auto;overflow-y:auto/);
});

test('LFL Columns paneli tıklanan Columns düğmesine sabitlenir', () => {
  assert.match(JS, /const trigger=event\.currentTarget/);
  assert.match(JS, /panel\._buyerLogAnchor=trigger/);
  assert.match(JS, /positionBuyerLogPopup\(panel,trigger\)/);
  assert.match(JS, /openLflColumnPanel\._buyerLogAnchor=null/);
});
