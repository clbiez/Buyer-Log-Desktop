'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
// Uygulama çekirdeği index.html'den public/app-main.js'e taşındı; test ortak
// image-size ölçü helper'ını doğrudan izole ederek çalıştırır.
const html = fs.readFileSync(path.join(root, 'public', 'app-main.js'), 'utf8');

function loadHeightApi() {
  const start = html.indexOf('const TABLE_IMAGE_SIZE_CONFIG=');
  const end = html.indexOf('let cpImageSize', start);
  assert.ok(start >= 0 && end > start);
  const source = `${html.slice(start, end)}
let kolImgSize=tableImageSizeBounds('koleksiyon').max;
function kolImgDims(){return tableImageSizeDimensions('koleksiyon',kolImgSize);}
function kolCompactMinRowHeight(){return 28;}
function kolFitImageDimensions(naturalWidth,naturalHeight,maxWidth,maxHeight,{allowUpscale=false}={}){
  const nw=Math.max(1,Number(naturalWidth)||1),nh=Math.max(1,Number(naturalHeight)||1);
  const mw=Math.max(1,Number(maxWidth)||1),mh=Math.max(1,Number(maxHeight)||1);
  const scale=Math.min(allowUpscale?Number.POSITIVE_INFINITY:1,mw/nw,mh/nh);
  return {width:nw*scale,height:nh*scale,scale};
}
function kolCompactRowHeightForDimensions(){return kolImgDims().row;}
this.__heightApi={kolCompactMinRowHeight,kolCompactRowHeightForDimensions,kolFitImageDimensions,setSize(value){kolImgSize=normalizeTableImageSizeValue('koleksiyon',value);}};`;
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.__heightApi;
}

// v6.x — CP/Orders'daki aynı titreme düzeltmesi (bkz. image-sizing-email-v503.test.js,
// cpApplyImageRowHeight) Koleksiyon'a da uygulandı: satır yüksekliği artık görselin
// gerçek en-boy oranından değil, yalnız seçili boyut kademesinden (large/medium) geliyor.
// kolCompactRowHeightForDimensions'ın parametreleri bilerek alt çizgiyle işaretlenmiş
// (_naturalWidth, _naturalHeight, _hasImage) — kasıtlı olarak kullanılmıyorlar. "small"
// kademesi de v5.85'te kaldırıldı (22×18 px'de görsel ayırt edilemiyordu). Görselin
// kendisi hâlâ hücre içinde en-boy oranını koruyarak ölçekleniyor
// (kolApplyCompactImageRowHeight/kolFitImageDimensions) — yalnız SATIR yüksekliği artık
// sabit. Sanallaştırılmış listede kaydırma titremesini önlemek için bilinçli tasarım.

test('Collection rows use a compact baseline regardless of image presence or dimensions', () => {
  const api = loadHeightApi();
  assert.equal(api.kolCompactMinRowHeight(), 28);
  api.setSize(38);
  assert.equal(api.kolCompactRowHeightForDimensions(0, 0, false), 34);
  assert.equal(api.kolCompactRowHeightForDimensions(1200, 800, true), 34, 'gerçek boyutlar satır yüksekliğini değiştirmemeli');
});

test('Collection row height is fixed per size mode, not per image aspect ratio', () => {
  const api = loadHeightApi();
  api.setSize(60);
  const wide = api.kolCompactRowHeightForDimensions(1600, 900, true);
  const portrait = api.kolCompactRowHeightForDimensions(900, 1600, true);
  assert.equal(wide, 44);
  assert.equal(portrait, 44, 'geniş ve dikey görsel aynı satır yüksekliğini almalı — oran artık satırı etkilemiyor');
});

test('Collection image-size modes remain progressively compact (large/medium, small removed)', () => {
  const api = loadHeightApi();
  api.setSize(60);
  const large = api.kolCompactRowHeightForDimensions(900, 1600, true);
  api.setSize(38);
  const medium = api.kolCompactRowHeightForDimensions(900, 1600, true);
  assert.deepEqual([large, medium], [44, 34]);
  assert.match(html, /preferenceKey:'lcw\.koleksiyon\.imageSize\.v2'/);
});

test('Collection renderer applies row-scoped height after each thumbnail load', () => {
  assert.match(html, /data-has-image="\$\{hasCollectionImage\?'1':'0'\}"/);
  assert.match(html, /max-width:\$\{hasCollectionImage\?_imgDim\.w:22\}px/);
  assert.match(html, /kolApplyCompactImageRowHeight\(img\)/);
  assert.match(html, /img\.addEventListener\('load',compactRow,\{once:true\}\)/);
  const css = fs.readFileSync(path.join(root, 'public', 'app.css'), 'utf8');
  assert.match(css, /#kolTable tbody tr\{height:var\(--kol-row-h,34px\);\}/);
  assert.match(css, /#kolTable tbody td\.kolPictureCell/);
});


test('Collection image resizing writes width and height from one shared scale factor', () => {
  const api = loadHeightApi();
  const landscape=api.kolFitImageDimensions(1600,900,88,82);
  const portrait=api.kolFitImageDimensions(900,1600,88,82);
  assert.ok(Math.abs((landscape.width/landscape.height)-(1600/900))<1e-12);
  assert.ok(Math.abs((portrait.width/portrait.height)-(900/1600))<1e-12);
  assert.match(html,/img\.style\.width=`\$\{fitted\.width\}px`/);
  assert.match(html,/img\.style\.height=`\$\{fitted\.height\}px`/);
});

test('Collection Status keeps native select lifecycle while rendering shared catalog pill semantics', () => {
  assert.match(html,/\{k:'durum', label:'Durum', w:170, status:true\}/);
  assert.match(html,/else if\(c\.status\)/);
  assert.match(html,/class="editCell kolStatusNoArrow"/);
  assert.match(html,/kolStatusEntries\(\)/);
  assert.match(html,/statusValue=kolStatusCanonicalName\(val\)/);
  assert.match(html,/kolStatusColor\(statusValue\)/);
  const css=fs.readFileSync(path.join(root,'public','app.css'),'utf8');
  assert.match(css,/#kolTable select\.kolStatusNoArrow/);
  assert.match(css,/appearance:none/);
  assert.match(css,/--kol-status-color/);
  assert.match(css,/border-radius:999px/);
});
