'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const LFL = fs.readFileSync(path.join(ROOT, 'public', 'lfl.js'), 'utf8');
const OAB = fs.readFileSync(path.join(ROOT, 'public', 'oab.js'), 'utf8');
const QUOTATIONS = fs.readFileSync(path.join(ROOT, 'public', 'quotations.js'), 'utf8');

function block(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Başlangıç bulunamadı: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Bitiş bulunamadı: ${end}`);
  return source.slice(from, to);
}

test('LUNA 4 ortak görsel runtime gecikmeli hover, kuyruk ve negatif cache sağlar', () => {
  assert.match(APP, /const BLImageRuntime\s*=\s*\(\(\)=>/);
  assert.match(APP, /IMAGE_HOVER_DELAY\s*=\s*140/);
  assert.match(APP, /IMAGE_REQUEST_CONCURRENCY\s*=\s*4/);
  assert.match(APP, /IntersectionObserver/);
  assert.match(APP, /inFlight/);
  assert.match(APP, /failed/);
  assert.match(APP, /scheduleHover/);
  assert.match(APP, /invalidate/);
});

test("LUNA 4 tablo görselleri gerçek kaynağı viewport görünene kadar data-src'te tutar", () => {
  for (const name of ['cpImageCellHtml', 'ordersImageCellHtml']) {
    const source = block(APP, `function ${name}`, name === 'cpImageCellHtml' ? 'function cpImageRowById' : 'function ordersCellHtml');
    assert.match(source, /data-src=/, name);
    assert.match(source, /loading="lazy"/, name);
    assert.match(source, /decoding="async"/, name);
    assert.match(source, /fetchpriority="low"/, name);
  }
  const collection = block(APP, 'const collectionImageSource=', 'const confirmed=');
  assert.match(collection, /data-src=/);
  assert.match(collection, /loading="lazy"/);
  assert.match(collection, /decoding="async"/);
});

test('LUNA 4 CP, Orders ve Collection hoverı ortak gecikmeli runtimea bağlıdır', () => {
  assert.match(APP, /BLImageRuntime\.scheduleHover\(img,event\)/);
  assert.match(APP, /BLImageRuntime\.cancelHover\(\)/);
  assert.doesNotMatch(block(APP, 'function bindCpImageNode', 'function bindCpImageCells'), /kolShowImgPopup\(img\.src/);
  assert.doesNotMatch(block(APP, 'function bindOrdersImageHover', 'function ordersCycleImageSize'), /kolShowImgPopup\(img\.src/);
  assert.doesNotMatch(block(APP, 'const collectionImageTitle=', "tbody.innerHTML=''"), /kolShowImgPopup\(img\.currentSrc\|\|img\.src/);
});

test('LUNA 4 detay tabloları lazy ve gecikmeli hover desteğini korur', () => {
  assert.match(block(APP, 'function detailImageCellHtml', '// "Model görsellerini göster"'), /loading="lazy"/);
  assert.match(OAB, /BLDetailImages\.thumbHtml|detailModelThumb[^`]*loading="lazy"/);
  assert.match(LFL, /BLDetailImages\.thumbHtml/);
  assert.match(QUOTATIONS, /qCachedModelThumb/);
  assert.match(QUOTATIONS, /classes:'quotationModelThumb'/);
  assert.match(QUOTATIONS, /classes:'qhModelImage'/);
});

test('LUNA 4 görsel güncelleme ve silme işlemleri cachei geçersiz kılar', () => {
  assert.match(block(APP, 'async function kolPersistImageData', 'async function kolSetRowImageFile'), /BLImageRuntime\.invalidate/);
  assert.match(block(APP, 'async function kolRemoveRowImage', 'function loadKolRows'), /BLImageRuntime\.invalidate/);
  assert.match(block(APP, 'async function cpSaveRowImage', 'async function cpRemoveRowImage'), /BLImageRuntime\.invalidate/);
  assert.match(block(APP, 'async function cpRemoveRowImage', 'function cpApplyImageRowHeight'), /BLImageRuntime\.invalidate/);
  assert.match(block(APP, 'function applySyncedPlmImages', 'async function plmJsonRequest'), /BLImageRuntime\.invalidate/);
  assert.match(block(APP, "if(Object.prototype.hasOwnProperty.call(patch,'imageRef'))", '// Kullanıcı şu an hangi satırı düzenliyor?'), /BLImageRuntime\.invalidate/);
});
