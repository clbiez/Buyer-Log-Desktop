'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'public', 'app.css'), 'utf8');

function imageSizeApi() {
  const start = APP.indexOf('const TABLE_IMAGE_SIZE_CONFIG');
  const end = APP.indexOf('let cpImageSize', start);
  assert.ok(start >= 0 && end > start, 'ortak image-size helper bulunmalı');
  return new Function(`${APP.slice(start, end)}; return {tableImageSizeBounds,tableImageSizeDimensions};`)();
}

test('shared image-size bounds use current minimum and triple current maximum', () => {
  const { tableImageSizeBounds } = imageSizeApi();
  for (const tableKey of ['cp', 'orders', 'koleksiyon']) {
    const bounds = tableImageSizeBounds(tableKey);
    assert.equal(bounds.min, tableKey === 'koleksiyon' ? 38 : 42);
    assert.equal(bounds.max, tableKey === 'koleksiyon' ? 180 : 198);
    assert.ok(bounds.max > bounds.min);
  }
});

test('shared image-size dimensions interpolate continuously and preserve aspect ratio limits', () => {
  const { tableImageSizeDimensions } = imageSizeApi();
  const min = tableImageSizeDimensions('cp', 42);
  const midpoint = tableImageSizeDimensions('cp', 54);
  const max = tableImageSizeDimensions('cp', 198);
  assert.equal(min.w, 42);
  assert.equal(min.h, 28);
  assert.equal(max.w, 198);
  assert.equal(max.h, 120);
  assert.ok(midpoint.w > min.w && midpoint.w < max.w);
  assert.ok(midpoint.h > min.h && midpoint.h < max.h);
  assert.equal(tableImageSizeDimensions('koleksiyon', 180).h, 114);
});

test('CP, Orders and Collection use one anchored range popover instead of size cycles', () => {
  assert.match(APP, /function openTableImageSizePopover\(/);
  assert.match(APP, /type=['"]range['"]/);
  assert.match(APP, /requestAnimationFrame/);
  assert.match(APP, /cpImage:tableImageSizeDimensions\(tableKey,tableImageSizeBounds\(tableKey\)\.min\)\.col/);
  assert.match(APP, /openTableImageSizePopover\(th,tableKey\)/);
  assert.match(APP, /openTableImageSizePopover\(kolPicTh,'koleksiyon'\)/);
  assert.doesNotMatch(APP, /cpImageSize=cpImageSize==='medium'\?'large':'medium'/);
  assert.doesNotMatch(APP, /kolImgSize=kolImgSize==='medium'\?'large':'medium'/);
  assert.match(CSS, /\.tableImageSizePopover/);
  const setStart = APP.indexOf('function setTableImageSize(');
  const setEnd = APP.indexOf('let _tableImageSizePopover', setStart);
  const setBlock = APP.slice(setStart, setEnd);
  assert.doesNotMatch(setBlock, /BLImageRuntime|renderCP\(\)|renderOrders\(\)|renderKol\(\)/);
  assert.match(setBlock, /scheduleTableImageSizeDom\(tableKey\)/);
});

test('image-size preferences are stored separately for each table', () => {
  const { tableImageSizeBounds } = imageSizeApi();
  assert.match(APP, /lcw\.cp\.imageSize\.v2/);
  assert.match(APP, /lcw\.orders\.imageSize\.v2/);
  assert.match(APP, /lcw\.koleksiyon\.imageSize\.v2/);
  assert.deepEqual(tableImageSizeBounds('cp'), tableImageSizeBounds('orders'));
});
