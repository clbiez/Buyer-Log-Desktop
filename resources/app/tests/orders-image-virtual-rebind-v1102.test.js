'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Baslangic bulunamadi: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Bitis bulunamadi: ${end}`);
  return source.slice(from, to);
}

// Orders tablosu pencereli cizilir: kaydirma her seferinde tbody icerigini
// yeniden olusturur. Bu testler, yeni olusan goruntu hucrelerinin de lazy-load
// katmanina baglandigini garanti eder; aksi halde ayni kayit bir pencerede
// gorselli, bir sonrakinde gorselsiz gorunur.
test('v1102 Orders tablosu pencereli cizim kullanir', () => {
  const render = block(APP, 'function renderOrdersNow', 'function markDirty');
  assert.match(render, /renderFullTable\('ordersTable'/);
  assert.match(render, /virtualize:true/);
  assert.match(render, /bindOrdersImageHover\(\)/);
});

test('v1102 Orders gorsel hucresi tek dugum bazli baglayici kullanir', () => {
  const node = block(APP, 'function bindOrdersImageNode', 'function bindOrdersImageHover');
  assert.match(node, /if\(!img\|\|img\.dataset\.ordersImageBound==='1'\)return;/);
  assert.match(node, /img\.dataset\.ordersImageBound='1';/);
  assert.match(node, /BLImageRuntime\.observe\(img\);/);
});

test('v1102 Orders sonradan eklenen satirlari MutationObserver ile baglar', () => {
  const bind = block(APP, 'function bindOrdersImageHover', 'function ordersCycleImageSize');
  assert.match(bind, /table\.querySelectorAll\('tbody img\.cpThumb'\)\.forEach\(bindOrdersImageNode\)/);
  assert.match(bind, /table\._ordersImageObserver=new MutationObserver\(/);
  assert.match(bind, /bindOrdersImageNode\(node\)/);
  assert.match(bind, /querySelectorAll\('img\.cpThumb'\)\.forEach\(bindOrdersImageNode\)/);
  assert.match(bind, /observe\(table\.tBodies\[0\]\|\|table,\{childList:true,subtree:true\}\)/);
});

test('v1102 CP tablosu ayni yeniden baglama sozlesmesini korur', () => {
  const bind = block(APP, 'function bindCpImageCells', 'function cpCycleImageSize');
  assert.match(bind, /table\._cpImageObserver=new MutationObserver\(/);
  assert.match(bind, /observe\(table\.tBodies\[0\]\|\|table,\{childList:true,subtree:true\}\)/);
});

test('v1102 gorsel kaynagi kanonik registry uzerinden cozulur', () => {
  const cell = block(APP, 'function ordersImageCellHtml', 'function ordersCellHtml');
  assert.match(cell, /canonicalModelImageSource\(modelId,colourCode,[^)]+\)/);
  assert.match(cell, /canonicalModelImageKnown\(modelId,colourCode,[^)]+\)/);
  // Kayitli gorseli olmayan satir yanlis bir kaynaga dusurulmez.
  assert.match(cell, /source=canonicalKnown\?canonical:\(has\?row\._imageUrl:''\)/);
  assert.match(cell, /data-has-image="\$\{has\?'1':'0'\}"/);
});
