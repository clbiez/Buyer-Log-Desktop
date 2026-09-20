'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const INDEX = (fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8'));
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

test('v4.95 Collection picture cell opens the same anchored delete confirmation as CP', () => {
  assert.match(INDEX, /data-kol-image-id="\$\{r\.id\}"/);
  assert.match(INDEX, /tbody\.querySelectorAll\('\.kolPictureCell'\)\.forEach\(cell=>/);
  assert.match(INDEX, /img\.addEventListener\('contextmenu',event=>\{/);
  assert.match(INDEX, /event\.preventDefault\(\);event\.stopPropagation\(\);/);
  assert.match(INDEX, /kolHideImgPopup\(\)/);
  assert.match(INDEX, /openImageDeleteConfirm\(img,\{message:appLang==='en'\?'Remove this Collection image\?'/);
  assert.match(INDEX, /onConfirm:\(\)=>kolRemoveRowImage\(row\)/);
});

test('v4.95 Collection model images are centered inside Picture cells', () => {
  assert.match(CSS, /#kolTable tbody td\.kolPictureCell\{[\s\S]*?text-align:center!important;[\s\S]*?vertical-align:middle!important;/);
  assert.match(CSS, /#kolTable tbody td\.kolPictureCell \.kolThumb\{[\s\S]*?margin-left:auto!important;[\s\S]*?margin-right:auto!important;/);
});
