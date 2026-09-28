'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'public', 'app-main.js'), 'utf8');

function between(start, end) {
  const from = APP.indexOf(start);
  const to = APP.indexOf(end, from + start.length);
  assert.ok(from >= 0, `başlangıç bulunamadı: ${start}`);
  assert.ok(to > from, `bitiş bulunamadı: ${end}`);
  return APP.slice(from, to);
}

test('PLM image override payload keeps Royalty/Licensor master state', () => {
  const source = between('function mergeImageOverridePayload', 'function syncModelImageRegistry');
  const mergeImageOverridePayload = new Function(`${source}; return mergeImageOverridePayload;`)();

  const pricingRules = [{ id:'r1', licensor:'DTR', license:'Marvel', royalty:12, hologramCost:0.05 }];
  const current = {
    pricingRules,
    nonDtrManufacturers:['Factory A'],
    _revision:31,
    _revisions:{ pricingRules:9, nonDtrManufacturers:4, orders:6 },
    imagemap:{ old:'old-ref' },
  };
  const incoming = { _revision:32, _revisions:{ orders:7 }, imagemap:{ fresh:'new-ref' } };
  const merged = mergeImageOverridePayload(current, incoming);

  assert.deepEqual(merged.pricingRules, pricingRules, 'image-only payload must not erase royalty rules');
  assert.deepEqual(merged.nonDtrManufacturers, ['Factory A']);
  assert.equal(merged._revisions.pricingRules, 9, 'pricing rule revision must survive a partial image response');
  assert.equal(merged._revisions.nonDtrManufacturers, 4);
  assert.equal(merged._revisions.orders, 7);
  assert.deepEqual(merged.imagemap, { fresh:'new-ref' });
  assert.equal(merged._revision, 32);
});

test('all image/link hydration paths merge partial overrides instead of replacing state.overrides', () => {
  assert.equal((APP.match(/state\.overrides=data\.overrides/g)||[]).length, 0,
    'partial image response must never wholesale-replace state.overrides');

  const sharedHydrate = between('const flushSharedHydrate=async()=>', 'const scheduleSharedHydrate=');
  assert.ok(sharedHydrate.includes('state.overrides=mergeImageOverridePayload(state.overrides,data.overrides)'));

  const linkedImage = between('async function kolPlmLinkImageEverywhere', 'async function kolPlmPersistImportedImage');
  assert.ok(linkedImage.includes('state.overrides=mergeImageOverridePayload(state.overrides,data.overrides)'));

  const syncedImages = between('function applySyncedPlmImages', 'function notifyPlmOperationStarted');
  assert.ok(syncedImages.includes('state.overrides=mergeImageOverridePayload(state.overrides,data.overrides)'));
});

test('PLM Sync still recalculates Collection Royalty/Licensor from retained rules on repaint', () => {
  const start = APP.indexOf('function renderKol(){');
  assert.ok(start >= 0, 'renderKol bulunmalı');
  const render = APP.slice(start, start + 1800);
  assert.ok(render.includes('kolSyncLicensorsFromRules({save:false})'));
  assert.ok(render.includes('kolSyncRulePricing({save:true})'));
});
