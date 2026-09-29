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

test('LFL comparison ve manufacturer panelleri sabit wrapper kimlikleri ve yatay yükseklik ayırıcıları kullanır', () => {
  assert.match(HTML, /id="lflGroupTableWrap"/);
  assert.match(HTML, /id="lflManufacturerVolume"/);
  assert.match(HTML, /id="lflGroupHeightHandle"[^>]*aria-orientation="horizontal"/);
  assert.match(HTML, /id="lflManufacturerHeightHandle"[^>]*aria-orientation="horizontal"/);
  assert.match(HTML, /lflAnalysisResizableCard/);
});

test('LFL ana analiz tabloları render ve toolbar işlemlerinde sabit yükseklikte kalır', () => {
  assert.match(CSS, /#view-lfl #lflGroupTableWrap,[\s\S]*#view-lfl #lflManufacturerVolume\{[^}]*height:360px!important;[^}]*max-height:360px!important;[^}]*overflow-y:auto!important;/);
  assert.match(CSS, /\.lflAnalysisGrid>\.lflAnalysisResizableCard\{[^}]*align-self:start!important[^}]*height:auto!important/s);
  assert.match(JS, /ANALYSIS_HEIGHT_DEFAULT=360/);
  assert.match(JS, /style\.setProperty\('height',`\$\{height\}px`,'important'\)/);
  assert.match(JS, /style\.setProperty\('max-height',`\$\{height\}px`,'important'\)/);
  assert.match(JS, /renderGroupTable\(a\);renderManufacturerVolumes\(a\);renderCustomCompare\(a\);syncAnalysisHeights\(\);/);
});

test('LFL tablo yükseklikleri kullanıcı bazında kalıcıdır ve sıfırlanabilir', () => {
  assert.match(JS, /ANALYSIS_HEIGHTS_KEY='lcw\.lfl\.analysisHeights\.v1'/);
  assert.match(JS, /function initAnalysisHeightResizers\(\)/);
  assert.match(JS, /BLStorage\.setItem\(ANALYSIS_HEIGHTS_KEY,JSON\.stringify\(saved\)\)/);
  assert.match(JS, /event\.key==='Home'/);
  assert.match(JS, /handle\.addEventListener\('dblclick'/);
  assert.match(JS, /initAnalysisHeightResizers\(\);/);
});

test('LFL manuel yükseklik yalnız kullanıcı resize state’i ile sabit viewport değerini değiştirir', () => {
  assert.match(CSS, /#view-lfl #lflGroupTableWrap\.lflManualHeight,[\s\S]*#view-lfl #lflManufacturerVolume\.lflManualHeight\{[^}]*height:var\(--lfl-manual-height,360px\)!important;[^}]*max-height:var\(--lfl-manual-height,360px\)!important;/);
  assert.match(JS, /wrap\.classList\.toggle\('lflManualHeight',isManual\)/);
  assert.match(JS, /function syncAnalysisHeights\(\)/);
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
