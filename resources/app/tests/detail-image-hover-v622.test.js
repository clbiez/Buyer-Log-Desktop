'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v6.22 every drill-down model image uses the shared CP hover preview', () => {
  assert.match(APP, /function bindDetailModelThumb\(img\)/);
  assert.match(APP, /img\.addEventListener\('mouseenter',[\s\S]*BLImageRuntime\.scheduleHover\(img,event\)/);
  assert.match(APP, /img\.addEventListener\('mousemove',[\s\S]*kolPositionPopup\(popup,event\)/);
  assert.match(APP, /img\.addEventListener\('mouseleave',kolHideImgPopup\)/);
  assert.match(APP, /new MutationObserver\([\s\S]*bindDetailModelThumbs\(node\)/);
});

test('v6.22 Backlog and both LFL detail renderers mark hoverable thumbnails', () => {
  assert.match(APP, /detailImageCellHtml[\s\S]*detailImageThumbHtml/);
  assert.match(APP, /classes=norm\(options\.classes\)\|\|'detailModelThumb'/);
  // v11.11: iki LFL detay çizicisi de AYNI ortak yardımcıdan geçer. Korunan
  // regression değişmedi (her iki pencere de ortak hover thumb'ı üretir);
  // yalnız iki kopya tek bir çağrı noktasında toplandı.
  assert.equal((LFL.match(/BLDetailImages\.thumbHtml/g)||[]).length, 1);
  assert.match(LFL, /function lflModelImageCellHtml\(row,imageIndex,title\)/);
  assert.equal((LFL.match(/lflModelImageCellHtml\(row,imageIndex/g)||[]).length, 3);
  assert.match(CSS, /\.detailImgCell img\.detailModelThumb\{cursor:zoom-in/);
  assert.doesNotMatch(APP.slice(APP.indexOf('function detailImageCellHtml'), APP.indexOf('// "Model görsellerini göster"')), /cpThumb|kolThumb/);
});
